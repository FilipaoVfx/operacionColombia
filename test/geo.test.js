import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { migrate, WriteStore } from "../packages/metadata/registry.js";
import { buildRecord } from "../packages/core-model/index.js";
import { buildGeoIndex, bboxOf } from "../services/geo-indexer/index.js";
import { createApp } from "../apps/api/server.js";

const source = { id: "s1", domain: "territorio", nombre: "S", endpoint: "http://x", kind: "socrata" };

// dos municipios lejos uno del otro + un tramo vial que cruza el bbox del primero
function seededDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const store = new WriteStore(db);
  store.upsert(buildRecord({
    source, idFuente: "05001", campos: { nom_mpio: "Medellín" }, searchBlob: "medellin",
    geom: { type: "Point", coordinates: [-75.57, 6.24] },
  }));
  store.upsert(buildRecord({
    source, idFuente: "88001", campos: { nom_mpio: "San Andrés" }, searchBlob: "san andres",
    geom: { type: "Point", coordinates: [-81.7, 12.58] },
  }));
  store.upsert(buildRecord({
    source: { ...source, id: "s2", domain: "vial" }, idFuente: "T1", campos: { nombre_tramo: "Tramo 1" }, searchBlob: "tramo 1",
    geom: { type: "LineString", coordinates: [[-76.0, 6.0], [-75.0, 6.5]] },
  }));
  store.upsert(buildRecord({ source, idFuente: "99999", campos: { nom_mpio: "Sin geom" }, searchBlob: "sin geom" }));
  db.prepare("INSERT INTO etl_runs (source_id, started_at, resultado) VALUES ('s1','2026-01-01','ok')").run();
  return db;
}

test("bboxOf: point y linestring", () => {
  assert.deepEqual(bboxOf({ type: "Point", coordinates: [-75.5, 6.2] }), [-75.5, 6.2, -75.5, 6.2]);
  assert.deepEqual(
    bboxOf({ type: "LineString", coordinates: [[-76.0, 6.0], [-75.0, 6.5]] }),
    [-76.0, 6.0, -75.0, 6.5]
  );
  assert.equal(bboxOf(null), null);
});

test("buildGeoIndex: incremental por hash + huérfanos", () => {
  const db = seededDb();
  const r1 = buildGeoIndex(db);
  assert.equal(r1.indexados, 3, "solo registros con geom");
  const r2 = buildGeoIndex(db);
  assert.equal(r2.indexados, 0, "hash sin cambio → nada que reindexar");
  db.prepare("DELETE FROM registros WHERE id_interno='s1:88001'").run();
  const r3 = buildGeoIndex(db);
  assert.equal(r3.eliminados, 1, "registro borrado sale del índice");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM geo_bbox").get().c, 2);
});

// --- API: geojson filtrado por bbox -----------------------------------------
const db = seededDb();
const server = http.createServer(createApp(db)); // createApp construye el geo index
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
after(() => server.close());

test("geojson con bbox devuelve solo el viewport (M10)", async () => {
  // bbox de Antioquia: entra Medellín y el tramo, no San Andrés
  const bb = "-77,5,-74,8";
  const munis = await (await fetch(`${base}/api/registros?dominio=territorio&format=geojson&bbox=${bb}`)).json();
  assert.deepEqual(munis.features.map((f) => f.properties.nom_mpio), ["Medellín"]);
  const vial = await (await fetch(`${base}/api/registros?dominio=vial&format=geojson&bbox=${bb}`)).json();
  assert.equal(vial.features.length, 1, "intersección de bbox, no solo contención");
});

test("bbox inválido se ignora (fallback a filtro sin bbox)", async () => {
  for (const bad of ["1,2,3", "a,b,c,d", "-74,5,-77,8", "-200,5,-74,8"]) {
    const out = await (await fetch(`${base}/api/registros?dominio=territorio&format=geojson&bbox=${bad}`)).json();
    assert.equal(out.features.length, 2, `bbox "${bad}" debe ignorarse`);
  }
});
