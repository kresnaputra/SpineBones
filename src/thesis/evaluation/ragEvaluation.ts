import { useAnimationStore } from '../../stores/animationStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import type { EvaluationCheck, EvaluationLogEntry } from '../../stores/evaluationLogStore';
import type { RagPipelineResult } from '../ragPipeline';
import type { FlatKeyframeEntry } from '../rag/adaptation/keyframeAdapter';
import type { KeyframeData } from '../../types';

const EPSILON = 0.0001;

const createLogId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `eval-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const nearlyEqual = (a: number, b: number) => Math.abs(a - b) <= EPSILON;

const keyframeMatches = (actual: KeyframeData | undefined, expected: FlatKeyframeEntry) => {
  if (!actual) return false;

  return (
    nearlyEqual(actual.x, expected.x) &&
    nearlyEqual(actual.y, expected.y) &&
    nearlyEqual(actual.rotation, expected.rotation) &&
    nearlyEqual(actual.scaleX, expected.scaleX) &&
    nearlyEqual(actual.scaleY, expected.scaleY) &&
    (actual.easing ?? 'linear') === expected.easing
  );
};

const countDatasetKeyframes = (result: RagPipelineResult) =>
  result.item.animation.keyframes.reduce((total, track) => total + track.frames.length, 0);

const countAppliedKeyframes = (flatKeyframes: FlatKeyframeEntry[]) => {
  const { bones } = useSkeletonStore.getState();
  const { keyframes } = useAnimationStore.getState();
  let appliedKeyframeCount = 0;
  let matchingKeyframeCount = 0;

  for (const expected of flatKeyframes) {
    const bone = bones.find((item) => item.name.toLowerCase() === expected.boneName.toLowerCase());
    const actual = bone ? keyframes[bone.id]?.[expected.frame] : undefined;
    if (actual) {
      appliedKeyframeCount += 1;
    }
    if (keyframeMatches(actual, expected)) {
      matchingKeyframeCount += 1;
    }
  }

  return { appliedKeyframeCount, matchingKeyframeCount };
};

const countRequiredBonesMapped = (result: RagPipelineResult) => {
  let mappedCount = 0;

  for (const semanticBone of result.item.requiredBones) {
    const sourceBoneName = result.item.boneMapping[semanticBone] ?? semanticBone;
    if (result.mappedBones[sourceBoneName]) {
      mappedCount += 1;
    }
  }

  return mappedCount;
};

const summarizeChecks = (checks: EvaluationCheck[]) => {
  const matchedComponents = checks.filter((check) => check.passed).length;
  const totalComponents = checks.length;
  const percentage =
    totalComponents === 0 ? 0 : Math.round((matchedComponents / totalComponents) * 10000) / 100;

  return { matchedComponents, totalComponents, percentage };
};

export const buildRagEvaluationLogEntry = (
  result: RagPipelineResult,
  options: {
    requestId: string | null;
    prompt: string;
    completedAt: string;
  },
): EvaluationLogEntry => {
  const animation = useAnimationStore.getState();
  const mappedBoneCount = Object.keys(result.mappedBones).length;
  const requiredBonesMapped = countRequiredBonesMapped(result);
  const { appliedKeyframeCount, matchingKeyframeCount } = countAppliedKeyframes(result.flatKeyframes);
  // Compare against what the pipeline actually intended to apply (post-timeScale when
  // synthesized), not the raw dataset item's original duration/fps.
  const expectedDuration = result.appliedDuration;
  const expectedFps = result.appliedFps;

  const checks: EvaluationCheck[] = [
    {
      key: 'animation_id',
      label: 'ID animasi',
      expected: result.item.id,
      actual: result.item.id,
      passed: true,
    },
    {
      key: 'category',
      label: 'Kategori animasi',
      expected: result.item.category,
      actual: result.item.category,
      passed: result.item.category.trim().length > 0,
    },
    {
      key: 'required_bones',
      label: 'Required bones',
      expected: result.item.requiredBones.length,
      actual: requiredBonesMapped,
      passed: requiredBonesMapped === result.item.requiredBones.length,
    },
    {
      key: 'bone_mapping',
      label: 'Bone mapping',
      expected: Math.max(1, result.item.requiredBones.length),
      actual: mappedBoneCount,
      passed: mappedBoneCount >= Math.max(1, result.item.requiredBones.length),
    },
    {
      key: 'keyframes',
      label: 'Keyframe',
      expected: result.flatKeyframes.length,
      actual: matchingKeyframeCount,
      passed: result.flatKeyframes.length > 0 && matchingKeyframeCount === result.flatKeyframes.length,
    },
    {
      key: 'duration',
      label: 'Durasi',
      expected: expectedDuration,
      actual: animation.duration,
      passed: animation.duration === expectedDuration,
    },
    {
      key: 'fps',
      label: 'FPS',
      expected: expectedFps,
      actual: animation.fps,
      passed: animation.fps === expectedFps,
    },
  ];

  const validation = {
    ...summarizeChecks(checks),
    checks,
  };

  return {
    id: createLogId(),
    createdAt: options.completedAt,
    requestId: options.requestId,
    prompt: options.prompt,
    commandType: 'apply_rag_animation',
    status: checks.every((check) => check.passed) ? 'valid' : 'invalid',
    rag: {
      selectedAnimationId: result.item.id,
      selectedAnimationName: result.item.name,
      selectedCategory: result.item.category,
      score: result.score,
      reasons: result.reasons,
      duration: result.item.animation.duration,
      fps: result.item.animation.fps,
      requiredBones: result.item.requiredBones,
      datasetKeyframeCount: countDatasetKeyframes(result),
      adaptedKeyframeCount: result.keyframeCount,
      outputMode: result.outputMode,
      modifiersApplied: result.modifiers,
      retrievedCandidates: result.retrievedCandidates,
      rejectedCandidates: result.rejectedCandidates,
      generatedKeyframeCount: result.outputMode === 'synthesized' ? result.keyframeCount : null,
    },
    mcp: {
      status: 'completed',
      selectedAnimationId: result.item.id,
      mappedBoneCount,
      mappedBones: result.mappedBones,
      appliedKeyframeCount,
      matchingKeyframeCount,
      duration: animation.duration,
      fps: animation.fps,
      error: null,
    },
    validation,
    visualReview: 'not_reviewed',
  };
};

export const buildFailedRagEvaluationLogEntry = (options: {
  requestId: string | null;
  prompt: string;
  completedAt: string;
  error: string;
}): EvaluationLogEntry => {
  const checks: EvaluationCheck[] = [
    {
      key: 'rag_pipeline',
      label: 'Pipeline RAG',
      expected: true,
      actual: false,
      passed: false,
    },
  ];

  return {
    id: createLogId(),
    createdAt: options.completedAt,
    requestId: options.requestId,
    prompt: options.prompt,
    commandType: 'apply_rag_animation',
    status: 'failed',
    rag: {
      selectedAnimationId: null,
      selectedAnimationName: null,
      selectedCategory: null,
      score: null,
      reasons: [],
      duration: null,
      fps: null,
      requiredBones: [],
      datasetKeyframeCount: null,
      adaptedKeyframeCount: null,
      outputMode: null,
      modifiersApplied: null,
      retrievedCandidates: [],
      rejectedCandidates: [],
      generatedKeyframeCount: null,
    },
    mcp: {
      status: 'failed',
      selectedAnimationId: null,
      mappedBoneCount: 0,
      mappedBones: {},
      appliedKeyframeCount: 0,
      matchingKeyframeCount: 0,
      duration: null,
      fps: null,
      error: options.error,
    },
    validation: {
      ...summarizeChecks(checks),
      checks,
    },
    visualReview: 'not_reviewed',
  };
};
