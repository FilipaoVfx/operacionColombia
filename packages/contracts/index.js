// Contratos entre módulos (PLANNING §6). Sin dependencias.
// Los conectores implementan la interfaz Connector (§6.1) y emiten RawBatch (§6.2).
// El normalizador produce UnifiedRecord (§6.3) que persiste el WriteStore.

/**
 * @typedef {Object} SourceConfig  (§6.1)
 * @property {string} id                       - p.ej. 'gdxc-w37w'
 * @property {'socrata'|'arcgis'|'file'|'scrape'} kind
 * @property {string} domain                   - 'territorio' | 'vial' | 'economia' | ...
 * @property {string} endpoint
 * @property {string} [where]                  - SoQL incremental
 * @property {'P0'|'P1'|'P2'|'P3'} priority
 * @property {'diario'|'semanal'|'mensual'|'semestral'|'anual'} schedule
 * @property {string} nombre
 * @property {string} licencia
 * @property {(row: any, ctx: any) => Partial<import('./index.js').UnifiedRecord>} mapRow
 */

/**
 * @typedef {Object} RawBatch  (§6.2)
 * @property {string} sourceId
 * @property {unknown[]} rows
 * @property {{offset:number}} cursor
 * @property {string} fetchedAt
 * @property {string} [etag]
 * @property {string} [hash]
 */

/**
 * @typedef {Object} UnifiedRecord  (§6.3 — núcleo del sistema)
 * @property {string} id_interno
 * @property {string} id_fuente
 * @property {string} dominio
 * @property {string} fuente
 * @property {string} fuente_url
 * @property {string} conector
 * @property {string} version_dataset
 * @property {string} hash
 * @property {string} fecha_ingesta
 * @property {string[]} transformaciones
 * @property {string} [divipola_muni]
 * @property {string} [divipola_depto]
 * @property {object} [geom]                   - GeoJSON WGS84
 * @property {Record<string,unknown>} campos   - canónicos por dominio
 * @property {Record<string,unknown>} extra    - bolsa que nunca descarta
 */

const KINDS = new Set(["socrata", "arcgis", "file", "scrape"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);

export function validateSourceConfig(s) {
  const errs = [];
  if (!s.id) errs.push("id requerido");
  if (!KINDS.has(s.kind)) errs.push(`kind inválido: ${s.kind}`);
  if (!s.domain) errs.push("domain requerido");
  if (!s.endpoint) errs.push("endpoint requerido");
  if (!PRIORITIES.has(s.priority)) errs.push(`priority inválida: ${s.priority}`);
  if (typeof s.mapRow !== "function") errs.push("mapRow requerido");
  if (errs.length) throw new Error(`SourceConfig '${s.id || "?"}' inválido: ${errs.join("; ")}`);
  return s;
}

// Contrato Connector (§6.1): cada conector exporta
//   discover(source): Promise<SourceMeta>       — esquema + conteo + etag/hash
//   fetch(source, cursor?): AsyncIterable<RawBatch>
//   healthcheck(source): Promise<'ok'|'down'|'changed'>
export function assertConnector(c, kind) {
  for (const fn of ["discover", "fetch", "healthcheck"]) {
    if (typeof c[fn] !== "function") throw new Error(`Connector '${kind}' no implementa ${fn}()`);
  }
  return c;
}
