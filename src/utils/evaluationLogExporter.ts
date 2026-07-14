import { useEvaluationLogStore, type EvaluationLogEntry } from '../stores/evaluationLogStore';
import { saveTextFile } from './nativeIO';

const JSON_FILTERS = [
  {
    name: 'JSON',
    extensions: ['json'],
  },
];

const getAverageAgreement = (entries: EvaluationLogEntry[]) => {
  if (entries.length === 0) return 0;

  const total = entries.reduce((sum, entry) => sum + entry.validation.percentage, 0);
  return Math.round((total / entries.length) * 100) / 100;
};

const getTimestampSlug = () => new Date().toISOString().replace(/[:.]/g, '-');

export const createEvaluationLogExportData = () => {
  const entries = useEvaluationLogStore.getState().entries;

  return {
    format: 'spinebones-rag-evaluation-log',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    summary: {
      total: entries.length,
      valid: entries.filter((entry) => entry.status === 'valid').length,
      invalid: entries.filter((entry) => entry.status === 'invalid').length,
      failed: entries.filter((entry) => entry.status === 'failed').length,
      averageJsonAgreement: getAverageAgreement(entries),
    },
    entries,
  };
};

export const exportEvaluationLogs = async () => {
  const payload = createEvaluationLogExportData();
  await saveTextFile(
    `spinebones-evaluation-log-${getTimestampSlug()}.json`,
    `${JSON.stringify(payload, null, 2)}\n`,
    JSON_FILTERS,
  );
};
