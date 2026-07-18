import type {
  RagAnimationDatasetItem,
  RagQueryContext,
  RagRetrievalDecision,
  RagRetrievalResult,
} from '../types/ragTypes';
import { scoreDatasetItem } from './scorer';

// Two candidates are "ambiguous" when their scores fall within this margin and
// neither was pinned by an exact id/name/variant.
const AMBIGUITY_DELTA = 10;

// Match types that make a selection decisive — they short-circuit ambiguity handling.
const DECISIVE_MATCHES = new Set(['exact-id', 'exact-name', 'variant']);

// Deterministic ordering: higher score first, then stable by id.
const byScoreThenId = (a: RagRetrievalResult, b: RagRetrievalResult): number =>
  b.score - a.score || a.item.id.localeCompare(b.item.id);

// Tie-break among ambiguous contenders: higher priority first, then stable by id.
const byPriorityThenId = (a: RagRetrievalResult, b: RagRetrievalResult): number =>
  (b.item.priority ?? 0) - (a.item.priority ?? 0) || a.item.id.localeCompare(b.item.id);

// Legacy: return the top-N scored candidates by score (selected first).
export const retrieveTopAnimations = (
  dataset: RagAnimationDatasetItem[],
  query: RagQueryContext,
  limit = 3,
): RagRetrievalResult[] =>
  dataset.map((item) => scoreDatasetItem(item, query)).sort(byScoreThenId).slice(0, limit);

// Full, explainable retrieval decision: ranked candidates, the selected item,
// how it was selected, and whether the choice was ambiguous.
export const retrieveAnimationDecision = (
  dataset: RagAnimationDatasetItem[],
  query: RagQueryContext,
  limit = 3,
): RagRetrievalDecision => {
  const scored = dataset.map((item) => scoreDatasetItem(item, query)).sort(byScoreThenId);
  const top = scored[0];
  if (!top) {
    throw new Error('RAG dataset produced no candidates to score');
  }

  let selected = top;
  let ambiguous = false;
  let ambiguityResolution: RagRetrievalDecision['ambiguityResolution'] = null;

  // An exact id/name/variant hit is decisive — no ambiguity resolution needed.
  if (!DECISIVE_MATCHES.has(top.matchType)) {
    const contenders = scored.filter((r) => r.score > 0 && top.score - r.score <= AMBIGUITY_DELTA);
    if (contenders.length > 1) {
      ambiguous = true;
      const defaults = contenders.filter((c) => c.item.defaultForCategory);
      if (defaults.length > 0) {
        selected = [...defaults].sort(byPriorityThenId)[0]!;
        ambiguityResolution = 'default';
      } else {
        const ranked = [...contenders].sort(byPriorityThenId);
        selected = ranked[0]!;
        // Distinguish an explicit priority win from a pure id-order fallback.
        const hasPriority = contenders.some((c) => (c.item.priority ?? 0) !== 0);
        ambiguityResolution = hasPriority ? 'priority' : 'id-order';
      }
    }
  }

  // Ensure the selected item leads the candidate list.
  const candidates = [
    selected,
    ...scored.filter((r) => r.item.id !== selected.item.id),
  ].slice(0, limit);

  return {
    selected,
    candidates,
    ambiguous,
    selectionSource: selected.matchType,
    ambiguityResolution,
  };
};
