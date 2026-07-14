import { create } from 'zustand';
import type { MotionModifiers, RagCandidateSummary, RagOutputMode, RagRejectedCandidate } from '../thesis/rag/synthesis/types';

export type EvaluationLogStatus = 'valid' | 'invalid' | 'failed';
export type VisualReviewStatus = 'not_reviewed' | 'accepted' | 'rejected';

export interface EvaluationCheck {
  key: string;
  label: string;
  expected: string | number | boolean | null;
  actual: string | number | boolean | null;
  passed: boolean;
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
    matchedComponents: number;
    totalComponents: number;
    percentage: number;
    checks: EvaluationCheck[];
  };
  visualReview: VisualReviewStatus;
}

interface EvaluationLogState {
  entries: EvaluationLogEntry[];
  addEntry: (entry: EvaluationLogEntry) => void;
  clearEntries: () => void;
}

export const useEvaluationLogStore = create<EvaluationLogState>((set) => ({
  entries: [],
  addEntry: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries],
    })),
  clearEntries: () => set({ entries: [] }),
}));
