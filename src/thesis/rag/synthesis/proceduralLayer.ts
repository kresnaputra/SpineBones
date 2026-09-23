import { PHASE_RESOLUTION, estimatePhaseOffset, phaseOf } from './motionCurve';
import type { ItemMotionField, MotionCurve, MotionSample } from './motionCurve';
import type { RigBoneRef } from '../adaptation/boneMapper';
import type { RagKeyframeEasing } from '../types/ragTypes';

export type { RigBoneRef };

// Procedural animation layer.
//
// Blending combines *what* the retrieved clips do; this layer changes *when* each part of the
// rig does it, which is where a clip stops being a rearrangement of its sources. Three effects,
// each derived from the target rig or the retrieved ensemble rather than from constants pulled
// out of the air:
//
//   1. Overlap / follow-through — a child bone trails its parent by a fraction of a cycle, so a
//      hand arrives after the arm that swings it and a weapon after the hand. Depth comes from
//      the *target* rig's hierarchy, so the same dataset clip lags differently on a different rig.
//   2. Gait phase correction — the left/right stride offset the ensemble agrees on, applied as a
//      residual against the winning clip's own offset, recovered by cross-correlation.
//   3. Data-derived asymmetry — the left/right amplitude imbalance the ensemble shows, again as
//      a residual, so output is not perfectly mirror-symmetric the way a single clip often is.
//
// Finally the layer re-keys: output keyframes land where the *synthesized* curve actually bends,
// not at the source clip's key times. This is what breaks topological identity with the dataset.

// Phase lag added per level of hierarchy depth below the root, before weight scaling. At a
// 32-frame cycle one level is ≈1.1 frames — small enough to read as follow-through rather than
// as a bone falling out of sync.
const OVERLAP_PHASE_PER_DEPTH = 0.035;

// Deep chains would otherwise accumulate lag until the tip is most of a cycle behind the root.
const MAX_OVERLAP_PHASE = 0.18;

// Both residual corrections are deliberately narrow: they are nudges the ensemble supports, not
// re-authoring of the winning clip.
const GAIT_CORRECTION_CLAMP = 0.06;
const ASYMMETRY_CLAMP: [number, number] = [0.92, 1.08];

// Re-keying bounds. The floor keeps a pose readable; the ceiling keeps the timeline editable by
// hand afterwards instead of becoming a baked per-frame track.
const MIN_KEY_SPACING_FRAMES = 2;
const MIN_KEYS = 3;
const MAX_KEYS = 12;

// A channel quieter than this against its own curve is treated as flat and excluded from
// curvature scoring, so numerical dust in a static channel cannot attract a keyframe.
const CHANNEL_EPSILON = 1e-6;

const clamp = (value: number, [min, max]: [number, number]) => Math.max(min, Math.min(max, value));

const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

export interface ProceduralProfile {
  // Phase lag and amplitude scale per curve index within the winner's motion field.
  lagByCurveIndex: Map<number, number>;
  amplitudeByCurveIndex: Map<number, number>;
  maxOverlapPhase: number;
  gaitCorrection: number;
  asymmetryRatio: number;
}

// Walk the target rig upward to find how deep this bone sits. Cycles cannot occur in a valid
// rig, but the visited set keeps a corrupt one from hanging the pipeline.
const depthOf = (bone: RigBoneRef, bones: RigBoneRef[]): number => {
  const byId = new Map(bones.map((entry) => [entry.id, entry]));
  const visited = new Set<number>();
  let depth = 0;
  let current: RigBoneRef | undefined = bone;

  while (current && current.parentId !== null && !visited.has(current.id)) {
    visited.add(current.id);
    current = byId.get(current.parentId);
    if (!current) break;
    depth += 1;
  }

  return depth;
};

const sideOf = (semantic: string | null): 'left' | 'right' | null => {
  if (!semantic) return null;
  const lower = semantic.toLowerCase();
  if (lower.startsWith('left')) return 'left';
  if (lower.startsWith('right')) return 'right';
  return null;
};

const pairKeyOf = (semantic: string): string => semantic.toLowerCase().replace(/^(left|right)/, '');

// Collect semantic labels that exist as a left/right pair within one item.
const findSidePairs = (field: ItemMotionField): Array<{ left: MotionCurve; right: MotionCurve }> => {
  const byPairKey = new Map<string, { left?: MotionCurve; right?: MotionCurve }>();

  for (const [semantic, curve] of field.bySemantic) {
    const side = sideOf(semantic);
    if (!side) continue;
    const key = pairKeyOf(semantic);
    const entry = byPairKey.get(key) ?? {};
    entry[side] = curve;
    byPairKey.set(key, entry);
  }

  return [...byPairKey.values()].filter(
    (entry): entry is { left: MotionCurve; right: MotionCurve } => Boolean(entry.left && entry.right),
  );
};

// Mean left/right rotation-energy ratio across an item's limb pairs. A clip whose left limb
// swings 5% wider than its right reports 1.05.
const measureAsymmetry = (field: ItemMotionField): number | null => {
  const ratios = findSidePairs(field)
    .filter((pair) => pair.left.energy.rotation > CHANNEL_EPSILON && pair.right.energy.rotation > CHANNEL_EPSILON)
    .map((pair) => pair.left.energy.rotation / pair.right.energy.rotation);

  return ratios.length === 0 ? null : mean(ratios);
};

// Mean left/right stride offset across an item's limb pairs, as a phase in [0, 1).
const measureGaitOffset = (field: ItemMotionField): number | null => {
  const offsets = findSidePairs(field)
    .map((pair) => estimatePhaseOffset(pair.left.samples, pair.right.samples))
    .filter((offset): offset is number => offset !== null);

  return offsets.length === 0 ? null : mean(offsets);
};

// Shortest signed distance between two phases on a circle, in [-0.5, 0.5].
const circularDelta = (from: number, to: number): number => {
  const raw = (to - from) % 1;
  const wrapped = raw < 0 ? raw + 1 : raw;
  return wrapped > 0.5 ? wrapped - 1 : wrapped;
};

export const buildProceduralProfile = (
  selected: ItemMotionField,
  ensemble: ItemMotionField[],
  targetBoneByCurveIndex: Map<number, RigBoneRef>,
  targetBones: RigBoneRef[],
  weightScale: number,
): ProceduralProfile => {
  const lagByCurveIndex = new Map<number, number>();
  const amplitudeByCurveIndex = new Map<number, number>();

  const others = ensemble.filter((field) => field.itemId !== selected.itemId);

  // Gait correction: how far the ensemble's agreed stride offset sits from the winner's own.
  const selectedGait = measureGaitOffset(selected);
  const ensembleGaits = others.map(measureGaitOffset).filter((offset): offset is number => offset !== null);
  const gaitCorrection =
    selectedGait !== null && ensembleGaits.length > 0
      ? Math.max(-GAIT_CORRECTION_CLAMP, Math.min(GAIT_CORRECTION_CLAMP, circularDelta(selectedGait, mean(ensembleGaits))))
      : 0;

  // Asymmetry residual: the ensemble's imbalance relative to the winner's own imbalance, so an
  // already-asymmetric clip is not pushed further in the same direction.
  const selectedAsymmetry = measureAsymmetry(selected);
  const ensembleAsymmetries = others.map(measureAsymmetry).filter((ratio): ratio is number => ratio !== null);
  const asymmetryRatio =
    selectedAsymmetry !== null && selectedAsymmetry > CHANNEL_EPSILON && ensembleAsymmetries.length > 0
      ? clamp(mean(ensembleAsymmetries) / selectedAsymmetry, ASYMMETRY_CLAMP)
      : 1;

  // Split the imbalance across both sides so overall motion energy is preserved.
  const leftAmplitude = Math.sqrt(asymmetryRatio);
  const rightAmplitude = 1 / leftAmplitude;

  let maxOverlapPhase = 0;

  selected.curves.forEach((curve, index) => {
    const targetBone = targetBoneByCurveIndex.get(index);
    const depth = targetBone ? depthOf(targetBone, targetBones) : 0;
    const overlap = Math.min(MAX_OVERLAP_PHASE, depth * OVERLAP_PHASE_PER_DEPTH * weightScale);
    maxOverlapPhase = Math.max(maxOverlapPhase, overlap);

    const side = sideOf(curve.semantic);
    // The stride correction is applied as equal and opposite half-shifts so the pair's midpoint
    // timing stays where the winning clip put it.
    const gaitShift = side === 'left' ? gaitCorrection / 2 : side === 'right' ? -gaitCorrection / 2 : 0;

    lagByCurveIndex.set(index, overlap + gaitShift);
    amplitudeByCurveIndex.set(index, side === 'left' ? leftAmplitude : side === 'right' ? rightAmplitude : 1);
  });

  return {
    lagByCurveIndex,
    amplitudeByCurveIndex,
    maxOverlapPhase: Math.round(maxOverlapPhase * 1000) / 1000,
    gaitCorrection: Math.round(gaitCorrection * 1000) / 1000,
    asymmetryRatio: Math.round(asymmetryRatio * 1000) / 1000,
  };
};

const CHANNELS = ['dx', 'dy', 'drot', 'dsx', 'dsy'] as const;
type ChannelKey = (typeof CHANNELS)[number];

// Per-channel RMS, used to put degrees, pixels and scale factors on a comparable footing before
// their curvatures are summed — otherwise rotation's larger numeric range would decide every key.
const channelScales = (samples: MotionSample[]): Record<ChannelKey, number> => {
  const scales = {} as Record<ChannelKey, number>;
  for (const channel of CHANNELS) {
    const values = samples.map((sample) => sample[channel]);
    const energy = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / Math.max(1, values.length));
    scales[channel] = energy;
  }
  return scales;
};

const dominantChannel = (scales: Record<ChannelKey, number>): ChannelKey =>
  CHANNELS.reduce((best, channel) => (scales[channel] > scales[best] ? channel : best), CHANNELS[0]);

// Second-difference magnitude per sample, summed over normalized channels. High curvature means
// the curve is turning there — exactly where an animator would place a key.
const curvatureSignal = (samples: MotionSample[], cyclic: boolean): number[] => {
  const scales = channelScales(samples);
  const last = samples.length - 1;
  const signal: number[] = new Array(samples.length).fill(0);

  for (let i = 0; i <= last; i++) {
    const prevIndex = i === 0 ? (cyclic ? PHASE_RESOLUTION - 1 : 0) : i - 1;
    const nextIndex = i === last ? (cyclic ? 1 : last) : i + 1;
    const prev = samples[prevIndex]!;
    const cur = samples[i]!;
    const next = samples[nextIndex]!;

    let total = 0;
    for (const channel of CHANNELS) {
      const scale = scales[channel];
      if (scale <= CHANNEL_EPSILON) continue;
      total += Math.abs(prev[channel] - 2 * cur[channel] + next[channel]) / scale;
    }
    signal[i] = total;
  }

  return signal;
};

// Choose output key phases from where the synthesized curve bends. Anchors (cycle start and end)
// are always kept so the clip opens and closes cleanly; the remaining budget goes to the highest
// curvature peaks that respect the minimum spacing.
export const selectKeyPhases = (samples: MotionSample[], cyclic: boolean, duration: number): number[] => {
  const minSpacing = duration > 0 ? MIN_KEY_SPACING_FRAMES / duration : 0;
  const signal = curvatureSignal(samples, cyclic);

  const anchors = [0, 1];
  const selected: number[] = [...anchors];

  const ranked = signal
    .map((value, index) => ({ value, phase: phaseOf(index) }))
    .filter((entry) => entry.phase > 0 && entry.phase < 1)
    .filter((entry, _index, all) => {
      // Keep local maxima only — a broad ramp should contribute one key, not a run of them.
      const position = Math.round(entry.phase * PHASE_RESOLUTION);
      const prev = all.find((other) => Math.round(other.phase * PHASE_RESOLUTION) === position - 1);
      const next = all.find((other) => Math.round(other.phase * PHASE_RESOLUTION) === position + 1);
      return (!prev || entry.value >= prev.value) && (!next || entry.value >= next.value);
    })
    .sort((a, b) => b.value - a.value);

  for (const entry of ranked) {
    if (selected.length >= MAX_KEYS) break;
    if (entry.value <= CHANNEL_EPSILON) break;
    if (selected.some((phase) => Math.abs(phase - entry.phase) < minSpacing)) continue;
    selected.push(entry.phase);
  }

  // A curve flat enough to produce no curvature peaks still needs enough keys to be a clip
  // rather than a two-pose fade; fill uniformly in that case.
  if (selected.length < MIN_KEYS) {
    for (let i = 1; i < MIN_KEYS && selected.length < MIN_KEYS; i++) {
      const phase = i / MIN_KEYS;
      if (selected.some((existing) => Math.abs(existing - phase) < minSpacing)) continue;
      selected.push(phase);
    }
  }

  return selected.sort((a, b) => a - b);
};

// Pick easing from how the dominant channel behaves either side of a key: a turning point holds
// (easeInOut), an accelerating departure eases in, a decelerating arrival eases out.
export const deriveEasing = (
  samples: MotionSample[],
  phases: number[],
  index: number,
  cyclic: boolean,
  sampleAt: (phase: number) => MotionSample,
): RagKeyframeEasing => {
  const channel = dominantChannel(channelScales(samples));
  const phase = phases[index]!;
  const previousPhase = index > 0 ? phases[index - 1]! : cyclic ? phases[phases.length - 1]! - 1 : phase;
  const nextPhase = index < phases.length - 1 ? phases[index + 1]! : cyclic ? phases[0]! + 1 : phase;

  const beforeSpan = phase - previousPhase;
  const afterSpan = nextPhase - phase;
  if (beforeSpan <= 0 || afterSpan <= 0) return 'linear';

  const current = sampleAt(phase)[channel];
  const slopeBefore = (current - sampleAt(previousPhase)[channel]) / beforeSpan;
  const slopeAfter = (sampleAt(nextPhase)[channel] - current) / afterSpan;

  const magnitudeBefore = Math.abs(slopeBefore);
  const magnitudeAfter = Math.abs(slopeAfter);
  if (magnitudeBefore <= CHANNEL_EPSILON && magnitudeAfter <= CHANNEL_EPSILON) return 'linear';

  // Sign flip means the curve turns around at this key.
  if (slopeBefore * slopeAfter < 0) return 'easeInOut';
  if (magnitudeAfter > magnitudeBefore * 1.3) return 'easeIn';
  if (magnitudeBefore > magnitudeAfter * 1.3) return 'easeOut';
  return 'linear';
};
