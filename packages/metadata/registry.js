// M2 — Metadata Registry + versionado + freshness (PLANNING §6.4).
// Cada corrida de conector se auto-registra aquí; re-ingesta se salta si hash/etag no cambió.
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const OSINT_DB_PATH = process.env.OSINT_DB || join(__dirname, "..", "..", "data", "osint.db");

export function openOsintDb() {
  mkdirSync(dirname(OSINT_DB_PATH), { recursive: true });
  const db = new DatabaseSync(OSINT_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dataset_meta (
      source_id   TEXT PRIMARY KEY,
      nombre      TEXT, descripcion TEXT, licencia TEXT,
      dominio     TEXT, conector TEXT, prioridad TEXT, frecuencia TEXT,
      esquema     TEXT,             -- JSON: columnas descubiertas
      version     INTEGER DEFAULT 1,
      etag        TEXT, hash TEXT,  -- freshness: detección de cambios
      filas       INTEGER,
      last_checked TEXT, last_updated TEXT,
      estado      TEXT DEFAULT 'ACTIVA'  -- ACTIVA | BLOQUEADA | PENDIENTE_LICENCIA
    );

    -- historial de versiones de esquema (drift detection)
    CREATE TABLE IF NOT EXISTS dataset_version (
      source_id TEXT, version INTEGER, esquema TEXT, changed_at TEXT,
      PRIMARY KEY (source_id, version)
    );

    -- métricas de corrida (M14 observabilidad, mínimo viable)
    CREATE TABLE IF NOT EXISTS etl_runs (
      run_id      INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id   TEXT, started_at TEXT, finished_at TEXT,
      filas       INTEGER, insertadas INTEGER, actualizadas INTEGER, sin_cambio INTEGER,
      errores     INTEGER DEFAULT 0, resultado TEXT  -- ok | skip | error
    );

    -- registros unificados (write store, §6.3)
    CREATE TABLE IF NOT EXISTS registros (
      id_interno   TEXT PRIMARY KEY,
      id_fuente    TEXT NOT NULL,
      dominio      TEXT NOT NULL,
      fuente       TEXT, fuente_url TEXT, conector TEXT,
      version_dataset TEXT, hash TEXT NOT NULL,
      fecha_ingesta TEXT, transformaciones TEXT,
      divipola_muni TEXT, divipola_depto TEXT,
      geom         TEXT,
      campos       TEXT NOT NULL,   -- JSON canónicos
      extra        TEXT,            -- JSON: nunca descarta atributo original
      search_blob  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reg_dominio ON registros(dominio);
    CREATE INDEX IF NOT EXISTS idx_reg_muni    ON registros(divipola_muni);
    CREATE INDEX IF NOT EXISTS idx_reg_depto   ON registros(divipola_depto);
    CREATE INDEX IF NOT EXISTS idx_reg_fuente  ON registros(fuente, id_fuente);

    -- tabla maestra territorial (M3)
    CREATE TABLE IF NOT EXISTS divipola (
      cod_mpio  TEXT PRIMARY KEY,
      cod_dpto  TEXT NOT NULL,
      nom_mpio  TEXT, dpto TEXT,
      mpio_norm TEXT, dpto_norm TEXT,   -- sin acentos, mayúsculas (llave de cruce)
      lat REAL, lon REAL
    );
    CREATE INDEX IF NOT EXISTS idx_divipola_norm ON divipola(mpio_norm, dpto_norm);
    CREATE INDEX IF NOT EXISTS idx_divipola_dpto ON divipola(cod_dpto);
  `);
}

export class MetadataRegistry {
  constructor(db) { this.db = db; }

  get(sourceId) {
    return this.db.prepare("SELECT * FROM dataset_meta WHERE source_id=?").get(sourceId) ?? null;
  }

  /** Registra/actualiza metadata tras discover(). Versiona si el esquema cambió. */
  upsert(source, meta) {
    const prev = this.get(source.id);
    const esquema = JSON.stringify(meta.esquema ?? null);
    const now = new Date().toISOString();
    let version = prev?.version ?? 1;
    if (prev && prev.esquema && prev.esquema !== esquema) {
      version = prev.version + 1;
      this.db.prepare("INSERT OR REPLACE INTO dataset_version (source_id, version, esquema, changed_at) VALUES (?,?,?,?)")
        .run(source.id, version, esquema, now);
    }
    this.db.prepare(`
      INSERT INTO dataset_meta (source_id, nombre, descripcion, licencia, dominio, conector, prioridad, frecuencia,
                                esquema, version, etag, hash, filas, last_checked, last_updated, estado)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source_id) DO UPDATE SET
        nombre=excluded.nombre, esquema=excluded.esquema, version=excluded.version,
        etag=excluded.etag, hash=excluded.hash, filas=excluded.filas,
        last_checked=excluded.last_checked,
        last_updated=CASE WHEN excluded.hash IS NOT dataset_meta.hash THEN excluded.last_checked ELSE dataset_meta.last_updated END
    `).run(
      source.id, source.nombre, meta.descripcion ?? null, source.licencia ?? null,
      source.domain, source.kind, source.priority, source.schedule,
      esquema, version, meta.etag ?? null, meta.hash ?? null, meta.filas ?? null,
      now, now, "ACTIVA"
    );
    return { version, changed: !prev || prev.hash !== (meta.hash ?? null) };
  }

  /** Freshness gate: true si hash/etag de la fuente no cambió desde la última corrida OK. */
  isFresh(sourceId, { etag, hash }) {
    const m = this.get(sourceId);
    if (!m) return false;
    const lastOk = this.db.prepare(
      "SELECT 1 FROM etl_runs WHERE source_id=? AND resultado='ok' ORDER BY run_id DESC LIMIT 1"
    ).get(sourceId);
    if (!lastOk) return false;
    if (etag && m.etag) return etag === m.etag;
    if (hash && m.hash) return hash === m.hash;
    return false;
  }

  startRun(sourceId) {
    const r = this.db.prepare("INSERT INTO etl_runs (source_id, started_at) VALUES (?,?)")
      .run(sourceId, new Date().toISOString());
    return Number(r.lastInsertRowid);
  }

  finishRun(runId, { filas = 0, insertadas = 0, actualizadas = 0, sin_cambio = 0, errores = 0, resultado = "ok" }) {
    this.db.prepare(`UPDATE etl_runs SET finished_at=?, filas=?, insertadas=?, actualizadas=?, sin_cambio=?, errores=?, resultado=? WHERE run_id=?`)
      .run(new Date().toISOString(), filas, insertadas, actualizadas, sin_cambio, errores, resultado, runId);
  }
}

/** WriteStore (M4 mínimo): upsert idempotente por id_interno + hash. */
export class WriteStore {
  constructor(db) {
    this.db = db;
    this.stmtGetHash = db.prepare("SELECT hash FROM registros WHERE id_interno=?");
    this.stmtUpsert = db.prepare(`
      INSERT INTO registros (id_interno, id_fuente, dominio, fuente, fuente_url, conector, version_dataset,
                             hash, fecha_ingesta, transformaciones, divipola_muni, divipola_depto, geom, campos, extra, search_blob)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id_interno) DO UPDATE SET
        hash=excluded.hash, fecha_ingesta=excluded.fecha_ingesta, transformaciones=excluded.transformaciones,
        divipola_muni=excluded.divipola_muni, divipola_depto=excluded.divipola_depto,
        geom=excluded.geom, campos=excluded.campos, extra=excluded.extra, search_blob=excluded.search_blob,
        version_dataset=excluded.version_dataset
    `);
  }

  /** @returns {'inserted'|'updated'|'unchanged'} */
  upsert(rec) {
    const prev = this.stmtGetHash.get(rec.id_interno);
    if (prev && prev.hash === rec.hash) return "unchanged";
    this.stmtUpsert.run(
      rec.id_interno, rec.id_fuente, rec.dominio, rec.fuente, rec.fuente_url, rec.conector,
      rec.version_dataset, rec.hash, rec.fecha_ingesta, JSON.stringify(rec.transformaciones ?? []),
      rec.divipola_muni, rec.divipola_depto,
      rec.geom ? JSON.stringify(rec.geom) : null,
      JSON.stringify(rec.campos ?? {}), JSON.stringify(rec.extra ?? {}), rec.search_blob ?? null
    );
    return prev ? "updated" : "inserted";
  }
}
