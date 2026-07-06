// M3 — DIVIPOLA: tabla maestra territorial + resolución de municipio/depto (llave de cruce).
import { normName } from "../core-model/index.js";

const numCo = (s) => Number(String(s ?? "").replace(",", "."));

/** Puebla la tabla divipola desde filas del dataset gdxc-w37w (datos.gov.co). */
export function loadDivipola(db, rows) {
  const ins = db.prepare(`
    INSERT INTO divipola (cod_mpio, cod_dpto, nom_mpio, dpto, mpio_norm, dpto_norm, lat, lon)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(cod_mpio) DO UPDATE SET
      cod_dpto=excluded.cod_dpto, nom_mpio=excluded.nom_mpio, dpto=excluded.dpto,
      mpio_norm=excluded.mpio_norm, dpto_norm=excluded.dpto_norm, lat=excluded.lat, lon=excluded.lon
  `);
  let n = 0;
  db.exec("BEGIN");
  try {
    for (const r of rows) {
      if (!r.cod_mpio) continue;
      ins.run(
        String(r.cod_mpio).padStart(5, "0"),
        String(r.cod_dpto).padStart(2, "0"),
        r.nom_mpio ?? null, r.dpto ?? null,
        normName(r.nom_mpio), normName(r.dpto),
        numCo(r.latitud) || null, numCo(r.longitud) || null
      );
      n++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return n;
}

export class DivipolaResolver {
  constructor(db) {
    this.db = db;
    this.byCode = db.prepare("SELECT * FROM divipola WHERE cod_mpio=?");
    this.byName = db.prepare("SELECT * FROM divipola WHERE mpio_norm=?");
    this.byNameDepto = db.prepare("SELECT * FROM divipola WHERE mpio_norm=? AND dpto_norm=?");
    this.deptoByCode = db.prepare("SELECT DISTINCT cod_dpto, dpto FROM divipola WHERE cod_dpto=?");
    this.deptoByName = db.prepare("SELECT DISTINCT cod_dpto, dpto FROM divipola WHERE dpto_norm=?");
  }

  /** Municipio → {cod_mpio, cod_dpto} | null. Nombres ambiguos exigen depto (PLANNING M3 riesgo). */
  resolveMunicipio({ codigo, nombre, depto }) {
    if (codigo) {
      const hit = this.byCode.get(String(codigo).padStart(5, "0"));
      if (hit) return { cod_mpio: hit.cod_mpio, cod_dpto: hit.cod_dpto, via: "codigo" };
    }
    if (nombre) {
      const nn = normName(nombre);
      if (depto) {
        const hit = this.byNameDepto.get(nn, normName(depto));
        if (hit) return { cod_mpio: hit.cod_mpio, cod_dpto: hit.cod_dpto, via: "nombre+depto" };
      }
      const all = this.byName.all(nn);
      if (all.length === 1) return { cod_mpio: all[0].cod_mpio, cod_dpto: all[0].cod_dpto, via: "nombre" };
      // ambiguo (ej. "SAN ANTONIO" en varios deptos) → sin depto no se resuelve
    }
    return null;
  }

  /** Departamento → cod_dpto | null (por código de 2 dígitos o nombre normalizado). */
  resolveDepto({ codigo, nombre }) {
    if (codigo != null && String(codigo).trim() !== "") {
      const hit = this.deptoByCode.get(String(codigo).padStart(2, "0"));
      if (hit) return hit.cod_dpto;
    }
    if (nombre) {
      const hit = this.deptoByName.get(normName(nombre));
      if (hit) return hit.cod_dpto;
    }
    return null;
  }
}
