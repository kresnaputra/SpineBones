import { useAnimationStore } from '../../stores/animationStore';
import { useSkeletonStore } from '../../stores/skeletonStore';
import type { EvaluationCheck, EvaluationLogEntry } from '../../stores/evaluationLogStore';
import type { RagPipelineResult } from '../ragPipeline';
import { flattenDatasetKeyframes, resolveKeyframeTarget } from '../rag/adaptation/keyframeAdapter';
import { compareKeyframes, INTEGRITY_TOLERANCE } from './compareKeyframes';

const createLogId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `eval-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const countDatasetKeyframes = (result: RagPipelineResult) =>
  result.item.animation.keyframes.reduce((total, track) => total + track.frames.length, 0);

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
  const bones = useSkeletonStore.getState().bones;
  const mappedBoneCount = new Set(result.flatKeyframes.map((entry) => resolveKeyframeTarget(entry, bones)?.id).filter((id) => id !== undefined)).size;
  const sourceKeyframes = flattenDatasetKeyframes(result.item.animation, result.bindings);
  const isDataset = result.outputMode === 'raw_copy';
  const expected = isDataset ? sourceKeyframes : result.flatKeyframes;
  const endFrame = Math.max(result.item.animation.duration, result.appliedDuration);
  const comparison = compareKeyframes(expected, useSkeletonStore.getState().bones, animation.keyframes, endFrame);
  const { appliedKeyframeCount, matchingKeyframeCount } = comparison;
  const expectedDuration = isDataset ? result.item.animation.duration : result.appliedDuration;
  const expectedFps = isDataset ? result.item.animation.fps : result.appliedFps;

  const checks: EvaluationCheck[] = [
    {
      key: 'animation_id',
      label: 'ID animasi',
      expected: result.item.id,
      actual: animation.appliedRagMetadata?.animationId ?? null,
      passed: animation.appliedRagMetadata?.animationId === result.item.id,
    },
    {
      key: 'category',
      label: 'Kategori animasi',
      expected: result.item.category,
      actual: animation.appliedRagMetadata?.category ?? null,
      passed: animation.appliedRagMetadata?.category === result.item.category,
    },
    {
      key: 'keyframe_count',
      label: 'Jumlah keyframe',
      expected: expected.length,
      actual: appliedKeyframeCount,
      passed: expected.length > 0 && appliedKeyframeCount === expected.length && comparison.missingKeyframes === 0 && comparison.unexpectedKeyframes === 0 && comparison.duplicateDestinations === 0,
      details: `Hilang: ${comparison.missingKeyframes}; tambahan: ${comparison.unexpectedKeyframes}; tujuan duplikat: ${comparison.duplicateDestinations}.`,
    },
    {
      key: 'keyframe_transforms',
      label: 'Transformasi keyframe',
      expected: expected.length,
      actual: matchingKeyframeCount,
      passed: expected.length > 0 && matchingKeyframeCount === expected.length && comparison.duplicateDestinations === 0,
      details: `Jumlah keyframe dengan x, y, rotasi, skala, dan easing sesuai. Toleransi numerik: ${INTEGRITY_TOLERANCE}; easing harus identik.`,
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
    basis: isDataset ? 'dataset' as const : 'synthesized_output' as const,
    scope: isDataset
      ? `Bone keyframes pada seluruh track, frame 0–${endFrame}, dibandingkan terhadap dataset. Metadata dibaca dari state hasil penerapan.`
      // In synthesized mode the reference is the synthesizer's own output, so this percentage
      // measures transport fidelity (did the editor receive what was generated), not novelty.
      // Kebaruan terhadap dataset dilaporkan terpisah di rag.novelty.
      : `Bone keyframes pada seluruh track, frame 0–${endFrame}, dibandingkan terhadap keluaran sintesis (uji integritas penerapan, bukan uji kebaruan — lihat rag.novelty). Metadata dibaca dari state hasil penerapan.`,
    tolerance: INTEGRITY_TOLERANCE,
    missingKeyframes: comparison.missingKeyframes,
    unexpectedKeyframes: comparison.unexpectedKeyframes,
    excludedSourceKeyframes: countDatasetKeyframes(result) - sourceKeyframes.length,
    discrepancies: comparison.discrepancies,
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
      novelty: result.novelty,
      blend: result.blend,
      procedural: result.procedural,
    },
    mcp: {
      status: 'completed',
      selectedAnimationId: animation.appliedRagMetadata?.animationId ?? null,
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
  // A pipeline failure has no completed output to compare; it is not a seventh
  // integrity component and must not enter the six-component aggregate.
  const checks: EvaluationCheck[] = [];

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
      novelty: null,
      blend: null,
      procedural: null,
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
      basis: 'not_evaluated',
      scope: 'Pipeline gagal; integritas keluaran belum dapat dievaluasi.',
      tolerance: INTEGRITY_TOLERANCE,
      missingKeyframes: 0,
      unexpectedKeyframes: 0,
      excludedSourceKeyframes: 0,
      discrepancies: [],
      ...summarizeChecks(checks),
      percentage: null,
      checks,
    },
    visualReview: 'not_reviewed',
  };
};
