import type { RagAnimationDatasetItem } from '../types/ragTypes';
import { NEUTRAL_MODIFIERS } from './types';
import type { MotionModifiers, MotionPattern } from './types';

export interface EnsembleMember {
  item: RagAnimationDatasetItem;
  pattern: MotionPattern;
}

// Tighter than promptIntent's AXIS_CLAMP — this is a data-derived nudge, not an explicit user
// request, so it should read as natural variation rather than a dramatic transformation.
const BASELINE_CLAMP: Record<'heightScale' | 'timeScale' | 'weightScale', [number, number]> = {
  heightScale: [0.9, 1.15],
  timeScale: [0.9, 1.15],
  weightScale: [0.9, 1.15],
};

const clamp = (value: number, [min, max]: [number, number]) => Math.max(min, Math.min(max, value));

const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

// Impact proxy: how prominent this pattern's extrema are relative to its own amplitude. Two
// patterns can share the same amplitude but read as different "weight" — sharp, prominent
// extrema (deep crouch, hard landing) vs a shallow, gentle arc across the same vertical range.
const impactRatio = (pattern: MotionPattern): number | null => {
  if (pattern.amplitude <= 0 || pattern.extrema.length === 0) return null;
  return mean(pattern.extrema.map((e) => e.prominence)) / pattern.amplitude;
};

// Derives a small baseline variation from comparing the selected candidate against the other
// top-ranked candidates retrieved for the same query — real signal already present in the
// dataset, not randomness. This is what makes synthesis "learn before generating": even a plain
// prompt with no modifier words produces output shaped by what else was retrieved, instead of a
// byte-identical replay of the single winning item. Falls back to neutral (no adjustment) when
// there's nothing to compare against — a lone match, or degenerate/flat patterns — rather than
// fabricating a difference that isn't backed by data.
export const deriveBaselineModifiers = (selected: EnsembleMember, allMembers: EnsembleMember[]): MotionModifiers => {
  const baseline: MotionModifiers = { ...NEUTRAL_MODIFIERS, matchedPhrases: [] };
  if (allMembers.length < 2) return baseline;

  const amplitudes = allMembers.map((m) => m.pattern.amplitude).filter((a) => a > 0);
  if (amplitudes.length >= 2 && selected.pattern.amplitude > 0) {
    baseline.heightScale = clamp(selected.pattern.amplitude / mean(amplitudes), BASELINE_CLAMP.heightScale);
  }

  const durations = allMembers.map((m) => m.item.animation.duration).filter((d) => d > 0);
  if (durations.length >= 2 && selected.item.animation.duration > 0) {
    baseline.timeScale = clamp(selected.item.animation.duration / mean(durations), BASELINE_CLAMP.timeScale);
  }

  const impacts = allMembers.map((m) => impactRatio(m.pattern)).filter((r): r is number => r !== null);
  const selectedImpact = impactRatio(selected.pattern);
  if (impacts.length >= 2 && selectedImpact !== null) {
    baseline.weightScale = clamp(selectedImpact / mean(impacts), BASELINE_CLAMP.weightScale);
  }

  return baseline;
};
