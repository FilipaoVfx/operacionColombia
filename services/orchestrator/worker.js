// M5 — Workers idempotentes + fan-out. Un job por vez; tras ingesta con cambios se
// encolan en paralelo los índices derivados (vistas M8, entidades M6) — no secuencial.
import { getSource } from "../connectors/sources.config.js";
import { runSource } from "../connectors/cli.js";
import { resolveDomain } from "../entity-res/index.js";
import { buildViews } from "../views-builder/index.js";
import { buildSearchIndex } from "../search-indexer/index.js";
import { buildGeoIndex } from "../geo-indexer/index.js";
import { resolveSource } from "../socrata-explorer/index.js";

/** Handlers por tipo de job. Todos idempotentes: reejecutar no duplica estado. */
export function createHandlers(db) {
  return {
    async ingest(payload, { queue }) {
      const source = resolveSource(db, payload.sourceId, getSource);
      const res = await runSource(db, source, { force: Boolean(payload.force) });
      // fan-out: storage listo → vistas, entidades y search como jobs independientes
      if (res.resultado === "ok" && (res.insertadas || res.actualizadas)) {
        queue.enqueue({ tipo: "views", payload: { domain: source.domain }, dedupeKey: `views:${source.domain}` });
        queue.enqueue({ tipo: "entity-res", payload: { domain: source.domain }, dedupeKey: `entity-res:${source.domain}` });
        queue.enqueue({ tipo: "search", payload: { domain: source.domain }, dedupeKey: `search:${source.domain}` });
        queue.enqueue({ tipo: "geo", payload: { domain: source.domain }, dedupeKey: `geo:${source.domain}` });
      }
      return res;
    },
    async "entity-res"(payload) {
      return resolveDomain(db, payload?.domain ?? null);
    },
    async views(payload) {
      return buildViews(db, { domain: payload?.domain ?? null });
    },
    async search(payload) {
      return buildSearchIndex(db, payload?.domain ?? null);
    },
    async geo(payload) {
      return buildGeoIndex(db, payload?.domain ?? null);
    },
  };
}

/** Drena la cola hasta vaciarla (o hasta max jobs). Devuelve resumen por resultado. */
export async function workUntilEmpty(queue, handlers, { max = Infinity, log = () => {} } = {}) {
  const done = { ok: 0, reintento: 0, muerto: 0 };
  for (let i = 0; i < max; i++) {
    const job = queue.claim();
    if (!job) break;
    const handler = handlers[job.tipo];
    try {
      if (!handler) throw new Error(`tipo de job desconocido: ${job.tipo}`);
      const res = await handler(job.payload, { queue });
      queue.complete(job.job_id);
      done.ok++;
      log(`[job ${job.job_id}] ${job.tipo} ok`, res?.resultado ?? "");
    } catch (e) {
      const out = queue.fail(job.job_id, e);
      done[out] = (done[out] ?? 0) + 1;
      log(`[job ${job.job_id}] ${job.tipo} ${out}: ${e.message}`);
    }
  }
  return done;
}
