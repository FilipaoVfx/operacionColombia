// M11 — Socrata Explorer (PLANNING BACKLOG B): autoservicio para descubrir, explorar,
// perfilar y registrar datasets de datos.gov.co sin tocar código. Una fuente nueva es una
// fila en `explorer_sources`; el motor de conectores (M1) la ingiere igual que las
// fuentes estáticas de sources.config.js — ver resolveSource().
import { sha256 } from "../../packages/core-model/index.js";
import { validateSourceConfig } from "../../packages/contracts/index.js";

const CATALOG_API = "https://api.us.socrata.com/api/catalog/v1";
const DEFAULT_DOMAIN = "www.datos.gov.co";

// El `domain` y el `id` llegan del usuario y se interpolan en la URL que el servidor
// consulta: sin allowlist esto es SSRF (metadatos del host, servicios internos). Solo
// portales Socrata conocidos; ampliable por entorno para despliegues con otro portal.
const ALLOWED_DOMAINS = new Set([
  DEFAULT_DOMAIN, "datos.gov.co", "www.datosabiertos.bogota.gov.co", "datosabiertos.bogota.gov.co",
  ...String(process.env.EXPLORER_DOMAINS || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
]);

/** Valida el portal contra la allowlist. Devuelve el dominio normalizado. */
export function assertDomain(domain) {
  const d = String(domain ?? "").trim().toLowerCase();
  if (!ALLOWED_DOMAINS.has(d)) {
    throw new Error(`dominio no permitido: ${d.slice(0, 60)} (permitidos: ${[...ALLOWED_DOMAINS].join(", ")})`);
  }
  return d;
}

/** Los ids de Socrata son 4x4 alfanuméricos; cualquier otra cosa es inyección de ruta. */
export function assertDatasetId(id) {
  const s = String(id ?? "").trim();
  if (!/^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(s)) throw new Error(`id de dataset inválido: ${s.slice(0, 40)}`);
  return s;
}

async function fetchJson(url, { timeout = 20000 } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": "operacionColombia-Explorer/1.0", Accept: "application/json" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url.slice(0, 120)}`);
  return res.json();
}

export function migrateExplorer(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS explorer_sources (
      id            TEXT PRIMARY KEY,
      domain        TEXT NOT NULL,       -- dominio Socrata de origen (p.ej. www.datos.gov.co)
      target_domain TEXT NOT NULL,       -- dominio OSINT interno destino (contratacion, agro, ...)
      nombre        TEXT, descripcion TEXT, licencia TEXT,
      endpoint      TEXT NOT NULL,
      where_clause  TEXT,
      priority      TEXT DEFAULT 'P2',
      schedule      TEXT DEFAULT 'mensual',
      registered_at TEXT
    );
  `);
}

// ---------------------------------------------------------------------------------------
// B1 — Discovery: catálogo Socrata por keyword/categoría.
// ---------------------------------------------------------------------------------------
export async function searchCatalog({ q, category, domain = DEFAULT_DOMAIN, limit = 20 } = {}) {
  domain = assertDomain(domain);
  const params = new URLSearchParams({ domains: domain, search_context: domain, limit: String(Math.min(limit, 100)) });
  if (q) params.set("q", q);
  if (category) params.set("categories", category);
  const data = await fetchJson(`${CATALOG_API}?${params}`);
  return (data.results ?? []).map((r) => ({
    id: r.resource.id,
    nombre: r.resource.name,
    descripcion: r.resource.description ?? null,
    categoria: r.classification?.categories?.[0] ?? null,
    tags: r.classification?.tags ?? [],
    columnas_count: r.resource.columns_count ?? null,
    actualizado: r.resource.data_updated_at ?? null,
    tipo: r.resource.type,
    dominio_origen: domain,
  }));
}

// ---------------------------------------------------------------------------------------
// B2 — Exploración: metadata + preview de filas.
// ---------------------------------------------------------------------------------------
export async function previewDataset(id, { domain = DEFAULT_DOMAIN, sample = 20 } = {}) {
  domain = assertDomain(domain);
  id = assertDatasetId(id);
  const meta = await fetchJson(`https://${domain}/api/views/${id}.json`);
  const columnas = (meta.columns ?? []).map((c) => ({ nombre: c.fieldName, tipo: c.dataTypeName, etiqueta: c.name }));
  const muestra = await fetchJson(`https://${domain}/resource/${id}.json?$limit=${Math.min(sample, 200)}`);
  return {
    id, nombre: meta.name, descripcion: meta.description ?? null,
    licencia: meta.licenseId ?? meta.license?.name ?? null,
    columnas, filas_totales: meta.viewCount ?? null,
    actualizado: meta.rowsUpdatedAt ? new Date(meta.rowsUpdatedAt * 1000).toISOString() : null,
    muestra,
  };
}

// ---------------------------------------------------------------------------------------
// B4 — Perfil de calidad: nulos, duplicados, cobertura, distribución top-5 por columna.
// Corre sobre una muestra (no el dataset completo — inviable para SECOP-sized sources).
// ---------------------------------------------------------------------------------------
export async function profileDataset(id, { domain = DEFAULT_DOMAIN, sample = 500 } = {}) {
  domain = assertDomain(domain);
  id = assertDatasetId(id);
  const rows = await fetchJson(`https://${domain}/resource/${id}.json?$limit=${Math.min(sample, 5000)}`);
  return profileRows(id, rows);
}

/** Perfilado puro sobre filas ya obtenidas — separado para poder testear sin red. */
export function profileRows(id, rows) {
  const cols = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!k.startsWith(":")) cols.add(k);

  const porColumna = [...cols].map((col) => {
    const valores = rows.map((r) => r[col]);
    const nulos = valores.filter((v) => v == null || v === "").length;
    const noNulos = valores.filter((v) => v != null && v !== "");
    const conteo = new Map();
    for (const v of noNulos) {
      const key = typeof v === "object" ? JSON.stringify(v) : String(v);
      conteo.set(key, (conteo.get(key) ?? 0) + 1);
    }
    const top = [...conteo].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([valor, n]) => ({ valor, n }));
    return {
      columna: col,
      nulos_pct: rows.length ? +(100 * nulos / rows.length).toFixed(1) : 0,
      distintos: conteo.size,
      top,
    };
  });

  const idKey = rows.length && rows.every((r) => r[":id"] != null) ? ":id" : null;
  const duplicados_en_muestra = idKey ? rows.length - new Set(rows.map((r) => r[idKey])).size : null;

  return { id, muestra_size: rows.length, columnas: porColumna, duplicados_en_muestra };
}

// ---------------------------------------------------------------------------------------
// Registro de fuente (B7 programación ETL + contrato con M1): persiste en DB, sin tocar
// sources.config.js. mapRow genérico: copia campos crudos sin normalizar (a diferencia de
// las fuentes curadas de M1/M3, que sí resuelven DIVIPOLA por dominio conocido).
// ---------------------------------------------------------------------------------------
export function registerSource(db, { id, domain = DEFAULT_DOMAIN, targetDomain, nombre, descripcion, licencia, where, priority = "P2", schedule = "mensual" }) {
  migrateExplorer(db);
  if (!id || !targetDomain) throw new Error("registerSource requiere id y targetDomain");
  // el endpoint persistido lo consume el ETL después: validar aquí evita guardar un SSRF diferido
  domain = assertDomain(domain);
  id = assertDatasetId(id);
  db.prepare(`
    INSERT INTO explorer_sources (id, domain, target_domain, nombre, descripcion, licencia, endpoint, where_clause, priority, schedule, registered_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      domain=excluded.domain, target_domain=excluded.target_domain, nombre=excluded.nombre,
      descripcion=excluded.descripcion, licencia=excluded.licencia, endpoint=excluded.endpoint,
      where_clause=excluded.where_clause, priority=excluded.priority, schedule=excluded.schedule
  `).run(id, domain, targetDomain, nombre ?? id, descripcion ?? null, licencia ?? null,
         `https://${domain}/resource/${id}.json`, where ?? null, priority, schedule, new Date().toISOString());
  return toSourceConfig(getExplorerSourceRow(db, id));
}

export function listExplorerSources(db) {
  migrateExplorer(db);
  return db.prepare("SELECT * FROM explorer_sources ORDER BY registered_at DESC").all().map(toSourceConfig);
}

function getExplorerSourceRow(db, id) {
  return db.prepare("SELECT * FROM explorer_sources WHERE id=?").get(id);
}

function toSourceConfig(row) {
  if (!row) return null;
  return validateSourceConfig({
    id: row.id, kind: "socrata", domain: row.target_domain,
    endpoint: row.endpoint, where: row.where_clause ?? undefined,
    priority: row.priority, schedule: row.schedule,
    nombre: row.nombre, licencia: row.licencia ?? "ver fuente original",
    mapRow: genericMapRow,
  });
}

/** mapRow genérico para fuentes autoservicio: sin resolución DIVIPOLA (fuera de scope aquí). */
export function genericMapRow(row) {
  const campos = {};
  for (const [k, v] of Object.entries(row)) if (!k.startsWith(":")) campos[k] = v;
  const idFuente = row[":id"] ?? sha256(campos);
  return {
    idFuente, campos, extra: row,
    searchBlob: Object.values(campos).filter((v) => typeof v === "string").join(" "),
  };
}

/** Resuelve una fuente sea estática (M1/sources.config.js) o dinámica (M11/explorer_sources). */
export function resolveSource(db, id, staticGetSource) {
  try { return staticGetSource(id); } catch { /* no está en las fuentes estáticas */ }
  migrateExplorer(db);
  const cfg = toSourceConfig(getExplorerSourceRow(db, id));
  if (!cfg) throw new Error(`fuente desconocida (ni estática ni explorer): ${id}`);
  return cfg;
}

// ---------------------------------------------------------------------------------------
// B6 — Exportación de muestra. GeoJSON/Parquet/SQLite quedan para cuando haya un caso de
// uso real que los requiera — exportar el dataset completo ya lo cubre "registrar fuente".
// ---------------------------------------------------------------------------------------
export function exportSample(rows, format = "json") {
  if (format === "json") return JSON.stringify(rows, null, 2);
  if (format === "csv") {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => !k.startsWith(":"))))];
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  }
  throw new Error(`formato de export no soportado: ${format}`);
}
