// Registro de fuentes (PLANNING M1). Añadir un dominio nuevo = añadir una entrada aquí.
// mapRow(row, ctx) devuelve lo que buildRecord necesita; ctx.resolver es DivipolaResolver (M3).
import { validateSourceConfig } from "../../packages/contracts/index.js";
import { TERRITORIAL, DEPARTAMENTOS } from "../../src/domains.js";

// territoriales INVIAS cuyo nombre difiere del oficial DIVIPOLA
const TERRITORIAL_ALIAS = { GUAJIRA: "LA GUAJIRA" };

export const SOURCES = [
  {
    id: "gdxc-w37w",
    kind: "socrata",
    domain: "territorio",
    nombre: "DANE — DIVIPOLA códigos municipios",
    endpoint: "https://www.datos.gov.co/resource/gdxc-w37w.json",
    licencia: "CC BY-SA 4.0 (datos.gov.co)",
    priority: "P0",
    schedule: "anual",
    // fuente maestra: además de registros unificados, puebla la tabla divipola (ver cli.js)
    isDivipolaMaster: true,
    mapRow(row) {
      const num = (s) => Number(String(s ?? "").replace(",", "."));
      return {
        idFuente: row.cod_mpio ?? row[":id"],
        campos: {
          cod_dpto: row.cod_dpto, dpto: row.dpto,
          cod_mpio: row.cod_mpio, nom_mpio: row.nom_mpio,
          tipo: row.tipo_municipio,
        },
        extra: row,
        geom: Number.isFinite(num(row.longitud)) && Number.isFinite(num(row.latitud))
          ? { type: "Point", coordinates: [num(row.longitud), num(row.latitud)] }
          : null,
        divipola: { codigo: row.cod_mpio },
        searchBlob: `${row.cod_mpio} ${row.nom_mpio} ${row.dpto}`,
      };
    },
  },
  {
    id: "kgyi-qc7j",
    kind: "socrata",
    domain: "economia",
    nombre: "DANE — PIB departamental por actividad",
    endpoint: "https://www.datos.gov.co/resource/kgyi-qc7j.json",
    licencia: "CC BY-SA 4.0 (datos.gov.co)",
    priority: "P1",
    schedule: "anual",
    mapRow(row, ctx) {
      const codDepto = ctx.resolver?.resolveDepto({
        codigo: row.c_digo_departamento_divipola,
        nombre: row.departamento,
      });
      return {
        idFuente: row[":id"],
        campos: {
          anio: Number(row.a_o) || row.a_o,
          actividad: row.actividad,
          sector: row.sector,
          tipo_precios: row.tipo_de_precios,
          departamento: row.departamento,
          valor_miles_millones: Number(row.valor_miles_de_millones_de) || null,
        },
        extra: row,
        deptoCode: codDepto,
        searchBlob: `${row.departamento} ${row.actividad} ${row.sector} ${row.a_o}`,
      };
    },
  },
  {
    id: "2pnw-mmge",
    kind: "socrata",
    domain: "agro",
    nombre: "MinAgricultura — EVA Evaluaciones Agropecuarias Municipales",
    endpoint: "https://www.datos.gov.co/resource/2pnw-mmge.json",
    licencia: "CC BY-SA 4.0 (datos.gov.co)",
    priority: "P1",
    schedule: "anual",
    // catálogo (§EVA): solo el corte más reciente del dataset (hoy 2018; la fuente dejó de actualizarse)
    where: "a_o='2018'",
    mapRow(row) {
      const num = (s) => { const n = Number(s); return Number.isFinite(n) ? n : null; };
      return {
        idFuente: row[":id"],
        campos: {
          anio: Number(row.a_o) || row.a_o,
          periodo: row.periodo ?? null,
          municipio: row.municipio,
          departamento: row.departamento,
          grupo_cultivo: row.grupo_de_cultivo ?? null,
          cultivo: row.cultivo,
          ciclo: row.ciclo_de_cultivo ?? null,
          area_sembrada_ha: num(row.rea_sembrada_ha),
          area_cosechada_ha: num(row.rea_cosechada_ha),
          produccion_t: num(row.producci_n_t),
          rendimiento_t_ha: num(row.rendimiento_t_ha),
        },
        extra: row,
        divipola: { codigo: row.c_d_mun, nombre: row.municipio, depto: row.departamento },
        searchBlob: `${row.cultivo} ${row.grupo_de_cultivo ?? ""} ${row.municipio} ${row.departamento} ${row.a_o}`,
      };
    },
  },
  {
    id: "invias-red-vial",
    kind: "arcgis",
    domain: "vial",
    nombre: "INVIAS — Red Vial Nacional (ArcGIS)",
    endpoint: "https://hermes2.invias.gov.co/server/rest/services/MapaCarreteras/RedVial/MapServer/1",
    licencia: "Datos abiertos INVIAS",
    priority: "P0",
    schedule: "mensual",
    mapRow(feature, ctx) {
      const p = feature.properties || {};
      // territorial INVIAS ≈ departamento; las administrativas (ANI, Planta Central…) no resuelven
      const territorial = TERRITORIAL[p.territorial] ?? null;
      const deptoName = territorial && DEPARTAMENTOS.has(territorial)
        ? (TERRITORIAL_ALIAS[territorial.toUpperCase()] ?? territorial)
        : null;
      const codDepto = deptoName ? ctx.resolver?.resolveDepto({ nombre: deptoName }) : null;
      const stLen = Number(p["st_length(shape)"]);
      return {
        idFuente: p.globalid || p.objectid,
        campos: {
          codigo_vial: p.codigotramo ?? null,
          nombre_tramo: p.nombretramo || p.nombreruta || p.sector || "Sin nombre",
          ruta: p.nombreruta ?? null,
          sector: p.sector ?? null,
          territorial,
          longitud_km: Number.isFinite(stLen) && stLen > 0 ? Math.round(stLen) / 1000 : null,
          categoria_code: p.categoria ?? null,
          superficie_code: p.superficie ?? null,
        },
        extra: p,
        geom: feature.geometry ?? null,
        deptoCode: codDepto,
        searchBlob: `${p.codigotramo ?? ""} ${p.nombretramo ?? ""} ${p.nombreruta ?? ""} ${p.sector ?? ""} ${territorial ?? ""}`,
      };
    },
  },
].map(validateSourceConfig);

export function getSource(id) {
  const s = SOURCES.find((s) => s.id === id);
  if (!s) throw new Error(`fuente desconocida: ${id}. Disponibles: ${SOURCES.map((x) => x.id).join(", ")}`);
  return s;
}
