import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, WriteStore, MetadataRegistry } from "../packages/metadata/registry.js";
import { buildRecord } from "../packages/core-model/index.js";

const source = { id: "s1", domain: "d", nombre: "S1", endpoint: "http://x", kind: "socrata", priority: "P1", schedule: "anual", licencia: "CC" };

function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

test("upsert idempotente: mismo hash no duplica ni reescribe", () => {
  const db = freshDb();
  const store = new WriteStore(db);
  const rec = buildRecord({ source, idFuente: 1, campos: { v: "a" } });
  assert.equal(store.upsert(rec), "inserted");
  assert.equal(store.upsert({ ...rec, fecha_ingesta: new Date().toISOString() }), "unchanged");
  const rec2 = buildRecord({ source, idFuente: 1, campos: { v: "CAMBIO" } });
  assert.equal(store.upsert(rec2), "updated");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM registros").get().c, 1);
});

test("metadata: versionado de esquema al cambiar", () => {
  const db = freshDb();
  const reg = new MetadataRegistry(db);
  reg.upsert(source, { esquema: [{ name: "a" }], etag: "1" });
  assert.equal(reg.get("s1").version, 1);
  reg.upsert(source, { esquema: [{ name: "a" }, { name: "b" }], etag: "2" });
  assert.equal(reg.get("s1").version, 2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM dataset_version").get().c, 1);
});

test("freshness: skip solo tras corrida ok con mismo etag", () => {
  const db = freshDb();
  const reg = new MetadataRegistry(db);
  reg.upsert(source, { esquema: [], etag: "e1" });
  assert.equal(reg.isFresh("s1", { etag: "e1" }), false, "sin corrida ok no hay skip");
  const run = reg.startRun("s1");
  reg.finishRun(run, { resultado: "ok" });
  assert.equal(reg.isFresh("s1", { etag: "e1" }), true);
  assert.equal(reg.isFresh("s1", { etag: "e2" }), false);
});
