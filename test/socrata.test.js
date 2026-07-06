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
