// M9 — Read API del registro unificado (CQRS lado lectura) + estáticos del panel M10.
// Cero dependencias: node:http + node:sqlite + node:zlib. Nunca toca la fuente oficial.
import http from "node:http";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { openOsintDb } from "../../packages/metadata/registry.js";
import { normName } from "../../packages/core-model/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, "..", "web");
const PORT = process.env.PORT || 8081;

const db = openOsintDb();

const stmtCache = new Map();
function prep(sql) {
  let s = stmtCache.get(sql);
  if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
  return s;
}

// ---------------------------------------------------------------------------
// filtros comunes: dominio, depto, muni, q  → WHERE parametrizado
// ---------------------------------------------------------------------------
const DOMINIOS = new Set(["territorio", "economia", "vial"]);

function buildWhere(qp) {
  const where = [];
  const args = [];
  const dominio = qp.get("dominio");
  if (dominio && DOMINIOS.has(dominio)) { where.push("dominio = ?"); args.push(dominio); }
  const depto = qp.get("depto");
  if (depto && /^\d{2}$/.test(depto)) { where.push("divipola_depto = ?"); args.push(depto); }
  const muni = qp.get("muni");
  if (muni && /^\d{5}$/.test(muni)) { where.push("divipola_muni = ?"); args.push(muni); }
  const q = qp.get("q");
  if (q && q.trim()) { where.push("search_blob LIKE ?"); args.push(`%${normName(q).toLowerCase()}%`); }
  return { clause: where.length ? "WHERE " + where.join(" AND ") : "", args };
}

function parseRow(r, { withGeom = false } = {}) {
  const out = {
    id_interno: r.id_interno,
    dominio: r.dominio,
    fuente: r.fuente,
    fuente_url: r.fuente_url,
    divipola_muni: r.divipola_muni,
    divipola_depto: r.divipola_depto,
    fecha_ingesta: r.fecha_ingesta,
    campos: JSON.parse(r.campos || "{}"),
  };
  if (withGeom && r.geom) out.geom = JSON.parse(r.geom);
  return out;
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------
let metaCache = null;
function handleMeta() {
  if (metaCache) return metaCache;
  metaCache = {
    dominios: prep("SELECT dominio, COUNT(*) n FROM registros GROUP BY dominio ORDER BY n DESC").all(),
    departamentos: prep(`
      SELECT d.cod_dpto codigo, MIN(d.dpto) nombre, COUNT(*) municipios
      FROM divipola d GROUP BY d.cod_dpto ORDER BY nombre
    `).all(),
    fuentes: prep(`
      SELECT source_id, nombre, dominio, conector, prioridad, frecuencia, version, filas, last_checked, last_updated, estado
      FROM dataset_meta ORDER BY dominio
    `).all(),
    ultima_corrida: prep("SELECT source_id, finished_at, filas, resultado FROM etl_runs WHERE resultado='ok' ORDER BY run_id DESC LIMIT 3").all(),
  };
  return metaCache;
}

const kpiCache = new Map();
function handleKpi(qp) {
  const depto = qp.get("depto") && /^\d{2}$/.test(qp.get("depto")) ? qp.get("depto") : null;
  const key = depto || "*";
  if (kpiCache.has(key)) return kpiCache.get(key);

  const dw = depto ? "AND divipola_depto = ?" : "";
  const da = depto ? [depto] : [];

  const municipios = prep(`SELECT COUNT(*) n FROM registros WHERE dominio='territorio' ${dw}`).get(...da).n;
  const vial = prep(`
    SELECT COUNT(*) tramos, ROUND(SUM(CAST(json_extract(campos,'$.longitud_km') AS REAL)),1) km
    FROM registros WHERE dominio='vial' ${dw}
  `).get(...da);

  // PIB: serie anual (precios corrientes, todas las actividades) — datos del gráfico
  const pibSerie = prep(`
    SELECT json_extract(campos,'$.anio') anio,
           ROUND(SUM(CAST(json_extract(campos,'$.valor_miles_millones') AS REAL)),1) valor
    FROM registros
    WHERE dominio='economia' AND json_extract(campos,'$.tipo_precios') LIKE 'PIB a precios corrientes%' ${dw}
    GROUP BY anio ORDER BY anio
  `).all(...da);
  const pibUltimo = pibSerie.at(-1) ?? null;

  const out = {
    depto,
    municipios,
    vial_tramos: vial.tramos,
    vial_km: vial.km ?? 0,
    pib_ultimo: pibUltimo,
    pib_serie: pibSerie,
    registros_total: prep(`SELECT COUNT(*) n FROM registros WHERE 1=1 ${dw}`).get(...da).n,
  };
  kpiCache.set(key, out);
  return out;
}

function handleRegistros(qp) {
  const { clause, args } = buildWhere(qp);
  const format = (qp.get("format") || "json").toLowerCase();
  let limit = Math.min(parseInt(qp.get("limit"), 10) || 50, 5000);
  let offset = Math.max(parseInt(qp.get("offset"), 10) || 0, 0);

  const total = prep(`SELECT COUNT(*) c FROM registros ${clause}`).get(...args).c;

  if (format === "geojson") {
    const geoClause = clause ? `${clause} AND geom IS NOT NULL` : "WHERE geom IS NOT NULL";
    const rows = prep(`
      SELECT id_interno, dominio, fuente, fuente_url, divipola_muni, divipola_depto, fecha_ingesta, campos, geom
      FROM registros ${geoClause} LIMIT ?
    `).all(...args, limit);
    const features = rows.map((r) => {
      const p = parseRow(r, { withGeom: true });
      const geom = p.geom; delete p.geom;
      return { type: "Feature", geometry: geom, properties: { ...p.campos, id_interno: p.id_interno, dominio: p.dominio, fuente: p.fuente, fuente_url: p.fuente_url, divipola_muni: p.divipola_muni, divipola_depto: p.divipola_depto } };
    });
    return { json: { type: "FeatureCollection", features, properties: { returned: features.length, total } } };
  }

  const rows = prep(`
    SELECT id_interno, dominio, fuente, fuente_url, divipola_muni, divipola_depto, fecha_ingesta, campos
    FROM registros ${clause} ORDER BY id_interno LIMIT ? OFFSET ?
  `).all(...args, limit, offset);
  const items = rows.map((r) => parseRow(r));

  if (format === "csv") {
    const flat = items.map((it) => ({ id_interno: it.id_interno, dominio: it.dominio, divipola_muni: it.divipola_muni, divipola_depto: it.divipola_depto, fuente: it.fuente, ...it.campos }));
    return { csv: toCsv(flat), total };
  }
  return { json: { total, limit, offset, items } };
}

function handleRegistroById(id) {
  const r = prep("SELECT * FROM registros WHERE id_interno=?").get(id);
  if (!r) return null;
  return {
    ...parseRow(r, { withGeom: true }),
    conector: r.conector,
    version_dataset: r.version_dataset,
    hash: r.hash,
    transformaciones: JSON.parse(r.transformaciones || "[]"),
    extra: JSON.parse(r.extra || "{}"),
  };
}

function handleSearch(qp) {
  const q = normName(qp.get("q") || "").toLowerCase();
  if (!q) return [];
  const depto = qp.get("depto") && /^\d{2}$/.test(qp.get("depto")) ? qp.get("depto") : null;
  const dw = depto ? "AND divipola_depto = ?" : "";
  const da = depto ? [depto] : [];
  const rows = prep(`
    SELECT id_interno, dominio, campos, divipola_depto, geom IS NOT NULL con_geom
    FROM registros WHERE search_blob LIKE ? ${dw} LIMIT 12
  `).all(`%${q}%`, ...da);
  return rows.map((r) => {
    const c = JSON.parse(r.campos);
    return {
      id_interno: r.id_interno,
      dominio: r.dominio,
      label: c.nom_mpio || c.nombre_tramo || `${c.actividad ?? ""} ${c.departamento ?? ""} ${c.anio ?? ""}`.trim() || r.id_interno,
      con_geom: !!r.con_geom,
    };
  });
}

function toCsv(items) {
  if (!items.length) return "";
  const cols = [...new Set(items.flatMap((it) => Object.keys(it)))];
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return cols.join(",") + "\n" + items.map((it) => cols.map((c) => esc(it[c])).join(",")).join("\n");
}

// ---------------------------------------------------------------------------
// HTTP (gzip + cache headers, patrón del piloto)
// ---------------------------------------------------------------------------
function send(req, res, status, body, contentType, extraHeaders = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const headers = { "Content-Type": contentType, "Access-Control-Allow-Origin": "*", ...extraHeaders };
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
  send(req, res, status, JSON.stringify(obj), "application/json; charset=utf-8", { "Cache-Control": `public, max-age=${cache}` });
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
async function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = join(WEB_DIR, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(WEB_DIR)) return send(req, res, 403, "Forbidden", "text/plain");
  try {
    send(req, res, 200, await readFile(file), MIME[extname(file)] || "application/octet-stream", { "Cache-Control": "public, max-age=60" });
  } catch {
    send(req, res, 404, "Not Found", "text/plain");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const qp = url.searchParams;

    if (path === "/api/health") {
      const m = handleMeta();
      return sendJson(req, res, { ok: true, dominios: m.dominios }, { cache: 0 });
    }
    if (path === "/api/meta") return sendJson(req, res, handleMeta(), { cache: 600 });
    if (path === "/api/kpi") return sendJson(req, res, handleKpi(qp));
    if (path === "/api/search") return sendJson(req, res, handleSearch(qp), { cache: 60 });

    if (path.startsWith("/api/registros/")) {
      const rec = handleRegistroById(decodeURIComponent(path.slice("/api/registros/".length)));
      if (!rec) return sendJson(req, res, { error: "no encontrado" }, { status: 404, cache: 0 });
      return sendJson(req, res, rec);
    }
    if (path === "/api/registros") {
      const out = handleRegistros(qp);
      if (out.csv !== undefined) {
        return send(req, res, 200, out.csv, "text/csv; charset=utf-8", {
          "Content-Disposition": 'attachment; filename="registros_osint.csv"',
          "Cache-Control": "no-store",
        });
      }
      return sendJson(req, res, out.json);
    }
    if (path.startsWith("/api/")) return sendJson(req, res, { error: "ruta no encontrada" }, { status: 404, cache: 0 });

    return serveStatic(req, res, path);
  } catch (err) {
    console.error("ERR", req.url, err);
    sendJson(req, res, { error: "error interno", detail: String(err.message) }, { status: 500, cache: 0 });
  }
});

server.listen(PORT, () => {
  const m = handleMeta();
  console.log(`Operación Colombia — panel OSINT -> http://localhost:${PORT}`);
  console.log(`  dominios: ${m.dominios.map((d) => `${d.dominio}=${d.n}`).join(" · ")}`);
});
