import { create } from 'zustand';
import type {
  BlendReport,
  MotionModifiers,
  ProceduralReport,
  RagCandidateSummary,
  RagOutputMode,
  RagRejectedCandidate,
} from '../thesis/rag/synthesis/types';
import type { NoveltyReport } from '../thesis/rag/synthesis/novelty';

export type EvaluationLogStatus = 'valid' | 'invalid' | 'failed';
export type VisualReviewStatus = 'not_reviewed' | 'accepted' | 'rejected';

export interface EvaluationCheck {
  key: string;
  label: string;
  expected: string | number | boolean | null;
  actual: string | number | boolean | null;
  passed: boolean;
  details?: string;
}

export interface EvaluationLogEntry {
  id: string;
  createdAt: string;
  requestId: string | null;
  prompt: string;
  commandType: 'apply_rag_animation';
  status: EvaluationLogStatus;
  rag: {
    selectedAnimationId: string | null;
    selectedAnimationName: string | null;
    selectedCategory: string | null;
    score: number | null;
    reasons: string[];
    duration: number | null;
    fps: number | null;
    requiredBones: string[];
    datasetKeyframeCount: number | null;
    adaptedKeyframeCount: number | null;
    outputMode: RagOutputMode | null;
    modifiersApplied: MotionModifiers | null;
    retrievedCandidates: RagCandidateSummary[];
    rejectedCandidates: RagRejectedCandidate[];
    generatedKeyframeCount: number | null;
    // How far the generated output sits from the dataset it was built on. Reported separately
    // from `validation`, which only checks that the editor received what synthesis produced and
    // therefore reads 100% for a verbatim copy just as it does for a novel result.
    novelty: NoveltyReport | null;
    blend: BlendReport | null;
    procedural: ProceduralReport | null;
  };
  mcp: {
    status: 'completed' | 'failed';
    selectedAnimationId: string | null;
    mappedBoneCount: number;
    mappedBones: Record<string, string>;
    appliedKeyframeCount: number;
    matchingKeyframeCount: number;
    duration: number | null;
    fps: number | null;
    error: string | null;
  };
  validation: {
    basis: 'dataset' | 'synthesized_output' | 'not_evaluated';
    scope: string;
    tolerance: number;
    missingKeyframes: number;
    unexpectedKeyframes: number;
    excludedSourceKeyframes: number;
    discrepancies: Array<{ bone: string; frame: number; property: string; expected: string | number | null; actual: string | number | null }>;
    matchedComponents: number;
    totalComponents: number;
    percentage: number | null;
    checks: EvaluationCheck[];
  };
  visualReview: VisualReviewStatus;
}

interface EvaluationLogState {
  entries: EvaluationLogEntry[];
  addEntry: (entry: EvaluationLogEntry) => void;
  clearEntries: () => void;
  setVisualReview: (id: string, review: VisualReviewStatus) => void;
}

export const useEvaluationLogStore = create<EvaluationLogState>((set) => ({
  entries: [],
  addEntry: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries],
    })),
  clearEntries: () => set({ entries: [] }),
  setVisualReview: (id, visualReview) => set((state) => ({
    entries: state.entries.map((entry) => entry.id === id ? { ...entry, visualReview } : entry),
  })),
}));
