import { clampDuration, clampFps } from '../shared/clamps';
import type { SemanticBoneMap } from '../adaptation/boneMapper';
import type { FlatKeyframeEntry } from '../adaptation/keyframeAdapter';
import type { RagAnimationDatasetItem, RagKeyframeEasing } from '../types/ragTypes';
import type { MotionModifiers, MotionPattern, MotionPhase, SynthesisResult } from './types';

const SMOOTHING_EASING_THRESHOLD = 1.15;

// Finds the source-track frame index nearest to `frame` within the reference pattern's frame
// list. Used only when a bone track's own frame array diverges from the shared reference
// timeline (should not happen given current dataset authoring, but keeps synthesis safe).
const nearestPatternIndex = (frame: number, patternFrames: number[]): number => {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < patternFrames.length; i++) {
    const distance = Math.abs(patternFrames[i]! - frame);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
};

const findPhase = (patternIndex: number, phases: MotionPhase[]): MotionPhase =>
  phases.find((phase) => patternIndex >= phase.startFrameIndex && patternIndex <= phase.endFrameIndex) ?? phases[0]!;

const resolveAxisScale = (axis: MotionPhase['yAxis'], modifiers: MotionModifiers): number =>
  axis === 'none' ? 1 : modifiers[axis];

const resolveRotationScale = (phase: MotionPhase, modifiers: MotionModifiers): number => {
  const product = phase.rotationAxes.reduce((acc, axis) => acc * modifiers[axis], 1);
  return product / modifiers.smoothness;
};

export const synthesizeKeyframes = (
  item: RagAnimationDatasetItem,
  semanticBoneMap: SemanticBoneMap,
  pattern: MotionPattern,
  modifiers: MotionModifiers,
): SynthesisResult => {
  const patternFrames = pattern.frames;
  const frameToPatternIndex = new Map<number, number>(patternFrames.map((frame, index) => [frame, index]));
  const lastPatternIndex = Math.max(0, patternFrames.length - 1);
  let warnedDivergence = false;

  const appliedDurationUnclamped = Math.round(item.animation.duration * modifiers.timeScale);
  const appliedDuration = clampDuration(appliedDurationUnclamped);
  const appliedFps = clampFps(item.animation.fps);
  const forceSmoothEasing = modifiers.smoothness >= SMOOTHING_EASING_THRESHOLD;

  const flatKeyframes: FlatKeyframeEntry[] = [];

  for (const track of item.animation.keyframes) {
    const targetBoneName = semanticBoneMap[track.boneName];
    if (!targetBoneName) continue;

    const sortedFrames = [...track.frames].sort((a, b) => a.frame - b.frame);
    if (sortedFrames.length === 0) continue;

    const rest = sortedFrames[0]!;
    let lastEmittedFrame = -1;

    for (const kf of sortedFrames) {
      let patternIndex = frameToPatternIndex.get(kf.frame);
      if (patternIndex === undefined) {
        if (!warnedDivergence) {
          console.warn(
            `synthesizeKeyframes: track "${track.boneName}" frame ${kf.frame} not found in reference pattern for "${item.id}" — falling back to nearest-frame phase lookup`,
          );
          warnedDivergence = true;
        }
        patternIndex = nearestPatternIndex(kf.frame, patternFrames);
      }
      patternIndex = Math.max(0, Math.min(lastPatternIndex, patternIndex));

      const phase = findPhase(patternIndex, pattern.phases);
      const yScale = resolveAxisScale(phase.yAxis, modifiers);
      const xScale = resolveAxisScale(phase.xAxis, modifiers);
      const scaleScale = resolveAxisScale(phase.scaleAxis, modifiers);
      const rotationScale = resolveRotationScale(phase, modifiers);

      const newX = rest.x + (kf.x - rest.x) * xScale;
      const newY = rest.y + (kf.y - rest.y) * yScale;
      const newRotation = rest.rotation + (kf.rotation - rest.rotation) * rotationScale;
      const newScaleX = rest.scaleX + (kf.scaleX - rest.scaleX) * scaleScale;
      const newScaleY = rest.scaleY + (kf.scaleY - rest.scaleY) * scaleScale;
      const easing: RagKeyframeEasing = forceSmoothEasing ? 'easeInOut' : kf.easing;

      let newFrame = Math.round(kf.frame * modifiers.timeScale);
      if (newFrame <= lastEmittedFrame) newFrame = lastEmittedFrame + 1;
      newFrame = Math.max(0, Math.min(appliedDurationUnclamped, newFrame));
      lastEmittedFrame = newFrame;

      flatKeyframes.push({
        sourceBoneId: track.boneId,
        boneName: targetBoneName,
        frame: newFrame,
        x: newX,
        y: newY,
        rotation: newRotation,
        scaleX: newScaleX,
        scaleY: newScaleY,
        easing,
      });
    }
  }

  return {
    flatKeyframes,
    appliedDuration,
    appliedFps,
    generatedKeyframeCount: flatKeyframes.length,
  };
};
