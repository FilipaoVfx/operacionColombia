// M12 — Knowledge Graph (PLANNING BACKLOG A2). ADR-008: nodos = catálogo de entidades
// (M6), aristas en SQL derivadas de co-ocurrencia tipada en registros — dos entidades
// vinculadas al mismo registro unificado se relacionan, con el tipo dictado por el par
// (Contrato→Empresa = adjudicado_a, etc.). Consultas multi-salto con CTE recursiva;
// Neo4j solo si el volumen/profundidad lo exige (revisar ADR-008 entonces).
import { migrateEntities } from "../entity-res/index.js";

export function migrateGraph(db) {
  migrateEntities(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS grafo_aristas (
      src    TEXT NOT NULL,      -- id_entidad origen
      dst    TEXT NOT NULL,      -- id_entidad destino
      tipo   TEXT NOT NULL,      -- adjudicado_a | contratado_por | ubicado_en | ...
      peso   INTEGER NOT NULL,   -- nº de registros que evidencian la relación
      muestra TEXT,              -- un id_interno de evidencia (linaje navegable)
      PRIMARY KEY (src, dst, tipo)
    );
    CREATE INDEX IF NOT EXISTS idx_arista_dst ON grafo_aristas(dst);
  `);
}

// Tipo de arista por par (tipo_src → tipo_dst). Solo pares con semántica clara;
// el resto de co-ocurrencias no genera arista (evita explosión de relaciones).
const EDGE_RULES = {
  "Contrato>Empresa": "adjudicado_a",
  "Contrato>EntidadPublica": "contratado_por",
  "Contrato>Departamento": "ubicado_en",
  "Empresa>Departamento": "opera_en",
  "EntidadPublica>Departamento": "ubicado_en",
  "TramoVial>Departamento": "ubicado_en",
  "Municipio>Departamento": "pertenece_a",
};

/**
 * (Re)construye las aristas desde entidad_registros (idempotente: DELETE + rebuild,
 * mismo patrón que las vistas M8). Los duplicados SECOP no inflan peso: solo cuentan
 * registros preferida=1 (o sin entrada de dedupe).
 */
export function buildGraph(db) {
  migrateGraph(db);
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM grafo_aristas");
    // pares de entidades sobre el mismo registro, tipados por EDGE_RULES
    const pares = db.prepare(`
      SELECT ea.id_entidad src, eb.id_entidad dst,
             sa.tipo tipo_src, sb.tipo tipo_dst,
             COUNT(*) peso, MIN(ea.id_interno) muestra
      FROM entidad_registros ea
      JOIN entidad_registros eb ON eb.id_interno = ea.id_interno AND eb.id_entidad != ea.id_entidad
      JOIN entidades sa ON sa.id_entidad = ea.id_entidad
      JOIN entidades sb ON sb.id_entidad = eb.id_entidad
      LEFT JOIN contrato_dedupe d ON d.id_interno = ea.id_interno
      WHERE COALESCE(d.preferida, 1) = 1
      GROUP BY ea.id_entidad, eb.id_entidad
    `).all();

    const ins = db.prepare(`
      INSERT INTO grafo_aristas (src, dst, tipo, peso, muestra) VALUES (?,?,?,?,?)
      ON CONFLICT(src, dst, tipo) DO UPDATE SET peso=excluded.peso, muestra=excluded.muestra
    `);
    let aristas = 0;
    for (const p of pares) {
      const tipo = EDGE_RULES[`${p.tipo_src}>${p.tipo_dst}`];
      if (!tipo) continue;
      ins.run(p.src, p.dst, tipo, p.peso, p.muestra);
      aristas++;
    }
    db.exec("COMMIT");
    return { resultado: "ok", aristas };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Vecindad multi-salto (CTE recursiva, no dirigida). depth acotado (≤3) para no
 * explotar; devuelve nodos con su distancia y las aristas del subgrafo.
 */
export function vecinos(db, idEntidad, { depth = 1, limit = 200 } = {}) {
  migrateGraph(db);
  const d = Math.min(Math.max(1, depth), 3);
  const nodos = db.prepare(`
    WITH RECURSIVE walk(id, dist) AS (
      SELECT ?, 0
      UNION
      SELECT CASE WHEN a.src = w.id THEN a.dst ELSE a.src END, w.dist + 1
      FROM grafo_aristas a
      JOIN walk w ON w.id IN (a.src, a.dst)
      WHERE w.dist < ?
    )
    SELECT w.id id_entidad, MIN(w.dist) dist, e.tipo, e.nombre_canonico
    FROM walk w JOIN entidades e ON e.id_entidad = w.id
    GROUP BY w.id ORDER BY dist, e.tipo LIMIT ?
  `).all(idEntidad, d, limit);

  const ids = new Set(nodos.map((n) => n.id_entidad));
  const aristas = db.prepare("SELECT src, dst, tipo, peso, muestra FROM grafo_aristas").all()
    .filter((a) => ids.has(a.src) && ids.has(a.dst));
  return { nodos, aristas };
}

/**
 * Concentración: para un tipo de entidad, ranking por peso agregado de una relación.
 * Responde la consulta ejemplo del README ("qué empresa concentra contratos en X").
 */
export function concentracion(db, { tipoEntidad = "Empresa", tipoArista = "adjudicado_a", depto = null, limit = 10 } = {}) {
  migrateGraph(db);
  let rows;
  if (depto) {
    // empresas cuyas relaciones nacen de contratos ubicados en el depto dado
    rows = db.prepare(`
      SELECT e.id_entidad, e.nombre_canonico, SUM(a.peso) relaciones
      FROM grafo_aristas a
      JOIN entidades e ON e.id_entidad = a.dst AND e.tipo = ?
      JOIN grafo_aristas ub ON ub.src = a.src AND ub.tipo = 'ubicado_en' AND ub.dst = ?
      WHERE a.tipo = ?
      GROUP BY e.id_entidad ORDER BY relaciones DESC LIMIT ?
    `).all(tipoEntidad, `Departamento:codigo:${depto}`, tipoArista, limit);
  } else {
    rows = db.prepare(`
      SELECT e.id_entidad, e.nombre_canonico, SUM(a.peso) relaciones
      FROM grafo_aristas a
      JOIN entidades e ON e.id_entidad = a.dst AND e.tipo = ?
      WHERE a.tipo = ?
      GROUP BY e.id_entidad ORDER BY relaciones DESC LIMIT ?
    `).all(tipoEntidad, tipoArista, limit);
  }
  return rows;
}

export function graphStats(db) {
  migrateGraph(db);
  return {
    nodos: db.prepare("SELECT COUNT(*) c FROM entidades").get().c,
    aristas: db.prepare("SELECT COUNT(*) c FROM grafo_aristas").get().c,
    por_tipo: db.prepare("SELECT tipo, COUNT(*) n, SUM(peso) peso FROM grafo_aristas GROUP BY tipo ORDER BY n DESC").all(),
  };
}
