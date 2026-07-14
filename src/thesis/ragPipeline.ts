import { useSkeletonStore } from '../stores/skeletonStore';
import { useAnimationStore } from '../stores/animationStore';
import { useEditorStore } from '../stores/editorStore';
import { loadRagDatasetFromItems } from './rag/retrieval/loader';
import { buildRagQueryContext } from './rag/retrieval/queryBuilder';
import { retrieveTopAnimations } from './rag/retrieval/retriever';
import { buildSemanticBoneMap } from './rag/adaptation/boneMapper';
import { flattenDatasetKeyframes } from './rag/adaptation/keyframeAdapter';
import { clampDuration, clampFps } from './rag/shared/clamps';
import { combineModifiers, detectRawCopyIntent, parseMotionModifiers } from './rag/synthesis/promptIntent';
import { analyzeMotionPattern } from './rag/synthesis/motionAnalyzer';
import { synthesizeKeyframes } from './rag/synthesis/keyframeSynthesizer';
import { deriveBaselineModifiers } from './rag/synthesis/ensembleLearning';
import type { EnsembleMember } from './rag/synthesis/ensembleLearning';
import type { RagAnimationDatasetItem } from './rag/types/ragTypes';
import type { FlatKeyframeEntry } from './rag/adaptation/keyframeAdapter';
import type {
  MotionModifiers,
  MotionPattern,
  RagOutputMode,
  RagCandidateSummary,
  RagRejectedCandidate,
} from './rag/synthesis/types';

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
  // sourceBoneName → targetBoneName for bones that were successfully mapped
  mappedBones: Record<string, string>;
  keyframeCount: number;
  flatKeyframes: FlatKeyframeEntry[];
  outputMode: RagOutputMode;
  appliedDuration: number;
  appliedFps: number;
  modifiers: MotionModifiers | null;
  motionPattern: MotionPattern | null;
  retrievedCandidates: RagCandidateSummary[];
  rejectedCandidates: RagRejectedCandidate[];
}

const MIN_RAG_SCORE = 5;
const MIN_MAPPED_BONES = 3;
const CANDIDATE_LIMIT = 3;

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

interface SelectedCandidate {
  item: RagAnimationDatasetItem;
  score: number;
  reasons: string[];
  mappedBones: Record<string, string>;
}

// Retrieve top candidates and walk them in ranked order until one clears both the minimum
// score and minimum mapped-bone thresholds. Candidates that fail either check are recorded
// in rejectedCandidates rather than immediately throwing, so a lower-ranked candidate still
// gets a chance (e.g. the #1 match scores well but doesn't map enough bones onto this rig).
const selectCandidate = (
  prompt: string,
  dataset: RagAnimationDatasetItem[],
  activeBoneNames: string[],
): {
  selected: SelectedCandidate;
  candidateItems: RagAnimationDatasetItem[];
  retrievedCandidates: RagCandidateSummary[];
  rejectedCandidates: RagRejectedCandidate[];
} => {
  const query = buildRagQueryContext(prompt, activeBoneNames);
  const candidates = retrieveTopAnimations(dataset, query, CANDIDATE_LIMIT);
  if (candidates.length === 0) throw new Error('No matching animation found in dataset');

  const candidateItems = candidates.map((c) => c.item);
  const retrievedCandidates: RagCandidateSummary[] = candidates.map((c) => ({ id: c.item.id, score: c.score }));
  const rejectedCandidates: RagRejectedCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.score < MIN_RAG_SCORE) {
      rejectedCandidates.push({ id: candidate.item.id, score: candidate.score, reason: 'below_min_score' });
      continue;
    }

    const targetSemanticMapping = buildTargetSemanticMapping(candidate.item.boneMapping, activeBoneNames);
    const mappedBones = buildSemanticBoneMap(candidate.item.boneMapping, targetSemanticMapping);
    const mappedBoneCount = Object.keys(mappedBones).length;
    if (mappedBoneCount < MIN_MAPPED_BONES) {
      rejectedCandidates.push({
        id: candidate.item.id,
        score: candidate.score,
        reason: 'insufficient_bone_mapping',
        mappedBoneCount,
      });
      continue;
    }

    return {
      selected: { item: candidate.item, score: candidate.score, reasons: candidate.reasons, mappedBones },
      candidateItems,
      retrievedCandidates,
      rejectedCandidates,
    };
  }

  const first = rejectedCandidates[0]!;
  if (first.reason === 'below_min_score') {
    throw new Error(
      `No confident RAG match for prompt "${prompt}" (top score ${first.score}, minimum ${MIN_RAG_SCORE})`,
    );
  }
  throw new Error(
    `RAG match "${first.id}" only mapped ${first.mappedBoneCount ?? 0} bone(s); minimum ${MIN_MAPPED_BONES} required`,
  );
};

// Run the full RAG pipeline: retrieve top candidates, then either apply the matched dataset
// item's keyframes verbatim (only when explicitly requested) or synthesize a new animation
// variant from the candidate's analyzed motion pattern (default behavior).
export const runRagPipeline = (prompt: string): RagPipelineResult => {
  const dataset = loadDataset();
  if (dataset.length === 0) throw new Error('RAG dataset is empty — check data/rag/animations/');

  const activeBones = useSkeletonStore.getState().bones;
  if (activeBones.length === 0) throw new Error('No bones in active rig');

  const activeBoneNames = activeBones.map((b) => b.name);

  const { selected, candidateItems, retrievedCandidates, rejectedCandidates } = selectCandidate(
    prompt,
    dataset,
    activeBoneNames,
  );
  const { item, score, reasons, mappedBones } = selected;

  if (detectRawCopyIntent(prompt)) {
    const flatKeyframes = flattenDatasetKeyframes(item.animation, mappedBones);
    if (flatKeyframes.length === 0) {
      throw new Error(`RAG match "${item.id}" produced no applicable keyframes for the active rig`);
    }
    return {
      item,
      score,
      reasons,
      mappedBones,
      keyframeCount: flatKeyframes.length,
      flatKeyframes,
      outputMode: 'raw_copy',
      appliedDuration: clampDuration(item.animation.duration),
      appliedFps: clampFps(item.animation.fps),
      modifiers: null,
      motionPattern: null,
      retrievedCandidates,
      rejectedCandidates,
    };
  }

  // Analyze every retrieved candidate's motion pattern (not just the selected one) so the
  // synthesizer has real cross-example signal to learn a baseline variation from, instead of
  // only ever scaling the selected item's own deltas by explicit prompt modifiers.
  const ensembleMembers: EnsembleMember[] = candidateItems.map((candidateItem) => ({
    item: candidateItem,
    pattern: analyzeMotionPattern(candidateItem),
  }));
  const selectedMember =
    ensembleMembers.find((member) => member.item.id === item.id) ?? { item, pattern: analyzeMotionPattern(item) };
  const motionPattern = selectedMember.pattern;

  const baselineModifiers = deriveBaselineModifiers(selectedMember, ensembleMembers);
  const explicitModifiers = parseMotionModifiers(prompt);
  const modifiers = combineModifiers(baselineModifiers, explicitModifiers);

  const synthesis = synthesizeKeyframes(item, mappedBones, motionPattern, modifiers);
  if (synthesis.flatKeyframes.length === 0) {
    throw new Error(`RAG match "${item.id}" produced no applicable keyframes for the active rig`);
  }

  return {
    item,
    score,
    reasons,
    mappedBones,
    keyframeCount: synthesis.generatedKeyframeCount,
    flatKeyframes: synthesis.flatKeyframes,
    outputMode: 'synthesized',
    appliedDuration: synthesis.appliedDuration,
    appliedFps: synthesis.appliedFps,
    modifiers,
    motionPattern,
    retrievedCandidates,
    rejectedCandidates,
  };
};

// Apply a pipeline result to the active editor timeline.
// Switches to animate mode, clears the target frame range, sets duration/fps, writes keyframes.
export const applyRagAnimation = (result: RagPipelineResult): void => {
  const animation = useAnimationStore.getState();
  const editor = useEditorStore.getState();
  const skeleton = useSkeletonStore.getState();

  editor.setMode('animate');

  // Clear existing keyframes across the union of the raw dataset's range and the actually-
  // applied range (the two can differ once synthesis compresses/stretches duration via timeScale).
  const endFrame = Math.max(result.item.animation.duration, result.appliedDuration);
  const currentKfs = animation.keyframes;
  Object.entries(currentKfs).forEach(([boneIdStr, boneKfs]) => {
    const boneId = Number(boneIdStr);
    Object.keys(boneKfs)
      .map(Number)
      .filter((f) => f >= 0 && f <= endFrame)
      .forEach((f) => animation.deleteKeyframe(boneId, f));
  });

  animation.setDuration(result.appliedDuration);
  animation.setFps(result.appliedFps);

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
