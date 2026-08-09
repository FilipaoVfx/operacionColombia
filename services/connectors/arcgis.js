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

// Un MapServer publica varias capas y no expone `fields` ni `/query`: apuntar una
// fuente al servicio en vez de a la capa produce errores opacos. Se detecta y se avisa.
function assertUrlDeCapa(source) {
  if (/\/(Map|Feature)Server\/?$/i.test(String(source.endpoint).split("?")[0])) {
    throw new Error(
      `[${source.id}] endpoint apunta al servicio, no a una capa: agregá /<idCapa> ` +
      `(descubrilas con: node services/arcgis-explorer/cli.js ${source.endpoint})`
    );
  }
}

export async function discover(source) {
  assertUrlDeCapa(source);
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
  assertUrlDeCapa(source);
  let offset = cursor.offset ?? 0;
  // La generalización por defecto (~80 m) está calibrada para tramos viales de escala
  // nacional. En polígonos chicos (títulos mineros, predios) ese mismo umbral los
  // colapsa: cada fuente declara el suyo, y 0/null la desactiva.
  const offsetGeom = source.maxAllowableOffset ?? MAX_OFFSET;
  // El campo de OID no siempre se llama 'objectid' (OBJECTID, FID, …); ordenar por uno
  // inexistente rompe la paginación y devuelve páginas repetidas.
  const orderBy = source.orderByFields ?? "objectid";
  for (;;) {
    const params = new URLSearchParams({
      where: source.where || "1=1",
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326",
      geometryPrecision: String(GEOM_PRECISION),
      orderByFields: orderBy,
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: "geojson",
    });
    if (offsetGeom) params.set("maxAllowableOffset", String(offsetGeom));
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
