import type { RagQueryContext } from '../types/ragTypes';

export const buildRagQueryContext = (
  prompt: string,
  semanticBones: string[] = [],
): RagQueryContext => ({
  prompt,
  category: null,
  tags: semanticBones,
  semanticBones,
});
