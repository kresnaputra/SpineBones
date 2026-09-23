import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isDesktopApp } from './nativeIO';
import { useEvaluationLogStore, type EvaluationLogEntry, type VisualReviewStatus } from '../stores/evaluationLogStore';

export const isEvaluationWindow = new URLSearchParams(window.location.search).get('view') === 'evaluation';
let opening: Promise<void> | null = null;

export const openEvaluationWindow = async () => {
  if (!isDesktopApp()) {
    window.open('?view=evaluation', 'spinebones-evaluation');
    return;
  }
  if (opening) return opening;
  opening = (async () => {
    const existing = await WebviewWindow.getByLabel('evaluation-report');
    if (existing) {
      await existing.unminimize();
      await existing.show();
      await existing.setFocus();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const report = new WebviewWindow('evaluation-report', {
        url: 'index.html?view=evaluation', title: 'SpineBones — Evaluation Report',
        width: 1100, height: 800, minWidth: 700, minHeight: 450, resizable: true,
      });
      void report.once('tauri://created', () => resolve());
      void report.once('tauri://error', (event) => reject(new Error(String(event.payload))));
    });
  })();
  try { await opening; } finally { opening = null; }
};

type ReportMessage =
  | { type: 'request' }
  | { type: 'snapshot'; entries: EvaluationLogEntry[] }
  | { type: 'clear' }
  | { type: 'review'; id: string; review: VisualReviewStatus };

let sendCommand: ((message: ReportMessage) => void) | undefined;
export const clearReportEntries = () => sendCommand?.({ type: 'clear' });
export const setReportVisualReview = (id: string, review: VisualReviewStatus) => sendCommand?.({ type: 'review', id, review });

// Main editor owns the session. Report windows receive snapshots and send commands;
// they never replace the editor's logs with a stale local snapshot.
export const connectEvaluationWindow = (report: boolean) => {
  const channel = new BroadcastChannel('spinebones-evaluation-report');
  const send = (message: ReportMessage) => channel.postMessage(message);
  if (report) sendCommand = send;
  const snapshot = () => send({ type: 'snapshot', entries: useEvaluationLogStore.getState().entries });
  channel.onmessage = ({ data }: MessageEvent<ReportMessage>) => {
    if (report) {
      if (data.type === 'snapshot') useEvaluationLogStore.setState({ entries: data.entries });
    } else {
      const store = useEvaluationLogStore.getState();
      if (data.type === 'request') snapshot();
      if (data.type === 'clear') store.clearEntries();
      if (data.type === 'review') store.setVisualReview(data.id, data.review);
    }
  };
  const unsubscribe = report ? () => {} : useEvaluationLogStore.subscribe(snapshot);
  if (report) send({ type: 'request' });
  else snapshot();
  return { send, close: () => { unsubscribe(); channel.close(); } };
};
