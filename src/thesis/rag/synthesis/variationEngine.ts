import type { FlatKeyframeEntry } from '../adaptation/keyframeAdapter';
import type { RagAnimationDatasetItem, RagKeyframeEasing } from '../types/ragTypes';
import type { MotionModifiers, MotionPattern, MotionPhaseLabel } from './types';

// ── Deterministic PRNG (mulberry32) ──────────────────────────────────────────
// Seeded from the prompt so the same prompt is reproducible while different
// prompts produce genuinely different output.
const hashPrompt = (prompt: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < prompt.length; i++) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

export interface Rng { next(): number; range(lo: number, hi: number): number; sign(): number }

export const createRng = (prompt: string, salt = 0): Rng => {
  let s = (hashPrompt(prompt) ^ (salt * 0x9e3779b9)) >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (lo, hi) => lo + next() * (hi - lo), sign: () => (next() < 0.5 ? -1 : 1) };
};

// ── Style detection from prompt ──────────────────────────────────────────────
export interface StyleProfile {
  snappiness: number;   // 0 = flowing, 1 = staccato
  heaviness: number;    // 0 = light, 1 = grounded
  dynamism: number;     // 0 = restrained, 1 = explosive
  asymmetry: number;    // 0 = balanced, 1 = uneven timing
}

const detectStyle = (prompt: string): StyleProfile => {
  const p = prompt.toLowerCase();
  let snappiness = 0.5;
  let heaviness = 0.5;
  let dynamism = 0.5;
  let asymmetry = 0.5;

  if (/\b(snap|snappy|crisp|sharp|explosive|pop|punchy)\b/.test(p)) snappiness += 0.3;
  if (/\b(smooth|flowing|fluid|soft|gentle|halus|lembut)\b/.test(p)) snappiness -= 0.3;
  if (/\b(heavy|berat|weighty|grounded|solid|massive|thud)\b/.test(p)) heaviness += 0.3;
  if (/\b(light|ringan|floaty|airy|nimble|agile)\b/.test(p)) heaviness -= 0.3;
  if (/\b(dramatic|dramatis|big|huge|wild|crazy|extreme|insane|epic|lebay)\b/.test(p)) dynamism += 0.3;
  if (/\b(subtle|gentle|calm|relaxed|small|tiny|tenang|santai)\b/.test(p)) dynamism -= 0.3;
  if (/\b(wild|uneven|erratic|crazy|random|chaotic)\b/.test(p)) asymmetry += 0.3;
  if (/\b(rhythmic|steady|even|balanced|rata|teratur)\b/.test(p)) asymmetry -= 0.3;

  return {
    snappiness: Math.max(0, Math.min(1, snappiness)),
    heaviness: Math.max(0, Math.min(1, heaviness)),
    dynamism: Math.max(0, Math.min(1, dynamism)),
    asymmetry: Math.max(0, Math.min(1, asymmetry)),
  };
};

// ── Cross-candidate pose blending ────────────────────────────────────────────
// Interpolates between the primary candidate's keyframes and a secondary
// candidate's corresponding keyframes, creating poses that don't exist in any
// single dataset item.
const lerpPose = (
  a: { x: number; y: number; rotation: number; scaleX: number; scaleY: number },
  b: { x: number; y: number; rotation: number; scaleX: number; scaleY: number },
  t: number,
) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  rotation: a.rotation + (b.rotation - a.rotation) * t,
  scaleX: a.scaleX + (b.scaleX - a.scaleX) * t,
  scaleY: a.scaleY + (b.scaleY - a.scaleY) * t,
});

// Find the secondary track with the same boneName (or semantic equivalent).
const findBlendTrack = (
  secondary: RagAnimationDatasetItem,
  boneName: string,
): RagAnimationDatasetItem['animation']['keyframes'][number] | undefined =>
  secondary.animation.keyframes.find((t) => t.boneName === boneName);

// ── Non-uniform timing redistribution ────────────────────────────────────────
// Warps frame positions within each motion phase so anticipation compresses,
// apex hangs, and landing snaps — the "feel" of the animation changes without
// altering the poses themselves.
const warpFrame = (
  originalFrame: number,
  duration: number,
  phases: MotionPattern['phases'],
  patternFrames: number[],
  style: StyleProfile,
  rng: Rng,
): number => {
  if (duration <= 0 || patternFrames.length < 2) return originalFrame;

  // Find which phase this frame belongs to
  const normalized = originalFrame / duration;
  let phaseLabel: MotionPhaseLabel = 'neutral';
  for (const phase of phases) {
    const startN = (patternFrames[phase.startFrameIndex] ?? 0) / (patternFrames.at(-1) ?? 1);
    const endN = (patternFrames[phase.endFrameIndex] ?? 0) / (patternFrames.at(-1) ?? 1);
    if (normalized >= startN && normalized <= endN) {
      phaseLabel = phase.label;
      break;
    }
  }

  // Phase-based time warp factors
  let warp = 1;
  switch (phaseLabel) {
    case 'anticipation':
    case 'start':
      warp = 1 - 0.15 * style.snappiness;  // compress prep
      break;
    case 'apex':
      warp = 1 + 0.2 * style.dynamism;     // hang time
      break;
    case 'fall':
      warp = 1 + 0.1 * style.heaviness;    // heavier = slower fall
      break;
    case 'landing':
    case 'contact':
      warp = 1 - 0.2 * style.snappiness;   // snap landing
      break;
    case 'recovery':
      warp = 1 - 0.1 * style.snappiness;
      break;
    default:
      warp = 1;
  }

  // Asymmetry: add small random temporal jitter
  warp *= 1 + (rng.next() - 0.5) * 0.12 * style.asymmetry;

  const warped = normalized * warp;
  return Math.round(warped * duration);
};

// ── Pose perturbation ────────────────────────────────────────────────────────
// Adds small, deterministic perturbations to each keyframe's values. The noise
// is scaled by dynamism and feels like natural animator variation.
const perturbPose = (
  pose: { x: number; y: number; rotation: number; scaleX: number; scaleY: number },
  style: StyleProfile,
  modifiers: MotionModifiers,
  rng: Rng,
) => {
  const amp = 0.04 * style.dynamism * modifiers.exaggeration;
  return {
    x: pose.x + rng.range(-1, 1) * amp * 8,
    y: pose.y + rng.range(-1, 1) * amp * 8,
    rotation: pose.rotation + rng.range(-1, 1) * amp * 12,
    scaleX: pose.scaleX * (1 + rng.range(-1, 1) * amp * 0.3),
    scaleY: pose.scaleY * (1 + rng.range(-1, 1) * amp * 0.3),
  };
};

// ── Main variation pipeline ──────────────────────────────────────────────────
export interface VariationInput {
  entries: FlatKeyframeEntry[];
  blendItems: RagAnimationDatasetItem[];
  pattern: MotionPattern;
  modifiers: MotionModifiers;
  prompt: string;
  duration: number;
}

export const applyVariation = (input: VariationInput): FlatKeyframeEntry[] => {
  const { entries, blendItems, pattern, modifiers, prompt, duration } = input;
  const style = detectStyle(prompt);
  const rng = createRng(prompt);

  // Pre-compute blend weights from prompt seed
  const blendPrimary = 1 - rng.range(0.15, 0.45) * (blendItems.length > 0 ? 1 : 0);
  const blendSecondary = 1 - blendPrimary;

  return entries.map((entry) => {
    let pose = { x: entry.x, y: entry.y, rotation: entry.rotation, scaleX: entry.scaleX, scaleY: entry.scaleY };
    let easing = entry.easing;

    // Layer 1: Cross-candidate blending
    if (blendItems.length > 0 && blendSecondary > 0) {
      const secondary = blendItems[0]!;
      const blendTrack = findBlendTrack(secondary, entry.boneName);
      if (blendTrack && blendTrack.frames.length > 0) {
        // Find the closest frame in the secondary track
        const targetFrame = entry.frame;
        const closest = blendTrack.frames.reduce((best, f) =>
          Math.abs(f.frame - targetFrame) < Math.abs(best.frame - targetFrame) ? f : best,
        blendTrack.frames[0]!);
        pose = lerpPose(pose, closest, blendSecondary * 0.5);
      }
    }

    // Layer 2: Non-uniform timing
    const patternFrames = pattern.frames.length > 0 ? pattern.frames : [0, duration];
    const warpedFrame = Math.max(0, Math.min(duration,
      warpFrame(entry.frame, duration, pattern.phases, patternFrames, style, rng)));

    // Layer 3: Pose perturbation (natural imperfection)
    pose = perturbPose(pose, style, modifiers, rng);

    // Layer 4: Style-based easing variation
    if (style.snappiness > 0.7 && rng.next() > 0.5) easing = 'easeOut';
    else if (style.heaviness > 0.7 && rng.next() > 0.5) easing = 'easeInOut';
    else if (style.dynamism > 0.7 && rng.next() > 0.6) easing = 'easeIn';
    else if (modifiers.smoothness >= 1.15) easing = 'easeInOut';

    return {
      ...entry,
      frame: warpedFrame,
      ...pose,
      easing: easing as RagKeyframeEasing,
    };
  });
};
