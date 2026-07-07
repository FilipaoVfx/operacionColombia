import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, WriteStore } from "../packages/metadata/registry.js";
import { buildRecord } from "../packages/core-model/index.js";
import { EntityResolver, resolveDomain } from "../services/entity-res/index.js";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

test("NIT unifica: múltiples grafías de proveedor → 1 sola entidad", () => {
  const r = new EntityResolver(freshDb());
  const a = r.resolve({ tipo: "Empresa", nit: "900123456", nombre: "Constructora El Cóndor S.A." });
  const b = r.resolve({ tipo: "Empresa", nit: "900123456", nombre: "CONSTRUCTORA EL CONDOR SA" });
  assert.equal(a.id_entidad, b.id_entidad);
  assert.equal(a.confianza, 1.0);
  // ambas grafías quedan como alias
  const aliases = r.db.prepare("SELECT COUNT(*) c FROM entidad_alias WHERE id_entidad=?").get(a.id_entidad);
  assert.ok(aliases.c >= 2);
});

test("nombre normalizado: acentos/mayúsculas/puntuación resuelven a la misma entidad", () => {
  const r = new EntityResolver(freshDb());
  const a = r.resolve({ tipo: "Departamento", nombre: "Bogotá D.C." });
  const b = r.resolve({ tipo: "Departamento", nombre: "BOGOTA D,C" });
  assert.equal(a.id_entidad, b.id_entidad);
});

test("nombre ambiguo (2+ candidatos) va a cola de revisión, no se fusiona", () => {
  const db = freshDb();
  const r = new EntityResolver(db);
  // dos empresas distintas (NITs distintos) que comparten grafía observada
  r.resolve({ tipo: "Empresa", nit: "1", nombre: "ACME" });
  r.resolve({ tipo: "Empresa", nit: "2", nombre: "ACME" });
  const res = r.resolve({ tipo: "Empresa", nombre: "ACME" });
  assert.equal(res, null, "ambiguo no resuelve en caliente");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM entidad_revision WHERE resuelto=0").get().c, 1);
});

test("resolveDomain es idempotente: reejecutar no duplica entidades ni vínculos", () => {
  const db = freshDb();
  const store = new WriteStore(db);
  const source = { id: "s1", domain: "territorio", nombre: "S", endpoint: "http://x", kind: "socrata" };
  store.upsert(buildRecord({
    source, idFuente: "05001",
    campos: { cod_mpio: "05001", nom_mpio: "Medellín", cod_dpto: "05", dpto: "Antioquia" },
  }));
  const first = resolveDomain(db, "territorio");
  const second = resolveDomain(db, "territorio");
  assert.equal(first.entidades, second.entidades);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM entidad_registros").get().c, 2, "Municipio + Departamento");
});
