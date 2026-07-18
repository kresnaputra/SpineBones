// Query normalization helpers for RAG retrieval.
//
// These utilities make dataset selection language-aware (Indonesian + English)
// and give the scorer stable, boundary-safe primitives for matching prompts
// against dataset identifiers, aliases, variants, and family/category labels.

// Canonical action terms the retriever understands. Used for family/category matching.
export const ACTION_ROOTS = ['walk', 'jump', 'run', 'attack', 'hit', 'idle'] as const;

// Multi-word Indonesian phrases resolve first so they can override single-word mappings
// (e.g. "kena pukul" => hit, even though "pukul" alone => attack).
const PHRASE_ACTIONS: Array<[string, string]> = [['kena pukul', 'hit']];

// Single-word Indonesian → canonical English action mapping.
const WORD_ACTIONS: Record<string, string> = {
  berjalan: 'walk',
  jalan: 'walk',
  melompat: 'jump',
  lompat: 'jump',
  lari: 'run',
  berlari: 'run',
  pukul: 'attack',
  serang: 'attack',
  menyerang: 'attack',
  terkena: 'hit',
  hit: 'hit',
};

// Split text into whitespace-separated tokens, lowercased, with surrounding
// punctuation stripped but internal hyphens preserved. This keeps identifiers
// like "walk-2" and "knight-walk" intact so they match exactly (and so a bare
// "walk" does NOT falsely match inside "walk-2").
export const phraseTokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9-]+|[^a-z0-9-]+$/g, ''))
    .filter(Boolean);

// True when the token sequence of `term` appears as a contiguous run inside
// `promptTokens`. Multi-word terms ("walk cycle") must match in order.
export const containsPhrase = (promptTokens: string[], term: string): boolean => {
  const termTokens = phraseTokenize(term);
  if (termTokens.length === 0) return false;
  for (let i = 0; i + termTokens.length <= promptTokens.length; i++) {
    let matched = true;
    for (let j = 0; j < termTokens.length; j++) {
      if (promptTokens[i + j] !== termTokens[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
};

// Detect the canonical action terms (walk/jump/run/attack/hit/…) implied by a
// prompt, resolving Indonesian words and phrases, and treating any token that
// starts with a known root as that action ("walking", "walk-2" => walk).
export const detectActions = (prompt: string): string[] => {
  const tokens = phraseTokenize(prompt);
  const found = new Set<string>();
  const consumed = new Set<number>();

  // Multi-word phrases first, marking their tokens consumed so single-word
  // mappings don't also fire on them.
  for (const [phrase, action] of PHRASE_ACTIONS) {
    const phraseTokens = phraseTokenize(phrase);
    for (let i = 0; i + phraseTokens.length <= tokens.length; i++) {
      let matched = true;
      for (let j = 0; j < phraseTokens.length; j++) {
        if (tokens[i + j] !== phraseTokens[j]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        found.add(action);
        for (let j = 0; j < phraseTokens.length; j++) consumed.add(i + j);
      }
    }
  }

  tokens.forEach((token, index) => {
    if (consumed.has(index)) return;
    if (WORD_ACTIONS[token]) found.add(WORD_ACTIONS[token]);
    for (const root of ACTION_ROOTS) {
      if (token === root || token.startsWith(root)) found.add(root);
    }
  });

  return [...found];
};

// Generic corpus tokens (3+ chars), with Indonesian action words folded to their
// English canonical form so full-text matching works across both languages.
export const normalizeTokens = (prompt: string): string[] =>
  prompt
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 3)
    .map((t) => WORD_ACTIONS[t] ?? t);
