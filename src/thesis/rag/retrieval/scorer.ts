import type {
  RagAnimationDatasetItem,
  RagMatchType,
  RagQueryContext,
  RagRetrievalResult,
} from '../types/ragTypes';
import { containsPhrase } from './normalize';

// Scoring weights, ordered by how strong/specific a signal is. Exact identifier
// matches dominate so a prompt that names an id/name/alias is decisive, while
// generic text overlap only nudges ranking.
const EXACT_ID_BONUS = 100;
const EXACT_NAME_BONUS = 100;
const ALIAS_BONUS = 90;
const VARIANT_BONUS = 40;
const FAMILY_BONUS = 30;
const CATEGORY_BONUS = 15;
const BONE_WEIGHT = 3;
const TOKEN_WEIGHT = 2;

// Most-specific first — the reported matchType is the strongest present signal.
const MATCH_PRIORITY: RagMatchType[] = [
  'exact-id',
  'exact-name',
  'alias',
  'variant',
  'family',
  'category',
  'token',
];

const pickStrongest = (signals: RagMatchType[]): RagMatchType => {
  for (const type of MATCH_PRIORITY) {
    if (signals.includes(type)) return type;
  }
  return 'none';
};

// Build a flat corpus of all searchable text from a dataset item.
const buildItemCorpus = (item: RagAnimationDatasetItem): string => [
  item.name,
  item.description,
  item.category,
  item.family ?? '',
  item.variant ?? '',
  item.usage,
  ...item.tags,
  ...(item.aliases ?? []),
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
  const signals: RagMatchType[] = [];

  const promptTokens = query.phraseTokens;
  const actions = new Set(query.actions);

  // Exact identifier matches — decisive, boundary-safe (a bare "walk" won't match "walk-2").
  if (containsPhrase(promptTokens, item.id)) {
    score += EXACT_ID_BONUS;
    reasons.push(`exact id match: ${item.id}`);
    signals.push('exact-id');
  }
  if (containsPhrase(promptTokens, item.name)) {
    score += EXACT_NAME_BONUS;
    reasons.push(`exact name match: ${item.name}`);
    signals.push('exact-name');
  }
  const matchedAlias = (item.aliases ?? []).find((alias) => containsPhrase(promptTokens, alias));
  if (matchedAlias) {
    score += ALIAS_BONUS;
    reasons.push(`alias match: ${matchedAlias}`);
    signals.push('alias');
  }

  // Variant (medium/large) — distinguishes flavours within a family, e.g. "rhino walk".
  if (item.variant && containsPhrase(promptTokens, item.variant)) {
    score += VARIANT_BONUS;
    reasons.push(`variant match: ${item.variant}`);
    signals.push('variant');
  }

  // Family (medium) — canonical action group implied by the prompt.
  if (item.family && actions.has(item.family)) {
    score += FAMILY_BONUS;
    reasons.push(`family match: ${item.family}`);
    signals.push('family');
  }

  // Category — still counts, whether via canonical action or a literal mention.
  if (actions.has(item.category) || query.prompt.toLowerCase().includes(item.category)) {
    score += CATEGORY_BONUS;
    reasons.push(`category match: ${item.category}`);
    signals.push('category');
  }

  // Bone overlap between dataset's required bones and the active rig.
  const queryBones = query.semanticBones ?? [];
  const matchedBones = item.requiredBones.filter((bone) => queryBones.includes(bone));
  if (matchedBones.length > 0) {
    score += matchedBones.length * BONE_WEIGHT;
    reasons.push(`required bone match: ${matchedBones.length}`);
  }

  // Generic full-text token overlap — lowest priority, only nudges ranking.
  const corpus = buildItemCorpus(item);
  let tokenHits = 0;
  for (const token of query.normalizedTokens) {
    if (corpus.includes(token)) tokenHits++;
  }
  if (tokenHits > 0) {
    score += tokenHits * TOKEN_WEIGHT;
    reasons.push(`text match: ${tokenHits} token(s)`);
    signals.push('token');
  }

  return { item, score, reasons, matchType: pickStrongest(signals) };
};
