import type { KeyframeData, KeyframeEasing } from '../types';

export const DEFAULT_KEYFRAME_EASING: KeyframeEasing = 'linear';

export const normalizeKeyframeEasing = (
  easing?: KeyframeEasing,
): KeyframeEasing => easing ?? DEFAULT_KEYFRAME_EASING;

export const normalizeKeyframeData = (
  keyframe: KeyframeData,
): KeyframeData => ({
  ...keyframe,
  easing: normalizeKeyframeEasing(keyframe.easing),
});

export const applyEasing = (
  easing: KeyframeEasing | undefined,
  t: number,
): number => {
  const clamped = Math.min(1, Math.max(0, t));

  switch (normalizeKeyframeEasing(easing)) {
    case 'easeIn':
      return clamped * clamped * clamped;
    case 'easeOut':
      return 1 - Math.pow(1 - clamped, 3);
    case 'easeInOut':
      return clamped < 0.5
        ? 4 * clamped * clamped * clamped
        : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
    case 'linear':
    default:
      return clamped;
  }
};
