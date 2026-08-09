// M7 — Search: índice full-text FTS5 separado del storage (ADR-005), con facetas
// y autocompletado. Indexado incremental por hash (budget: < 30 s desde ingesta),
// disparado por el fan-out de M5. Vector/híbrido diferido (ADR-006): requiere
// modelo de embeddings externo; el contrato query() ya deja el hueco.

export function migrateSearch(db) {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      id_interno UNINDEXED,
      dominio    UNINDEXED,
      depto      UNINDEXED,
      label      UNINDEXED,
      texto,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    -- control incremental: qué hash de cada registro está indexado y en qué
    -- rowid del FTS vive (borrar por rowid; id_interno es UNINDEXED = full scan)
    CREATE TABLE IF NOT EXISTS search_indexed (
      id_interno TEXT PRIMARY KEY,
      hash       TEXT NOT NULL,
      fts_rowid  INTEGER
    );
  `);
  const cols = db.prepare("PRAGMA table_info(search_indexed)").all();
  if (!cols.some((c) => c.name === "fts_rowid")) db.exec("ALTER TABLE search_indexed ADD COLUMN fts_rowid INTEGER");
}

// label humano del hit: primer campo "nombre" disponible por dominio
function labelOf(campos, idInterno) {
  return campos.nom_mpio || campos.nombre_tramo || campos.razon_social
    || (campos.cultivo ? [campos.cultivo, campos.municipio, campos.anio].filter(Boolean).join(" · ") : null)
    || (campos.proveedor ? [campos.proveedor, campos.entidad, campos.anio].filter(Boolean).join(" · ") : null)
    || [campos.actividad, campos.departamento, campos.anio].filter(Boolean).join(" · ")
    || idInterno;
}

/**
 * Indexado incremental: solo registros nuevos o con hash cambiado; borra huérfanos.
 * Idempotente. domain=null indexa todos los dominios.
 */
export function buildSearchIndex(db, domain = null) {
  migrateSearch(db);
  const dw = domain ? "WHERE r.dominio=?" : "";
  const da = domain ? [domain] : [];

  const pendientes = db.prepare(`
    SELECT r.id_interno, r.dominio, r.divipola_depto, r.campos, r.search_blob, r.hash,
           s.id_interno ya_indexado, s.fts_rowid
    FROM registros r LEFT JOIN search_indexed s ON s.id_interno = r.id_interno
    ${dw} ${dw ? "AND" : "WHERE"} (s.id_interno IS NULL OR s.hash <> r.hash)
  `).all(...da);

  const delFtsRowid = db.prepare("DELETE FROM search_fts WHERE rowid=?");
  const delFtsScan = db.prepare("DELETE FROM search_fts WHERE id_interno=?"); // solo legado sin fts_rowid
  const insFts = db.prepare("INSERT INTO search_fts (id_interno, dominio, depto, label, texto) VALUES (?,?,?,?,?)");
  const markIdx = db.prepare("INSERT OR REPLACE INTO search_indexed (id_interno, hash, fts_rowid) VALUES (?,?,?)");

  db.exec("BEGIN");
  try {
    for (const r of pendientes) {
      const campos = JSON.parse(r.campos || "{}");
      if (r.fts_rowid != null) delFtsRowid.run(r.fts_rowid);
      else if (r.ya_indexado != null) delFtsScan.run(r.id_interno);
      const ins = insFts.run(r.id_interno, r.dominio, r.divipola_depto, labelOf(campos, r.id_interno), r.search_blob || "");
      markIdx.run(r.id_interno, r.hash, ins.lastInsertRowid);
    }
    // huérfanos: indexados cuyo registro ya no existe
    const huerfanos = db.prepare(`
      SELECT s.id_interno, s.fts_rowid FROM search_indexed s
      LEFT JOIN registros r ON r.id_interno = s.id_interno WHERE r.id_interno IS NULL
    `).all();
    for (const h of huerfanos) {
      if (h.fts_rowid != null) delFtsRowid.run(h.fts_rowid);
      else delFtsScan.run(h.id_interno);
      db.prepare("DELETE FROM search_indexed WHERE id_interno=?").run(h.id_interno);
    }
    db.exec("COMMIT");
    return { resultado: "ok", indexados: pendientes.length, eliminados: huerfanos.length };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// Palabras de función: aportan ruido en el modo OR y ningún poder discriminante.
// No se filtran en modo AND, donde el usuario escribió exactamente lo que quiso.
const VACIAS = new Set([
  "de", "del", "la", "el", "lo", "los", "las", "un", "una", "unos", "unas", "en", "y", "o",
  "que", "quien", "quienes", "cual", "cuales", "como", "cuanto", "cuantos", "cuanta", "cuantas",
  "por", "para", "con", "sin", "sobre", "entre", "desde", "hasta", "a", "al", "es", "son", "ser",
  "se", "su", "sus", "mas", "muy", "donde", "cuando", "hay", "tiene", "tienen", "me", "mi",
]);

function tokens(q) {
  return String(q).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9ñ]+/).filter(Boolean);
}

/**
 * Traduce texto libre a una expresión MATCH de FTS5. Las comillas cierran la inyección
 * de operadores (el usuario nunca escribe sintaxis FTS).
 *
 * - `and` (por defecto): todos los términos, prefijo en el último → precisión y
 *   autocompletado fluido mientras se tipea.
 * - `or`: cualquier término significativo. Es el fallback para lenguaje natural: en
 *   AND, "quién ganó contratos de pavimentación" exige que *todas* esas palabras estén
 *   en el mismo registro, así que una pregunta bien formada no matchea nada.
 */
function ftsQuery(q, { modo = "and" } = {}) {
  let terms = tokens(q);
  if (modo === "or") {
    const significativos = terms.filter((t) => !VACIAS.has(t) && t.length > 2);
    if (significativos.length) terms = significativos;
  }
  if (!terms.length) return null;
  if (modo === "or") return terms.map((t) => `"${t}"`).join(" OR ");
  return terms.map((t, i) => `"${t}"${i === terms.length - 1 ? "*" : ""}`).join(" ");
}

/**
 * Búsqueda full-text con ranking bm25, filtros y facetas (dominio, depto).
 * @returns {{hits:Array, facetas:{dominio:Array, depto:Array}, total:number}}
 */
export function searchQuery(db, { q, dominio = null, depto = null, limit = 12 } = {}) {
  migrateSearch(db);
  let match = ftsQuery(q);
  if (!match) return { hits: [], facetas: { dominio: [], depto: [] }, total: 0, modo: "and" };

  const filtros = [];
  const filtroArgs = [];
  if (dominio) { filtros.push("dominio = ?"); filtroArgs.push(dominio); }
  if (depto) { filtros.push("depto = ?"); filtroArgs.push(depto); }
  const clause = ["search_fts MATCH ?", ...filtros].join(" AND ");
  const contar = (m) => db.prepare(`SELECT COUNT(*) c FROM search_fts WHERE ${clause}`).get(m, ...filtroArgs).c;

  // AND primero (precisión); si no matchea nada, se reintenta en OR. Sin este fallback
  // toda pregunta en lenguaje natural devuelve vacío — que es lo que rompía el RAG (M13).
  let total = contar(match);
  let modo = "and";
  if (total === 0) {
    const alterno = ftsQuery(q, { modo: "or" });
    if (alterno && alterno !== match) {
      const totalOr = contar(alterno);
      if (totalOr > 0) { match = alterno; total = totalOr; modo = "or"; }
    }
  }
  const args = [match, ...filtroArgs];

  const hits = db.prepare(`
    SELECT id_interno, dominio, depto, label, bm25(search_fts) score
    FROM search_fts WHERE ${clause} ORDER BY score LIMIT ?
  `).all(...args, limit);

  // facetas sobre el match completo (sin filtro propio de la faceta)
  const facetas = {
    dominio: db.prepare(`
      SELECT dominio valor, COUNT(*) n FROM search_fts
      WHERE search_fts MATCH ? ${depto ? "AND depto=?" : ""} GROUP BY dominio ORDER BY n DESC
    `).all(match, ...(depto ? [depto] : [])),
    depto: db.prepare(`
      SELECT depto valor, COUNT(*) n FROM search_fts
      WHERE search_fts MATCH ? ${dominio ? "AND dominio=?" : ""} AND depto IS NOT NULL
      GROUP BY depto ORDER BY n DESC LIMIT 10
    `).all(match, ...(dominio ? [dominio] : [])),
  };
  return { hits, facetas, total, modo };
}

/** Autocompletado: labels distintos que matchean el prefijo, más frecuentes primero. */
export function autocomplete(db, q, { limit = 8 } = {}) {
  migrateSearch(db);
  const match = ftsQuery(q);
  if (!match) return [];
  return db.prepare(`
    SELECT label, dominio, COUNT(*) n FROM search_fts
    WHERE search_fts MATCH ? GROUP BY label, dominio ORDER BY n DESC, label LIMIT ?
  `).all(match, limit);
}
