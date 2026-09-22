import type { RagAnimationDatasetItem, RagQueryContext, RagRetrievalResult } from '../types/ragTypes';

// Split text into lowercase tokens of 3+ chars, ignoring punctuation/whitespace.
const tokenize = (text: string): string[] =>
  text.toLowerCase().split(/\W+/).filter((t) => t.length >= 3);

// Build a flat searchable token set from a dataset item.
const buildItemTokenSet = (item: RagAnimationDatasetItem): Set<string> =>
  new Set(tokenize([
    item.name,
    item.description,
    item.category,
    item.usage,
    ...item.tags,
    ...item.style,
    item.motionFeatures.speed,
    item.motionFeatures.energy,
    item.motionFeatures.mood,
  ].join(' ')));

// High-signal fields: name and tags are curated keywords that describe the action.
// A prompt token matching here is a much stronger relevance signal than a match
// buried in descriptive prose (description/usage), where generic words like
// "character" or "body" appear incidentally.
const buildHighSignalTokens = (item: RagAnimationDatasetItem): Set<string> =>
  new Set(tokenize([item.name, ...item.tags].join(' ')));

export const scoreDatasetItem = (
  item: RagAnimationDatasetItem,
  query: RagQueryContext,
): RagRetrievalResult => {
  let score = 0;
  const reasons: string[] = [];

  // Full-text token matching against all item fields — no hardcoded keywords needed.
  // Tokens are matched as whole words (exact token equality), not substrings.
  // Matches in name/tags score higher (5 pts) than matches in description/usage (3 pts),
  // so an action word in the item name outweighs a generic noun in descriptive prose.
  const itemTokens = buildItemTokenSet(item);
  const highSignalTokens = buildHighSignalTokens(item);
  const promptTokens = tokenize(query.prompt);
  let tokenHits = 0;
  let textScore = 0;
  for (const token of promptTokens) {
    if (itemTokens.has(token)) {
      tokenHits++;
      textScore += highSignalTokens.has(token) ? 5 : 3;
    }
  }
  if (tokenHits > 0) {
    score += textScore;
    reasons.push(`text match: ${tokenHits} token(s)`);
  }

  // Extra weight when the item's category word itself appears in the prompt.
  if (query.prompt.toLowerCase().includes(item.category)) {
    score += 5;
    reasons.push(`category match: ${item.category}`);
  }

  // Rig-compatibility bonus: a flat bonus when the item's required bones overlap
  // the active rig at all. This signals "can be applied" without letting a longer
  // requiredBones list (e.g. 9 vs 7) outscore a more relevant text match.
  const queryBones = query.semanticBones ?? [];
  const matchedBones = item.requiredBones.filter((bone) => queryBones.includes(bone));
  if (matchedBones.length > 0) {
    score += 5;
    reasons.push(`required bone match: ${matchedBones.length}`);
  }

  return { item, score, reasons };
};
