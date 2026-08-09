import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCES, getSource } from "../services/connectors/sources.config.js";
import * as socrata from "../services/connectors/socrata.js";
import * as arcgis from "../services/connectors/arcgis.js";
import { assertConnector } from "../packages/contracts/index.js";

test("todas las fuentes registradas validan el contrato SourceConfig", () => {
  assert.ok(SOURCES.length >= 3);
  assert.equal(getSource("gdxc-w37w").domain, "territorio");
  assert.throws(() => getSource("no-existe"));
});

test("conectores implementan el contrato Connector (§6.1)", () => {
  assertConnector(socrata, "socrata");
  assertConnector(arcgis, "arcgis");
});

test("mapRow DIVIPOLA produce punto WGS84 y campos canónicos", () => {
  const s = getSource("gdxc-w37w");
  const m = s.mapRow({ cod_dpto: "05", dpto: "ANTIOQUIA", cod_mpio: "05001", nom_mpio: "MEDELLÍN", longitud: "-75,58", latitud: "6,24" });
  assert.equal(m.idFuente, "05001");
  assert.deepEqual(m.geom, { type: "Point", coordinates: [-75.58, 6.24] });
  assert.equal(m.campos.nom_mpio, "MEDELLÍN");
});

test("mapRow PIB resuelve depto vía resolver", () => {
  const s = getSource("kgyi-qc7j");
  const fakeResolver = { resolveDepto: ({ codigo }) => (codigo === "97" ? "97" : null) };
  const m = s.mapRow(
    { ":id": "row-1", a_o: "2005", actividad: "Construcción", c_digo_departamento_divipola: "97", departamento: "Vaupés", valor_miles_de_millones_de: "2.28" },
    { resolver: fakeResolver }
  );
  assert.equal(m.deptoCode, "97");
  assert.equal(m.campos.valor_miles_millones, 2.28);
  assert.equal(m.campos.anio, 2005);
});

test("mapRow SECOP contratos: campos canónicos + año derivado de fecha_de_firma", () => {
  const s = getSource("jbjy-vk9h");
  const fakeResolver = { resolveDepto: ({ nombre }) => (nombre === "Antioquia" ? "05" : null) };
  const m = s.mapRow(
    {
      id_contrato: "CO1.PCCNTR.1",
      nombre_entidad: "ALCALDIA DE MEDELLIN",
      nit_entidad: "890905211",
      departamento: "Antioquia",
      ciudad: "Medellín",
      fecha_de_firma: "2026-03-15T00:00:00.000",
      proveedor_adjudicado: "CONSTRUCTORA XYZ SAS",
      valor_del_contrato: "750000000",
      valor_pagado: "100000000",
      urlproceso: { url: "https://community.secop.gov.co/x" },
    },
    { resolver: fakeResolver }
  );
  assert.equal(m.idFuente, "CO1.PCCNTR.1");
  assert.equal(m.deptoCode, "05");
  assert.equal(m.campos.anio, 2026);
  assert.equal(m.campos.valor_contrato, 750000000);
  assert.equal(m.campos.url_proceso, "https://community.secop.gov.co/x");
  assert.match(m.searchBlob, /CONSTRUCTORA XYZ SAS/);
});

test("mapRow CHIP entidades: alias de departamento (DEPARTAMENTO DE/DEL + casos especiales)", () => {
  const s = getSource("5c7g-ptic");
  const seen = [];
  const fakeResolver = { resolveDepto: ({ nombre }) => { seen.push(nombre); return "44"; } };
  const m = s.mapRow(
    {
      id_entidad: "1",
      nit: "800.123.456",
      razon_social: "EMPRESA DE SERVICIOS PUBLICOS",
      departamento: "DEPARTAMENTO DE LA GUAJIRA",
      ciudad: "Riohacha",
      a_o: "2026",
      periodo: "ENERO-MARZO",
    },
    { resolver: fakeResolver }
  );
  assert.equal(seen[0], "LA GUAJIRA");
  assert.equal(m.deptoCode, "44");
  assert.equal(m.campos.razon_social, "EMPRESA DE SERVICIOS PUBLICOS");
  assert.equal(m.campos.anio, 2026);
});
