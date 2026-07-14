// M9 — Read API (CQRS lado lectura) + estáticos del panel M10 + caché M15.
// Cero dependencias: node:http + node:sqlite + node:zlib. Nunca toca la fuente oficial.
// Query router: KPIs leen read models rm_* (M8), search va al índice FTS (M7);
// el write store solo se toca para listados/by-id con índice, nunca SELECT *.
// Caché M15: respuestas clavadas a la versión de datos (etl_runs + read_models),
// ETag/If-None-Match → 304; invalidación por versión, no TTL ciego.
import http from "node:http";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { openOsintDb } from "../../packages/metadata/registry.js";
import { normName } from "../../packages/core-model/index.js";
import { migrateViews, buildViews } from "../../services/views-builder/index.js";
import { migrateSearch, searchQuery } from "../../services/search-indexer/index.js";
import { migrateGeo, buildGeoIndex } from "../../services/geo-indexer/index.js";
import {
  migrateExplorer, searchCatalog, previewDataset, profileDataset,
  registerSource, listExplorerSources,
} from "../../services/socrata-explorer/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, "..", "web");

export function createApp(db, { webDir = WEB_DIR } = {}) {
  migrateViews(db);
  migrateSearch(db);
  migrateGeo(db);
  migrateExplorer(db);
  buildGeoIndex(db); // incremental: solo geoms nuevos/cambiados desde el último build
  // read models faltantes (DB nueva) se construyen una vez al arrancar
  if (!db.prepare("SELECT COUNT(*) c FROM read_models").get().c) {
    try { buildViews(db); } catch { /* sin registros aún: vistas vacías luego */ }
  }

  const stmtCache = new Map();
  function prep(sql) {
    let s = stmtCache.get(sql);
    if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); }
    return s;
  }

  // -------------------------------------------------------------------------
  // M15 — versión de datos: cambia con cada ingesta o rebuild de vista.
  // Toda respuesta cacheable se clava a esta versión (ETag + caché en memoria).
  // -------------------------------------------------------------------------
  function dataVersion() {
    const runs = prep("SELECT COALESCE(MAX(run_id),0) v FROM etl_runs").get().v;
    const views = prep("SELECT COALESCE(SUM(version),0) v FROM read_models").get().v;
    return `${runs}.${views}`;
  }

  let cacheVer = null;
  const respCache = new Map(); // url → body serializado (válido solo para cacheVer)
  function cached(url, produce) {
    const ver = dataVersion();
    if (ver !== cacheVer) { respCache.clear(); cacheVer = ver; }
    let body = respCache.get(url);
    if (body === undefined) {
      body = JSON.stringify(produce());
      respCache.set(url, body);
    }
    return { body, etag: `"${ver}-${createHash("sha256").update(url).digest("hex").slice(0, 12)}"` };
  }

  // -------------------------------------------------------------------------
  // filtros comunes: dominio, depto, muni, q → WHERE parametrizado
  // -------------------------------------------------------------------------
  // dominios existentes en el write store; un dominio nuevo entra al reiniciar tras su ingesta
  const DOMINIOS = new Set(db.prepare("SELECT DISTINCT dominio FROM registros").all().map((r) => r.dominio));

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
    return { clause: where.length ? "WHERE " + where.join(" AND ") : "", args, filtros: { dominio, depto, muni } };
  }

  // bbox=minLon,minLat,maxLon,maxLat → [n,n,n,n] validado, o null (se ignora)
  function parseBbox(raw) {
    if (!raw) return null;
    const b = raw.split(",").map(Number);
    if (b.length !== 4 || b.some((n) => !Number.isFinite(n))) return null;
    const [minLon, minLat, maxLon, maxLat] = b;
    if (minLon >= maxLon || minLat >= maxLat) return null;
    if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return null;
    return b;
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

  // -------------------------------------------------------------------------
  // handlers
  // -------------------------------------------------------------------------
  function handleMeta() {
    return {
      version_datos: dataVersion(),
      dominios: prep("SELECT dominio, registros n FROM rm_resumen_dominio ORDER BY n DESC").all(),
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
  }

  // KPIs: query router → read models rm_* (M8); nunca agrega sobre registros crudos
  function handleKpi(qp) {
    const depto = qp.get("depto") && /^\d{2}$/.test(qp.get("depto")) ? qp.get("depto") : null;
    const dw = depto ? "WHERE cod_dpto = ?" : "";
    const da = depto ? [depto] : [];

    const municipios = prep(
      `SELECT COALESCE(SUM(registros),0) n FROM rm_registros_depto WHERE dominio='territorio' ${depto ? "AND cod_dpto=?" : ""}`
    ).get(...da).n;
    const vial = prep(
      `SELECT COALESCE(SUM(tramos),0) tramos, ROUND(COALESCE(SUM(km_total),0),1) km FROM rm_vial_depto ${dw}`
    ).get(...da);
    const agro = prep(
      `SELECT COALESCE(SUM(produccion_t),0) produccion_t, COALESCE(SUM(area_sembrada_ha),0) area_ha, MAX(anio) anio
       FROM rm_agro_depto ${dw}`
    ).get(...da);
    const pibSerie = prep(`
      SELECT anio, ROUND(SUM(pib_miles_millones),1) valor FROM rm_pib_depto_anio
      WHERE tipo_precios LIKE 'PIB a precios corrientes%' ${depto ? "AND cod_dpto=?" : ""}
      GROUP BY anio ORDER BY anio
    `).all(...da);
    const registrosTotal = depto
      ? prep("SELECT COALESCE(SUM(registros),0) n FROM rm_registros_depto WHERE cod_dpto=?").get(depto).n
      : prep("SELECT COALESCE(SUM(registros),0) n FROM rm_resumen_dominio").get().n;
    const contratos = prep(
      `SELECT COALESCE(SUM(contratos),0) contratos, COALESCE(SUM(valor_total),0) valor_total FROM rm_contratos_depto ${dw}`
    ).get(...da);
    const topLimit = Math.min(parseInt(qp.get("top"), 10) || 5, 100);
    const topProveedores = prep(`
      SELECT proveedor, SUM(contratos) contratos, SUM(valor_total) valor_total
      FROM rm_top_proveedores_depto ${dw}
      GROUP BY proveedor ORDER BY valor_total DESC LIMIT ?
    `).all(...da, topLimit);
    const entidadesTotal = prep(`SELECT COALESCE(SUM(entidades),0) n FROM rm_entidades_depto ${dw}`).get(...da).n;

    return {
      depto,
      municipios,
      vial_tramos: vial.tramos,
      vial_km: vial.km ?? 0,
      agro_produccion_t: Math.round(agro.produccion_t),
      agro_area_ha: Math.round(agro.area_ha),
      agro_anio: agro.anio ?? null,
      pib_ultimo: pibSerie.at(-1) ?? null,
      pib_serie: pibSerie,
      registros_total: registrosTotal,
      contratos_total: contratos.contratos,
      contratos_valor_total: contratos.valor_total,
      top_proveedores: topProveedores,
      entidades_total: entidadesTotal,
    };
  }

  // listado: paginación por CURSOR (id_interno, índice PK — no offset profundo)
  function handleRegistros(qp) {
    const { clause, args } = buildWhere(qp);
    const format = (qp.get("format") || "json").toLowerCase();
    const limit = Math.min(parseInt(qp.get("limit"), 10) || 50, 5000);

    const total = prep(`SELECT COUNT(*) c FROM registros ${clause}`).get(...args).c;

    if (format === "geojson") {
      let geoClause = clause ? `${clause} AND geom IS NOT NULL` : "WHERE geom IS NOT NULL";
      let geoArgs = args;
      // carga por bbox (M10): intersección contra bbox precalculado (geo-indexer),
      // nunca parseando GeoJSON en caliente
      const bbox = parseBbox(qp.get("bbox"));
      if (bbox) {
        geoClause += ` AND id_interno IN (
          SELECT id_interno FROM geo_bbox
          WHERE min_lon <= ? AND max_lon >= ? AND min_lat <= ? AND max_lat >= ?
        )`;
        geoArgs = [...args, bbox[2], bbox[0], bbox[3], bbox[1]];
      }
      const rows = prep(`
        SELECT id_interno, dominio, fuente, fuente_url, divipola_muni, divipola_depto, fecha_ingesta, campos, geom
        FROM registros ${geoClause} LIMIT ?
      `).all(...geoArgs, limit);
      const features = rows.map((r) => {
        const p = parseRow(r, { withGeom: true });
        const geom = p.geom; delete p.geom;
        return { type: "Feature", geometry: geom, properties: { ...p.campos, id_interno: p.id_interno, dominio: p.dominio, fuente: p.fuente, fuente_url: p.fuente_url, divipola_muni: p.divipola_muni, divipola_depto: p.divipola_depto } };
      });
      return { json: { type: "FeatureCollection", features, properties: { returned: features.length, total } } };
    }

    const cursor = qp.get("cursor");
    const cursorClause = cursor
      ? (clause ? `${clause} AND id_interno > ?` : "WHERE id_interno > ?")
      : clause;
    const cursorArgs = cursor ? [...args, cursor] : args;
    // offset solo para compat superficial (paginador del panel); capado
    const offset = cursor ? 0 : Math.min(Math.max(parseInt(qp.get("offset"), 10) || 0, 0), 100_000);

    const rows = prep(`
      SELECT id_interno, dominio, fuente, fuente_url, divipola_muni, divipola_depto, fecha_ingesta, campos
      FROM registros ${cursorClause} ORDER BY id_interno LIMIT ? OFFSET ?
    `).all(...cursorArgs, limit, offset);
    const items = rows.map((r) => parseRow(r));
    const nextCursor = items.length === limit ? items.at(-1).id_interno : null;

    if (format === "csv") {
      const flat = items.map((it) => ({ id_interno: it.id_interno, dominio: it.dominio, divipola_muni: it.divipola_muni, divipola_depto: it.divipola_depto, fuente: it.fuente, ...it.campos }));
      return { csv: toCsv(flat), total };
    }
    return { json: { total, limit, offset, next_cursor: nextCursor, items } };
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

  // search: query router → índice FTS (M7); fallback LIKE si el índice está vacío
  function handleSearch(qp) {
    const q = qp.get("q") || "";
    if (!q.trim()) return { hits: [], facetas: { dominio: [], depto: [] }, total: 0 };
    const depto = qp.get("depto") && /^\d{2}$/.test(qp.get("depto")) ? qp.get("depto") : null;
    const dominio = qp.get("dominio") && DOMINIOS.has(qp.get("dominio")) ? qp.get("dominio") : null;
    const limit = Math.min(parseInt(qp.get("limit"), 10) || 12, 100);

    const indexado = prep("SELECT COUNT(*) c FROM search_indexed").get().c;
    if (indexado > 0) {
      const out = searchQuery(db, { q, dominio, depto, limit });
      const conGeom = prep("SELECT geom IS NOT NULL g FROM registros WHERE id_interno=?");
      out.hits = out.hits.map((h) => ({ ...h, con_geom: !!conGeom.get(h.id_interno)?.g }));
      return out;
    }
    // fallback (índice aún no construido): LIKE sobre search_blob
    const nq = normName(q).toLowerCase();
    const dw = [depto ? "AND divipola_depto=?" : "", dominio ? "AND dominio=?" : ""].join(" ");
    const da = [depto, dominio].filter(Boolean);
    const rows = prep(`
      SELECT id_interno, dominio, campos, divipola_depto depto, geom IS NOT NULL con_geom
      FROM registros WHERE search_blob LIKE ? ${dw} LIMIT ?
    `).all(`%${nq}%`, ...da, limit);
    const hits = rows.map((r) => {
      const c = JSON.parse(r.campos);
      return {
        id_interno: r.id_interno,
        dominio: r.dominio,
        depto: r.depto,
        label: c.nom_mpio || c.nombre_tramo || `${c.actividad ?? ""} ${c.departamento ?? ""} ${c.anio ?? ""}`.trim() || r.id_interno,
        con_geom: !!r.con_geom,
      };
    });
    return { hits, facetas: { dominio: [], depto: [] }, total: hits.length };
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

  // -------------------------------------------------------------------------
  // HTTP: gzip + ETag/304 + Cache-Control clavado a versión de datos (M15)
  // -------------------------------------------------------------------------
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

  /** JSON cacheable: caché en memoria por versión + ETag; If-None-Match → 304. */
  function sendCachedJson(req, res, url, produce, { maxAge = 60 } = {}) {
    const { body, etag } = cached(url, produce);
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag, "Cache-Control": `public, max-age=${maxAge}` });
      return res.end();
    }
    send(req, res, 200, body, "application/json; charset=utf-8", {
      ETag: etag,
      "Cache-Control": `public, max-age=${maxAge}`,
    });
  }
  function sendJson(req, res, obj, { status = 200, cache = 0 } = {}) {
    send(req, res, status, JSON.stringify(obj), "application/json; charset=utf-8",
      { "Cache-Control": cache ? `public, max-age=${cache}` : "no-store" });
  }

  async function readJsonBody(req, { max = 1_000_000 } = {}) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > max) throw new Error("cuerpo demasiado grande");
      chunks.push(chunk);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
  }

  const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
  async function serveStatic(req, res, pathname) {
    const rel = pathname === "/" ? "/index.html" : pathname;
    const file = join(webDir, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(webDir)) return send(req, res, 403, "Forbidden", "text/plain");
    try {
      send(req, res, 200, await readFile(file), MIME[extname(file)] || "application/octet-stream", { "Cache-Control": "public, max-age=60" });
    } catch {
      send(req, res, 404, "Not Found", "text/plain");
    }
  }

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      const qp = url.searchParams;
      const cacheKey = path + url.search;

      if (path === "/api/health") {
        return sendJson(req, res, { ok: true, version_datos: dataVersion() });
      }
      if (path === "/api/meta") return sendCachedJson(req, res, cacheKey, () => handleMeta(), { maxAge: 300 });
      if (path === "/api/kpi") return sendCachedJson(req, res, cacheKey, () => handleKpi(qp), { maxAge: 300 });
      if (path === "/api/search") return sendCachedJson(req, res, cacheKey, () => handleSearch(qp), { maxAge: 60 });

      // M11 — Socrata Explorer: llamadas en vivo al catálogo externo, sin caché por versión
      // de datos (no son datos ingeridos todavía). Errores de red → 502, no 500.
      if (path === "/api/explorer/search") {
        try {
          const results = await searchCatalog({
            q: qp.get("q") || undefined, category: qp.get("category") || undefined,
            domain: qp.get("domain") || undefined, limit: qp.get("limit") ? Number(qp.get("limit")) : undefined,
          });
          return sendJson(req, res, { results });
        } catch (e) { return sendJson(req, res, { error: "catálogo no disponible", detail: String(e.message) }, { status: 502 }); }
      }
      if (path === "/api/explorer/preview") {
        if (!qp.get("id")) return sendJson(req, res, { error: "falta ?id=" }, { status: 400 });
        try {
          const out = await previewDataset(qp.get("id"), { domain: qp.get("domain") || undefined, sample: qp.get("sample") ? Number(qp.get("sample")) : undefined });
          return sendJson(req, res, out);
        } catch (e) { return sendJson(req, res, { error: "dataset no disponible", detail: String(e.message) }, { status: 502 }); }
      }
      if (path === "/api/explorer/profile") {
        if (!qp.get("id")) return sendJson(req, res, { error: "falta ?id=" }, { status: 400 });
        try {
          const out = await profileDataset(qp.get("id"), { domain: qp.get("domain") || undefined, sample: qp.get("sample") ? Number(qp.get("sample")) : undefined });
          return sendJson(req, res, out);
        } catch (e) { return sendJson(req, res, { error: "dataset no disponible", detail: String(e.message) }, { status: 502 }); }
      }
      if (path === "/api/explorer/sources") {
        const registradas = listExplorerSources(db).map((s) => ({ id: s.id, nombre: s.nombre, domain: s.domain, priority: s.priority, schedule: s.schedule }));
        const meta = db.prepare("SELECT source_id, filas, estado, last_checked FROM dataset_meta").all();
        const metaById = Object.fromEntries(meta.map((m) => [m.source_id, m]));
        return sendJson(req, res, { fuentes: registradas.map((s) => ({ ...s, ingesta: metaById[s.id] ?? null })) });
      }
      if (path === "/api/explorer/register" && req.method === "POST") {
        try {
          const body = await readJsonBody(req);
          const cfg = registerSource(db, body);
          return sendJson(req, res, { ok: true, fuente: { id: cfg.id, nombre: cfg.nombre, domain: cfg.domain, schedule: cfg.schedule } }, { status: 201 });
        } catch (e) { return sendJson(req, res, { error: "registro inválido", detail: String(e.message) }, { status: 400 }); }
      }

      if (path.startsWith("/api/registros/")) {
        const rec = handleRegistroById(decodeURIComponent(path.slice("/api/registros/".length)));
        if (!rec) return sendJson(req, res, { error: "no encontrado" }, { status: 404 });
        return sendCachedJson(req, res, cacheKey, () => rec, { maxAge: 300 });
      }
      if (path === "/api/registros") {
        const format = (qp.get("format") || "json").toLowerCase();
        if (format === "csv") {
          const out = handleRegistros(qp);
          return send(req, res, 200, out.csv, "text/csv; charset=utf-8", {
            "Content-Disposition": 'attachment; filename="registros_osint.csv"',
            "Cache-Control": "no-store",
          });
        }
        return sendCachedJson(req, res, cacheKey, () => handleRegistros(qp).json, { maxAge: 120 });
      }
      if (path.startsWith("/api/")) return sendJson(req, res, { error: "ruta no encontrada" }, { status: 404 });

      return serveStatic(req, res, path);
    } catch (err) {
      console.error("ERR", req.url, err);
      sendJson(req, res, { error: "error interno", detail: String(err.message) }, { status: 500 });
    }
  };
}

// arranque directo: node apps/api/server.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openOsintDb();
  const PORT = process.env.PORT || 8081;
  const HOST = process.env.HOST || "0.0.0.0";
  http.createServer(createApp(db)).listen(PORT, HOST, () => {
    const url = HOST === "0.0.0.0" ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
    console.log(`Operación Colombia — panel OSINT -> ${url} (escuchando en ${HOST}:${PORT})`);
  });
}
