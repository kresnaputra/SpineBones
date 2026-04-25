import type { RagAnimationDatasetItem, RagQueryContext, RagRetrievalResult } from '../types/ragTypes';
import { scoreDatasetItem } from './scorer';

export const retrieveTopAnimations = (
  dataset: RagAnimationDatasetItem[],
  query: RagQueryContext,
  limit = 3,
): RagRetrievalResult[] =>
  dataset
    .map((item) => scoreDatasetItem(item, query))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
