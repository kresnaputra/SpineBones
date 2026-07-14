import type { FlatKeyframeEntry } from '../adaptation/keyframeAdapter';

// Multiplicative scale factors applied on top of a retrieved animation's motion pattern.
// All axes default to 1 (neutral / no change from the base pattern).
export interface MotionModifiers {
  heightScale: number;
  timeScale: number;
  weightScale: number;
  smoothness: number;
  exaggeration: number;
  matchedPhrases: string[];
}

export const NEUTRAL_MODIFIERS: MotionModifiers = {
  heightScale: 1,
  timeScale: 1,
  weightScale: 1,
  smoothness: 1,
  exaggeration: 1,
  matchedPhrases: [],
};

// Numeric modifier axes only — excludes matchedPhrases, which isn't a scale factor.
export type ModifierAxisKey = 'heightScale' | 'timeScale' | 'weightScale' | 'smoothness' | 'exaggeration';

export type MotionPhaseLabel =
  | 'start'
  | 'anticipation'
  | 'apex'
  | 'fall'
  | 'landing'
  | 'recovery'
  | 'contact'
  | 'passing'
  | 'neutral';

export interface MotionExtremum {
  frameIndex: number;
  frame: number;
  value: number;
  kind: 'min' | 'max';
  prominence: number;
}

// A contiguous span of frame indices (into MotionPattern.frames) sharing one motion role.
// Axis fields are symbolic — they name which MotionModifiers field governs this phase's
// deltas, resolved to a concrete number only once modifiers are known. This lets the same
// analyzed MotionPattern be re-synthesized under different modifiers without re-analyzing.
export interface MotionPhase {
  label: MotionPhaseLabel;
  startFrameIndex: number;
  endFrameIndex: number;
  yAxis: ModifierAxisKey | 'none';
  rotationAxes: ModifierAxisKey[];
  xAxis: ModifierAxisKey | 'none';
  scaleAxis: ModifierAxisKey | 'none';
}

export interface MotionPattern {
  sourceItemId: string;
  isCyclic: boolean;
  referenceBoneName: string;
  frames: number[];
  amplitude: number;
  extrema: MotionExtremum[];
  phases: MotionPhase[];
}

export type RagOutputMode = 'synthesized' | 'raw_copy';

export interface SynthesisResult {
  flatKeyframes: FlatKeyframeEntry[];
  appliedDuration: number;
  appliedFps: number;
  generatedKeyframeCount: number;
}

export type CandidateRejectionReason = 'below_min_score' | 'insufficient_bone_mapping';

export interface RagCandidateSummary {
  id: string;
  score: number;
}

export interface RagRejectedCandidate extends RagCandidateSummary {
  reason: CandidateRejectionReason;
  mappedBoneCount?: number;
}
