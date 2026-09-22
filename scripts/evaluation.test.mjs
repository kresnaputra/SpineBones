import { beforeEach, expect, test } from 'bun:test';
import { useAnimationStore } from '../src/stores/animationStore.ts';
import { useSkeletonStore } from '../src/stores/skeletonStore.ts';
import { buildRagEvaluationLogEntry, buildFailedRagEvaluationLogEntry } from '../src/thesis/evaluation/ragEvaluation.ts';
import { summarizeEvaluationLogs } from '../src/thesis/evaluation/evaluationSummary.ts';

const pose = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, easing: 'linear' };
const options = { requestId: 'test', prompt: 'walk, pakai dataset asli', completedAt: '2026-01-01T00:00:00Z' };
const result = () => ({
  item: { id: 'walk', name: 'Walk', category: 'walk', requiredBones: ['root'], boneMapping: { root: 'root' },
    animation: { duration: 60, fps: 24, keyframes: [{ boneName: 'root', frames: [{ frame: 0, ...pose }] }] } },
  mappedBones: { root: 'root' }, flatKeyframes: [{ boneName: 'root', frame: 0, ...pose }], keyframeCount: 1,
  appliedDuration: 60, appliedFps: 24, outputMode: 'raw_copy', score: 10, reasons: [], modifiers: null,
  retrievedCandidates: [], rejectedCandidates: [],
});
beforeEach(() => {
  useSkeletonStore.setState({ bones: [{ id: 1, name: 'root' }] });
  useAnimationStore.setState({ duration: 60, fps: 24, keyframes: { 1: { 0: { ...pose } } }, appliedRagMetadata: { animationId: 'walk', category: 'walk' } });
});
test('six thesis components pass against independently observed editor state', () => {
  const log = buildRagEvaluationLogEntry(result(), options);
  expect(log.validation.totalComponents).toBe(6);
  expect(log.validation.percentage).toBe(100);
  expect(log.status).toBe('valid');
});
test('one corrupted transform yields 5/6, preserving the count check', () => {
  useAnimationStore.setState({ keyframes: { 1: { 0: { ...pose, rotation: 0.001 } } } });
  const log = buildRagEvaluationLogEntry(result(), options);
  expect(log.validation.percentage).toBe(83.33);
  expect(log.validation.discrepancies[0].property).toBe('rotation');
  expect(log.validation.checks.find((check) => check.key === 'keyframe_count').passed).toBe(true);
});
test('metadata corruption is observed instead of automatically passing', () => {
  useAnimationStore.setState({ appliedRagMetadata: { animationId: 'idle', category: 'idle' } });
  expect(buildRagEvaluationLogEntry(result(), options).validation.matchedComponents).toBe(4);
});
test('same count but wrong frame is not lossless', () => {
  useAnimationStore.setState({ keyframes: { 1: { 1: pose } } });
  const log = buildRagEvaluationLogEntry(result(), options);
  expect(log.validation.missingKeyframes).toBe(1);
  expect(log.validation.unexpectedKeyframes).toBe(1);
  expect(log.status).toBe('invalid');
});
test('unexpected keyframes on other tracks are detected within the documented scope', () => {
  useAnimationStore.setState({ keyframes: { 1: { 0: pose, 90: pose }, 2: { 10: pose } } });
  const log = buildRagEvaluationLogEntry(result(), options);
  expect(log.mcp.appliedKeyframeCount).toBe(2);
  expect(log.validation.unexpectedKeyframes).toBe(1);
});
test('unmapped source tracks are excluded, not counted as integrity corruption', () => {
  const input = result();
  input.item.animation.keyframes.push({ boneName: 'missing', frames: [{ frame: 0, ...pose }] });
  const log = buildRagEvaluationLogEntry(input, options);
  expect(log.validation.excludedSourceKeyframes).toBe(1);
  expect(log.status).toBe('valid');
});
test('raw copy is compared with source, not a corrupted adapted result', () => {
  const input = result();
  input.flatKeyframes[0].rotation = 10;
  useAnimationStore.setState({ keyframes: { 1: { 0: { ...pose, rotation: 10 } } } });
  expect(buildRagEvaluationLogEntry(input, options).status).toBe('invalid');
});
test('easing is compared categorically and numeric tolerance is explicit', () => {
  useAnimationStore.setState({ keyframes: { 1: { 0: { ...pose, x: 0.00001, easing: 'easeIn' } } } });
  const log = buildRagEvaluationLogEntry(result(), options);
  expect(log.validation.discrepancies.map((difference) => difference.property)).toEqual(['easing']);
});
test('duplicate destinations cannot pass even when values match', () => {
  const input = result();
  input.item.animation.keyframes[0].frames.push({ frame: 0, ...pose });
  expect(buildRagEvaluationLogEntry(input, options).status).toBe('invalid');
});
test('dataset clamping is visible; synthesis uses its intentional output as reference', () => {
  const input = result();
  input.item.animation.duration = 80;
  expect(buildRagEvaluationLogEntry(input, options).validation.percentage).toBe(83.33);
  input.outputMode = 'synthesized';
  const synthesized = buildRagEvaluationLogEntry(input, options);
  expect(synthesized.validation.percentage).toBe(100);
  expect(synthesized.validation.basis).toBe('synthesized_output');
});
test('failed runs and synthesis never inflate or depress the dataset aggregate', () => {
  const dataset = buildRagEvaluationLogEntry(result(), options);
  const failed = buildFailedRagEvaluationLogEntry({ ...options, error: 'No match' });
  const synthesized = buildRagEvaluationLogEntry({ ...result(), outputMode: 'synthesized' }, options);
  const summary = summarizeEvaluationLogs([dataset, failed, synthesized]);
  expect(summary.failed).toBe(1);
  expect(summary.datasetIntegrity.evaluated).toBe(1);
  expect(summary.datasetIntegrity.percentage).toBe(100);
  expect(summarizeEvaluationLogs([failed]).datasetIntegrity.percentage).toBeNull();
  expect(failed.validation.totalComponents).toBe(0);
  expect(failed.validation.percentage).toBeNull();
});
