export interface RagMotionFeatures {
  speed: string;
  energy: string;
  mood: string;
  cycle: boolean;
}

export interface RagSourceInfo {
  type: string;
  projectPath: string | null;
  exportedAt: string;
}

export interface RagRigProfile {
  type: string;
  semanticBones: string[];
  boneCount: number;
  slotCount: number;
}

export type RagKeyframeEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface RagAnimationFrame {
  frame: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  easing: RagKeyframeEasing;
}

export interface RagAnimationBoneTrack {
  boneId: number;
  boneName: string;
  frames: RagAnimationFrame[];
}

export interface RagAnimationData {
  format: string;
  version: string;
  duration: number;
  fps: number;
  bones: Array<{ id: number; name: string; parentId: number | null }>;
  slots: Array<Record<string, unknown>>;
  keyframes: RagAnimationBoneTrack[];
}

export interface RagAnimationDatasetItem {
  datasetFormat: 'spinebones-rag-animation';
  version: string;
  id: string;
  name: string;
  description: string;
  category: string;
  // Optional retrieval-control metadata. These make dataset selection stable and
  // explainable instead of relying on generic text token overlap.
  // Broad motion group shared by variants, e.g. "walk", "jump", "run".
  family?: string;
  // Distinguishing flavour within a family, e.g. "basic", "rhino", "knight", "heavy".
  variant?: string;
  // Extra search terms (incl. Indonesian) that should strongly select this item.
  aliases?: string[];
  // Tie-breaker weight when several candidates score equally (higher wins).
  priority?: number;
  // When true, this item is chosen for ambiguous prompts that only name the category.
  defaultForCategory?: boolean;
  loop: boolean;
  style: string[];
  motionFeatures: RagMotionFeatures;
  requiredBones: string[];
  usage: string;
  tags: string[];
  source: RagSourceInfo;
  rigProfile: RagRigProfile;
  boneMapping: Record<string, string>;
  animation: RagAnimationData;
}

export interface RagQueryContext {
  prompt: string;
  category?: string | null;
  tags?: string[];
  semanticBones?: string[];
  // Whitespace tokens (hyphen-preserving) for exact id/name/alias/variant matching.
  phraseTokens: string[];
  // Canonical action terms (walk/jump/run/attack/hit) implied by the prompt.
  actions: string[];
  // Generic 3+ char tokens with Indonesian folded to English, for corpus matching.
  normalizedTokens: string[];
}

// Strongest signal that contributed to an item's score, ordered from most to
// least specific. Used to explain and control selection.
export type RagMatchType =
  | 'exact-id'
  | 'exact-name'
  | 'alias'
  | 'variant'
  | 'family'
  | 'category'
  | 'token'
  | 'none';

export interface RagRetrievalResult {
  item: RagAnimationDatasetItem;
  score: number;
  reasons: string[];
  matchType: RagMatchType;
}

// How an ambiguous tie was broken, when applicable.
export type RagAmbiguityResolution = 'default' | 'priority' | 'id-order';

export interface RagRetrievalDecision {
  selected: RagRetrievalResult;
  // Top candidates (selected first), each with score, reasons, and match type.
  candidates: RagRetrievalResult[];
  // True when the top scores were close and no exact id/name/variant was given.
  ambiguous: boolean;
  // The match signal behind the selected item (mirrors selected.matchType).
  selectionSource: RagMatchType;
  // Present only when `ambiguous` and a tie-break rule was applied.
  ambiguityResolution: RagAmbiguityResolution | null;
}
