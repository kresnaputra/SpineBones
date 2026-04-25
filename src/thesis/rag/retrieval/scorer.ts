import type { RagAnimationDatasetItem, RagQueryContext, RagRetrievalResult } from '../types/ragTypes';

export const scoreDatasetItem = (
  item: RagAnimationDatasetItem,
  query: RagQueryContext,
): RagRetrievalResult => {
  let score = 0;
  const reasons: string[] = [];

  if (query.category && item.category === query.category) {
    score += 10;
    reasons.push(`category match: ${item.category}`);
  }

  const queryBones = query.semanticBones ?? [];
  const matchedBones = item.requiredBones.filter((bone) => queryBones.includes(bone));
  if (matchedBones.length > 0) {
    score += matchedBones.length * 3;
    reasons.push(`required bone match: ${matchedBones.length}`);
  }

  const promptText = query.prompt.toLowerCase();
  for (const token of item.tags) {
    if (promptText.includes(token.toLowerCase())) {
      score += 1;
    }
  }

  return { item, score, reasons };
};
