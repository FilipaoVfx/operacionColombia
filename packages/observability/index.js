// M14 — Observabilidad (PLANNING, BACKLOG H): logger estructurado + métricas en proceso
// + reporte de budget (§2.3). El ETL ya persiste sus corridas en `etl_runs` (M2); este
// paquete añade la capa API/search (latencias, cache hit, error rate) y el veredicto
// budget-vs-medido que exige el DoD ("todo el budget es medible").

/** Logger estructurado: una línea JSON por evento (parseable por cualquier colector). */
export function createLogger(module, { sink = console.log } = {}) {
  const emit = (level, msg, fields) =>
    sink(JSON.stringify({ ts: new Date().toISOString(), level, module, msg, ...fields }));
  return {
    info: (msg, fields = {}) => emit("info", msg, fields),
    warn: (msg, fields = {}) => emit("warn", msg, fields),
    error: (msg, fields = {}) => emit("error", msg, fields),
  };
}

const MAX_SAMPLES = 2000; // ring buffer por ruta: suficiente para P99 estable, memoria acotada

/** Métricas en proceso: contadores + latencias por etiqueta (ruta agrupada). */
export class Metrics {
  constructor() {
    this.rutas = new Map(); // label -> { samples: number[], idx, n, errores, cache_hits }
    this.desde = new Date().toISOString();
  }

  #ruta(label) {
    let r = this.rutas.get(label);
    if (!r) { r = { samples: [], idx: 0, n: 0, errores: 0, cache_hits: 0 }; this.rutas.set(label, r); }
    return r;
  }

  observe(label, ms, { error = false, cacheHit = false } = {}) {
    const r = this.#ruta(label);
    r.n++;
    if (error) r.errores++;
    if (cacheHit) r.cache_hits++;
    if (r.samples.length < MAX_SAMPLES) r.samples.push(ms);
    else { r.samples[r.idx] = ms; r.idx = (r.idx + 1) % MAX_SAMPLES; }
  }

  percentile(label, p) {
    const r = this.rutas.get(label);
    if (!r || !r.samples.length) return null;
    const sorted = [...r.samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  }

  snapshot() {
    const por_ruta = {};
    let n = 0, errores = 0, hits = 0;
    for (const [label, r] of this.rutas) {
      n += r.n; errores += r.errores; hits += r.cache_hits;
      por_ruta[label] = {
        n: r.n, errores: r.errores, cache_hits: r.cache_hits,
        p50_ms: this.percentile(label, 50), p95_ms: this.percentile(label, 95), p99_ms: this.percentile(label, 99),
      };
    }
    return {
      desde: this.desde, total: n,
      error_rate_pct: n ? +(100 * errores / n).toFixed(3) : 0,
      cache_hit_pct: n ? +(100 * hits / n).toFixed(1) : 0,
      por_ruta,
    };
  }
}

// Presupuesto §2.3 (PLANNING). Umbrales que el reporte compara contra lo medido.
export const BUDGET = {
  p95_api_ms: 150,
  p99_api_ms: 300,
  by_id_ms: 20,
  search_ms: 100,
  error_rate_pct: 0.1,
  etl_incremental_min: 5,
  cache_hit_pct: 95, // budget original es edge; sin edge desplegado se mide el caché de API
};

/**
 * Reporte operativo completo: API (proceso actual) + ETL/freshness (persistido en DB)
 * + alertas por umbral. Es el contrato del endpoint /api/status.
 */
export function budgetReport(db, metrics) {
  const api = metrics.snapshot();

  const etl = db.prepare(`
    SELECT source_id,
           MAX(run_id) run_id, MAX(started_at) started_at, MAX(finished_at) finished_at,
           filas, errores, resultado,
           ROUND((julianday(finished_at) - julianday(started_at)) * 24 * 60, 2) duracion_min
    FROM etl_runs GROUP BY source_id ORDER BY started_at DESC
  `).all();

  const freshness = db.prepare(
    "SELECT source_id, estado, last_checked, last_updated FROM dataset_meta"
  ).all();

  const alertas = [];
  const worst = (p) => Math.max(0, ...[...metrics.rutas.keys()].map((l) => metrics.percentile(l, p) ?? 0));
  if (api.total) {
    const p95 = worst(95), p99 = worst(99);
    if (p95 > BUDGET.p95_api_ms) alertas.push({ metrica: "p95_api_ms", medido: p95, umbral: BUDGET.p95_api_ms });
    if (p99 > BUDGET.p99_api_ms) alertas.push({ metrica: "p99_api_ms", medido: p99, umbral: BUDGET.p99_api_ms });
    if (api.error_rate_pct > BUDGET.error_rate_pct)
      alertas.push({ metrica: "error_rate_pct", medido: api.error_rate_pct, umbral: BUDGET.error_rate_pct });
  }
  for (const r of etl) {
    if (r.resultado === "error") alertas.push({ metrica: "etl_error", fuente: r.source_id });
    if (r.duracion_min != null && r.duracion_min > BUDGET.etl_incremental_min)
      alertas.push({ metrica: "etl_incremental_min", fuente: r.source_id, medido: r.duracion_min, umbral: BUDGET.etl_incremental_min });
  }

  return { budget: BUDGET, api, etl, freshness, alertas, ok: alertas.length === 0 };
}
