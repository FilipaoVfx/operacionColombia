// SIVU - API + servidor estatico (sin dependencias: node:http + node:sqlite + node:zlib)
import http from "node:http";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { openDb, getMeta } from "./db.js";
import { esDepartamento } from "./domains.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const PORT = process.env.PORT || 8080;

const db = openDb();

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------
function stripAccents(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function norm(s) {
  return stripAccents(String(s)).toLowerCase().trim();
}

const stmtCache = new Map();
function prep(sql) {
  let s = stmtCache.get(sql);
  if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
  return s;
}

// columnas expuestas como propiedades
const PROP_COLS = [
  "id", "codigo_vial", "nombre_tramo", "ruta", "sector", "tipo_vial",
  "categoria", "superficie", "pavimentada", "calzada", "administrador",
  "grupo_admin", "region", "revision", "longitud_km", "fuente",
];

const SOURCE_FEATURE_URL =
  "https://hermes2.invias.gov.co/server/rest/services/MapaCarreteras/RedVial/MapServer/1";

function rowProps(r) {
  const p = {};
  for (const c of PROP_COLS) p[c] = r[c];
  p.pavimentada = r.pavimentada === null ? null : !!r.pavimentada;
  p.fuente_oficial = SOURCE_FEATURE_URL;
  return p;
}

// ---------------------------------------------------------------------------
// construccion de filtros -> WHERE dinamico
// ---------------------------------------------------------------------------
const MULTI = { region: "region", tipo: "tipo_vial", superficie: "superficie", administrador: "administrador" };

function buildWhere(qp) {
  const where = [];
  const args = [];

  for (const [param, col] of Object.entries(MULTI)) {
    const raw = qp.get(param);
    if (raw) {
      const vals = raw.split(",").map((v) => v.trim()).filter(Boolean);
      if (vals.length) {
        where.push(`${col} IN (${vals.map(() => "?").join(",")})`);
        args.push(...vals);
      }
    }
  }

  if (qp.get("pavimentada") === "1" || qp.get("pavimentada") === "0") {
    where.push("pavimentada = ?");
    args.push(Number(qp.get("pavimentada")));
  }

  const q = qp.get("q");
  if (q && q.trim()) {
    where.push("search_blob LIKE ?");
    args.push(`%${norm(q)}%`);
  }

  const bbox = qp.get("bbox");
  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [left, bottom, right, top] = parts;
      // interseccion de envolventes
      where.push("maxx >= ? AND minx <= ? AND maxy >= ? AND miny <= ?");
      args.push(left, right, bottom, top);
    }
  }

  return { clause: where.length ? "WHERE " + where.join(" AND ") : "", args };
}

const SORT_COLS = new Set([
  "region", "tipo_vial", "superficie", "longitud_km", "nombre_tramo",
  "codigo_vial", "administrador",
]);

// ---------------------------------------------------------------------------
// handlers de datos
// ---------------------------------------------------------------------------
let metaCache = null;
function handleMeta() {
  if (metaCache) return metaCache;
  const distinct = (col) =>
    prep(`SELECT ${col} v, COUNT(*) c FROM vias WHERE ${col} IS NOT NULL GROUP BY ${col} ORDER BY c DESC`).all();
  const totals = prep("SELECT COUNT(*) count, ROUND(SUM(longitud_km),1) total_km FROM vias").get();
  const regions = distinct("region");
  metaCache = {
    ...totals,
    ingested_at: getMeta(db, "ingested_at"),
    source: getMeta(db, "source"),
    source_url: getMeta(db, "source_url"),
    bbox: JSON.parse(getMeta(db, "bbox") || "null"),
    regions, // territoriales completas (compatibilidad)
    departamentos: regions.filter((r) => esDepartamento(r.v)),
    territoriales_otras: regions.filter((r) => !esDepartamento(r.v)),
    tipos: distinct("tipo_vial"),
    superficies: distinct("superficie"),
    administradores: distinct("administrador"),
  };
  return metaCache;
}

const kpiCache = new Map();
function handleKpi(qp) {
  const { clause, args } = buildWhere(qp);
  const key = clause + "|" + args.join("|");
  if (kpiCache.has(key)) return kpiCache.get(key);

  const totals = prep(
    `SELECT COUNT(*) total_segmentos, ROUND(SUM(longitud_km),1) total_km,
            SUM(CASE WHEN pavimentada=1 THEN longitud_km ELSE 0 END) km_pav,
            SUM(CASE WHEN pavimentada IS NOT NULL THEN longitud_km ELSE 0 END) km_clasif
     FROM vias ${clause}`
  ).get(...args);

  const grp = (col) =>
    prep(
      `SELECT ${col} label, COUNT(*) segmentos, ROUND(SUM(longitud_km),1) km
       FROM vias ${clause} GROUP BY ${col} ORDER BY km DESC`
    ).all(...args);

  const pct = totals.km_clasif > 0 ? (totals.km_pav / totals.km_clasif) * 100 : null;
  const out = {
    total_segmentos: totals.total_segmentos,
    total_km: totals.total_km || 0,
    pct_pavimentada: pct === null ? null : Math.round(pct * 10) / 10,
    km_pavimentada: Math.round((totals.km_pav || 0) * 10) / 10,
    km_clasificado: Math.round((totals.km_clasif || 0) * 10) / 10,
    pct_clasificado:
      totals.total_km > 0 ? Math.round((totals.km_clasif / totals.total_km) * 1000) / 10 : 0,
    por_tipo: grp("tipo_vial"),
    por_superficie: grp("superficie"),
    por_region: grp("region"),
    por_administrador: grp("administrador"),
  };
  kpiCache.set(key, out);
  return out;
}

function handleVias(qp) {
  const { clause, args } = buildWhere(qp);
  const format = (qp.get("format") || "geojson").toLowerCase();

  let limit = parseInt(qp.get("limit"), 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = format === "table" ? 50 : 3000;
  limit = Math.min(limit, 10000);
  let offset = parseInt(qp.get("offset"), 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  if (format === "table" || format === "csv") {
    let order = "";
    const sort = qp.get("sort");
    if (sort && SORT_COLS.has(sort)) {
      const dir = (qp.get("dir") || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
      order = `ORDER BY ${sort} ${dir}`;
    }
    const total = prep(`SELECT COUNT(*) c FROM vias ${clause}`).get(...args).c;
    const rows = prep(
      `SELECT ${PROP_COLS.join(",")} FROM vias ${clause} ${order} LIMIT ? OFFSET ?`
    ).all(...args, limit, offset);
    if (format === "csv") return { csv: toCsv(rows.map(rowProps)), total };
    return { json: { total, limit, offset, items: rows.map(rowProps) } };
  }

  // geojson
  const rows = prep(
    `SELECT ${PROP_COLS.join(",")}, geom FROM vias ${clause} LIMIT ?`
  ).all(...args, limit);
  const total = prep(`SELECT COUNT(*) c FROM vias ${clause}`).get(...args).c;
  const features = rows.map((r) => ({
    type: "Feature",
    geometry: JSON.parse(r.geom),
    properties: rowProps(r),
  }));
  return {
    json: {
      type: "FeatureCollection",
      features,
      properties: { returned: features.length, total, truncated: total > features.length },
    },
  };
}

function handleViaById(id) {
  const r = prep(`SELECT ${PROP_COLS.join(",")}, geom, extra FROM vias WHERE id=?`).get(id);
  if (!r) return null;
  const props = rowProps(r);
  props.extra = JSON.parse(r.extra || "{}");
  return { type: "Feature", geometry: JSON.parse(r.geom), properties: props };
}

function handleSearch(qp) {
  const q = norm(qp.get("q") || "");
  if (!q) return [];
  let limit = parseInt(qp.get("limit"), 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 10;
  limit = Math.min(limit, 50);
  const rows = prep(
    `SELECT id, codigo_vial, nombre_tramo, tipo_vial, region, minx, miny, maxx, maxy
     FROM vias WHERE search_blob LIKE ? ORDER BY longitud_km DESC LIMIT ?`
  ).all(`%${q}%`, limit);
  return rows.map((r) => ({
    id: r.id,
    label: `${r.codigo_vial || "?"} - ${r.nombre_tramo}`,
    sublabel: [r.tipo_vial, r.region].filter(Boolean).join(" - "),
    bbox: [r.minx, r.miny, r.maxx, r.maxy],
  }));
}

function toCsv(items) {
  if (!items.length) return "";
  const cols = Object.keys(items[0]).filter((c) => c !== "fuente_oficial");
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(",");
  const body = items.map((it) => cols.map((c) => esc(it[c])).join(",")).join("\n");
  return head + "\n" + body;
}

// ---------------------------------------------------------------------------
// respuesta HTTP (con gzip)
// ---------------------------------------------------------------------------
function send(req, res, status, body, contentType, extraHeaders = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const headers = {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    ...extraHeaders,
  };
  const ae = req.headers["accept-encoding"] || "";
  if (ae.includes("gzip") && buf.length > 1024) {
    buf = gzipSync(buf);
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
  }
  headers["Content-Length"] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === "HEAD" ? undefined : buf);
}

function sendJson(req, res, obj, { status = 200, cache = 300 } = {}) {
  send(req, res, status, JSON.stringify(obj), "application/json; charset=utf-8", {
    "Cache-Control": `public, max-age=${cache}`,
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) return send(req, res, 403, "Forbidden", "text/plain");
  try {
    const data = await readFile(file);
    send(req, res, 200, data, MIME[extname(file)] || "application/octet-stream", {
      "Cache-Control": "public, max-age=60",
    });
  } catch {
    send(req, res, 404, "Not Found", "text/plain");
  }
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const qp = url.searchParams;

    // normaliza alias del PRD a rutas internas
    let route = path;
    if (route === "/vias/region" || route === "/vias/filter") route = "/api/vias";
    else if (route === "/vias/search") route = "/api/search";
    else if (route === "/kpi/vias/region" || route === "/kpi/vias/overall") route = "/api/kpi";

    if (route === "/api/health") {
      return sendJson(req, res, { ok: true, count: handleMeta().count, ingested_at: handleMeta().ingested_at }, { cache: 0 });
    }
    if (route === "/api/meta") return sendJson(req, res, handleMeta(), { cache: 600 });
    if (route === "/api/kpi") return sendJson(req, res, handleKpi(qp));
    if (route === "/api/search") return sendJson(req, res, handleSearch(qp));

    const idMatch = route.match(/^\/api\/vias\/(\d+)$/);
    if (idMatch) {
      const feat = handleViaById(Number(idMatch[1]));
      if (!feat) return sendJson(req, res, { error: "no encontrado" }, { status: 404, cache: 0 });
      return sendJson(req, res, feat);
    }

    if (route === "/api/vias") {
      const out = handleVias(qp);
      if (out.csv !== undefined) {
        return send(req, res, 200, out.csv, "text/csv; charset=utf-8", {
          "Content-Disposition": 'attachment; filename="vias_sivu.csv"',
          "Cache-Control": "no-store",
        });
      }
      return sendJson(req, res, out.json);
    }

    if (path.startsWith("/api/")) {
      return sendJson(req, res, { error: "ruta no encontrada" }, { status: 404, cache: 0 });
    }

    return serveStatic(req, res, path);
  } catch (err) {
    console.error("ERR", req.url, err);
    sendJson(req, res, { error: "error interno", detail: String(err.message) }, { status: 500, cache: 0 });
  }
});

server.listen(PORT, () => {
  const m = handleMeta();
  console.log(`SIVU API + UI -> http://localhost:${PORT}`);
  console.log(`  ${m.count} tramos viales | ${m.total_km} km | fuente: ${m.source}`);
});
