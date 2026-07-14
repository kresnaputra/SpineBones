import { NEUTRAL_MODIFIERS, type ModifierAxisKey, type MotionModifiers } from './types';

// Phrases that explicitly ask for the matched dataset item's keyframes verbatim,
// bypassing motion synthesis entirely. Checked before any modifier parsing.
const RAW_COPY_PATTERNS: RegExp[] = [
  /copy exact json/i,
  /exact dataset/i,
  /raw copy/i,
  /apply exact dataset/i,
  /use raw keyframes/i,
  /salin json persis/i,
  /pakai dataset asli/i,
  /salin persis/i,
  /gunakan (animasi|dataset) asli/i,
];

export const detectRawCopyIntent = (prompt: string): boolean =>
  RAW_COPY_PATTERNS.some((pattern) => pattern.test(prompt));

interface PhraseGroup {
  axis: ModifierAxisKey;
  direction: 'up' | 'down';
  baseFactor: number;
  phrases: string[];
}

// English + Indonesian trigger phrases per modifier axis. baseFactor is applied once per
// distinct (non-overlapping) matched phrase, capped at 2 stacked hits to avoid runaway scaling.
const PHRASE_GROUPS: PhraseGroup[] = [
  { axis: 'heightScale', direction: 'up', baseFactor: 1.35, phrases: ['higher', 'lebih tinggi', 'tinggi'] },
  { axis: 'timeScale', direction: 'down', baseFactor: 0.75, phrases: ['faster', 'quick', 'cepat', 'lebih cepat'] },
  { axis: 'timeScale', direction: 'up', baseFactor: 1.3, phrases: ['slower', 'lambat', 'pelan', 'lebih lambat'] },
  { axis: 'weightScale', direction: 'up', baseFactor: 1.3, phrases: ['heavier', 'heavy', 'berat', 'lebih berat'] },
  { axis: 'smoothness', direction: 'up', baseFactor: 1.3, phrases: ['smoother', 'smooth', 'halus', 'lebih halus'] },
  {
    axis: 'exaggeration',
    direction: 'up',
    baseFactor: 1.4,
    phrases: ['exaggerated', 'dramatic', 'dramatis', 'lebay', 'lebih dramatis'],
  },
];

export const AXIS_CLAMP: Record<ModifierAxisKey, [number, number]> = {
  heightScale: [0.5, 2.2],
  timeScale: [0.4, 2.5],
  weightScale: [0.6, 2.0],
  smoothness: [0.5, 2.0],
  exaggeration: [0.5, 2.5],
};

const AXIS_KEYS: ModifierAxisKey[] = ['heightScale', 'timeScale', 'weightScale', 'smoothness', 'exaggeration'];

const MAX_STACKED_HITS = 2;

interface GroupMatch {
  count: number;
  matchedPhrases: string[];
  lastMatchEnd: number;
}

// Scans phrases longest-first so a longer phrase (e.g. "lebih tinggi") consumes its character
// range before a shorter substring phrase (e.g. "tinggi") is checked, preventing one occurrence
// of an intensified phrase from being double-counted as two separate hits.
const countGroupMatches = (promptLower: string, phrases: string[]): GroupMatch => {
  const sorted = [...phrases].sort((a, b) => b.length - a.length);
  const consumed: Array<[number, number]> = [];
  const matchedPhrases: string[] = [];
  let lastMatchEnd = -1;

  for (const phrase of sorted) {
    let searchFrom = 0;
    for (;;) {
      const idx = promptLower.indexOf(phrase, searchFrom);
      if (idx === -1) break;
      const end = idx + phrase.length;
      const overlaps = consumed.some(([s, e]) => idx < e && end > s);
      if (!overlaps) {
        consumed.push([idx, end]);
        matchedPhrases.push(phrase);
        lastMatchEnd = Math.max(lastMatchEnd, end);
      }
      searchFrom = idx + phrase.length;
    }
  }

  return { count: matchedPhrases.length, matchedPhrases, lastMatchEnd };
};

const clamp = (value: number, [min, max]: [number, number]) => Math.max(min, Math.min(max, value));

export const parseMotionModifiers = (prompt: string): MotionModifiers => {
  const promptLower = prompt.toLowerCase();
  const modifiers: MotionModifiers = { ...NEUTRAL_MODIFIERS, matchedPhrases: [] };
  const matchedPhrases: string[] = [];

  const byAxis = new Map<ModifierAxisKey, PhraseGroup[]>();
  for (const group of PHRASE_GROUPS) {
    const list = byAxis.get(group.axis) ?? [];
    list.push(group);
    byAxis.set(group.axis, list);
  }

  for (const [axis, groups] of byAxis) {
    if (groups.length === 1) {
      const group = groups[0]!;
      const match = countGroupMatches(promptLower, group.phrases);
      if (match.count > 0) {
        const factor = group.baseFactor ** Math.min(match.count, MAX_STACKED_HITS);
        modifiers[axis] = clamp(factor, AXIS_CLAMP[axis]);
        matchedPhrases.push(...match.matchedPhrases);
      }
      continue;
    }

    // Conflicting directions on the same axis (currently only timeScale: faster vs slower) —
    // the direction whose phrase occurs latest in the prompt wins; the other is ignored entirely.
    const evaluated = groups
      .map((group) => ({ group, match: countGroupMatches(promptLower, group.phrases) }))
      .filter(({ match }) => match.count > 0);

    if (evaluated.length === 0) continue;

    evaluated.sort((a, b) => b.match.lastMatchEnd - a.match.lastMatchEnd);
    const winner = evaluated[0]!;
    const factor = winner.group.baseFactor ** Math.min(winner.match.count, MAX_STACKED_HITS);
    modifiers[axis] = clamp(factor, AXIS_CLAMP[axis]);
    matchedPhrases.push(...winner.match.matchedPhrases);
  }

  modifiers.matchedPhrases = matchedPhrases;
  return modifiers;
};

// Layers explicit prompt-parsed modifiers on top of a data-derived baseline (see
// ensembleLearning.ts) by multiplying corresponding axes, then re-clamping to the same ranges
// used for prompt modifiers alone. matchedPhrases is carried from the overlay only — the
// baseline isn't phrase-derived.
export const combineModifiers = (base: MotionModifiers, overlay: MotionModifiers): MotionModifiers => {
  const combined: MotionModifiers = { ...NEUTRAL_MODIFIERS, matchedPhrases: overlay.matchedPhrases };
  for (const axis of AXIS_KEYS) {
    combined[axis] = clamp(base[axis] * overlay[axis], AXIS_CLAMP[axis]);
  }
  return combined;
};
