import { SAMPLE_COUNT } from './motionCurve';
import type { ItemMotionField, MotionSample } from './motionCurve';
import type { FlatKeyframeEntry } from '../adaptation/keyframeAdapter';
import type { RagAnimationDatasetItem } from '../types/ragTypes';

// Novelty measurement.
//
// The existing integrity check answers "did the editor receive exactly what synthesis produced",
// which is a transport check — it passes at 100% whether synthesis generated something new or
// replayed its input verbatim. These metrics answer the different question the label
// "synthesized" actually claims: how far is the output from the dataset it was built from.
//
// Reported alongside the integrity percentage rather than replacing it: one says the pipeline is
// faithful, the other says it is generative, and a pipeline needs to be both.

const VALUE_TOLERANCE = 0.0001;
const ENERGY_EPSILON = 1e-6;

const CHANNELS = ['dx', 'dy', 'drot', 'dsx', 'dsy'] as const;

export interface SynthesizedCurve {
  semantic: string | null;
  samples: MotionSample[];
}

export interface ItemDivergence {
  itemId: string;
  divergence: number;
  comparedBones: number;
}

export interface NoveltyReport {
  // Mean normalized RMS difference from the winning clip, as a percentage. 0 means the output
  // traces that clip exactly; 100 means it differs by as much as the clip's own motion energy.
  divergenceFromSource: number;
  // The dataset item the output ended up closest to — not necessarily the one retrieved, since
  // blending pulls the result toward its partners.
  nearestItemId: string | null;
  nearestItemDivergence: number | null;
  // Share of emitted keyframes that land on a source keyframe's exact frame *and* repeat all
  // five of its channel values. A pure copy scores 100.
  identicalKeyframeRatio: number;
  // Share of emitted keyframes whose frame number exists in the corresponding source track at
  // all. Low values mean the output was genuinely re-keyed rather than re-valued in place.
  sharedFrameRatio: number;
  perItem: ItemDivergence[];
}

const rms = (values: number[]): number => {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
};

// Normalized distance between two phase-aligned curves: RMS of their per-sample difference,
// divided by the reference curve's own RMS. Dividing by the reference makes the number
// comparable across bones whose motion ranges differ by orders of magnitude.
const curveDivergence = (synthesized: MotionSample[], reference: MotionSample[]): number | null => {
  if (synthesized.length === 0 || reference.length === 0) return null;

  let totalDifference = 0;
  let totalReference = 0;
  let counted = 0;

  for (const channel of CHANNELS) {
    const referenceValues = reference.map((sample) => sample[channel]);
    const referenceEnergy = rms(referenceValues);
    if (referenceEnergy <= ENERGY_EPSILON) continue;

    const differences: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const a = synthesized[Math.min(i, synthesized.length - 1)]![channel];
      const b = reference[Math.min(i, reference.length - 1)]![channel];
      differences.push(a - b);
    }

    totalDifference += rms(differences);
    totalReference += referenceEnergy;
    counted += 1;
  }

  if (counted === 0 || totalReference <= ENERGY_EPSILON) return null;
  return totalDifference / totalReference;
};

const divergenceAgainstItem = (synthesized: SynthesizedCurve[], field: ItemMotionField): ItemDivergence | null => {
  const scores: number[] = [];

  for (const curve of synthesized) {
    if (!curve.semantic) continue;
    const reference = field.bySemantic.get(curve.semantic);
    if (!reference) continue;
    const divergence = curveDivergence(curve.samples, reference.samples);
    if (divergence === null) continue;
    scores.push(divergence);
  }

  if (scores.length === 0) return null;
  return {
    itemId: field.itemId,
    divergence: Math.round((scores.reduce((sum, v) => sum + v, 0) / scores.length) * 10000) / 100,
    comparedBones: scores.length,
  };
};

// Compare emitted keyframes against the source clip's own keys, track by track. sourceBoneId is
// used rather than bone name because a rig may carry two bones with the same name.
const measureKeyframeOverlap = (
  outputKeyframes: FlatKeyframeEntry[],
  sourceItem: RagAnimationDatasetItem,
): { identicalKeyframeRatio: number; sharedFrameRatio: number } => {
  if (outputKeyframes.length === 0) return { identicalKeyframeRatio: 0, sharedFrameRatio: 0 };

  const tracksByBoneId = new Map(sourceItem.animation.keyframes.map((track) => [track.boneId, track]));
  let identical = 0;
  let sharedFrames = 0;

  for (const entry of outputKeyframes) {
    const track = entry.sourceBoneId === undefined ? undefined : tracksByBoneId.get(entry.sourceBoneId);
    const sourceFrame = track?.frames.find((frame) => frame.frame === entry.frame);
    if (!sourceFrame) continue;

    sharedFrames += 1;
    const matches =
      Math.abs(sourceFrame.x - entry.x) <= VALUE_TOLERANCE &&
      Math.abs(sourceFrame.y - entry.y) <= VALUE_TOLERANCE &&
      Math.abs(sourceFrame.rotation - entry.rotation) <= VALUE_TOLERANCE &&
      Math.abs(sourceFrame.scaleX - entry.scaleX) <= VALUE_TOLERANCE &&
      Math.abs(sourceFrame.scaleY - entry.scaleY) <= VALUE_TOLERANCE;
    if (matches) identical += 1;
  }

  return {
    identicalKeyframeRatio: Math.round((identical / outputKeyframes.length) * 10000) / 100,
    sharedFrameRatio: Math.round((sharedFrames / outputKeyframes.length) * 10000) / 100,
  };
};

export const measureNovelty = (
  synthesized: SynthesizedCurve[],
  sourceItem: RagAnimationDatasetItem,
  sourceField: ItemMotionField,
  datasetFields: ItemMotionField[],
  outputKeyframes: FlatKeyframeEntry[],
): NoveltyReport => {
  const sourceDivergence = divergenceAgainstItem(synthesized, sourceField);

  const perItem = datasetFields
    .map((field) => divergenceAgainstItem(synthesized, field))
    .filter((entry): entry is ItemDivergence => entry !== null)
    .sort((a, b) => a.divergence - b.divergence);

  const nearest = perItem[0] ?? null;
  const overlap = measureKeyframeOverlap(outputKeyframes, sourceItem);

  return {
    divergenceFromSource: sourceDivergence?.divergence ?? 0,
    nearestItemId: nearest?.itemId ?? null,
    nearestItemDivergence: nearest?.divergence ?? null,
    identicalKeyframeRatio: overlap.identicalKeyframeRatio,
    sharedFrameRatio: overlap.sharedFrameRatio,
    perItem: perItem.slice(0, 5),
  };
};
