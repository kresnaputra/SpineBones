import type { RagAnimationDatasetItem, RagQueryContext, RagRetrievalResult } from '../types/ragTypes';

// Split text into lowercase tokens of 3+ chars, ignoring punctuation/whitespace.
const tokenize = (text: string): string[] =>
  text.toLowerCase().split(/\W+/).filter((t) => t.length >= 3);

// Build a flat corpus of all searchable text from a dataset item.
const buildItemCorpus = (item: RagAnimationDatasetItem): string => [
  item.name,
  item.description,
  item.category,
  item.usage,
  ...item.tags,
  ...item.style,
  item.motionFeatures.speed,
  item.motionFeatures.energy,
  item.motionFeatures.mood,
].join(' ').toLowerCase();

export const scoreDatasetItem = (
  item: RagAnimationDatasetItem,
  query: RagQueryContext,
): RagRetrievalResult => {
  let score = 0;
  const reasons: string[] = [];

  // Full-text token matching against all item fields — no hardcoded keywords needed.
  const corpus = buildItemCorpus(item);
  const promptTokens = tokenize(query.prompt);
  let tokenHits = 0;
  for (const token of promptTokens) {
    if (corpus.includes(token)) tokenHits++;
  }
  if (tokenHits > 0) {
    score += tokenHits * 3;
    reasons.push(`text match: ${tokenHits} token(s)`);
  }

  // Extra weight when the item's category word itself appears in the prompt.
  if (query.prompt.toLowerCase().includes(item.category)) {
    score += 5;
    reasons.push(`category match: ${item.category}`);
  }

  // Bone overlap between dataset's required bones and the active rig.
  const queryBones = query.semanticBones ?? [];
  const matchedBones = item.requiredBones.filter((bone) => queryBones.includes(bone));
  if (matchedBones.length > 0) {
    score += matchedBones.length * 3;
    reasons.push(`required bone match: ${matchedBones.length}`);
  }

  return { item, score, reasons };
};
