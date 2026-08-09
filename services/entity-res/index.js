// M6 — Entity Resolution + catálogo de entidades (PLANNING). Pasa de "filas" a
// entidades canónicas cruzables (Municipio, Departamento, TramoVial, Empresa…).
// Matching en orden de confianza: NIT > código > nombre normalizado; lo dudoso va
// a cola de revisión humana, nunca se fusiona en caliente.
import { normName } from "../../packages/core-model/index.js";

export function migrateEntities(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entidades (
      id_entidad      TEXT PRIMARY KEY,   -- estable: tipo:clave_tipo:clave_valor
      tipo            TEXT NOT NULL,      -- Municipio | Departamento | TramoVial | Empresa | ...
      nombre_canonico TEXT,
      nombre_norm     TEXT,
      clave_tipo      TEXT NOT NULL,      -- nit | codigo | nombre
      clave_valor     TEXT NOT NULL,
      atributos       TEXT,               -- JSON
      creado_en       TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ent_clave ON entidades(tipo, clave_tipo, clave_valor);
    CREATE INDEX IF NOT EXISTS idx_ent_nombre ON entidades(tipo, nombre_norm);

    -- grafías alternativas observadas (dedupe: N nombres → 1 entidad)
    CREATE TABLE IF NOT EXISTS entidad_alias (
      id_entidad TEXT NOT NULL,
      alias_norm TEXT NOT NULL,
      origen     TEXT,
      PRIMARY KEY (id_entidad, alias_norm)
    );
    CREATE INDEX IF NOT EXISTS idx_alias_lookup ON entidad_alias(alias_norm);

    -- vínculo entidad ↔ registro unificado (con método y confianza del match)
    CREATE TABLE IF NOT EXISTS entidad_registros (
      id_entidad TEXT NOT NULL,
      id_interno TEXT NOT NULL,
      metodo     TEXT,               -- nit | codigo | nombre | alias
      confianza  REAL,
      PRIMARY KEY (id_entidad, id_interno)
    );
    CREATE INDEX IF NOT EXISTS idx_entreg_registro ON entidad_registros(id_interno);

    -- cola de revisión para matches bajo umbral o ambiguos (nunca auto-fusionar)
    CREATE TABLE IF NOT EXISTS entidad_revision (
      rev_id     INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo       TEXT, nombre TEXT, id_interno TEXT,
      candidatos TEXT,               -- JSON: ids de entidades candidatas
      motivo     TEXT, creado_en TEXT, resuelto INTEGER DEFAULT 0
    );

    -- dedupe SECOP (bloqueante #8): un contrato puede venir de SECOP II, Contratos SECOP II
    -- e Integrado a la vez. Se agrupa por llave natural y se marca UNA fila preferida por
    -- grupo; los read models solo cuentan preferida=1.
    CREATE TABLE IF NOT EXISTS contrato_dedupe (
      id_interno  TEXT PRIMARY KEY,
      llave       TEXT NOT NULL,     -- nit_entidad + referencia/proceso normalizados
      id_canonico TEXT NOT NULL,     -- id_interno de la fila preferida del grupo
      preferida   INTEGER NOT NULL   -- 1 = cuenta en vistas; 0 = duplicado
    );
    CREATE INDEX IF NOT EXISTS idx_dedupe_llave ON contrato_dedupe(llave);
  `);
}

const CONFIANZA = { nit: 1.0, codigo: 1.0, nombre: 0.85, alias: 0.85 };

export class EntityResolver {
  constructor(db) {
    this.db = db;
    migrateEntities(db);
  }

  /**
   * Resuelve una referencia a entidad canónica; crea la entidad si no existe.
   * ref = { tipo, nit?, codigo?, nombre?, atributos? }
   * @returns {{id_entidad:string, metodo:string, confianza:number}|null}
   */
  resolve(ref) {
    const nombreNorm = ref.nombre ? normName(ref.nombre) : null;

    // 1) claves fuertes: NIT, código oficial
    for (const [claveTipo, valor] of [["nit", ref.nit], ["codigo", ref.codigo]]) {
      if (valor == null || valor === "") continue;
      const clave = String(valor).trim();
      const found = this.db.prepare(
        "SELECT id_entidad FROM entidades WHERE tipo=? AND clave_tipo=? AND clave_valor=?"
      ).get(ref.tipo, claveTipo, clave);
      const id = found?.id_entidad ?? this.#create(ref.tipo, claveTipo, clave, ref, nombreNorm);
      if (nombreNorm) this.#addAlias(id, nombreNorm, "observado");
      return { id_entidad: id, metodo: claveTipo, confianza: CONFIANZA[claveTipo] };
    }

    if (!nombreNorm) return null;

    // 2) nombre normalizado exacto (canónico o alias previo)
    const byName = this.db.prepare(
      "SELECT id_entidad FROM entidades WHERE tipo=? AND nombre_norm=?"
    ).all(ref.tipo, nombreNorm);
    const byAlias = this.db.prepare(`
      SELECT DISTINCT a.id_entidad FROM entidad_alias a
      JOIN entidades e ON e.id_entidad=a.id_entidad
      WHERE e.tipo=? AND a.alias_norm=?
    `).all(ref.tipo, nombreNorm);
    const ids = [...new Set([...byName, ...byAlias].map((r) => r.id_entidad))];

    if (ids.length === 1) {
      return { id_entidad: ids[0], metodo: byName.length ? "nombre" : "alias", confianza: CONFIANZA.nombre };
    }
    if (ids.length > 1) {
      // ambiguo: mismo nombre apunta a varias entidades → revisión humana
      this.#enqueueRevision(ref, ids, "nombre ambiguo (multiples candidatos)");
      return null;
    }

    // 3) sin match: crear entidad nueva con clave 'nombre'
    const id = this.#create(ref.tipo, "nombre", nombreNorm, ref, nombreNorm);
    return { id_entidad: id, metodo: "nombre", confianza: CONFIANZA.nombre };
  }

  /** Vincula registro ↔ entidad (idempotente). */
  link(idEntidad, idInterno, metodo, confianza) {
    this.db.prepare(`
      INSERT INTO entidad_registros (id_entidad, id_interno, metodo, confianza)
      VALUES (?,?,?,?)
      ON CONFLICT(id_entidad, id_interno) DO UPDATE SET metodo=excluded.metodo, confianza=excluded.confianza
    `).run(idEntidad, idInterno, metodo, confianza);
  }

  /**
   * Nombre oficial de una entidad territorial. DIVIPOLA es la tabla maestra (M3):
   * el nombre que traiga la fuente es incidental y puede faltar, el código no.
   * No es inferencia — es leer el nombre en el registro autoritativo.
   */
  #nombreOficial(tipo, claveTipo, claveValor) {
    if (claveTipo !== "codigo") return null;
    try {
      if (tipo === "Departamento") {
        return this.db.prepare("SELECT dpto FROM divipola WHERE cod_dpto=? LIMIT 1")
          .get(String(claveValor).padStart(2, "0"))?.dpto ?? null;
      }
      if (tipo === "Municipio") {
        return this.db.prepare("SELECT nom_mpio FROM divipola WHERE cod_mpio=?")
          .get(String(claveValor).padStart(5, "0"))?.nom_mpio ?? null;
      }
    } catch { /* divipola aún sin poblar: se usa lo que traiga la fuente */ }
    return null;
  }

  #create(tipo, claveTipo, claveValor, ref, nombreNorm) {
    const id = `${tipo}:${claveTipo}:${claveValor}`;
    const nombre = this.#nombreOficial(tipo, claveTipo, claveValor) ?? ref.nombre ?? null;
    this.db.prepare(`
      INSERT INTO entidades (id_entidad, tipo, nombre_canonico, nombre_norm, clave_tipo, clave_valor, atributos, creado_en)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id_entidad) DO UPDATE SET
        -- solo rellena huecos: si la primera aparición vino sin nombre y una
        -- posterior lo trae, la entidad deja de quedar anónima. Nunca sobreescribe.
        nombre_canonico = COALESCE(entidades.nombre_canonico, excluded.nombre_canonico),
        nombre_norm     = COALESCE(entidades.nombre_norm, excluded.nombre_norm)
    `).run(id, tipo, nombre, nombre ? normName(nombre) : nombreNorm, claveTipo, String(claveValor),
           ref.atributos ? JSON.stringify(ref.atributos) : null, new Date().toISOString());
    return id;
  }

  #addAlias(idEntidad, aliasNorm, origen) {
    this.db.prepare(
      "INSERT OR IGNORE INTO entidad_alias (id_entidad, alias_norm, origen) VALUES (?,?,?)"
    ).run(idEntidad, aliasNorm, origen);
  }

  #enqueueRevision(ref, candidatos, motivo) {
    this.db.prepare(`
      INSERT INTO entidad_revision (tipo, nombre, id_interno, candidatos, motivo, creado_en)
      VALUES (?,?,?,?,?,?)
    `).run(ref.tipo, ref.nombre ?? null, ref.idInterno ?? null, JSON.stringify(candidatos), motivo, new Date().toISOString());
  }
}

// ---------------------------------------------------------------------------
// Extractores por dominio: de un registro unificado salen 0..N referencias de entidad.
// Añadir un dominio nuevo = añadir un extractor aquí.
// ---------------------------------------------------------------------------
export const EXTRACTORS = {
  territorio(reg, campos) {
    const refs = [];
    if (campos.cod_mpio) refs.push({ tipo: "Municipio", codigo: campos.cod_mpio, nombre: campos.nom_mpio, atributos: { dpto: campos.dpto } });
    if (campos.cod_dpto) refs.push({ tipo: "Departamento", codigo: campos.cod_dpto, nombre: campos.dpto });
    return refs;
  },
  economia(reg, campos) {
    const refs = [];
    if (reg.divipola_depto || campos.departamento) {
      refs.push({ tipo: "Departamento", codigo: reg.divipola_depto, nombre: campos.departamento });
    }
    return refs;
  },
  vial(reg, campos) {
    const refs = [];
    refs.push({ tipo: "TramoVial", codigo: campos.codigo_vial ?? reg.id_fuente, nombre: campos.nombre_tramo });
    if (reg.divipola_depto) refs.push({ tipo: "Departamento", codigo: reg.divipola_depto, nombre: campos.territorial });
    return refs;
  },
  contratacion(reg, campos) {
    const refs = [];
    if (campos.nit_entidad) refs.push({ tipo: "EntidadPublica", nit: campos.nit_entidad, nombre: campos.entidad });
    if (campos.documento_proveedor || campos.proveedor) {
      refs.push({ tipo: "Empresa", nit: campos.documento_proveedor, nombre: campos.proveedor });
    }
    refs.push({ tipo: "Contrato", codigo: contratoKey(campos) ?? reg.id_fuente, nombre: campos.referencia });
    if (reg.divipola_depto) refs.push({ tipo: "Departamento", codigo: reg.divipola_depto, nombre: campos.departamento });
    return refs;
  },
  entidades(reg, campos) {
    const refs = [];
    if (campos.nit || campos.razon_social) refs.push({ tipo: "EntidadPublica", nit: campos.nit, nombre: campos.razon_social });
    if (reg.divipola_depto) refs.push({ tipo: "Departamento", codigo: reg.divipola_depto, nombre: campos.departamento });
    return refs;
  },
};

// ---------------------------------------------------------------------------
// Dedupe SECOP I / II / Integrado (bloqueante #8 del CATALOGO).
// Fuente canónica: SECOP II electrónico (jbjy-vk9h); Integrado solo aporta lo
// que no exista ya en la canónica. La llave opera sobre `campos` canónicos
// (nit_entidad + referencia|proceso), independiente del nombre de columna de
// cada dataset — el mapRow de cada fuente ya normalizó.
// ---------------------------------------------------------------------------
export const SECOP_PRECEDENCE = ["jbjy-vk9h", "tb27-zmix", "rpmr-utcd"];

const normKey = (v) => (v == null ? "" : String(v).toUpperCase().replace(/[^A-Z0-9]/g, ""));

/** Llave natural del contrato; null si no hay con qué agrupar (fila queda como única). */
export function contratoKey(campos) {
  const ref = normKey(campos.referencia) || normKey(campos.proceso);
  const nit = normKey(campos.nit_entidad);
  return ref ? `${nit}:${ref}` : null;
}

/** Recalcula la tabla de dedupe completa. Idempotente y barato (solo dominio contratación). */
export function dedupeContratos(db) {
  migrateEntities(db);
  const rows = db.prepare(
    "SELECT id_interno, id_fuente, campos FROM registros WHERE dominio='contratacion'"
  ).all();

  const grupos = new Map();
  for (const r of rows) {
    const llave = contratoKey(JSON.parse(r.campos)) ?? `__unica__:${r.id_interno}`;
    if (!grupos.has(llave)) grupos.set(llave, []);
    grupos.get(llave).push(r);
  }

  // id_interno = `${sourceId}:${idFuente}` (core-model) → la fuente se lee del prefijo
  const rank = (idInterno) => {
    const i = SECOP_PRECEDENCE.findIndex((id) => idInterno.startsWith(`${id}:`));
    return i === -1 ? SECOP_PRECEDENCE.length : i;
  };

  const stats = { contratos: rows.length, grupos: grupos.size, duplicados: 0 };
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM contrato_dedupe");
    const ins = db.prepare(
      "INSERT INTO contrato_dedupe (id_interno, llave, id_canonico, preferida) VALUES (?,?,?,?)"
    );
    for (const [llave, grupo] of grupos) {
      grupo.sort((a, b) => rank(a.id_interno) - rank(b.id_interno) || a.id_interno.localeCompare(b.id_interno));
      const canonico = grupo[0].id_interno;
      for (const r of grupo) {
        const preferida = r.id_interno === canonico ? 1 : 0;
        if (!preferida) stats.duplicados++;
        ins.run(r.id_interno, llave, canonico, preferida);
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { resultado: "ok", ...stats };
}

/**
 * Corre resolución sobre los registros de un dominio (o todos si domain=null).
 * Idempotente: reejecutar no duplica entidades ni vínculos.
 */
export function resolveDomain(db, domain = null) {
  const resolver = new EntityResolver(db);
  const rows = domain
    ? db.prepare("SELECT id_interno, id_fuente, dominio, divipola_muni, divipola_depto, campos FROM registros WHERE dominio=?").all(domain)
    : db.prepare("SELECT id_interno, id_fuente, dominio, divipola_muni, divipola_depto, campos FROM registros").all();

  const stats = { registros: rows.length, vinculos: 0, sin_extractor: 0 };
  db.exec("BEGIN");
  try {
    for (const reg of rows) {
      const extract = EXTRACTORS[reg.dominio];
      if (!extract) { stats.sin_extractor++; continue; }
      const campos = JSON.parse(reg.campos);
      for (const ref of extract(reg, campos)) {
        const res = resolver.resolve({ ...ref, idInterno: reg.id_interno });
        if (!res) continue;
        resolver.link(res.id_entidad, reg.id_interno, res.metodo, res.confianza);
        stats.vinculos++;
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  stats.entidades = db.prepare("SELECT COUNT(*) c FROM entidades").get().c;
  stats.revision = db.prepare("SELECT COUNT(*) c FROM entidad_revision WHERE resuelto=0").get().c;
  if (domain === null || domain === "contratacion") {
    stats.dedupe = dedupeContratos(db);
  }
  return { resultado: "ok", ...stats };
}
