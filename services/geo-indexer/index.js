// M10 (soporte) — Índice geoespacial: bbox precalculado por registro para servir
// "carga por bbox" del panel sin parsear GeoJSON en caliente. Mismo patrón que
// search-indexer: incremental por hash, idempotente, disparado por fan-out (M5).
// SQLite plano (sin R*Tree): el filtro es un rango sobre columnas indexadas vía PK
// del write store; suficiente para el volumen actual (ADR-002 revisita a escala).

export function migrateGeo(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS geo_bbox (
      id_interno TEXT PRIMARY KEY,
      hash       TEXT NOT NULL,
      dominio    TEXT,
      min_lon REAL NOT NULL, min_lat REAL NOT NULL,
      max_lon REAL NOT NULL, max_lat REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_geo_bbox_lon ON geo_bbox (min_lon, max_lon);
  `);
}

/** Bbox [minLon, minLat, maxLon, maxLat] de cualquier geometría GeoJSON, o null. */
export function bboxOf(geom) {
  if (!geom || !geom.coordinates) return null;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < box[0]) box[0] = c[0];
      if (c[1] < box[1]) box[1] = c[1];
      if (c[0] > box[2]) box[2] = c[0];
      if (c[1] > box[3]) box[3] = c[1];
    } else for (const inner of c) walk(inner);
  };
  walk(geom.coordinates);
  return Number.isFinite(box[0]) ? box : null;
}

/**
 * Indexado incremental: solo registros con geom nuevos o con hash cambiado;
 * borra huérfanos (registro eliminado o que perdió geom). Idempotente.
 * domain=null indexa todos los dominios.
 */
export function buildGeoIndex(db, domain = null) {
  migrateGeo(db);
  const dw = domain ? "AND r.dominio=?" : "";
  const da = domain ? [domain] : [];

  const pendientes = db.prepare(`
    SELECT r.id_interno, r.dominio, r.geom, r.hash
    FROM registros r LEFT JOIN geo_bbox g ON g.id_interno = r.id_interno
    WHERE r.geom IS NOT NULL ${dw} AND (g.id_interno IS NULL OR g.hash <> r.hash)
  `).all(...da);

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO geo_bbox (id_interno, hash, dominio, min_lon, min_lat, max_lon, max_lat)
    VALUES (?,?,?,?,?,?,?)
  `);
  const del = db.prepare("DELETE FROM geo_bbox WHERE id_interno=?");

  db.exec("BEGIN");
  try {
    let indexados = 0;
    for (const r of pendientes) {
      const box = bboxOf(JSON.parse(r.geom));
      if (!box) continue;
      upsert.run(r.id_interno, r.hash, r.dominio, box[0], box[1], box[2], box[3]);
      indexados++;
    }
    // huérfanos: entrada sin registro, o cuyo registro ya no tiene geom
    const huerfanos = db.prepare(`
      SELECT g.id_interno FROM geo_bbox g
      LEFT JOIN registros r ON r.id_interno = g.id_interno
      WHERE r.id_interno IS NULL OR r.geom IS NULL
    `).all();
    for (const h of huerfanos) del.run(h.id_interno);
    db.exec("COMMIT");
    return { resultado: "ok", indexados, eliminados: huerfanos.length };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
