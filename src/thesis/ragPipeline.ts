import { useSkeletonStore } from '../stores/skeletonStore';
import { useAnimationStore } from '../stores/animationStore';
import { useEditorStore } from '../stores/editorStore';
import { loadRagDatasetFromItems } from './rag/retrieval/loader';
import { buildRagQueryContext } from './rag/retrieval/queryBuilder';
import { retrieveTopAnimations } from './rag/retrieval/retriever';
import { buildBoneBindings, describeBindings } from './rag/adaptation/boneMapper';
import { flattenDatasetKeyframes, resolveKeyframeTarget } from './rag/adaptation/keyframeAdapter';
import { clampDuration, clampFps } from './rag/shared/clamps';
import { combineModifiers, detectRawCopyIntent, parseMotionModifiers } from './rag/synthesis/promptIntent';
import { analyzeMotionPattern } from './rag/synthesis/motionAnalyzer';
import { synthesizeKeyframes } from './rag/synthesis/keyframeSynthesizer';
import { deriveBaselineModifiers } from './rag/synthesis/ensembleLearning';
import { buildItemMotionField } from './rag/synthesis/motionCurve';
import { measureNovelty } from './rag/synthesis/novelty';
import type { EnsembleMember } from './rag/synthesis/ensembleLearning';
import type { BlendCandidate } from './rag/synthesis/motionBlender';
import type { ItemMotionField } from './rag/synthesis/motionCurve';
import type { NoveltyReport } from './rag/synthesis/novelty';
import type { BoneBindingMap, RigBoneRef } from './rag/adaptation/boneMapper';
import type { RagAnimationDatasetItem, RagRetrievalResult } from './rag/types/ragTypes';
import type { FlatKeyframeEntry } from './rag/adaptation/keyframeAdapter';
import type {
  BlendReport,
  MotionModifiers,
  MotionPattern,
  ProceduralReport,
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
  // Semantic role (or name#id when a track has no role) → target bone name, for reporting.
  mappedBones: Record<string, string>;
  // The authoritative source-bone-id → target-bone binding the whole run was applied through.
  bindings: BoneBindingMap;
  keyframeCount: number;
  flatKeyframes: FlatKeyframeEntry[];
  outputMode: RagOutputMode;
  appliedDuration: number;
  appliedFps: number;
  modifiers: MotionModifiers | null;
  motionPattern: MotionPattern | null;
  retrievedCandidates: RagCandidateSummary[];
  rejectedCandidates: RagRejectedCandidate[];
  // Null in raw_copy mode, where nothing is generated and there is nothing to report on.
  blend: BlendReport | null;
  procedural: ProceduralReport | null;
  novelty: NoveltyReport | null;
}

const MIN_RAG_SCORE = 5;
const MIN_MAPPED_BONES = 3;
const CANDIDATE_LIMIT = 3;

interface SelectedCandidate {
  item: RagAnimationDatasetItem;
  score: number;
  reasons: string[];
  bindings: BoneBindingMap;
}

// Retrieve top candidates and walk them in ranked order until one clears both the minimum
// score and minimum mapped-bone thresholds. Candidates that fail either check are recorded
// in rejectedCandidates rather than immediately throwing, so a lower-ranked candidate still
// gets a chance (e.g. the #1 match scores well but doesn't map enough bones onto this rig).
const selectCandidate = (
  prompt: string,
  dataset: RagAnimationDatasetItem[],
  activeBones: RigBoneRef[],
): {
  selected: SelectedCandidate;
  candidates: RagRetrievalResult[];
  retrievedCandidates: RagCandidateSummary[];
  rejectedCandidates: RagRejectedCandidate[];
} => {
  const query = buildRagQueryContext(prompt, activeBones.map((bone) => bone.name));
  const candidates = retrieveTopAnimations(dataset, query, CANDIDATE_LIMIT);
  if (candidates.length === 0) throw new Error('No matching animation found in dataset');

  const retrievedCandidates: RagCandidateSummary[] = candidates.map((c) => ({ id: c.item.id, score: c.score }));
  const rejectedCandidates: RagRejectedCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.score < MIN_RAG_SCORE) {
      rejectedCandidates.push({ id: candidate.item.id, score: candidate.score, reason: 'below_min_score' });
      continue;
    }

    const bindings = buildBoneBindings(candidate.item, activeBones);
    const mappedBoneCount = bindings.size;
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
      selected: { item: candidate.item, score: candidate.score, reasons: candidate.reasons, bindings },
      candidates,
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

  const { selected, candidates, retrievedCandidates, rejectedCandidates } = selectCandidate(
    prompt,
    dataset,
    activeBones,
  );
  const { item, score, reasons, bindings } = selected;
  const mappedBones = describeBindings(bindings);

  if (detectRawCopyIntent(prompt)) {
    const flatKeyframes = flattenDatasetKeyframes(item.animation, bindings);
    if (flatKeyframes.length === 0) {
      throw new Error(`RAG match "${item.id}" produced no applicable keyframes for the active rig`);
    }
    return {
      item,
      score,
      reasons,
      mappedBones,
      bindings,
      keyframeCount: flatKeyframes.length,
      flatKeyframes,
      outputMode: 'raw_copy',
      appliedDuration: clampDuration(item.animation.duration),
      appliedFps: clampFps(item.animation.fps),
      modifiers: null,
      motionPattern: null,
      retrievedCandidates,
      rejectedCandidates,
      blend: null,
      procedural: null,
      novelty: null,
    };
  }

  // Analyze and phase-normalize every retrieved candidate, not just the selected one. The motion
  // pattern drives modifier routing; the motion field is the resampled, duration-independent form
  // the synthesizer can actually blend across clips that were authored at different lengths.
  const fieldCache = new Map<RagAnimationDatasetItem, ItemMotionField>();
  const fieldOf = (candidateItem: RagAnimationDatasetItem): ItemMotionField => {
    const cached = fieldCache.get(candidateItem);
    if (cached) return cached;
    const field = buildItemMotionField(candidateItem);
    fieldCache.set(candidateItem, field);
    return field;
  };

  const ensembleMembers: EnsembleMember[] = candidates.map((candidate) => ({
    item: candidate.item,
    pattern: analyzeMotionPattern(candidate.item),
    field: fieldOf(candidate.item),
  }));
  const selectedMember =
    ensembleMembers.find((member) => member.item === item) ??
    { item, pattern: analyzeMotionPattern(item), field: fieldOf(item) };
  const motionPattern = selectedMember.pattern;

  const baselineModifiers = deriveBaselineModifiers(selectedMember, ensembleMembers);
  const explicitModifiers = parseMotionModifiers(prompt);
  const modifiers = combineModifiers(baselineModifiers, explicitModifiers);

  const blendCandidates: BlendCandidate[] = candidates
    .filter((candidate) => candidate.item !== item)
    .map((candidate) => ({
      field: fieldOf(candidate.item),
      score: candidate.score,
      category: candidate.item.category,
    }));

  const synthesis = synthesizeKeyframes({
    item,
    bindings,
    pattern: motionPattern,
    modifiers,
    selectedField: selectedMember.field,
    selectedScore: score,
    candidates: blendCandidates,
    targetBones: activeBones,
  });
  if (synthesis.flatKeyframes.length === 0) {
    throw new Error(`RAG match "${item.id}" produced no applicable keyframes for the active rig`);
  }

  // Measure the output against the whole dataset, not only against the clip it was built from —
  // blending can land the result closer to a clip that was never the top match.
  const novelty = measureNovelty(
    synthesis.synthesizedCurves,
    item,
    selectedMember.field,
    dataset.map(fieldOf),
    synthesis.flatKeyframes,
  );

  return {
    item,
    score,
    reasons,
    mappedBones,
    bindings,
    keyframeCount: synthesis.generatedKeyframeCount,
    flatKeyframes: synthesis.flatKeyframes,
    outputMode: 'synthesized',
    appliedDuration: synthesis.appliedDuration,
    appliedFps: synthesis.appliedFps,
    modifiers,
    motionPattern,
    retrievedCandidates,
    rejectedCandidates,
    blend: synthesis.blend,
    procedural: synthesis.procedural,
    novelty,
  };
};

// Apply a pipeline result to the active editor timeline.
// Switches to animate mode, clears the target frame range, sets duration/fps, writes keyframes.
export const applyRagAnimation = (result: RagPipelineResult): void => {
  useAnimationStore.setState({ appliedRagMetadata: null });
  const animation = useAnimationStore.getState();
  const editor = useEditorStore.getState();
  const skeleton = useSkeletonStore.getState();

  // Resolve every destination before clearing the timeline. Ambiguous mappings
  // must fail explicitly rather than overwrite another bone's track.
  const targets = result.flatKeyframes.map((kf) => {
    const bone = resolveKeyframeTarget(kf, skeleton.bones);
    if (!bone) throw new Error(`Cannot uniquely map bone "${kf.boneName}" (source ID ${kf.sourceBoneId ?? 'unknown'})`);
    return bone;
  });
  const destinations = new Set<string>();
  result.flatKeyframes.forEach((kf, index) => {
    const key = `${targets[index]!.id}:${kf.frame}`;
    if (destinations.has(key)) throw new Error(`Duplicate keyframe destination: ${key}`);
    destinations.add(key);
  });

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

  for (const [index, kf] of result.flatKeyframes.entries()) {
    const bone = targets[index]!;

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
  // Execution metadata is committed only after application completes. The evaluator
  // reads this editor state rather than treating input metadata as observed output.
  useAnimationStore.setState({
    appliedRagMetadata: { animationId: result.item.id, category: result.item.category },
  });
};
