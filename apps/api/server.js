// M9 — Read API (CQRS lado lectura) + estáticos del panel M10 + caché M15.
// Cero dependencias: node:http + node:sqlite + node:zlib. Nunca toca la fuente oficial.
// Query router: KPIs leen read models rm_* (M8), search va al índice FTS (M7);
// el write store solo se toca para listados/by-id con índice, nunca SELECT *.
// Caché M15: respuestas clavadas a la versión de datos (etl_runs + read_models),
// ETag/If-None-Match → 304; invalidación por versión, no TTL ciego.
import http from "node:http";
import { gzipSync } from "node:zlib";
import { createHash, timingSafeEqual } from "node:crypto";
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
import { Metrics, budgetReport, createLogger } from "../../packages/observability/index.js";
import { migrateGraph, vecinos, concentracion, graphStats } from "../../services/graph/index.js";
import { ask } from "../../services/ai/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, "..", "web");
// Panel nuevo (Vite). dist/ no se versiona: se construye en el servidor.
const NEXT_DIR = join(__dirname, "..", "web-next", "dist");

export function createApp(db, { webDir = WEB_DIR } = {}) {
  migrateViews(db);
  migrateSearch(db);
  migrateGeo(db);
  migrateExplorer(db);
  migrateGraph(db);
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
    let hit = false;
    const ver = dataVersion();
    if (ver !== cacheVer) { respCache.clear(); cacheVer = ver; }
    let body = respCache.get(url);
    if (body === undefined) {
      body = JSON.stringify(produce());
      respCache.set(url, body);
    } else {
      hit = true;
    }
    return { body, hit, etag: `"${ver}-${createHash("sha256").update(url).digest("hex").slice(0, 12)}"` };
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

  // -------------------------------------------------------------------------
  // Entidades (M6). El grafo ya las consume por id, pero no había forma de
  // listarlas ni de abrir una: es el objeto sobre el que se investiga.
  // Todo lo que se devuelve sale de entidad_registros → registros; nada se
  // infiere ni se puntúa.
  // -------------------------------------------------------------------------
  const TIPOS_ENTIDAD = new Set(["Empresa", "EntidadPublica", "Contrato", "Municipio", "Departamento", "TramoVial"]);

  /** Departamentos donde la entidad tiene registros, ordenados por volumen. */
  function territoriosDe(ids) {
    if (!ids.length) return new Map();
    const marks = ids.map(() => "?").join(",");
    const rows = prep(`
      SELECT er.id_entidad, r.divipola_depto cod,
             (SELECT dpto FROM divipola d WHERE d.cod_dpto=r.divipola_depto LIMIT 1) nombre,
             COUNT(*) n
      FROM entidad_registros er JOIN registros r ON r.id_interno = er.id_interno
      WHERE er.id_entidad IN (${marks}) AND r.divipola_depto IS NOT NULL
      GROUP BY er.id_entidad, r.divipola_depto ORDER BY n DESC
    `).all(...ids);
    const out = new Map();
    for (const r of rows) {
      if (!out.has(r.id_entidad)) out.set(r.id_entidad, []);
      out.get(r.id_entidad).push({ cod: r.cod, nombre: r.nombre, registros: r.n });
    }
    return out;
  }

  function handleEntidades(qp) {
    const tipo = TIPOS_ENTIDAD.has(qp.get("tipo")) ? qp.get("tipo") : null;
    const depto = /^\d{2}$/.test(qp.get("depto") || "") ? qp.get("depto") : null;
    const dominio = DOMINIOS.has(qp.get("dominio")) ? qp.get("dominio") : null;
    const q = (qp.get("q") || "").trim();
    const limit = Math.min(parseInt(qp.get("limit"), 10) || 50, 500);
    const offset = Math.min(Math.max(parseInt(qp.get("offset"), 10) || 0, 0), 100_000);

    const where = ["1=1"], args = [];
    if (tipo) { where.push("e.tipo = ?"); args.push(tipo); }
    if (q) { where.push("e.nombre_norm LIKE ?"); args.push(`%${normName(q)}%`); }
    if (depto) { where.push("r.divipola_depto = ?"); args.push(depto); }
    if (dominio) { where.push("r.dominio = ?"); args.push(dominio); }
    const clause = where.join(" AND ");

    const total = prep(`
      SELECT COUNT(*) c FROM (
        SELECT e.id_entidad FROM entidades e
        JOIN entidad_registros er ON er.id_entidad = e.id_entidad
        JOIN registros r ON r.id_interno = er.id_interno
        WHERE ${clause} GROUP BY e.id_entidad)
    `).get(...args).c;

    const items = prep(`
      SELECT e.id_entidad, e.tipo, e.nombre_canonico, e.clave_tipo, e.clave_valor,
             COUNT(DISTINCT er.id_interno) registros,
             COUNT(DISTINCT r.fuente)      fuentes,
             COUNT(DISTINCT r.dominio)     dominios,
             MAX(r.fecha_ingesta)          ultima_ingesta
      FROM entidades e
      JOIN entidad_registros er ON er.id_entidad = e.id_entidad
      JOIN registros r ON r.id_interno = er.id_interno
      WHERE ${clause}
      GROUP BY e.id_entidad
      ORDER BY registros DESC, e.nombre_canonico
      LIMIT ? OFFSET ?
    `).all(...args, limit, offset);

    // Faceta por tipo: mismo criterio que las de /api/search — se aplica todo el
    // filtro MENOS el propio, para que la faceta muestre a dónde se puede ir.
    const whereSinTipo = ["1=1"], argsSinTipo = [];
    if (q) { whereSinTipo.push("e.nombre_norm LIKE ?"); argsSinTipo.push(`%${normName(q)}%`); }
    if (depto) { whereSinTipo.push("r.divipola_depto = ?"); argsSinTipo.push(depto); }
    if (dominio) { whereSinTipo.push("r.dominio = ?"); argsSinTipo.push(dominio); }
    const porTipo = prep(`
      SELECT tipo, COUNT(*) n FROM (
        SELECT e.tipo FROM entidades e
        JOIN entidad_registros er ON er.id_entidad = e.id_entidad
        JOIN registros r ON r.id_interno = er.id_interno
        WHERE ${whereSinTipo.join(" AND ")} GROUP BY e.id_entidad, e.tipo)
      GROUP BY tipo ORDER BY n DESC
    `).all(...argsSinTipo);

    const terr = territoriosDe(items.map((i) => i.id_entidad));
    return {
      total, limit, offset,
      filtros: { tipo, depto, dominio, q: q || null },
      facetas: { tipo: porTipo },
      items: items.map((i) => ({ ...i, territorios: terr.get(i.id_entidad) ?? [] })),
    };
  }

  function handleEntidadById(id) {
    const e = prep("SELECT * FROM entidades WHERE id_entidad=?").get(id);
    if (!e) return null;

    // procedencia de la resolución: con qué método y confianza se ligó cada registro (M6)
    const vinculos = prep(`
      SELECT metodo, ROUND(AVG(confianza), 2) confianza, COUNT(*) n
      FROM entidad_registros WHERE id_entidad=? GROUP BY metodo ORDER BY n DESC
    `).all(id);

    const fuentes = prep(`
      SELECT r.fuente, r.fuente_url, r.dominio, COUNT(*) registros, MAX(r.fecha_ingesta) ultima_ingesta
      FROM entidad_registros er JOIN registros r ON r.id_interno = er.id_interno
      WHERE er.id_entidad=? GROUP BY r.fuente, r.dominio ORDER BY registros DESC
    `).all(id);

    const relaciones = prep(`
      SELECT a.tipo, a.peso, a.muestra,
             CASE WHEN a.src=? THEN a.dst ELSE a.src END otro_id,
             o.tipo otro_tipo, o.nombre_canonico otro_nombre
      FROM grafo_aristas a
      JOIN entidades o ON o.id_entidad = CASE WHEN a.src=? THEN a.dst ELSE a.src END
      WHERE a.src=? OR a.dst=?
      ORDER BY a.peso DESC LIMIT 200
    `).all(id, id, id, id);

    return {
      id_entidad: e.id_entidad,
      tipo: e.tipo,
      nombre: e.nombre_canonico,
      clave: { tipo: e.clave_tipo, valor: e.clave_valor },
      atributos: JSON.parse(e.atributos || "{}"),
      creado_en: e.creado_en,
      alias: prep("SELECT alias_norm, origen FROM entidad_alias WHERE id_entidad=?").all(id),
      territorios: territoriosDe([id]).get(id) ?? [],
      fuentes,
      vinculos,
      relaciones,
      registros_total: prep("SELECT COUNT(*) c FROM entidad_registros WHERE id_entidad=?").get(id).c,
    };
  }

  /** Registros que respaldan a la entidad: la evidencia, paginada. */
  function handleEntidadRegistros(id, qp) {
    const limit = Math.min(parseInt(qp.get("limit"), 10) || 25, 500);
    const offset = Math.min(Math.max(parseInt(qp.get("offset"), 10) || 0, 0), 100_000);
    const total = prep("SELECT COUNT(*) c FROM entidad_registros WHERE id_entidad=?").get(id).c;
    const rows = prep(`
      SELECT r.id_interno, r.dominio, r.fuente, r.fuente_url, r.divipola_muni, r.divipola_depto,
             r.fecha_ingesta, r.campos, er.metodo, er.confianza
      FROM entidad_registros er JOIN registros r ON r.id_interno = er.id_interno
      WHERE er.id_entidad=? ORDER BY r.fecha_ingesta DESC, r.id_interno
      LIMIT ? OFFSET ?
    `).all(id, limit, offset);
    return {
      total, limit, offset,
      items: rows.map((r) => ({ ...parseRow(r), metodo: r.metodo, confianza: r.confianza })),
    };
  }

  // -------------------------------------------------------------------------
  // Agregados de contratación para la vista de análisis. Salen de los read
  // models (M8), que ya excluyen duplicados SECOP vía contrato_dedupe; el flujo
  // entidad→proveedor no tiene vista propia y se agrega acá con el mismo criterio.
  // Nada se estima: si un contrato no trae valor, no suma.
  // -------------------------------------------------------------------------
  function handleContratacionAgregados(qp) {
    const depto = /^\d{2}$/.test(qp.get("depto") || "") ? qp.get("depto") : null;
    const topProv = Math.min(parseInt(qp.get("proveedores"), 10) || 20, 200);
    const topFlujo = Math.min(parseInt(qp.get("flujos"), 10) || 40, 300);
    const dw = depto ? "WHERE cod_dpto = ?" : "";
    const da = depto ? [depto] : [];

    const nombreDepto = `(SELECT dpto FROM divipola d WHERE d.cod_dpto = t.cod_dpto LIMIT 1)`;

    // depto × año: alimenta el mapa de calor temporal
    const porDeptoAnio = prep(`
      SELECT t.cod_dpto, ${nombreDepto} departamento, t.anio,
             SUM(t.contratos) contratos, SUM(t.valor_total) valor_total
      FROM rm_contratos_depto t ${dw}
      GROUP BY t.cod_dpto, t.anio
      HAVING t.cod_dpto IS NOT NULL
      ORDER BY valor_total DESC
    `).all(...da);

    // depto → proveedor: alimenta el treemap jerárquico
    const porProveedor = prep(`
      SELECT t.cod_dpto, ${nombreDepto} departamento, t.proveedor,
             SUM(t.contratos) contratos, SUM(t.valor_total) valor_total
      FROM rm_top_proveedores_depto t ${dw}
      GROUP BY t.cod_dpto, t.proveedor
      ORDER BY valor_total DESC LIMIT ?
    `).all(...da, topProv);

    // entidad → proveedor: alimenta el Sankey. Sin read model propio, se agrega
    // igual que las vistas: solo la fila preferida de cada contrato.
    const flujo = prep(`
      SELECT json_extract(r.campos,'$.entidad')   entidad,
             json_extract(r.campos,'$.proveedor') proveedor,
             COUNT(*) contratos,
             ROUND(SUM(json_extract(r.campos,'$.valor_contrato')), 0) valor_total
      FROM registros r
      LEFT JOIN contrato_dedupe d ON d.id_interno = r.id_interno
      WHERE r.dominio='contratacion' AND COALESCE(d.preferida, 1) = 1
        AND json_extract(r.campos,'$.entidad') IS NOT NULL
        AND json_extract(r.campos,'$.proveedor') IS NOT NULL
        ${depto ? "AND r.divipola_depto = ?" : ""}
      GROUP BY entidad, proveedor
      ORDER BY valor_total DESC LIMIT ?
    `).all(...da, topFlujo);

    const totales = prep(`
      SELECT COALESCE(SUM(contratos),0) contratos, COALESCE(SUM(valor_total),0) valor_total
      FROM rm_contratos_depto ${depto ? "WHERE cod_dpto = ?" : ""}
    `).get(...da);

    return {
      depto,
      totales,
      anios: [...new Set(porDeptoAnio.map((r) => r.anio).filter((a) => a != null))].sort(),
      por_depto_anio: porDeptoAnio,
      por_proveedor: porProveedor,
      flujo_entidad_proveedor: flujo,
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
    const { body, hit, etag } = cached(url, produce);
    if (hit) res.cacheHit = true; // leído por el wrapper de métricas (M14)
    if (req.headers["if-none-match"] === etag) {
      res.cacheHit = true; // 304: el cliente ya tiene la versión vigente
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

  /**
   * Autorización de escritura (PLANNING §5.3). `register` alimenta el scheduler del ETL,
   * así que no puede quedar abierto: exige `X-Admin-Token` == EXPLORER_ADMIN_TOKEN.
   * Falla cerrado — sin token configurado, nadie escribe.
   */
  function authorizeWrite(req, res) {
    const esperado = process.env.EXPLORER_ADMIN_TOKEN || "";
    if (!esperado) {
      sendJson(req, res, { error: "escritura deshabilitada", detail: "EXPLORER_ADMIN_TOKEN no configurado en el servidor" }, { status: 503 });
      return false;
    }
    const dado = req.headers["x-admin-token"];
    const ok = typeof dado === "string" && dado.length === esperado.length
      && timingSafeEqual(Buffer.from(dado), Buffer.from(esperado));
    if (!ok) {
      log.warn("escritura rechazada", { url: req.url, ip: req.socket.remoteAddress });
      sendJson(req, res, { error: "no autorizado" }, { status: 401 });
      return false;
    }
    return true;
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

  const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".map": "application/json; charset=utf-8" };
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

  // -------------------------------------------------------------------------
  // Panel nuevo (apps/web-next) montado en /next mientras convive con el actual.
  // Es una SPA: cualquier ruta que no sea archivo devuelve index.html para que el
  // router del cliente resuelva. Sin build responde 503 con el comando, no 404 mudo.
  // -------------------------------------------------------------------------
  async function serveNext(req, res, pathname) {
    const rel = pathname.slice("/next".length) || "/";
    const candidato = join(NEXT_DIR, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!candidato.startsWith(NEXT_DIR)) return send(req, res, 403, "Forbidden", "text/plain");

    const esArchivo = extname(candidato) !== "";
    try {
      const file = esArchivo ? candidato : join(NEXT_DIR, "index.html");
      // los assets llevan hash en el nombre: inmutables. El HTML nunca se cachea.
      const cache = esArchivo && /-[A-Za-z0-9_]{8,}\./.test(candidato)
        ? "public, max-age=31536000, immutable"
        : "no-cache";
      send(req, res, 200, await readFile(file), MIME[extname(file)] || "application/octet-stream", { "Cache-Control": cache });
    } catch {
      if (esArchivo) return send(req, res, 404, "Not Found", "text/plain");
      send(req, res, 503,
        "Panel nuevo sin construir. En el servidor: npm --prefix apps/web-next ci && npm --prefix apps/web-next run build",
        "text/plain; charset=utf-8");
    }
  }

  const metrics = new Metrics();
  const log = createLogger("api");

  async function route(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;
      const qp = url.searchParams;
      const cacheKey = path + url.search;

      if (path === "/api/health") {
        return sendJson(req, res, { ok: true, version_datos: dataVersion() }, { cache: 10 });
      }
      // M14 — dashboard operativo: budget vs medido (API en vivo + ETL/freshness de la DB)
      // M15 — cacheable 30s: el edge (nginx) colapsa ráfagas del panel sin ocultar degradación.
      if (path === "/api/status") {
        return sendJson(req, res, budgetReport(db, metrics), { cache: 30 });
      }

      // M12 — Graph API: vecindad multi-salto, concentración y stats del grafo
      if (path === "/api/graph/vecinos") {
        const id = qp.get("id");
        if (!id) return sendJson(req, res, { error: "falta ?id=<id_entidad>" }, { status: 400 });
        return sendCachedJson(req, res, cacheKey,
          () => vecinos(db, id, { depth: Number(qp.get("depth")) || 1, limit: Number(qp.get("limit")) || 200 }),
          { maxAge: 300 });
      }
      if (path === "/api/graph/concentracion") {
        return sendCachedJson(req, res, cacheKey, () => concentracion(db, {
          tipoEntidad: qp.get("tipo") || "Empresa",
          tipoArista: qp.get("arista") || "adjudicado_a",
          depto: qp.get("depto") && /^\d{2}$/.test(qp.get("depto")) ? qp.get("depto") : null,
          limit: Math.min(Number(qp.get("limit")) || 10, 100),
        }), { maxAge: 300 });
      }
      if (path === "/api/graph/stats") {
        return sendCachedJson(req, res, cacheKey, () => graphStats(db), { maxAge: 300 });
      }

      // M13 — consulta NL con evidencia citada; sin API key degrada a solo-recuperación
      if (path === "/api/ai/ask") {
        const q = qp.get("q");
        if (!q || !q.trim()) return sendJson(req, res, { error: "falta ?q=<pregunta>" }, { status: 400 });
        try {
          return sendJson(req, res, await ask(db, q.trim(), { limit: Math.min(Number(qp.get("limit")) || 8, 20) }));
        } catch (e) {
          return sendJson(req, res, { error: "ai no disponible", detail: String(e.message) }, { status: 502 });
        }
      }
      if (path === "/api/meta") return sendCachedJson(req, res, cacheKey, () => handleMeta(), { maxAge: 300 });
      if (path === "/api/kpi") return sendCachedJson(req, res, cacheKey, () => handleKpi(qp), { maxAge: 300 });
      if (path === "/api/search") return sendCachedJson(req, res, cacheKey, () => handleSearch(qp), { maxAge: 60 });

      // M11 — Socrata Explorer: llamadas en vivo al catálogo externo, sin caché por versión
      // de datos (no son datos ingeridos todavía). Errores de red → 502, no 500.
      // `domain`/`id` los valida el explorer contra su allowlist (SSRF): eso es 400 del
      // cliente, no 502 de la fuente.
      const errExplorer = (e) => (/no permitido|inválido/.test(e.message) ? 400 : 502);
      if (path === "/api/explorer/search") {
        try {
          const results = await searchCatalog({
            q: qp.get("q") || undefined, category: qp.get("category") || undefined,
            domain: qp.get("domain") || undefined, limit: qp.get("limit") ? Number(qp.get("limit")) : undefined,
          });
          return sendJson(req, res, { results }, { cache: 300 });
        } catch (e) { return sendJson(req, res, { error: "catálogo no disponible", detail: String(e.message) }, { status: errExplorer(e) }); }
      }
      if (path === "/api/explorer/preview") {
        if (!qp.get("id")) return sendJson(req, res, { error: "falta ?id=" }, { status: 400 });
        try {
          const out = await previewDataset(qp.get("id"), { domain: qp.get("domain") || undefined, sample: qp.get("sample") ? Number(qp.get("sample")) : undefined });
          return sendJson(req, res, out, { cache: 300 });
        } catch (e) { return sendJson(req, res, { error: "dataset no disponible", detail: String(e.message) }, { status: errExplorer(e) }); }
      }
      if (path === "/api/explorer/profile") {
        if (!qp.get("id")) return sendJson(req, res, { error: "falta ?id=" }, { status: 400 });
        try {
          const out = await profileDataset(qp.get("id"), { domain: qp.get("domain") || undefined, sample: qp.get("sample") ? Number(qp.get("sample")) : undefined });
          return sendJson(req, res, out, { cache: 300 });
        } catch (e) { return sendJson(req, res, { error: "dataset no disponible", detail: String(e.message) }, { status: errExplorer(e) }); }
      }
      if (path === "/api/explorer/sources") {
        const registradas = listExplorerSources(db).map((s) => ({ id: s.id, nombre: s.nombre, domain: s.domain, priority: s.priority, schedule: s.schedule }));
        const meta = db.prepare("SELECT source_id, filas, estado, last_checked FROM dataset_meta").all();
        const metaById = Object.fromEntries(meta.map((m) => [m.source_id, m]));
        return sendJson(req, res, { fuentes: registradas.map((s) => ({ ...s, ingesta: metaById[s.id] ?? null })) }, { cache: 30 });
      }
      if (path === "/api/explorer/register" && req.method === "POST") {
        if (!authorizeWrite(req, res)) return;
        try {
          const body = await readJsonBody(req);
          const cfg = registerSource(db, body);
          return sendJson(req, res, { ok: true, fuente: { id: cfg.id, nombre: cfg.nombre, domain: cfg.domain, schedule: cfg.schedule } }, { status: 201 });
        } catch (e) { return sendJson(req, res, { error: "registro inválido", detail: String(e.message) }, { status: 400 }); }
      }

      // M6 — entidades: listado, ficha y evidencia que la respalda
      if (path === "/api/contratacion/agregados") {
        return sendCachedJson(req, res, cacheKey, () => handleContratacionAgregados(qp), { maxAge: 300 });
      }
      if (path === "/api/entidades") {
        return sendCachedJson(req, res, cacheKey, () => handleEntidades(qp), { maxAge: 300 });
      }
      if (path.startsWith("/api/entidades/")) {
        const resto = decodeURIComponent(path.slice("/api/entidades/".length));
        if (resto.endsWith("/registros")) {
          const id = resto.slice(0, -"/registros".length);
          if (!prep("SELECT 1 FROM entidades WHERE id_entidad=?").get(id)) {
            return sendJson(req, res, { error: "entidad no encontrada" }, { status: 404 });
          }
          return sendCachedJson(req, res, cacheKey, () => handleEntidadRegistros(id, qp), { maxAge: 300 });
        }
        const ent = handleEntidadById(resto);
        if (!ent) return sendJson(req, res, { error: "entidad no encontrada" }, { status: 404 });
        return sendCachedJson(req, res, cacheKey, () => ent, { maxAge: 300 });
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

      if (path === "/next" || path.startsWith("/next/")) return serveNext(req, res, path);
      return serveStatic(req, res, path);
    } catch (err) {
      log.error("error interno", { url: req.url, detail: String(err.message) });
      sendJson(req, res, { error: "error interno", detail: String(err.message) }, { status: 500 });
    }
  }

  // Wrapper de métricas (M14): latencia + error + cache hit por grupo de ruta.
  // Solo instrumenta /api/*; estáticos y /api/status quedan fuera para no sesgar percentiles.
  return async function handler(req, res) {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/") || path === "/api/status") return route(req, res);
    const label = path.split("/").slice(0, 3).join("/"); // /api/kpi, /api/registros, /api/explorer
    const t0 = performance.now();
    await route(req, res); // al resolver, la respuesta ya se escribió (handlers síncronos o awaited)
    metrics.observe(label, +(performance.now() - t0).toFixed(2), {
      error: res.statusCode >= 500,
      cacheHit: Boolean(res.cacheHit),
    });
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
