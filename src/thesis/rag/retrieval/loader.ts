import type { RagAnimationDatasetItem } from '../types/ragTypes';

export const isRagAnimationDatasetItem = (value: unknown): value is RagAnimationDatasetItem => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RagAnimationDatasetItem>;
  return candidate.datasetFormat === 'spinebones-rag-animation' && typeof candidate.id === 'string';
};

export const loadRagDatasetFromItems = (items: unknown[]): RagAnimationDatasetItem[] =>
  items.filter(isRagAnimationDatasetItem);
