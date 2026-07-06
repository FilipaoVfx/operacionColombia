// ETL: INVIAS ArcGIS "RedVial" -> SQLite (tabla vias)
// Fuente: https://hermes2.invias.gov.co/server/rest/services/MapaCarreteras/RedVial/MapServer/1
// Geometria nativa en wkid 9377 (metros) -> se solicita outSR=4326 (WGS84) para el mapa.

import { openDb, createSchema, resetData, setMeta } from "./db.js";
import {
  CATEGORIA, CATEGORIA_TIPO, SUPERFICIE, CALZADA,
  ADMINISTRADOR, GRUPO_ADMIN, TERRITORIAL, REVISION, decode,
} from "./domains.js";

const LAYER =
  "https://hermes2.invias.gov.co/server/rest/services/MapaCarreteras/RedVial/MapServer/1";
// El servicio anuncia maxRecordCount=2000, pero serializar geometrias completas
// en paginas grandes provoca HTTP 500 (payloads de cientos de MB). Paginamos
// pequeno y pedimos precision/generalizacion para mapas nacionales.
const PAGE = 250;
const GEOM_PRECISION = 6;       // ~0.1 m de precision en coordenadas
const MAX_OFFSET = 0.0008;      // generalizacion ~80 m (Douglas-Peucker, en grados)
const OFFICIAL_URL =
  "https://hermes2.invias.gov.co/server/rest/services/MapaCarreteras/RedVial/MapServer/1";

async function fetchJson(url, { tries = 4 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "SIVU-ETL/1.0", Accept: "application/json" },
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      const wait = 800 * (i + 1);
      console.warn(`  ! intento ${i + 1} fallo (${err.message}); reintento en ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function getTotalCount() {
  const u = `${LAYER}/query?where=1%3D1&returnCountOnly=true&f=json`;
  const j = await fetchJson(u);
  return j.count;
}

async function fetchPage(offset) {
  const params = new URLSearchParams({
    where: "1=1",
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
  return fetchJson(`${LAYER}/query?${params}`);
}

// ---- helpers de geometria (WGS84) ----
function eachLine(geom, cb) {
  if (!geom) return;
  if (geom.type === "LineString") cb(geom.coordinates);
  else if (geom.type === "MultiLineString") geom.coordinates.forEach(cb);
}

function bboxOf(geom) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  eachLine(geom, (line) => {
    for (const [x, y] of line) {
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  });
  if (minx === Infinity) return null;
  return { minx, miny, maxx, maxy };
}

const R = 6371; // km
function haversineKm(geom) {
  let total = 0;
  eachLine(geom, (line) => {
    for (let i = 1; i < line.length; i++) {
      const [lon1, lat1] = line[i - 1];
      const [lon2, lat2] = line[i];
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
      total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
  });
  return total;
}

function stripAccents(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function pavimentadaCode(code) {
  const n = Number(code);
  if (n === 1) return 1;
  if (n === 2) return 0;
  return null;
}

function mapFeature(f) {
  const p = f.properties || {};
  const geom = f.geometry;
  const bb = bboxOf(geom);
  if (!bb) return null; // sin geometria utilizable

  const tipo_vial = decode(CATEGORIA_TIPO, p.categoria);
  const categoria = decode(CATEGORIA, p.categoria);
  const superficie = decode(SUPERFICIE, p.superficie);
  const region = decode(TERRITORIAL, p.territorial);
  const administrador = decode(ADMINISTRADOR, p.administrador);
  const calzada = decode(CALZADA, p.calzada);
  const grupo_admin = decode(GRUPO_ADMIN, p.grupoadministradorvial);
  const revision = decode(REVISION, p.revisionestado);

  const nombre_tramo =
    (p.nombretramo && String(p.nombretramo).trim()) ||
    (p.nombreruta && String(p.nombreruta).trim()) ||
    (p.sector && String(p.sector).trim()) ||
    "Sin nombre";

  // Longitud: preferimos st_length(shape) nativo (metros, geometria sin simplificar);
  // si no viene, calculamos geodesica sobre la geometria (simplificada).
  const stLenM = Number(p["st_length(shape)"]);
  const longitud_km =
    Number.isFinite(stLenM) && stLenM > 0
      ? Math.round((stLenM / 1000) * 1000) / 1000
      : Math.round(haversineKm(geom) * 1000) / 1000;

  const search_blob = stripAccents(
    [p.codigotramo, nombre_tramo, p.nombreruta, p.sector, region, p.ruta]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();

  const extra = {
    ruta: p.ruta ?? null,
    nombreruta: p.nombreruta ?? null,
    calzada,
    grupo_admin,
    poste_inicial: p.postereferenciainicial ?? null,
    distancia_inicial: p.distanciainicial ?? null,
    poste_final: p.postereferenciafinal ?? null,
    distancia_final: p.distanciafinal ?? null,
    st_length_m: p["st_length(shape)"] ?? null,
    fuente_original: p.fuente ?? null,
    territorial_code: p.territorial ?? null,
    categoria_code: p.categoria ?? null,
    globalid: p.globalid ?? null,
  };

  return {
    objectid: p.objectid ?? null,
    codigo_vial: p.codigotramo ?? null,
    nombre_tramo,
    ruta: p.nombreruta ?? null,
    sector: p.sector ?? null,
    tipo_vial,
    categoria,
    superficie,
    pavimentada: pavimentadaCode(p.superficie),
    calzada,
    administrador,
    grupo_admin,
    region,
    revision,
    longitud_km,
    fuente: "invias_arcgis",
    geom: JSON.stringify(geom),
    minx: bb.minx, miny: bb.miny, maxx: bb.maxx, maxy: bb.maxy,
    search_blob,
    extra: JSON.stringify(extra),
  };
}

async function main() {
  const t0 = Date.now();
  console.log("SIVU - Ingesta de la Red Vial Nacional (INVIAS)\n");

  const db = openDb({ create: true });
  createSchema(db);
  resetData(db);

  const total = await getTotalCount();
  console.log(`Total de tramos reportados por el servicio: ${total}`);

  const insert = db.prepare(`
    INSERT INTO vias (
      objectid, codigo_vial, nombre_tramo, ruta, sector, tipo_vial, categoria,
      superficie, pavimentada, calzada, administrador, grupo_admin, region,
      revision, longitud_km, fuente, geom, minx, miny, maxx, maxy, search_blob, extra
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  let inserted = 0, skipped = 0, offset = 0;
  for (;;) {
    const fc = await fetchPage(offset);
    const feats = fc.features || [];
    console.log(`  pagina offset=${offset}: ${feats.length} features`);
    if (feats.length === 0) break;

    db.exec("BEGIN");
    try {
      for (const f of feats) {
        const r = mapFeature(f);
        if (!r) { skipped++; continue; }
        insert.run(
          r.objectid, r.codigo_vial, r.nombre_tramo, r.ruta, r.sector, r.tipo_vial,
          r.categoria, r.superficie, r.pavimentada, r.calzada, r.administrador,
          r.grupo_admin, r.region, r.revision, r.longitud_km, r.fuente, r.geom,
          r.minx, r.miny, r.maxx, r.maxy, r.search_blob, r.extra
        );
        inserted++;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    offset += feats.length;
    const more = fc.exceededTransferLimit === true || (total && offset < total);
    if (feats.length < PAGE && !fc.exceededTransferLimit) break;
    if (!more) break;
  }

  // --- metadatos para el frontend (cacheados) ---
  const bb = db.prepare(
    "SELECT MIN(minx) minx, MIN(miny) miny, MAX(maxx) maxx, MAX(maxy) maxy FROM vias"
  ).get();
  setMeta(db, "bbox", bb);
  setMeta(db, "count", String(inserted));
  setMeta(db, "ingested_at", new Date().toISOString());
  setMeta(db, "source", "INVIAS ArcGIS - MapaCarreteras/RedVial");
  setMeta(db, "source_url", OFFICIAL_URL);

  db.close();
  console.log(
    `\nListo: ${inserted} tramos insertados, ${skipped} omitidos (sin geometria). ` +
      `${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
}

main().catch((e) => {
  console.error("ERROR en ingesta:", e);
  process.exit(1);
});
