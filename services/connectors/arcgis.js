// C2 — ArcgisConnector, extraído del piloto (src/ingest.js). PLANNING M1.
// Paginación resultOffset/resultRecordCount, outSR=4326, generalización para mapas nacionales.
import { sha256 } from "../../packages/core-model/index.js";

const PAGE = Number(process.env.ARCGIS_PAGE || 250);
const GEOM_PRECISION = 6;
const MAX_OFFSET = 0.0008;

async function fetchJson(url, { tries = 4, timeout = 60000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "operacionColombia-ETL/1.0", Accept: "application/json" },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      const wait = 1000 * 2 ** i;
      console.warn(`  ! intento ${i + 1}: ${err.message}; reintento en ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

export async function discover(source) {
  const info = await fetchJson(`${source.endpoint}?f=json`);
  const count = await fetchJson(`${source.endpoint}/query?where=1%3D1&returnCountOnly=true&f=json`);
  const esquema = (info.fields || []).map((f) => ({ name: f.name, type: f.type }));
  return {
    descripcion: info.name ?? null,
    esquema,
    // ArcGIS no expone etag; usamos conteo+esquema como huella de frescura (aprox).
    hash: sha256({ esquema, count: count.count }),
    filas: count.count,
  };
}

export async function* fetch_(source, cursor = { offset: 0 }) {
  let offset = cursor.offset ?? 0;
  for (;;) {
    const params = new URLSearchParams({
      where: source.where || "1=1",
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326",
      geometryPrecision: String(GEOM_PRECISION),
      maxAllowableOffset: String(MAX_OFFSET),
      orderByFields: "objectid",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: "geojson",
    });
    const fc = await fetchJson(`${source.endpoint}/query?${params}`);
    const feats = fc.features || [];
    if (feats.length === 0) return;
    offset += feats.length;
    yield { sourceId: source.id, rows: feats, cursor: { offset }, fetchedAt: new Date().toISOString() };
    if (feats.length < PAGE && fc.exceededTransferLimit !== true) return;
  }
}
export { fetch_ as fetch };

export async function healthcheck(source) {
  try {
    const j = await fetchJson(`${source.endpoint}?f=json`, { tries: 2, timeout: 15000 });
    return j && !j.error ? "ok" : "down";
  } catch {
    return "down";
  }
}
