import { useEvaluationLogStore, type VisualReviewStatus } from '../../stores/evaluationLogStore';
import { summarizeEvaluationLogs } from '../../thesis/evaluation/evaluationSummary';
import { isEvaluationWindow, setReportVisualReview } from '../../utils/evaluationWindow';

const percent = (value: number | null) => value === null ? 'Belum diuji' : `${value.toFixed(2)}%`;

export const EvaluationResults = () => {
  const entries = useEvaluationLogStore((state) => state.entries);
  const setVisualReview = useEvaluationLogStore((state) => state.setVisualReview);
  const summary = summarizeEvaluationLogs(entries);
  return (
    <div className="mt-2 space-y-4 text-sm leading-6 text-text-dim">
      <p>Integritas data · Tesis §3.14.7 · 6 komponen. Bukan skor akurasi retrieval atau kualitas visual.</p>
      <p>Untuk uji sumber dataset, gunakan rig kontrol dengan seluruh bone terpetakan dan prompt seperti “walk, pakai dataset asli”.</p>
      <div className="rounded border border-border bg-panel p-2">
        <div>Dataset: <strong className="text-text">{percent(summary.datasetIntegrity.percentage)}</strong> · {summary.datasetIntegrity.evaluated} uji</div>
        <div>Penerapan synthesis: <strong className="text-text">{percent(summary.synthesisApplicationIntegrity.percentage)}</strong> · {summary.synthesisApplicationIntegrity.evaluated} uji</div>
        <div>{summary.valid} valid · {summary.invalid} tidak sesuai · {summary.failed} pipeline gagal</div>
        <p>Pipeline gagal tidak masuk rata-rata integritas. Log tersimpan selama sesi; ekspor sebelum menutup aplikasi.</p>
      </div>
      {entries.length === 0 && <p>Belum ada hasil. Jalankan apply_rag_animation melalui MCP.</p>}
      <p>Rumus: komponen sesuai ÷ 6 × 100%. Tiap komponen lulus/gagal; bukan persentase keyframe. Ringkasan menghitung log tersimpan.</p>
      <div className="space-y-3">
        {entries.map((entry) => (
          <details key={entry.id} className="rounded border border-border bg-panel p-2">
            <summary className="cursor-pointer text-text">
              {entry.rag.selectedAnimationName ?? 'Pipeline gagal'} · {entry.status.toUpperCase()} · {entry.status === 'failed' ? 'Tidak dievaluasi' : percent(entry.validation.percentage)}
            </summary>
            <div className="mt-2 space-y-2">
              <p className="break-words">{entry.prompt}</p>
              <p>{new Date(entry.createdAt).toLocaleString()} · {entry.validation.basis === 'dataset' ? 'Acuan: dataset sumber' : entry.validation.basis === 'synthesized_output' ? 'Acuan: hasil synthesis (bukan kesamaan dataset)' : 'Tidak ada keluaran lengkap'}</p>
              <p>{entry.validation.scope}</p>
              <p className="break-all font-mono text-xs">Log: {entry.id}<br />Request: {entry.requestId ?? '—'}</p>
              <div className="grid gap-4 rounded border border-border bg-panel2 p-3 md:grid-cols-2">
                <section>
                  <h3 className="font-semibold text-text">Retrieval & synthesis</h3>
                  <p>ID: {entry.rag.selectedAnimationId ?? '—'} · Kategori: {entry.rag.selectedCategory ?? '—'}</p>
                  <p>Skor retrieval: {entry.rag.score ?? '—'} (bukan persentase) · Mode: {entry.rag.outputMode ?? '—'}</p>
                  <ul>{entry.rag.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
                  <p>Kandidat: {entry.rag.retrievedCandidates.map((candidate) => `${candidate.id} (${candidate.score})`).join(', ') || '—'}</p>
                  <p>Required bones: {entry.rag.requiredBones.join(', ') || '—'}</p>
                  {entry.rag.modifiersApplied && <details><summary className="cursor-pointer">Modifier synthesis</summary><pre className="overflow-auto text-xs">{JSON.stringify(entry.rag.modifiersApplied, null, 2)}</pre></details>}
                  {entry.rag.rejectedCandidates.length > 0 && <details><summary className="cursor-pointer">Kandidat ditolak</summary><pre className="overflow-auto text-xs">{JSON.stringify(entry.rag.rejectedCandidates, null, 2)}</pre></details>}
                </section>
                <section>
                  <h3 className="font-semibold text-text">Eksekusi MCP</h3>
                  <p>Status: {entry.mcp.status} · Bone terpetakan: {entry.mcp.mappedBoneCount}</p>
                  <p>Keyframe dataset: {entry.rag.datasetKeyframeCount ?? '—'} · Adaptasi: {entry.rag.adaptedKeyframeCount ?? '—'} · Generated: {entry.rag.generatedKeyframeCount ?? '—'}</p>
                  <p>Tertulis: {entry.mcp.appliedKeyframeCount} · Terverifikasi sesuai: {entry.mcp.matchingKeyframeCount}</p>
                  <p>Durasi sumber: {entry.rag.duration ?? '—'} · Aktual: {entry.mcp.duration ?? '—'} frame</p>
                  <p>FPS sumber: {entry.rag.fps ?? '—'} · Aktual: {entry.mcp.fps ?? '—'}</p>
                  <p>Hilang: {entry.validation.missingKeyframes} · Tambahan: {entry.validation.unexpectedKeyframes} · Toleransi: {entry.validation.tolerance}</p>
                  <details><summary className="cursor-pointer">Pemetaan bone</summary><pre className="overflow-auto text-xs">{JSON.stringify(entry.mcp.mappedBones, null, 2)}</pre></details>
                </section>
              </div>
              {entry.mcp.error && <p className="break-words text-red-400">{entry.mcp.error}</p>}
              <p>{entry.validation.matchedComponents}/{entry.validation.totalComponents} komponen sesuai. Keyframe sumber dikecualikan karena bone tidak terpetakan: {entry.validation.excludedSourceKeyframes}.</p>
              {entry.validation.excludedSourceKeyframes > 0 && <p>Hasil ini bukan uji rig kontrol lengkap; kehilangan karena adaptasi dicatat terpisah.</p>}
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <caption className="sr-only">Perbandingan enam komponen integritas</caption>
                  <thead><tr><th className="p-1">Komponen</th><th className="p-1">Acuan</th><th className="p-1">Aktual</th><th className="p-1">Hasil</th></tr></thead>
                  <tbody>{entry.validation.checks.map((check) => (
                    <tr key={check.key} className="border-t border-border">
                      <th scope="row" className="p-1 font-normal"><span>{check.label}</span>{check.details && <p className="min-w-32 text-[10px] text-text-dim">{check.details}</p>}</th>
                      <td className="p-1 break-all">{String(check.expected ?? '—')}</td>
                      <td className="p-1 break-all">{String(check.actual ?? '—')}</td>
                      <td className={`p-1 ${check.passed ? 'text-accent2' : 'text-red-400'}`}>{check.passed ? 'Sesuai' : 'Tidak sesuai'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {entry.validation.discrepancies.length > 0 && <details>
                <summary className="cursor-pointer">{entry.validation.discrepancies.length} perbedaan nilai/keyframe</summary>
                <ul className="max-h-48 overflow-auto break-words">
                  {entry.validation.discrepancies.map((difference, index) => <li key={index} className="border-t border-border py-1">
                    {difference.bone} · frame {difference.frame} · {difference.property}: {String(difference.expected ?? 'tidak ada')} → {String(difference.actual ?? 'tidak ada')}
                  </li>)}
                </ul>
              </details>}
              <label className="flex flex-wrap items-center gap-2">Review visual manual
                <select className="rounded border border-border bg-panel2 p-1 text-text" value={entry.visualReview} onChange={(event) => (isEvaluationWindow ? setReportVisualReview : setVisualReview)(entry.id, event.target.value as VisualReviewStatus)}>
                  <option value="not_reviewed">Belum direview</option><option value="accepted">Diterima</option><option value="rejected">Ditolak</option>
                </select>
              </label>
              <p>Review visual tidak mengubah skor integritas. Hasil ini adalah snapshot saat eksekusi, bukan evaluasi ulang timeline terkini.</p>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
};
