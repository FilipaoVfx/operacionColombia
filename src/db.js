import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = join(__dirname, "..", "data", "sivu.db");

export function openDb({ create = false } = {}) {
  mkdirSync(join(__dirname, "..", "data"), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  if (create) createSchema(db);
  return db;
}

export function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vias (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      objectid      INTEGER,
      codigo_vial   TEXT,
      nombre_tramo  TEXT,
      ruta          TEXT,
      sector        TEXT,
      tipo_vial     TEXT,   -- Nacional / Departamental / Terciaria / Por Definir
      categoria     TEXT,   -- Primer/Segundo/Tercer Orden (etiqueta original INVIAS)
      superficie    TEXT,   -- Pavimentada / Sin Pavimentar / Por Definir
      pavimentada   INTEGER,-- 1 / 0 / NULL
      calzada       TEXT,   -- Sencilla / Doble
      administrador TEXT,   -- INVIAS / ANI / Concesion Departamental ...
      grupo_admin   TEXT,
      region        TEXT,   -- territorial INVIAS (sirve como departamento/region)
      revision      TEXT,   -- Revisado / No Revisado
      longitud_km   REAL,
      fuente        TEXT,
      geom          TEXT,   -- GeoJSON geometry (WGS84)
      minx REAL, miny REAL, maxx REAL, maxy REAL,  -- bbox para filtro espacial
      search_blob   TEXT,   -- texto normalizado para busqueda
      extra         TEXT    -- JSON con atributos adicionales
    );

    CREATE INDEX IF NOT EXISTS idx_vias_region      ON vias(region);
    CREATE INDEX IF NOT EXISTS idx_vias_tipo        ON vias(tipo_vial);
    CREATE INDEX IF NOT EXISTS idx_vias_superficie  ON vias(superficie);
    CREATE INDEX IF NOT EXISTS idx_vias_admin       ON vias(administrador);
    CREATE INDEX IF NOT EXISTS idx_vias_pavimentada ON vias(pavimentada);
    CREATE INDEX IF NOT EXISTS idx_vias_codigo      ON vias(codigo_vial);
    -- indice de bounding box para consultas por mapa (envelope intersect)
    CREATE INDEX IF NOT EXISTS idx_vias_bbox        ON vias(minx, maxx, miny, maxy);

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

export function resetData(db) {
  db.exec("DELETE FROM vias;");
  db.exec("DELETE FROM sqlite_sequence WHERE name='vias';");
}

export function setMeta(db, key, value) {
  db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, typeof value === "string" ? value : JSON.stringify(value));
}

export function getMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key=?").get(key);
  return row ? row.value : null;
}
