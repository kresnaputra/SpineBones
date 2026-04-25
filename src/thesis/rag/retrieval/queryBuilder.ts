import type { RagQueryContext } from '../types/ragTypes';

const inferCategoryFromPrompt = (prompt: string) => {
  const normalized = prompt.toLowerCase();
  if (normalized.includes('walk') || normalized.includes('jalan')) return 'walk';
  if (normalized.includes('run') || normalized.includes('lari')) return 'run';
  if (normalized.includes('idle') || normalized.includes('diam')) return 'idle';
  if (normalized.includes('attack') || normalized.includes('serang')) return 'attack';
  return null;
};

export const buildRagQueryContext = (
  prompt: string,
  semanticBones: string[] = [],
): RagQueryContext => ({
  prompt,
  category: inferCategoryFromPrompt(prompt),
  tags: semanticBones,
  semanticBones,
});
