import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../packages/metadata/registry.js";
import { loadDivipola, DivipolaResolver } from "../packages/divipola/index.js";
import {
  pickField, suggestMapping, profileFeatures, coberturaTerritorial, esUrlDeServicio,
} from "../services/arcgis-explorer/index.js";
import { DICCIONARIO_MINERIA, mapRowMineria, anmSources } from "../services/connectors/sources.config.js";
import { discover } from "../services/connectors/arcgis.js";

// Esquema al estilo ANM: mayúsculas, con tilde y abreviaturas mezcladas.
const CAMPOS = [
  { nombre: "OBJECTID", tipo: "esriFieldTypeOID" },
  { nombre: "CODIGO_EXPEDIENTE", tipo: "esriFieldTypeString" },
  { nombre: "NOMBRE_TITULAR", tipo: "esriFieldTypeString" },
  { nombre: "MINERALES", tipo: "esriFieldTypeString" },
  { nombre: "ESTADO", tipo: "esriFieldTypeString" },
  { nombre: "ETAPA", tipo: "esriFieldTypeString" },
  { nombre: "AREA_HECTAREAS", tipo: "esriFieldTypeDouble" },
  { nombre: "FECHA_INSCRIPCION", tipo: "esriFieldTypeDate" },
  { nombre: "MUNICIPIO", tipo: "esriFieldTypeString" },
  { nombre: "DEPARTAMENTO", tipo: "esriFieldTypeString" },
];

const feature = (props, geom) => ({
  type: "Feature",
  properties: props,
  geometry: geom ?? { type: "Polygon", coordinates: [[[-75.6, 6.2], [-75.5, 6.2], [-75.5, 6.3], [-75.6, 6.2]]] },
});

function ctxCon(resolver, source = {}) {
  return { resolver, source, suggestMapping };
}

function dbConDivipola() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  loadDivipola(db, [
    { cod_mpio: "05001", cod_dpto: "05", nom_mpio: "MEDELLÍN", dpto: "ANTIOQUIA", latitud: "6.25", longitud: "-75.56" },
    { cod_mpio: "05045", cod_dpto: "05", nom_mpio: "APARTADÓ", dpto: "ANTIOQUIA", latitud: "7.88", longitud: "-76.62" },
    { cod_mpio: "27001", cod_dpto: "27", nom_mpio: "QUIBDÓ", dpto: "CHOCÓ", latitud: "5.69", longitud: "-76.66" },
  ]);
  return db;
}

test("pickField resuelve alias por acentos, mayúsculas y separadores", () => {
  assert.equal(pickField(CAMPOS, ["CODIGO_EXPEDIENTE"]), "CODIGO_EXPEDIENTE");
  assert.equal(pickField(CAMPOS, ["codigo expediente"]), "CODIGO_EXPEDIENTE");
  assert.equal(pickField(CAMPOS, ["TITULAR", "NOMBRE_TITULAR"]), "NOMBRE_TITULAR");
  assert.equal(pickField(CAMPOS, ["NO_EXISTE_NADA_ASI"]), null);
});

test("suggestMapping mapea el esquema ANM y reporta lo que falta", () => {
  const { mapeo, faltantes } = suggestMapping(CAMPOS, DICCIONARIO_MINERIA);
  assert.equal(mapeo.expediente, "CODIGO_EXPEDIENTE");
  assert.equal(mapeo.titular, "NOMBRE_TITULAR");
  assert.equal(mapeo.mineral, "MINERALES");
  assert.equal(mapeo.area_ha, "AREA_HECTAREAS");
  // la capa de ejemplo no trae terminación ni documento: deben aparecer como faltantes
  assert.ok(faltantes.includes("fecha_terminacion"));
  assert.ok(faltantes.includes("documento_titular"));
});

test("mapRowMineria normaliza campos, fecha epoch→ISO y resuelve DIVIPOLA por nombre+depto", () => {
  const db = dbConDivipola();
  const ctx = ctxCon(new DivipolaResolver(db));
  const out = mapRowMineria(feature({
    OBJECTID: 1, CODIGO_EXPEDIENTE: "HIQ-08001X", NOMBRE_TITULAR: "MINERA ANDINA S.A.S.",
    MINERALES: "ORO", ESTADO: "Vigente", ETAPA: "Explotación",
    AREA_HECTAREAS: "1250.5", FECHA_INSCRIPCION: 1451606400000, // 2016-01-01
    MUNICIPIO: "MEDELLÍN", DEPARTAMENTO: "ANTIOQUIA",
  }), ctx);

  assert.equal(out.idFuente, "HIQ-08001X");
  assert.equal(out.campos.titular, "MINERA ANDINA S.A.S.");
  assert.equal(out.campos.area_ha, 1250.5, "área numérica, no string");
  assert.equal(out.campos.fecha_inscripcion, "2016-01-01", "epoch ms → ISO");
  assert.equal(out.campos.fecha_terminacion, null, "campo ausente en la capa → null, no undefined");
  assert.deepEqual(out.divipola, { nombre: "MEDELLÍN", depto: "ANTIOQUIA" });
  assert.equal(out.deptoCode, "05");
  assert.ok(out.geom.type === "Polygon");
  assert.match(out.searchBlob, /HIQ-08001X/);
});

test("área ausente entra como null, nunca como 0 (no contamina SUM/AVG)", () => {
  const ctx = ctxCon(null, {});
  for (const vacio of [null, "", undefined]) {
    const out = mapRowMineria(feature({ CODIGO_EXPEDIENTE: "A-1", AREA_HECTAREAS: vacio }), ctx);
    assert.equal(out.campos.area_ha, null, `AREA_HECTAREAS=${JSON.stringify(vacio)} debe ser null`);
  }
  const noNumerica = mapRowMineria(feature({ CODIGO_EXPEDIENTE: "A-2", AREA_HECTAREAS: "s/d" }), ctx);
  assert.equal(noNumerica.campos.area_ha, null);
  const cero = mapRowMineria(feature({ CODIGO_EXPEDIENTE: "A-3", AREA_HECTAREAS: 0 }), ctx);
  assert.equal(cero.campos.area_ha, 0, "un 0 real sí se conserva");
});

test("título multi-municipio no se ancla a un municipio: cae a departamento", () => {
  const db = dbConDivipola();
  const ctx = ctxCon(new DivipolaResolver(db));
  const out = mapRowMineria(feature({
    CODIGO_EXPEDIENTE: "ABC-123", MUNICIPIO: "MEDELLÍN; APARTADÓ", DEPARTAMENTO: "ANTIOQUIA",
  }), ctx);
  assert.equal(out.divipola, undefined, "lista de municipios → sin match de municipio");
  assert.equal(out.deptoCode, "05", "pero sí conserva el departamento");
  assert.equal(out.campos.municipio, "MEDELLÍN; APARTADÓ", "el valor original nunca se descarta");
});

test("capa sin campo de expediente falla ruidosamente en vez de ingerir nulls", () => {
  const ctx = ctxCon(null);
  assert.throws(
    () => mapRowMineria(feature({ FOO: 1, BAR: "x" }), ctx),
    /sin campo de expediente reconocible/
  );
});

test("el mapeo se resuelve una sola vez por capa (memoizado en la fuente)", () => {
  const db = dbConDivipola();
  const source = {};
  const ctx = ctxCon(new DivipolaResolver(db), source);
  mapRowMineria(feature({ CODIGO_EXPEDIENTE: "A-1", MUNICIPIO: "QUIBDÓ", DEPARTAMENTO: "CHOCÓ" }), ctx);
  assert.equal(source._mapeo.expediente, "CODIGO_EXPEDIENTE");
  const antes = source._mapeo;
  mapRowMineria(feature({ CODIGO_EXPEDIENTE: "A-2", MUNICIPIO: "QUIBDÓ", DEPARTAMENTO: "CHOCÓ" }), ctx);
  assert.equal(source._mapeo, antes, "no se recalcula por fila");
});

test("profileFeatures mide nulos, cardinalidad, rango numérico y geometrías colapsadas", () => {
  const feats = [
    feature({ A: "x", N: 10, C: "k" }),
    feature({ A: "", N: 20, C: "k" }),
    feature({ A: "y", N: null, C: "k" }, { type: "Polygon", coordinates: [[[-75, 6]]] }), // 1 vértice
  ];
  const p = profileFeatures(feats);
  const col = (n) => p.columnas.find((c) => c.columna === n);
  assert.equal(col("A").nulos_pct, 33.3);
  assert.equal(col("C").constante, true, "columna de un solo valor se marca constante");
  assert.equal(col("N").numerica.min, 10);
  assert.equal(col("N").numerica.max, 20);
  assert.equal(p.geometria.con_geometria_pct, 100);
  assert.equal(p.geometria.colapsadas, 1, "geometría de <3 vértices = polígono colapsado");
});

test("coberturaTerritorial mide cuánto cruza realmente contra DIVIPOLA", () => {
  const db = dbConDivipola();
  const feats = [
    feature({ MUNICIPIO: "MEDELLÍN", DEPARTAMENTO: "ANTIOQUIA" }),
    feature({ MUNICIPIO: "QUIBDÓ", DEPARTAMENTO: "CHOCÓ" }),
    feature({ MUNICIPIO: "PUEBLO INEXISTENTE", DEPARTAMENTO: "ANTIOQUIA" }),
    feature({ MUNICIPIO: "", DEPARTAMENTO: "" }),
  ];
  const c = coberturaTerritorial(feats, {
    campoMuni: "MUNICIPIO", campoDepto: "DEPARTAMENTO", resolver: new DivipolaResolver(db),
  });
  assert.equal(c.con_municipio_pct, 75, "3 de 4 traen municipio");
  assert.equal(c.resuelve_municipio_pct, 50, "solo 2 de 4 cruzan de verdad");
  assert.equal(c.resuelve_departamento_pct, 75);
});

test("esUrlDeServicio distingue servicio de capa", () => {
  assert.equal(esUrlDeServicio("https://x/rest/services/ANM/S/MapServer"), true);
  assert.equal(esUrlDeServicio("https://x/rest/services/ANM/S/MapServer/"), true);
  assert.equal(esUrlDeServicio("https://x/rest/services/ANM/S/MapServer/3"), false);
});

test("discover rechaza una URL de servicio con instrucción accionable", async () => {
  await assert.rejects(
    () => discover({ id: "anm", endpoint: "https://x/rest/services/ANM/S/MapServer" }),
    /apunta al servicio, no a una capa/
  );
});

test("anmSources se registra solo si ANM_CAPAS está declarado", () => {
  assert.deepEqual(anmSources(undefined), []);
  const ss = anmSources("3:titulos,7");
  assert.equal(ss.length, 2);
  assert.equal(ss[0].id, "anm-titulos");
  assert.equal(ss[0].domain, "mineria");
  assert.ok(ss[0].endpoint.endsWith("/3"));
  assert.equal(ss[1].id, "anm-7");
  assert.throws(() => anmSources("abc"), /ANM_CAPAS inválido/);
});
