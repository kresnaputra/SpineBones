import { PHASE_RESOLUTION, SAMPLE_COUNT, estimatePhaseOffset } from './motionCurve';
import type { ItemMotionField, MotionCurve, MotionSample } from './motionCurve';

// Cross-example blending.
//
// Retrieval already returns several ranked clips for a query, but the previous synthesizer
// reduced them to three scalar modifiers and then replayed the winning clip alone. Here the
// runner-up clips contribute their actual motion: each is resampled onto the shared phase axis
// (see motionCurve.ts), magnitude-aligned to the winner so the blend changes *shape and timing*
// rather than just amplitude, and mixed in at a weight derived from how close its retrieval
// score came to the winner's. The result is a motion curve that exists in no single dataset
// item, while every contributing sample is real authored animation rather than noise.

// A single runner-up may not dominate the winner, and all runners-up together stay a minority
// contribution — the query's best match should still be recognisable in the output.
const MAX_SINGLE_WEIGHT = 0.35;
const MAX_TOTAL_WEIGHT = 0.5;

// Below this share of the winner's score a candidate is too weak a match to be worth mixing in.
const MIN_SCORE_RATIO = 0.35;

// A candidate must share at least this many semantic bones with the winner to blend usefully.
const MIN_SHARED_SEMANTICS = 3;

// Magnitude alignment is a correction, not a transformation — a candidate whose motion is
// wildly out of scale with the winner's is clamped rather than stretched to fit.
const ENERGY_ALIGN_CLAMP: [number, number] = [0.4, 2.5];

// After blending, each channel's magnitude is pulled back toward the winner's. Two gait cycles
// that disagree about where a stride peaks will partially cancel when summed, draining the
// motion; restoring energy keeps blending a change of *shape*, and leaves amplitude to the
// modifier axes that are supposed to govern it. Clamped so restoration cannot itself become an
// amplification effect.
const ENERGY_RESTORE_CLAMP: [number, number] = [0.8, 1.25];

const ENERGY_EPSILON = 1e-6;

export interface BlendCandidate {
  field: ItemMotionField;
  score: number;
  category: string;
}

export interface BlendContribution {
  itemId: string;
  weight: number;
  sharedSemantics: number;
}

export interface BlendedMotion {
  // Keyed by the winner's curve index within its own ItemMotionField.
  curves: Map<number, MotionSample[]>;
  contributions: BlendContribution[];
  blendedBoneCount: number;
  // Total weight given to clips other than the winner, 0 when nothing was eligible.
  blendStrength: number;
}

const clamp = (value: number, [min, max]: [number, number]) => Math.max(min, Math.min(max, value));

// Rotation is the dominant channel for limb motion; fall back to positional travel for tracks
// that only translate (a root/torso bob), and give up when a curve is essentially flat.
const alignmentFactor = (target: MotionCurve, source: MotionCurve): number | null => {
  if (target.energy.rotation > ENERGY_EPSILON && source.energy.rotation > ENERGY_EPSILON) {
    return clamp(target.energy.rotation / source.energy.rotation, ENERGY_ALIGN_CLAMP);
  }
  if (target.energy.position > ENERGY_EPSILON && source.energy.position > ENERGY_EPSILON) {
    return clamp(target.energy.position / source.energy.position, ENERGY_ALIGN_CLAMP);
  }
  return null;
};

const rms = (values: number[]): number =>
  values.length === 0 ? 0 : Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);

// A single rotation series standing in for an item's whole gait: every shared limb curve
// normalized by its own energy and summed, so the signature describes *when* the body moves
// rather than which bone swings widest.
const buildAlignmentSignature = (field: ItemMotionField, shared: string[]): MotionSample[] | null => {
  const contributors = shared
    .map((semantic) => field.bySemantic.get(semantic))
    .filter((curve): curve is MotionCurve => Boolean(curve) && curve!.energy.rotation > ENERGY_EPSILON);

  if (contributors.length === 0) return null;

  const signature: MotionSample[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    let drot = 0;
    for (const curve of contributors) drot += curve.samples[i]!.drot / curve.energy.rotation;
    signature.push({ dx: 0, dy: 0, drot, dsx: 0, dsy: 0 });
  }
  return signature;
};

// How far to rotate a partner clip around its own cycle before mixing it in. Two walk cycles
// authored with different starting poses are the same motion offset in time; summing them
// unaligned cancels the stride instead of combining it. Only meaningful between two cyclic
// clips — a one-shot action has no cycle to rotate.
const resolveAlignmentOffset = (
  selected: ItemMotionField,
  partner: ItemMotionField,
  shared: string[],
): number => {
  if (!selected.cyclic || !partner.cyclic) return 0;
  const selectedSignature = buildAlignmentSignature(selected, shared);
  const partnerSignature = buildAlignmentSignature(partner, shared);
  if (!selectedSignature || !partnerSignature) return 0;

  const offset = estimatePhaseOffset(selectedSignature, partnerSignature);
  return offset === null ? 0 : Math.round(offset * PHASE_RESOLUTION) % PHASE_RESOLUTION;
};

const sharedSemanticList = (selected: ItemMotionField, other: ItemMotionField): string[] =>
  [...selected.bySemantic.keys()].filter((semantic) => other.bySemantic.has(semantic));

// Pull each channel group's magnitude back toward the reference curve's.
const restoreEnergy = (blended: MotionSample[], reference: MotionCurve): MotionSample[] => {
  const factorFor = (actual: number, target: number): number =>
    actual <= ENERGY_EPSILON || target <= ENERGY_EPSILON ? 1 : clamp(target / actual, ENERGY_RESTORE_CLAMP);

  const rotationFactor = factorFor(rms(blended.map((s) => s.drot)), reference.energy.rotation);
  const positionFactor = factorFor(rms(blended.map((s) => Math.hypot(s.dx, s.dy))), reference.energy.position);
  const scaleFactor = factorFor(rms(blended.map((s) => Math.hypot(s.dsx, s.dsy))), reference.energy.scale);

  return blended.map((sample) => ({
    dx: sample.dx * positionFactor,
    dy: sample.dy * positionFactor,
    drot: sample.drot * rotationFactor,
    dsx: sample.dsx * scaleFactor,
    dsy: sample.dsy * scaleFactor,
  }));
};

const countSharedSemantics = (selected: ItemMotionField, other: ItemMotionField): number => {
  let shared = 0;
  for (const semantic of selected.bySemantic.keys()) {
    if (other.bySemantic.has(semantic)) shared += 1;
  }
  return shared;
};

// Derive each runner-up's mixing weight from its retrieval score relative to the winner's. The
// square makes the falloff steep: a candidate that scored 70% of the winner contributes about
// half as much as one that tied it, so a clearly weaker match stays a light seasoning.
const deriveWeights = (
  selected: ItemMotionField,
  selectedScore: number,
  candidates: BlendCandidate[],
  selectedCategory: string,
): Array<{ candidate: BlendCandidate; weight: number; sharedSemantics: number }> => {
  if (selectedScore <= 0) return [];

  const eligible: Array<{ candidate: BlendCandidate; weight: number; sharedSemantics: number }> = [];
  for (const candidate of candidates) {
    // Identity is the field object, not the id string: the dataset currently ships distinct
    // clips under a shared id (two different `run` files), and comparing ids would discard a
    // legitimate blend partner as if it were the winner itself.
    if (candidate.field === selected) continue;
    // Blending across categories would fuse unrelated actions (a walk with an attack) into
    // something neither clip describes. Same-category candidates are variations on one motion.
    if (candidate.category !== selectedCategory) continue;

    const ratio = candidate.score / selectedScore;
    if (ratio < MIN_SCORE_RATIO) continue;

    const sharedSemantics = countSharedSemantics(selected, candidate.field);
    if (sharedSemantics < MIN_SHARED_SEMANTICS) continue;

    eligible.push({
      candidate,
      weight: Math.min(MAX_SINGLE_WEIGHT, ratio * ratio * MAX_SINGLE_WEIGHT),
      sharedSemantics,
    });
  }

  const total = eligible.reduce((sum, entry) => sum + entry.weight, 0);
  if (total > MAX_TOTAL_WEIGHT) {
    const rescale = MAX_TOTAL_WEIGHT / total;
    for (const entry of eligible) entry.weight *= rescale;
  }

  return eligible;
};

export const blendEnsembleMotion = (
  selected: ItemMotionField,
  selectedScore: number,
  selectedCategory: string,
  candidates: BlendCandidate[],
): BlendedMotion => {
  const weighted = deriveWeights(selected, selectedScore, candidates, selectedCategory);
  const curves = new Map<number, MotionSample[]>();

  // No eligible partner: fall through with the winner's own curves untouched, so a lone match
  // degrades to the previous behaviour instead of inventing a difference with nothing behind it.
  if (weighted.length === 0) {
    selected.curves.forEach((curve, index) => curves.set(index, curve.samples));
    return { curves, contributions: [], blendedBoneCount: 0, blendStrength: 0 };
  }

  // Alignment is a property of the clip pair, not of one bone, so it is resolved once per
  // candidate and applied uniformly — shifting each bone by its own best offset would scramble
  // the partner's internal limb coordination.
  const alignmentByField = new Map<ItemMotionField, number>();
  for (const { candidate } of weighted) {
    alignmentByField.set(
      candidate.field,
      resolveAlignmentOffset(selected, candidate.field, sharedSemanticList(selected, candidate.field)),
    );
  }

  // Also keyed by field rather than id, so two clips sharing an id keep separate tallies.
  const contributionWeights = new Map<ItemMotionField, number>();
  let blendedBoneCount = 0;

  selected.curves.forEach((curve, index) => {
    // Per-bone contributor set: a candidate that lacks this semantic bone drops out here and
    // its weight is redistributed, rather than silently pulling the bone toward zero motion.
    const partners: Array<{ field: ItemMotionField; weight: number; samples: MotionSample[] }> = [];
    if (curve.semantic) {
      for (const { candidate, weight } of weighted) {
        const partner = candidate.field.bySemantic.get(curve.semantic);
        if (!partner) continue;
        const factor = alignmentFactor(curve, partner);
        if (factor === null) continue;

        const offset = alignmentByField.get(candidate.field) ?? 0;
        const wrap = selected.cyclic && candidate.field.cyclic;
        const samples: MotionSample[] = [];
        for (let i = 0; i < SAMPLE_COUNT; i++) {
          const sourceIndex = wrap
            ? (i + offset) % PHASE_RESOLUTION
            : Math.min(partner.samples.length - 1, i);
          const sample = partner.samples[sourceIndex]!;
          samples.push({
            dx: sample.dx * factor,
            dy: sample.dy * factor,
            drot: sample.drot * factor,
            dsx: sample.dsx * factor,
            dsy: sample.dsy * factor,
          });
        }

        partners.push({ field: candidate.field, weight, samples });
      }
    }

    if (partners.length === 0) {
      curves.set(index, curve.samples);
      return;
    }

    const partnerWeight = partners.reduce((sum, partner) => sum + partner.weight, 0);
    const selectedWeight = 1 - partnerWeight;
    blendedBoneCount += 1;
    for (const partner of partners) {
      contributionWeights.set(partner.field, (contributionWeights.get(partner.field) ?? 0) + partner.weight);
    }

    const blended: MotionSample[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const base = curve.samples[i]!;
      let dx = base.dx * selectedWeight;
      let dy = base.dy * selectedWeight;
      let drot = base.drot * selectedWeight;
      let dsx = base.dsx * selectedWeight;
      let dsy = base.dsy * selectedWeight;
      for (const partner of partners) {
        const sample = partner.samples[i]!;
        dx += sample.dx * partner.weight;
        dy += sample.dy * partner.weight;
        drot += sample.drot * partner.weight;
        dsx += sample.dsx * partner.weight;
        dsy += sample.dsy * partner.weight;
      }
      blended.push({ dx, dy, drot, dsx, dsy });
    }
    curves.set(index, restoreEnergy(blended, curve));
  });

  // Report each contributor's mean weight across the bones it actually reached, which is what
  // "how much of this clip is in the output" means once per-bone redistribution is accounted for.
  const contributions: BlendContribution[] = weighted
    .map(({ candidate, sharedSemantics }) => ({
      itemId: candidate.field.itemId,
      weight:
        blendedBoneCount === 0
          ? 0
          : Math.round(((contributionWeights.get(candidate.field) ?? 0) / blendedBoneCount) * 1000) / 1000,
      sharedSemantics,
    }))
    .filter((contribution) => contribution.weight > 0);

  const blendStrength = contributions.reduce((sum, contribution) => sum + contribution.weight, 0);

  return {
    curves,
    contributions,
    blendedBoneCount,
    blendStrength: Math.round(blendStrength * 1000) / 1000,
  };
};
