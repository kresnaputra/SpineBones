import type { RagQueryContext } from '../types/ragTypes';
import { detectActions, normalizeTokens, phraseTokenize } from './normalize';

export const buildRagQueryContext = (
  prompt: string,
  semanticBones: string[] = [],
): RagQueryContext => ({
  prompt,
  category: null,
  tags: semanticBones,
  semanticBones,
  phraseTokens: phraseTokenize(prompt),
  actions: detectActions(prompt),
  normalizedTokens: normalizeTokens(prompt),
});
