import { useEvaluationLogStore } from '../stores/evaluationLogStore';
import { summarizeEvaluationLogs } from '../thesis/evaluation/evaluationSummary';
import { saveTextFile } from './nativeIO';

const JSON_FILTERS = [
  {
    name: 'JSON',
    extensions: ['json'],
  },
];

const getTimestampSlug = () => new Date().toISOString().replace(/[:.]/g, '-');

export const createEvaluationLogExportData = () => {
  const entries = useEvaluationLogStore.getState().entries;

  return {
    format: 'spinebones-rag-evaluation-log',
    version: '2.0',
    methodology: 'Tesis §3.14.7 / Tabel 31: enam komponen integritas. Synthesis dilaporkan terpisah dengan acuan output synthesis. Kegagalan pipeline dikecualikan dari agregat integritas.',
    exportedAt: new Date().toISOString(),
    summary: summarizeEvaluationLogs(entries),
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
