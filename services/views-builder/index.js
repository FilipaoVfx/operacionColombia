// M8 — Materialized views (PLANNING): KPIs precalculados como tablas rm_* leídas
// con SELECT directo; nada de SUM()/GROUP BY en caliente. Rebuild incremental por
// dominio afectado (disparado por el fan-out de M5), versionado para cacheo.

export function migrateViews(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS read_models (
      view_name TEXT PRIMARY KEY,
      version   INTEGER NOT NULL DEFAULT 0,   -- sube en cada rebuild → clave de caché
      built_at  TEXT,
      filas     INTEGER,
      dominio   TEXT                          -- NULL = transversal
    );
  `);
}

// Catálogo de vistas (README §7/§10 + casos de uso del catálogo).
// domain: qué ingesta la invalida (null = cualquier dominio la invalida).
export const VIEWS = [
  {
    name: "rm_resumen_dominio",
    domain: null,
    sql: `
      SELECT dominio,
             COUNT(*)                      registros,
             COUNT(DISTINCT divipola_muni) municipios,
             COUNT(DISTINCT divipola_depto) departamentos,
             MAX(fecha_ingesta)            ultima_ingesta
      FROM registros GROUP BY dominio
    `,
  },
  {
    name: "rm_registros_depto",
    domain: null,
    sql: `
      SELECT r.dominio, r.divipola_depto cod_dpto,
             (SELECT dpto FROM divipola d WHERE d.cod_dpto=r.divipola_depto LIMIT 1) departamento,
             COUNT(*) registros
      FROM registros r
      WHERE r.divipola_depto IS NOT NULL
      GROUP BY r.dominio, r.divipola_depto
    `,
  },
  {
    name: "rm_pib_depto_anio",
    domain: "economia",
    sql: `
      SELECT divipola_depto cod_dpto,
             json_extract(campos,'$.departamento')  departamento,
             json_extract(campos,'$.anio')          anio,
             json_extract(campos,'$.tipo_precios')  tipo_precios,
             SUM(json_extract(campos,'$.valor_miles_millones')) pib_miles_millones,
             COUNT(*) actividades
      FROM registros WHERE dominio='economia'
      GROUP BY divipola_depto, anio, tipo_precios
    `,
  },
  {
    name: "rm_vial_depto",
    domain: "vial",
    sql: `
      SELECT divipola_depto cod_dpto,
             json_extract(campos,'$.territorial') territorial,
             COUNT(*) tramos,
             ROUND(SUM(json_extract(campos,'$.longitud_km')), 1) km_total
      FROM registros WHERE dominio='vial'
      GROUP BY divipola_depto, territorial
    `,
  },
];

/**
 * (Re)construye vistas. domain limita a las afectadas por esa ingesta (incremental);
 * view construye una sola por nombre. Swap atómico: tabla nueva → RENAME.
 */
export function buildViews(db, { domain = null, view = null } = {}) {
  migrateViews(db);
  const targets = VIEWS.filter((v) =>
    (view ? v.name === view : true) &&
    (view || domain == null || v.domain == null || v.domain === domain)
  );
  if (!targets.length) throw new Error(`vista desconocida o sin match: view=${view} domain=${domain}`);

  const built = [];
  for (const v of targets) {
    const tmp = `${v.name}__new`;
    db.exec("BEGIN");
    try {
      db.exec(`DROP TABLE IF EXISTS ${tmp}`);
      db.exec(`CREATE TABLE ${tmp} AS ${v.sql}`);
      db.exec(`DROP TABLE IF EXISTS ${v.name}`);
      db.exec(`ALTER TABLE ${tmp} RENAME TO ${v.name}`);
      const filas = db.prepare(`SELECT COUNT(*) c FROM ${v.name}`).get().c;
      db.prepare(`
        INSERT INTO read_models (view_name, version, built_at, filas, dominio)
        VALUES (?, 1, ?, ?, ?)
        ON CONFLICT(view_name) DO UPDATE SET
          version=read_models.version+1, built_at=excluded.built_at, filas=excluded.filas
      `).run(v.name, new Date().toISOString(), filas, v.domain);
      db.exec("COMMIT");
      built.push({ view: v.name, filas });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return { resultado: "ok", built };
}

export function viewsStatus(db) {
  migrateViews(db);
  return db.prepare("SELECT view_name, version, filas, dominio, built_at FROM read_models ORDER BY view_name").all();
}
