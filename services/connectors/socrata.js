// C1 — SocrataConnector (SODA API, datos.gov.co). PLANNING M1.
// Paginación $limit/$offset con $order estable, $where incremental, app token opcional,
// backoff/reintentos (patrón fetchJson del piloto).
import { sha256 } from "../../packages/core-model/index.js";

const PAGE = Number(process.env.SOCRATA_PAGE || 1000);
const APP_TOKEN = process.env.SOCRATA_APP_TOKEN || "";

async function fetchWithRetry(url, { tries = 4, timeout = 60000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const headers = { "User-Agent": "operacionColombia-ETL/1.0", Accept: "application/json" };
      if (APP_TOKEN) headers["X-App-Token"] = APP_TOKEN;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
      if (res.status === 429) throw new Error("HTTP 429 rate limit");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      const wait = 1000 * 2 ** i;
      console.warn(`  ! ${url.slice(0, 80)}… intento ${i + 1}: ${err.message}; reintento en ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

function domainOf(endpoint) {
  return new URL(endpoint).origin;
}

/** Metadata del dataset vía API de vistas de Socrata (esquema + filas + fecha). */
export async function discover(source) {
  const meta = await (await fetchWithRetry(`${domainOf(source.endpoint)}/api/views/${source.id}.json`)).json();
  const esquema = (meta.columns || []).map((c) => ({ name: c.fieldName, type: c.dataTypeName }));
  // rowsUpdatedAt (epoch s) actúa como etag de frescura: si no cambió, no re-ingerir.
  const etag = meta.rowsUpdatedAt ? String(meta.rowsUpdatedAt) : undefined;
  return {
    descripcion: meta.description ?? meta.name ?? null,
    esquema,
    etag,
    hash: etag ? undefined : sha256(esquema),
    filas: undefined,
  };
}

/** Streaming paginado: AsyncIterable<RawBatch>. */
export async function* fetch_(source, cursor = { offset: 0 }) {
  let offset = cursor.offset ?? 0;
  for (;;) {
    const params = new URLSearchParams({
      $select: ":*,*",   // metacolumnas (:id,:updated_at) + datos; el star debe ir primero (SoQL)
      $order: ":id",
      $limit: String(PAGE),
      $offset: String(offset),
    });
    if (source.where) params.set("$where", source.where);
    const rows = await (await fetchWithRetry(`${source.endpoint}?${params}`)).json();
    if (!Array.isArray(rows) || rows.length === 0) return;
    offset += rows.length;
    yield { sourceId: source.id, rows, cursor: { offset }, fetchedAt: new Date().toISOString() };
    if (rows.length < PAGE) return;
  }
}
export { fetch_ as fetch };

export async function healthcheck(source) {
  try {
    const res = await fetchWithRetry(`${source.endpoint}?$limit=1`, { tries: 2, timeout: 15000 });
    return res.ok ? "ok" : "down";
  } catch {
    return "down";
  }
}
