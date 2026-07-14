import type { RagAnimationBoneTrack, RagAnimationDatasetItem } from '../types/ragTypes';
import type { MotionExtremum, MotionPattern, MotionPhase, MotionPhaseLabel } from './types';

const AMPLITUDE_EPSILON = 2.0;
const MIN_FRAMES_FOR_ANALYSIS = 3;
const PROMINENCE_RATIO = 0.2;
const CYCLIC_EXTREMA_THRESHOLD = 4;

const routingForLabel = (
  label: MotionPhaseLabel,
): Pick<MotionPhase, 'yAxis' | 'rotationAxes' | 'xAxis' | 'scaleAxis'> => {
  switch (label) {
    case 'anticipation':
    case 'landing':
      return {
        yAxis: 'weightScale',
        rotationAxes: ['weightScale', 'exaggeration'],
        xAxis: 'exaggeration',
        scaleAxis: 'weightScale',
      };
    case 'contact':
      return { yAxis: 'weightScale', rotationAxes: ['exaggeration'], xAxis: 'exaggeration', scaleAxis: 'none' };
    case 'apex':
    case 'fall':
    case 'passing':
      return { yAxis: 'heightScale', rotationAxes: ['exaggeration'], xAxis: 'exaggeration', scaleAxis: 'none' };
    case 'start':
    case 'recovery':
      return { yAxis: 'none', rotationAxes: ['exaggeration'], xAxis: 'exaggeration', scaleAxis: 'none' };
    case 'neutral':
    default:
      return { yAxis: 'heightScale', rotationAxes: ['exaggeration'], xAxis: 'exaggeration', scaleAxis: 'none' };
  }
};

const buildPhase = (label: MotionPhaseLabel, startFrameIndex: number, endFrameIndex: number): MotionPhase => ({
  label,
  startFrameIndex,
  endFrameIndex,
  ...routingForLabel(label),
});

const neutralPhase = (lastIndex: number): MotionPhase => buildPhase('neutral', 0, lastIndex);

// Only emits a phase when its range is non-empty — used at anchor boundaries where an
// adjacent extremum may be one frame away (or zero frames away), which would otherwise
// produce an inverted (start > end) range.
const pushIfValid = (phases: MotionPhase[], label: MotionPhaseLabel, start: number, end: number): void => {
  if (start > end) return;
  phases.push(buildPhase(label, start, end));
};

// Prefers the track mapped to the "torso" semantic bone (the most reliable proxy for overall
// body displacement); falls back to the track with the most frames when no torso mapping exists.
const selectReferenceTrack = (item: RagAnimationDatasetItem): RagAnimationBoneTrack | null => {
  const tracks = item.animation.keyframes;
  if (tracks.length === 0) return null;

  const torsoSourceBone = item.boneMapping.torso;
  if (torsoSourceBone) {
    const torsoTrack = tracks.find((track) => track.boneName === torsoSourceBone);
    if (torsoTrack) return torsoTrack;
  }

  return tracks.reduce((best, track) => (track.frames.length > best.frames.length ? track : best), tracks[0]!);
};

// Local min/max detection over the reference track's y-series, in frame order. An extremum is
// kept only when its deviation from the average of its neighbors ("prominence") is at least
// 20% of the track's total amplitude — a relative threshold so it self-scales across dataset
// items with very different y ranges, filtering out noise on near-flat tracks (e.g. attack/hit).
const detectExtrema = (values: number[], amplitude: number): Omit<MotionExtremum, 'frame'>[] => {
  const extrema: Omit<MotionExtremum, 'frame'>[] = [];
  const prominenceThreshold = PROMINENCE_RATIO * amplitude;

  for (let i = 1; i < values.length - 1; i++) {
    const prev = values[i - 1]!;
    const cur = values[i]!;
    const next = values[i + 1]!;
    const isMax = cur >= prev && cur >= next && (cur > prev || cur > next);
    const isMin = cur <= prev && cur <= next && (cur < prev || cur < next);
    if (!isMax && !isMin) continue;

    const prominence = Math.abs(cur - (prev + next) / 2);
    if (prominence < prominenceThreshold) continue;

    extrema.push({ frameIndex: i, value: cur, kind: isMax ? 'max' : 'min', prominence });
  }

  return extrema;
};

const isAlternating = (extrema: MotionExtremum[]): boolean => {
  for (let i = 1; i < extrema.length; i++) {
    if (extrema[i]!.kind === extrema[i - 1]!.kind) return false;
  }
  return true;
};

// Cyclic gait (walk/run): the timeline is partitioned so each extremum owns its own frame index
// as the START of its segment (half-open ranges — segment i spans [boundary_i, boundary_{i+1})),
// which keeps every extremum's own pose frame unambiguously labeled by its own kind rather than
// by whichever neighboring segment a naive inclusive-inclusive range happens to be checked first.
// A segment starting at a 'max' extremum (higher y = lower screen position = ground contact in
// this coordinate space) is 'contact'; 'min' is 'passing'. The lead-in segment before the first
// extremum wraps around to the last extremum's kind, since a looping clip's frame 0 continues
// from the end of the previous cycle.
const buildCyclicPhases = (extrema: MotionExtremum[], lastIndex: number): MotionPhase[] => {
  const boundaries = [0, ...extrema.map((e) => e.frameIndex), lastIndex + 1].filter(
    (value, index, arr) => index === 0 || value !== arr[index - 1],
  );

  const phases: MotionPhase[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!;
    const end = Math.min(lastIndex, boundaries[i + 1]! - 1);
    if (start > end) continue;

    const governing = extrema.find((e) => e.frameIndex === start) ?? (start === 0 ? extrema.at(-1) : undefined);
    const label: MotionPhaseLabel = governing ? (governing.kind === 'max' ? 'contact' : 'passing') : 'neutral';
    phases.push(buildPhase(label, start, end));
  }
  return phases.length > 0 ? phases : [neutralPhase(lastIndex)];
};

// One-shot arc (jump/hop): the deepest 'min' extremum (highest point on screen = apex) anchors
// the arc as its own single-frame phase. The nearest preceding 'max' extremum (deepest crouch)
// becomes its own single-frame 'anticipation' anchor; the nearest following 'max' extremum
// becomes a single-frame 'landing' anchor. Transitional spans ('start', 'fall', 'recovery') fill
// the gaps between anchors and are omitted when there's no gap (adjacent anchors). Either
// boundary anchor may be absent entirely (e.g. a hop with no distinct crouch, or a soft landing
// with no bounce) — in that case the adjacent anchor/span is simply omitted rather than fabricated.
const buildOneShotPhases = (extrema: MotionExtremum[], lastIndex: number): MotionPhase[] => {
  const mins = extrema.filter((e) => e.kind === 'min');
  if (mins.length === 0) return [neutralPhase(lastIndex)];

  const apex = mins.reduce((best, e) => (e.value < best.value ? e : best), mins[0]!);
  const anticipation = extrema
    .filter((e) => e.kind === 'max' && e.frameIndex < apex.frameIndex)
    .sort((a, b) => b.frameIndex - a.frameIndex)[0];
  const landing = extrema
    .filter((e) => e.kind === 'max' && e.frameIndex > apex.frameIndex)
    .sort((a, b) => a.frameIndex - b.frameIndex)[0];

  const phases: MotionPhase[] = [];

  if (anticipation) {
    pushIfValid(phases, 'start', 0, anticipation.frameIndex - 1);
    phases.push(buildPhase('anticipation', anticipation.frameIndex, anticipation.frameIndex));
    pushIfValid(phases, 'anticipation', anticipation.frameIndex + 1, apex.frameIndex - 1);
  } else {
    pushIfValid(phases, 'start', 0, apex.frameIndex - 1);
  }

  phases.push(buildPhase('apex', apex.frameIndex, apex.frameIndex));

  if (landing) {
    pushIfValid(phases, 'fall', apex.frameIndex + 1, landing.frameIndex - 1);
    phases.push(buildPhase('landing', landing.frameIndex, landing.frameIndex));
    pushIfValid(phases, 'recovery', landing.frameIndex + 1, lastIndex);
  } else {
    pushIfValid(phases, 'fall', apex.frameIndex + 1, lastIndex);
  }

  return phases;
};

export const analyzeMotionPattern = (item: RagAnimationDatasetItem): MotionPattern => {
  const referenceTrack = selectReferenceTrack(item);
  if (!referenceTrack) {
    return {
      sourceItemId: item.id,
      isCyclic: item.loop,
      referenceBoneName: '',
      frames: [],
      amplitude: 0,
      extrema: [],
      phases: [neutralPhase(0)],
    };
  }

  const sortedFrames = [...referenceTrack.frames].sort((a, b) => a.frame - b.frame);
  const frames = sortedFrames.map((f) => f.frame);
  const values = sortedFrames.map((f) => f.y);
  const lastIndex = Math.max(0, frames.length - 1);
  const amplitude = values.length > 0 ? Math.max(...values) - Math.min(...values) : 0;

  // Degenerate gate: too few frames or too little vertical travel to trust extrema detection
  // (e.g. attack-sword/hit tracks) — fall back to a single neutral phase so modifiers still have
  // some effect (via exaggeration/height) without misreading noise as a jump arc.
  if (frames.length < MIN_FRAMES_FOR_ANALYSIS || amplitude < AMPLITUDE_EPSILON) {
    return {
      sourceItemId: item.id,
      isCyclic: item.loop,
      referenceBoneName: referenceTrack.boneName,
      frames,
      amplitude,
      extrema: [],
      phases: [neutralPhase(lastIndex)],
    };
  }

  const rawExtrema = detectExtrema(values, amplitude);
  const extrema: MotionExtremum[] = rawExtrema.map((e) => ({ ...e, frame: frames[e.frameIndex]! }));

  const isCyclic = item.loop === true || (extrema.length >= CYCLIC_EXTREMA_THRESHOLD && isAlternating(extrema));

  const phases = isCyclic
    ? buildCyclicPhases(extrema, lastIndex)
    : extrema.length >= 1 && extrema.length <= 3
      ? buildOneShotPhases(extrema, lastIndex)
      : [neutralPhase(lastIndex)];

  return {
    sourceItemId: item.id,
    isCyclic,
    referenceBoneName: referenceTrack.boneName,
    frames,
    amplitude,
    extrema,
    phases: phases.length > 0 ? phases : [neutralPhase(lastIndex)],
  };
};
