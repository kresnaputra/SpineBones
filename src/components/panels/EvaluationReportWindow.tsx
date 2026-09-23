import { useState } from 'react';
import { clearReportEntries } from '../../utils/evaluationWindow';
import { useEvaluationLogStore } from '../../stores/evaluationLogStore';
import { exportEvaluationLogs } from '../../utils/evaluationLogExporter';
import { EvaluationResults } from './EvaluationResults';

export const EvaluationReportWindow = () => {
  const entries = useEvaluationLogStore((state) => state.entries);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const requestCount = new Set(entries.map((entry) => entry.requestId ?? entry.id)).size;

  const exportReport = async () => {
    setBusy(true);
    setError('');
    try {
      await exportEvaluationLogs();
    } catch (cause) {
      setError(`Export gagal: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen overflow-y-auto bg-panel text-text" aria-labelledby="evaluation-report-title">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-panel2 px-6 py-4">
        <div>
          <h2 id="evaluation-report-title" className="text-lg font-semibold">Evaluation Report</h2>
          <p className="mt-1 text-xs text-text-dim">Laporan sesi · {entries.length} log · {requestCount} request unik</p>
        </div>
      </header>
      <main className="px-6 py-4">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
          <button disabled={!entries.length || busy} onClick={() => void exportReport()} className="rounded border border-accent bg-accent/15 px-4 py-2 text-accent2 disabled:opacity-40">
            {busy ? 'Exporting…' : 'Export laporan lengkap (JSON)'}
          </button>
          <button disabled={!entries.length || busy} onClick={() => setConfirmClear(true)} className="rounded border border-border px-4 py-2 disabled:opacity-40">Hapus log sesi…</button>
        </div>
        {confirmClear && <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-border p-3 text-sm">
          <span>Hapus seluruh log sesi? Ekspor terlebih dahulu jika ingin menyimpannya.</span>
          <button className="text-red-400" onClick={() => { clearReportEntries(); setConfirmClear(false); }}>Hapus semua</button>
          <button onClick={() => setConfirmClear(false)}>Batal</button>
        </div>}
        {error && <p role="alert" className="mb-4 text-sm text-red-400">{error}</p>}
        {requestCount < entries.length && <p className="mb-3 text-sm text-amber-300">Ada log dengan request ID yang sama. Jumlah log bukan jumlah request unik; ringkasan di bawah menghitung seluruh log.</p>}
        <EvaluationResults />
      </main>
    </div>
  );
};
