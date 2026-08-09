import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { migrate, WriteStore } from "../packages/metadata/registry.js";
import { buildRecord } from "../packages/core-model/index.js";
import { buildViews } from "../services/views-builder/index.js";
import { buildSearchIndex } from "../services/search-indexer/index.js";
import { createApp } from "../apps/api/server.js";

const source = { id: "s1", domain: "territorio", nombre: "S", endpoint: "http://x", kind: "socrata" };

function seededDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const store = new WriteStore(db);
  for (let i = 0; i < 7; i++) {
    store.upsert({
      ...buildRecord({ source, idFuente: `0500${i}`, campos: { cod_mpio: `0500${i}`, nom_mpio: `Muni ${i}` }, searchBlob: `0500${i} muni ${i}` }),
      divipola_depto: "05",
    });
  }
  db.prepare("INSERT INTO etl_runs (source_id, started_at, resultado) VALUES ('s1','2026-01-01','ok')").run();
  buildViews(db);
  buildSearchIndex(db);
  return db;
}

const db = seededDb();
const server = http.createServer(createApp(db));
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
after(() => server.close());

test("paginación por cursor: next_cursor encadena sin offset profundo", async () => {
  const p1 = await (await fetch(`${base}/api/registros?limit=3`)).json();
  assert.equal(p1.items.length, 3);
  assert.ok(p1.next_cursor);
  const p2 = await (await fetch(`${base}/api/registros?limit=3&cursor=${encodeURIComponent(p1.next_cursor)}`)).json();
  assert.equal(p2.items[0].id_interno > p1.items.at(-1).id_interno, true);
  assert.equal(p1.total, 7);
});

test("ETag + If-None-Match → 304 mientras la versión de datos no cambie", async () => {
  const r1 = await fetch(`${base}/api/kpi`);
  const etag = r1.headers.get("etag");
  assert.ok(etag);
  const r2 = await fetch(`${base}/api/kpi`, { headers: { "If-None-Match": etag } });
  assert.equal(r2.status, 304);
});

test("invalidación por versión: nueva ingesta cambia el ETag (M15)", async () => {
  const etag1 = (await fetch(`${base}/api/kpi`)).headers.get("etag");
  db.prepare("INSERT INTO etl_runs (source_id, started_at, resultado) VALUES ('s1','2026-01-02','ok')").run();
  const r = await fetch(`${base}/api/kpi`, { headers: { "If-None-Match": etag1 } });
  assert.equal(r.status, 200, "versión nueva → ETag viejo ya no valida");
  assert.notEqual(r.headers.get("etag"), etag1);
});

test("kpi lee read models: municipios desde rm_registros_depto", async () => {
  const k = await (await fetch(`${base}/api/kpi?depto=05`)).json();
  assert.equal(k.municipios, 7);
});

test("search rutea al índice FTS: hits + facetas", async () => {
  const s = await (await fetch(`${base}/api/search?q=muni`)).json();
  assert.equal(s.total, 7);
  assert.equal(s.hits.length, 7);
  assert.equal(s.facetas.depto[0].valor, "05");
  assert.equal(typeof s.hits[0].con_geom, "boolean");
});

test("by-id incluye linaje completo", async () => {
  const rec = await (await fetch(`${base}/api/registros/${encodeURIComponent("s1:05001")}`)).json();
  assert.equal(rec.campos.nom_mpio, "Muni 1");
  assert.ok(rec.hash);
  assert.ok(Array.isArray(rec.transformaciones));
});
