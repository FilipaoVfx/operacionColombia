// M5 — Scheduler por periodicidad de fuente (M2 freshness): encola jobs de ingesta
// cuando la última corrida OK es más vieja que el periodo declarado en sources.config.
const DIA = 86_400_000;
export const PERIOD_MS = {
  diario: DIA,
  semanal: 7 * DIA,
  mensual: 30 * DIA,
  semestral: 182 * DIA,
  anual: 365 * DIA,
};

/** Devuelve las fuentes vencidas y encola un job 'ingest' por cada una (con dedupe). */
export function scheduleDue(db, queue, sources, now = Date.now()) {
  const lastOk = db.prepare(`
    SELECT source_id, MAX(started_at) last FROM etl_runs WHERE resultado='ok' GROUP BY source_id
  `).all();
  const lastBySource = new Map(lastOk.map((r) => [r.source_id, Date.parse(r.last)]));

  const enqueued = [];
  for (const s of sources) {
    const period = PERIOD_MS[s.schedule] ?? PERIOD_MS.mensual;
    const last = lastBySource.get(s.id);
    if (last != null && now - last < period) continue;
    const jobId = queue.enqueue({
      tipo: "ingest",
      payload: { sourceId: s.id },
      dedupeKey: `ingest:${s.id}`,
    });
    if (jobId != null) enqueued.push({ sourceId: s.id, jobId });
  }
  return enqueued;
}
