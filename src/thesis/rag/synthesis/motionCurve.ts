import { applyEasing } from '../../../utils/easing';
import { assignSourceSemantics } from '../adaptation/boneMapper';
import type { RagAnimationBoneTrack, RagAnimationDatasetItem, RagAnimationFrame } from '../types/ragTypes';

// A dataset clip is authored on its own timeline (24, 32, 40 frames …) with its own key
// density. To compare or combine two clips, both must first be expressed on a common,
// duration-independent axis. A MotionCurve is that representation: the clip's motion resampled
// onto PHASE_RESOLUTION + 1 uniform samples over normalized phase 0→1, stored as a delta from
// the track's own rest pose so a clip authored on one rig's proportions can be read against
// another's.
export const PHASE_RESOLUTION = 64;

export interface MotionSample {
  dx: number;
  dy: number;
  drot: number;
  dsx: number;
  dsy: number;
}

// Per-channel RMS magnitude of a curve. Used to align two clips' magnitudes before blending,
// so combining a wide-swinging clip with a subtle one changes the motion's *shape* rather than
// simply making it bigger.
export interface CurveEnergy {
  rotation: number;
  position: number;
  scale: number;
}

export interface MotionCurve {
  semantic: string | null;
  boneId: number;
  boneName: string;
  rest: RagAnimationFrame;
  samples: MotionSample[];
  energy: CurveEnergy;
}

export const SAMPLE_COUNT = PHASE_RESOLUTION + 1;

const ZERO_SAMPLE: MotionSample = { dx: 0, dy: 0, drot: 0, dsx: 0, dsy: 0 };

export const phaseOf = (index: number): number => index / PHASE_RESOLUTION;

// Wraps a phase into [0, 1) for cyclic clips; clamps it into [0, 1] for one-shot clips.
export const normalizePhase = (phase: number, cyclic: boolean): number => {
  if (!cyclic) return Math.max(0, Math.min(1, phase));
  const wrapped = phase % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};

// Evaluate a source track at an arbitrary frame time, honouring each segment's authored easing
// so resampling preserves the clip's timing feel rather than flattening it to linear.
const evaluateTrackAtFrame = (frames: RagAnimationFrame[], frame: number): RagAnimationFrame => {
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  if (frame <= first.frame) return first;
  if (frame >= last.frame) return last;

  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i]!;
    const b = frames[i + 1]!;
    if (frame < a.frame || frame > b.frame) continue;

    const span = b.frame - a.frame;
    const local = span <= 0 ? 0 : (frame - a.frame) / span;
    const t = applyEasing(a.easing, local);
    return {
      frame,
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      rotation: a.rotation + (b.rotation - a.rotation) * t,
      scaleX: a.scaleX + (b.scaleX - a.scaleX) * t,
      scaleY: a.scaleY + (b.scaleY - a.scaleY) * t,
      easing: a.easing,
    };
  }

  return last;
};

const rms = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v * v, 0);
  return Math.sqrt(sum / values.length);
};

const measureEnergy = (samples: MotionSample[]): CurveEnergy => ({
  rotation: rms(samples.map((s) => s.drot)),
  position: rms(samples.map((s) => Math.hypot(s.dx, s.dy))),
  scale: rms(samples.map((s) => Math.hypot(s.dsx, s.dsy))),
});

// Resample one bone track onto the shared phase axis as deltas from its rest pose (its first
// keyframe — the same rest convention the previous synthesizer used, kept so same-rig output
// stays in the source's coordinate space).
export const buildMotionCurve = (
  track: RagAnimationBoneTrack,
  duration: number,
  semantic: string | null,
): MotionCurve | null => {
  const frames = [...track.frames].sort((a, b) => a.frame - b.frame);
  if (frames.length === 0 || duration <= 0) return null;

  const rest = frames[0]!;
  const samples: MotionSample[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const value = evaluateTrackAtFrame(frames, phaseOf(i) * duration);
    samples.push({
      dx: value.x - rest.x,
      dy: value.y - rest.y,
      drot: value.rotation - rest.rotation,
      dsx: value.scaleX - rest.scaleX,
      dsy: value.scaleY - rest.scaleY,
    });
  }

  return {
    semantic,
    boneId: track.boneId,
    boneName: track.boneName,
    rest,
    samples,
    energy: measureEnergy(samples),
  };
};

export interface ItemMotionField {
  itemId: string;
  cyclic: boolean;
  duration: number;
  curves: MotionCurve[];
  bySemantic: Map<string, MotionCurve>;
}

// Build the full phase-normalized representation of a dataset item: one curve per bone track,
// plus a semantic index for cross-item lookup.
export const buildItemMotionField = (item: RagAnimationDatasetItem): ItemMotionField => {
  // Semantic roles come from the shared assignment in boneMapper, so synthesis and the binding
  // layer cannot disagree about which track is the arm and which is the hand.
  const semantics = assignSourceSemantics(item);
  const curves: MotionCurve[] = [];
  const bySemantic = new Map<string, MotionCurve>();

  item.animation.keyframes.forEach((track) => {
    const curve = buildMotionCurve(track, item.animation.duration, semantics.get(track.boneId) ?? null);
    if (!curve) return;
    curves.push(curve);
    if (curve.semantic && !bySemantic.has(curve.semantic)) bySemantic.set(curve.semantic, curve);
  });

  return {
    itemId: item.id,
    cyclic: item.loop === true,
    duration: item.animation.duration,
    curves,
    bySemantic,
  };
};

// Sample a curve at an arbitrary phase, interpolating between the stored uniform samples.
// Fractional phases matter: the procedural layer delays a bone by a fraction of a cycle, which
// only produces real overlap if the curve can be read between its own samples.
export const sampleCurveAtPhase = (samples: MotionSample[], phase: number, cyclic: boolean): MotionSample => {
  if (samples.length === 0) return ZERO_SAMPLE;

  const normalized = normalizePhase(phase, cyclic);
  const position = normalized * PHASE_RESOLUTION;
  const lower = Math.floor(position);
  const upper = cyclic ? (lower + 1) % PHASE_RESOLUTION : Math.min(SAMPLE_COUNT - 1, lower + 1);
  const t = position - lower;

  const a = samples[Math.min(lower, samples.length - 1)]!;
  const b = samples[Math.min(upper, samples.length - 1)]!;

  return {
    dx: a.dx + (b.dx - a.dx) * t,
    dy: a.dy + (b.dy - a.dy) * t,
    drot: a.drot + (b.drot - a.drot) * t,
    dsx: a.dsx + (b.dsx - a.dsx) * t,
    dsy: a.dsy + (b.dsy - a.dsy) * t,
  };
};

// Circular cross-correlation between two rotation series, returning the phase offset (0→1) at
// which they align best. For a gait clip this recovers the natural left/right stride offset
// (≈0.5 for a walk) directly from the data, with no hardcoded assumption about the gait.
export const estimatePhaseOffset = (a: MotionSample[], b: MotionSample[]): number | null => {
  if (a.length < 2 || b.length < 2) return null;

  const left = a.slice(0, PHASE_RESOLUTION).map((s) => s.drot);
  const right = b.slice(0, PHASE_RESOLUTION).map((s) => s.drot);
  const leftEnergy = rms(left);
  const rightEnergy = rms(right);
  if (leftEnergy <= 1e-6 || rightEnergy <= 1e-6) return null;

  let bestShift = 0;
  let bestScore = -Infinity;
  for (let shift = 0; shift < PHASE_RESOLUTION; shift++) {
    let score = 0;
    for (let i = 0; i < PHASE_RESOLUTION; i++) {
      score += left[i]! * right[(i + shift) % PHASE_RESOLUTION]!;
    }
    if (score > bestScore) {
      bestScore = score;
      bestShift = shift;
    }
  }

  return bestShift / PHASE_RESOLUTION;
};
