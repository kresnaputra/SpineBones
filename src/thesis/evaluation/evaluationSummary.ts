import type { EvaluationLogEntry } from '../../stores/evaluationLogStore';

export const summarizeEvaluationLogs = (entries: EvaluationLogEntry[]) => {
  const aggregate = (basis: 'dataset' | 'synthesized_output') => {
    const evaluated = entries.filter((entry) => entry.validation.basis === basis && entry.status !== 'failed');
    const matched = evaluated.reduce((sum, entry) => sum + entry.validation.matchedComponents, 0);
    const total = evaluated.reduce((sum, entry) => sum + entry.validation.totalComponents, 0);
    return {
      evaluated: evaluated.length,
      matchedComponents: matched,
      totalComponents: total,
      percentage: total ? Math.round(matched / total * 10000) / 100 : null,
    };
  };
  return {
    total: entries.length,
    valid: entries.filter((entry) => entry.status === 'valid').length,
    invalid: entries.filter((entry) => entry.status === 'invalid').length,
    failed: entries.filter((entry) => entry.status === 'failed').length,
    datasetIntegrity: aggregate('dataset'),
    synthesisApplicationIntegrity: aggregate('synthesized_output'),
  };
};
