import type { FlatKeyframeEntry } from '../rag/adaptation/keyframeAdapter';
import { resolveKeyframeTarget } from '../rag/adaptation/keyframeAdapter';
import type { Keyframes } from '../../types';
import type { EvaluationLogEntry } from '../../stores/evaluationLogStore';

export const INTEGRITY_TOLERANCE = 0.0001;

// Compare both directions in the application range, across all bone tracks.
// Missing target bones and duplicate destinations must not disappear from the denominator.
export const compareKeyframes = (
  expected: FlatKeyframeEntry[],
  bones: Array<{ id: number; name: string }>,
  actual: Keyframes,
  endFrame: number,
) => {
  const discrepancies: EvaluationLogEntry['validation']['discrepancies'] = [];
  const expectedKeys = new Set<string>();
  let missingKeyframes = 0;
  let matchingKeyframeCount = 0;
  let duplicateDestinations = 0;
  for (const entry of expected) {
    const bone = resolveKeyframeTarget(entry, bones);
    const key = bone ? `${bone.id}:${entry.frame}` : `unresolved:${entry.sourceBoneId ?? entry.boneName}:${entry.frame}`;
    if (expectedKeys.has(key)) duplicateDestinations += 1;
    expectedKeys.add(key);
    const observed = bone && entry.frame >= 0 && entry.frame <= endFrame
      ? actual[bone.id]?.[entry.frame] : undefined;
    if (!observed) {
      missingKeyframes += 1;
      discrepancies.push({ bone: entry.boneName, frame: entry.frame, property: 'keyframe', expected: 'present', actual: null });
      continue;
    }
    let matches = true;
    for (const property of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'easing'] as const) {
      const value = property === 'easing' ? observed.easing ?? 'linear' : observed[property];
      const wanted = entry[property];
      const equal = typeof value === 'number' && typeof wanted === 'number'
        ? Number.isFinite(value) && Number.isFinite(wanted) && Math.abs(value - wanted) <= INTEGRITY_TOLERANCE
        : value === wanted;
      if (!equal) {
        matches = false;
        discrepancies.push({ bone: entry.boneName, frame: entry.frame, property, expected: wanted, actual: value });
      }
    }
    if (matches) matchingKeyframeCount += 1;
  }
  let appliedKeyframeCount = 0;
  let unexpectedKeyframes = 0;
  for (const [boneId, frames] of Object.entries(actual)) {
    for (const frame of Object.keys(frames).map(Number)) {
      if (frame < 0 || frame > endFrame) continue;
      appliedKeyframeCount += 1;
      if (!expectedKeys.has(`${Number(boneId)}:${frame}`)) {
        unexpectedKeyframes += 1;
        discrepancies.push({ bone: bones.find((bone) => bone.id === Number(boneId))?.name ?? boneId, frame, property: 'keyframe', expected: null, actual: 'present' });
      }
    }
  }
  return { appliedKeyframeCount, matchingKeyframeCount, missingKeyframes, unexpectedKeyframes, duplicateDestinations, discrepancies };
};
