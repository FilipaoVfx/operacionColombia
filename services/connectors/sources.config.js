// Registro de fuentes (PLANNING M1). Añadir un dominio nuevo = añadir una entrada aquí.
// mapRow(row, ctx) devuelve lo que buildRecord necesita; ctx.resolver es DivipolaResolver (M3).
import { validateSourceConfig } from "../../packages/contracts/index.js";
import { TERRITORIAL, DEPARTAMENTOS } from "../../src/domains.js";

// territoriales INVIAS cuyo nombre difiere del oficial DIVIPOLA
const TERRITORIAL_ALIAS = { GUAJIRA: "LA GUAJIRA" };

// departamento CHIP viene como "DEPARTAMENTO DE X" / "DEPARTAMENTO DEL X"; algunos
// nombres además difieren del oficial DIVIPOLA.
const CHIP_DEPTO_ALIAS = {
  GUAJIRA: "LA GUAJIRA",
  "ARCHIPIELAGO DE SAN ANDRES": "ARCHIPIÉLAGO DE SAN ANDRÉS, PROVIDENCIA Y SANTA CATALINA",
  "DISTRITO CAPITAL": "BOGOTA D.C.",
};
function chipDeptoName(raw) {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/^DEPARTAMENTO DEL? /, "").trim();
  return CHIP_DEPTO_ALIAS[s] ?? s;
}

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
  {
    id: "jbjy-vk9h",
    kind: "socrata",
    domain: "contratacion",
    nombre: "Colombia Compra Eficiente — SECOP II contratos grandes (2026)",
    endpoint: "https://www.datos.gov.co/resource/jbjy-vk9h.json",
    licencia: "CC BY-SA 4.0 (datos.gov.co)",
    priority: "P1",
    schedule: "mensual",
    // corte piloto: SECOP II tiene decenas de millones de filas; se limita a
    // contratos grandes (>500M COP) firmados en 2026 (~11k filas) para un
    // primer corte manejable. Ampliar rango de años en iteración futura.
    where: "fecha_de_firma between '2026-01-01T00:00:00.000' and '2026-12-31T23:59:59.000' AND valor_del_contrato > 500000000",
    mapRow(row, ctx) {
      const num = (s) => { const n = Number(s); return Number.isFinite(n) ? n : null; };
      const codDepto = ctx.resolver?.resolveDepto({ nombre: row.departamento });
      return {
        idFuente: row.id_contrato,
        campos: {
          entidad: row.nombre_entidad,
          nit_entidad: row.nit_entidad,
          departamento: row.departamento,
          ciudad: row.ciudad,
          sector: row.sector,
          orden: row.orden,
          proceso: row.proceso_de_compra,
          referencia: row.referencia_del_contrato,
          estado: row.estado_contrato,
          tipo_contrato: row.tipo_de_contrato,
          modalidad: row.modalidad_de_contratacion,
          fecha_firma: row.fecha_de_firma,
          anio: row.fecha_de_firma ? Number(String(row.fecha_de_firma).slice(0, 4)) : null,
          proveedor: row.proveedor_adjudicado,
          documento_proveedor: row.documento_proveedor,
          es_pyme: row.es_pyme,
          valor_contrato: num(row.valor_del_contrato),
          valor_pagado: num(row.valor_pagado),
          objeto: row.objeto_del_contrato || row.descripcion_del_proceso || null,
          url_proceso: row.urlproceso?.url ?? null,
        },
        extra: row,
        deptoCode: codDepto,
        searchBlob: `${row.nombre_entidad ?? ""} ${row.proveedor_adjudicado ?? ""} ${row.objeto_del_contrato ?? ""} ${row.referencia_del_contrato ?? ""} ${row.departamento ?? ""}`,
      };
    },
  },
  {
    id: "5c7g-ptic",
    kind: "socrata",
    domain: "entidades",
    nombre: "Contaduría General de la Nación — Entidades registradas en el CHIP",
    endpoint: "https://www.datos.gov.co/resource/5c7g-ptic.json",
    licencia: "CC BY-SA 4.0 (datos.gov.co)",
    priority: "P0",
    schedule: "trimestral",
    // catálogo: solo el corte más reciente (evita duplicar ~95k filas históricas por período)
    where: "a_o='2026' AND periodo='ENERO-MARZO'",
    mapRow(row, ctx) {
      const deptoName = chipDeptoName(row.departamento);
      const codDepto = deptoName ? ctx.resolver?.resolveDepto({ nombre: deptoName }) : null;
      return {
        idFuente: row.id_entidad,
        campos: {
          nit: row.nit,
          razon_social: row.razon_social,
          departamento: row.departamento,
          ciudad: row.ciudad,
          direccion: row.direcci_n,
          telefono: row.tel_fono,
          email: row.e_mail,
          pagina_web: row.p_gina_web?.url ?? null,
          anio: Number(row.a_o) || row.a_o,
          periodo: row.periodo,
        },
        extra: row,
        deptoCode: codDepto,
        searchBlob: `${row.razon_social ?? ""} ${row.nit ?? ""} ${row.departamento ?? ""} ${row.ciudad ?? ""}`,
      };
    },
  },
].map(validateSourceConfig);

export function getSource(id) {
  const s = SOURCES.find((s) => s.id === id);
  if (!s) throw new Error(`fuente desconocida: ${id}. Disponibles: ${SOURCES.map((x) => x.id).join(", ")}`);
  return s;
}
