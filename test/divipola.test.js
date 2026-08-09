import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../packages/metadata/registry.js";
import { loadDivipola, DivipolaResolver } from "../packages/divipola/index.js";

function dbWithData() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  loadDivipola(db, [
    { cod_dpto: "05", dpto: "ANTIOQUIA", cod_mpio: "05001", nom_mpio: "MEDELLÍN", latitud: "6,246631", longitud: "-75,581775" },
    { cod_dpto: "73", dpto: "TOLIMA", cod_mpio: "73675", nom_mpio: "SAN ANTONIO" },
    { cod_dpto: "52", dpto: "NARIÑO", cod_mpio: "52678", nom_mpio: "SAN ANTONIO" },
  ]);
  return db;
}

test("resolución por código", () => {
  const r = new DivipolaResolver(dbWithData());
  assert.deepEqual(r.resolveMunicipio({ codigo: "05001" }), { cod_mpio: "05001", cod_dpto: "05", via: "codigo" });
});

test("resolución por nombre normalizado (acentos fuera)", () => {
  const r = new DivipolaResolver(dbWithData());
  assert.equal(r.resolveMunicipio({ nombre: "medellin" }).cod_mpio, "05001");
});

test("nombre ambiguo requiere depto (caso San Antonio, PLANNING M3)", () => {
  const r = new DivipolaResolver(dbWithData());
  assert.equal(r.resolveMunicipio({ nombre: "San Antonio" }), null);
  assert.equal(r.resolveMunicipio({ nombre: "San Antonio", depto: "Tolima" }).cod_mpio, "73675");
});

test("resolveDepto por código y nombre", () => {
  const r = new DivipolaResolver(dbWithData());
  assert.equal(r.resolveDepto({ codigo: "5" }), "05");
  assert.equal(r.resolveDepto({ nombre: "nariño" }), "52");
  assert.equal(r.resolveDepto({ nombre: "inexistente" }), null);
});
