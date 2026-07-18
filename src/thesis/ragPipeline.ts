import { useSkeletonStore } from '../stores/skeletonStore';
import { useAnimationStore } from '../stores/animationStore';
import { useEditorStore } from '../stores/editorStore';
import { loadRagDatasetFromItems } from './rag/retrieval/loader';
import { buildRagQueryContext } from './rag/retrieval/queryBuilder';
import { retrieveAnimationDecision } from './rag/retrieval/retriever';
import { buildSemanticBoneMap } from './rag/adaptation/boneMapper';
import { flattenDatasetKeyframes } from './rag/adaptation/keyframeAdapter';
import type {
  RagAmbiguityResolution,
  RagAnimationDatasetItem,
  RagMatchType,
} from './rag/types/ragTypes';
import type { FlatKeyframeEntry } from './rag/adaptation/keyframeAdapter';

// Compact, serializable summary of a scored candidate for explainable results.
export interface RagCandidateSummary {
  id: string;
  name: string;
  score: number;
  matchType: RagMatchType;
  reasons: string[];
}

// Bundle all dataset JSONs at build time via Vite glob.
// Path is relative to this file (src/thesis/ → ../../data/rag/animations/).
const datasetModules = import.meta.glob('../../data/rag/animations/*.json', { eager: true });

const loadDataset = (): RagAnimationDatasetItem[] => {
  const items = Object.values(datasetModules).map((mod) => {
    const m = mod as Record<string, unknown>;
    return 'default' in m ? m.default : m;
  });
  return loadRagDatasetFromItems(items);
};

export interface RagPipelineResult {
  item: RagAnimationDatasetItem;
  score: number;
  reasons: string[];
  // How the selected item was chosen (exact id/name/alias, variant, family, category, token).
  matchType: RagMatchType;
  selectionSource: RagMatchType;
  // True when several candidates scored closely and no exact id/name/variant was given.
  ambiguous: boolean;
  ambiguityResolution: RagAmbiguityResolution | null;
  // Top candidates (selected first) with scores and reasons, for transparency.
  candidates: RagCandidateSummary[];
  // sourceBoneName → targetBoneName for bones that were successfully mapped
  mappedBones: Record<string, string>;
  keyframeCount: number;
  flatKeyframes: FlatKeyframeEntry[];
}

const MIN_RAG_SCORE = 5;
const MIN_MAPPED_BONES = 3;

// Build a target semantic mapping by checking which source bone names from the dataset
// also exist in the active rig. Falls back gracefully when rigs differ.
const buildTargetSemanticMapping = (
  datasetBoneMapping: Record<string, string>,
  activeBoneNames: string[],
): Record<string, string> => {
  const mapping: Record<string, string> = {};
  const lowerActive = activeBoneNames.map((n) => n.toLowerCase());
  for (const [semantic, sourceName] of Object.entries(datasetBoneMapping)) {
    const idx = lowerActive.indexOf(sourceName.toLowerCase());
    if (idx !== -1) {
      // Map semantic label to the actual cased bone name in the active rig
      mapping[semantic] = activeBoneNames[idx]!;
    }
  }
  return mapping;
};

// Run the full RAG pipeline: retrieve best-matching animation and adapt it to the active rig.
export const runRagPipeline = (prompt: string): RagPipelineResult => {
  const dataset = loadDataset();
  if (dataset.length === 0) throw new Error('RAG dataset is empty — check data/rag/animations/');

  const activeBones = useSkeletonStore.getState().bones;
  if (activeBones.length === 0) throw new Error('No bones in active rig');

  const activeBoneNames = activeBones.map((b) => b.name);

  const query = buildRagQueryContext(prompt, activeBoneNames);
  const decision = retrieveAnimationDecision(dataset, query, 3);
  const top = decision.selected;
  if (top.score < MIN_RAG_SCORE) {
    throw new Error(
      `No confident RAG match for prompt "${prompt}" (top score ${top.score}, minimum ${MIN_RAG_SCORE})`,
    );
  }

  const { item, score, reasons, matchType } = top;
  const candidates: RagCandidateSummary[] = decision.candidates.map((c) => ({
    id: c.item.id,
    name: c.item.name,
    score: c.score,
    matchType: c.matchType,
    reasons: c.reasons,
  }));

  const targetSemanticMapping = buildTargetSemanticMapping(item.boneMapping, activeBoneNames);
  const mappedBones = buildSemanticBoneMap(item.boneMapping, targetSemanticMapping);
  const mappedBoneCount = Object.keys(mappedBones).length;
  if (mappedBoneCount < MIN_MAPPED_BONES) {
    throw new Error(
      `RAG match "${item.id}" only mapped ${mappedBoneCount} bone(s); minimum ${MIN_MAPPED_BONES} required`,
    );
  }

  const flatKeyframes = flattenDatasetKeyframes(item.animation, mappedBones);
  if (flatKeyframes.length === 0) {
    throw new Error(`RAG match "${item.id}" produced no applicable keyframes for the active rig`);
  }

  return {
    item,
    score,
    reasons,
    matchType,
    selectionSource: decision.selectionSource,
    ambiguous: decision.ambiguous,
    ambiguityResolution: decision.ambiguityResolution,
    candidates,
    mappedBones,
    keyframeCount: flatKeyframes.length,
    flatKeyframes,
  };
};

// Apply a pipeline result to the active editor timeline.
// Switches to animate mode, clears the target frame range, sets duration/fps, writes keyframes.
export const applyRagAnimation = (result: RagPipelineResult): void => {
  const animation = useAnimationStore.getState();
  const editor = useEditorStore.getState();
  const skeleton = useSkeletonStore.getState();

  editor.setMode('animate');

  // Clear existing keyframes in the target range
  const endFrame = result.item.animation.duration;
  const currentKfs = animation.keyframes;
  Object.entries(currentKfs).forEach(([boneIdStr, boneKfs]) => {
    const boneId = Number(boneIdStr);
    Object.keys(boneKfs)
      .map(Number)
      .filter((f) => f >= 0 && f <= endFrame)
      .forEach((f) => animation.deleteKeyframe(boneId, f));
  });

  animation.setDuration(Math.max(10, Math.min(300, endFrame)));
  animation.setFps(Math.max(1, Math.min(120, result.item.animation.fps)));

  const originalFrame = animation.frame;

  for (const kf of result.flatKeyframes) {
    const bone = skeleton.bones.find(
      (b) => b.name.toLowerCase() === kf.boneName.toLowerCase(),
    );
    if (!bone) continue;

    animation.setFrame(kf.frame);
    animation.insertKeyframe(bone.id, {
      x: kf.x,
      y: kf.y,
      rotation: kf.rotation,
      scaleX: kf.scaleX,
      scaleY: kf.scaleY,
      easing: kf.easing,
    });
  }

  animation.setFrame(originalFrame);
  animation.applyKeyframes();
};
