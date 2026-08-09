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

// --- M6 dedupe SECOP (bloqueante #8) ---
import { dedupeContratos, contratoKey } from "../services/entity-res/index.js";

test("dedupe SECOP: mismo contrato en SECOP II e Integrado → 1 preferida (SECOP II)", () => {
  const db = freshDb();
  const store = new WriteStore(db);
  const mk = (sourceId, idFuente, campos) => buildRecord({
    source: { id: sourceId, domain: "contratacion", nombre: sourceId, endpoint: "http://x", kind: "socrata" },
    idFuente, campos,
  });
  // mismo contrato: misma entidad + referencia, distinta grafía entre datasets
  store.upsert(mk("jbjy-vk9h", "CO1.123", { nit_entidad: "899999.063", referencia: "CD-2026-001", valor_contrato: 900e6 }));
  store.upsert(mk("rpmr-utcd", "999888", { nit_entidad: "899999063", referencia: "cd 2026 001", valor_contrato: 900e6 }));
  // contrato distinto: no se agrupa
  store.upsert(mk("rpmr-utcd", "999889", { nit_entidad: "899999063", referencia: "CD-2026-002", valor_contrato: 100e6 }));

  const res = dedupeContratos(db);
  assert.equal(res.contratos, 3);
  assert.equal(res.grupos, 2);
  assert.equal(res.duplicados, 1);
  const pref = db.prepare("SELECT id_canonico FROM contrato_dedupe WHERE id_interno=?").get("rpmr-utcd:999888");
  assert.equal(pref.id_canonico, "jbjy-vk9h:CO1.123", "canónica es la de SECOP II");
  assert.equal(db.prepare("SELECT preferida FROM contrato_dedupe WHERE id_interno=?").get("jbjy-vk9h:CO1.123").preferida, 1);
});

test("dedupe: sin referencia ni proceso la fila queda como única (no colapsa por accidente)", () => {
  assert.equal(contratoKey({ nit_entidad: "1" }), null);
  assert.equal(contratoKey({ referencia: "A-1", nit_entidad: "800.100" }), "800100:A1");
});

test("vistas de contratación excluyen duplicados (COALESCE preferida)", async () => {
  const { migrateViews, buildViews } = await import("../services/views-builder/index.js");
  const db = freshDb();
  migrateViews(db);
  const store = new WriteStore(db);
  const mk = (sourceId, idFuente, campos) => buildRecord({
    source: { id: sourceId, domain: "contratacion", nombre: sourceId, endpoint: "http://x", kind: "socrata" },
    idFuente, campos, divipola_depto: "11",
  });
  store.upsert(mk("jbjy-vk9h", "C1", { nit_entidad: "1", referencia: "R1", anio: 2026, valor_contrato: 100, proveedor: "ACME" }));
  store.upsert(mk("rpmr-utcd", "X1", { nit_entidad: "1", referencia: "R1", anio: 2026, valor_contrato: 100, proveedor: "ACME" }));
  dedupeContratos(db);
  buildViews(db, "contratacion");
  const row = db.prepare("SELECT contratos, valor_total FROM rm_contratos_depto WHERE cod_dpto='11'").get();
  assert.equal(row.contratos, 1, "duplicado no cuenta");
  assert.equal(row.valor_total, 100, "valor no se duplica");
});
