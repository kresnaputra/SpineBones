import { clampDuration, clampFps } from '../shared/clamps';
import { blendEnsembleMotion } from './motionBlender';
import { sampleCurveAtPhase } from './motionCurve';
import { buildProceduralProfile, deriveEasing, selectKeyPhases } from './proceduralLayer';
import type { BlendCandidate } from './motionBlender';
import type { ItemMotionField, MotionSample } from './motionCurve';
import type { SynthesizedCurve } from './novelty';
import type { BoneBindingMap, RigBoneRef } from '../adaptation/boneMapper';
import type { FlatKeyframeEntry } from '../adaptation/keyframeAdapter';
import type { RagAnimationDatasetItem, RagKeyframeEasing } from '../types/ragTypes';
import type { MotionModifiers, MotionPattern, MotionPhase, SynthesisResult } from './types';

const SMOOTHING_EASING_THRESHOLD = 1.15;

// Resolution of the working curve each bone is synthesized on before re-keying. Independent of
// both the source clip's key count and the output's — the curve is continuous, and keys are
// chosen from it afterwards.
const WORKING_SAMPLES = 65;

const resolveAxisScale = (axis: MotionPhase['yAxis'], modifiers: MotionModifiers): number =>
  axis === 'none' ? 1 : modifiers[axis];

const resolveRotationScale = (phase: MotionPhase, modifiers: MotionModifiers): number => {
  const product = phase.rotationAxes.reduce((acc, axis) => acc * modifiers[axis], 1);
  return product / modifiers.smoothness;
};

// MotionPattern phases are spans of *frame indices* into the source clip's key list. Synthesis
// works in normalized phase, so each span is converted to a half-open phase range and the spans
// are made contiguous — the analyzer anchors some phases to a single key (an apex, a contact),
// which would otherwise leave the time between anchors unrouted.
const buildPhaseRouting = (pattern: MotionPattern, duration: number): ((phase: number) => MotionPhase) => {
  const fallback = pattern.phases[0]!;
  if (pattern.phases.length === 0 || pattern.frames.length === 0 || duration <= 0) return () => fallback;

  const starts = pattern.phases.map((phase) => (pattern.frames[phase.startFrameIndex] ?? 0) / duration);
  return (phase: number): MotionPhase => {
    for (let i = pattern.phases.length - 1; i >= 0; i--) {
      if (phase >= starts[i]!) return pattern.phases[i]!;
    }
    return fallback;
  };
};

export interface SynthesisInput {
  item: RagAnimationDatasetItem;
  bindings: BoneBindingMap;
  pattern: MotionPattern;
  modifiers: MotionModifiers;
  selectedField: ItemMotionField;
  selectedScore: number;
  candidates: BlendCandidate[];
  targetBones: RigBoneRef[];
}

// Generate an animation from a retrieved clip and the ensemble retrieved alongside it.
//
// The pipeline is: blend the ensemble's motion onto a shared phase axis → delay each bone by its
// own hierarchy-derived lag → scale per motion phase by the active modifiers → re-key where the
// resulting curve actually bends. Only the last step produces keyframes, so the output's key
// times come from the synthesized motion rather than from the source clip's authoring.
export const synthesizeKeyframes = (input: SynthesisInput): SynthesisResult => {
  const { item, bindings, pattern, modifiers, selectedField, selectedScore, candidates, targetBones } = input;

  const appliedDurationUnclamped = Math.round(item.animation.duration * modifiers.timeScale);
  const appliedDuration = clampDuration(appliedDurationUnclamped);
  const appliedFps = clampFps(item.animation.fps);
  const cyclic = item.loop === true;
  const forceSmoothEasing = modifiers.smoothness >= SMOOTHING_EASING_THRESHOLD;

  const blended = blendEnsembleMotion(selectedField, selectedScore, item.category, candidates);

  // Only bound tracks take part. Destinations were already decided by bone id when the bindings
  // were built, so the procedural layer can read hierarchy depth straight from the rig bone this
  // curve is actually going to drive.
  const targetBoneByCurveIndex = new Map<number, RigBoneRef>();
  selectedField.curves.forEach((curve, index) => {
    const binding = bindings.get(curve.boneId);
    if (!binding) return;
    const bone = targetBones.find((candidate) => candidate.id === binding.targetBoneId);
    if (!bone) return;
    targetBoneByCurveIndex.set(index, bone);
  });

  const ensembleFields = [selectedField, ...candidates.map((candidate) => candidate.field)];
  const profile = buildProceduralProfile(
    selectedField,
    ensembleFields,
    targetBoneByCurveIndex,
    targetBones,
    modifiers.weightScale,
  );

  const routePhase = buildPhaseRouting(pattern, item.animation.duration);
  const flatKeyframes: FlatKeyframeEntry[] = [];
  const synthesizedCurves: SynthesizedCurve[] = [];

  selectedField.curves.forEach((curve, index) => {
    const targetBone = targetBoneByCurveIndex.get(index);
    if (!targetBone) return;

    const source = blended.curves.get(index) ?? curve.samples;
    const lag = profile.lagByCurveIndex.get(index) ?? 0;
    const amplitude = profile.amplitudeByCurveIndex.get(index) ?? 1;

    // Read the blended curve back through this bone's own delay, then scale it by whatever the
    // motion phase at that point routes to. Sampling the delayed curve is what makes frame 0 stop
    // being pinned to the source's rest pose: at a non-zero lag the cycle no longer starts there.
    const sampleFinal = (phase: number): MotionSample => {
      const delayed = sampleCurveAtPhase(source, phase - lag, cyclic);
      const motionPhase = routePhase(Math.max(0, Math.min(1, phase)));
      const yScale = resolveAxisScale(motionPhase.yAxis, modifiers) * amplitude;
      const xScale = resolveAxisScale(motionPhase.xAxis, modifiers) * amplitude;
      const scaleScale = resolveAxisScale(motionPhase.scaleAxis, modifiers);
      const rotationScale = resolveRotationScale(motionPhase, modifiers) * amplitude;

      return {
        dx: delayed.dx * xScale,
        dy: delayed.dy * yScale,
        drot: delayed.drot * rotationScale,
        dsx: delayed.dsx * scaleScale,
        dsy: delayed.dsy * scaleScale,
      };
    };

    const working: MotionSample[] = [];
    for (let i = 0; i < WORKING_SAMPLES; i++) working.push(sampleFinal(i / (WORKING_SAMPLES - 1)));
    synthesizedCurves.push({ semantic: curve.semantic, samples: working });

    const keyPhases = selectKeyPhases(working, cyclic, appliedDuration);
    const rest = curve.rest;
    let lastEmittedFrame = -1;

    keyPhases.forEach((phase, keyIndex) => {
      let frame = Math.round(phase * appliedDuration);
      if (frame <= lastEmittedFrame) frame = lastEmittedFrame + 1;
      frame = Math.max(0, Math.min(appliedDuration, frame));
      // A bumped frame can collide with the clip's end; drop the key rather than stack two
      // keyframes on one frame, which the editor would treat as a duplicate destination.
      if (frame <= lastEmittedFrame) return;
      lastEmittedFrame = frame;

      const sample = sampleFinal(phase);
      const easing: RagKeyframeEasing = forceSmoothEasing
        ? 'easeInOut'
        : deriveEasing(working, keyPhases, keyIndex, cyclic, sampleFinal);

      flatKeyframes.push({
        sourceBoneId: curve.boneId,
        targetBoneId: targetBone.id,
        boneName: targetBone.name,
        frame,
        x: rest.x + sample.dx,
        y: rest.y + sample.dy,
        rotation: rest.rotation + sample.drot,
        scaleX: rest.scaleX + sample.dsx,
        scaleY: rest.scaleY + sample.dsy,
        easing,
      });
    });
  });

  return {
    flatKeyframes,
    appliedDuration,
    appliedFps,
    generatedKeyframeCount: flatKeyframes.length,
    synthesizedCurves,
    blend: {
      contributions: blended.contributions,
      blendStrength: blended.blendStrength,
      blendedBoneCount: blended.blendedBoneCount,
    },
    procedural: {
      maxOverlapPhase: profile.maxOverlapPhase,
      gaitCorrection: profile.gaitCorrection,
      asymmetryRatio: profile.asymmetryRatio,
    },
  };
};
