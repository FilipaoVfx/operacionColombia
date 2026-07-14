import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../packages/metadata/registry.js";
import {
  profileRows, registerSource, listExplorerSources, resolveSource, genericMapRow, exportSample,
} from "../services/socrata-explorer/index.js";

function seededDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

test("profileRows: nulos/distintos/top-5 por columna + duplicados por :id", () => {
  const rows = [
    { ":id": "1", nombre: "Acme", categoria: "A" },
    { ":id": "2", nombre: "Acme", categoria: "B" },
    { ":id": "3", nombre: null, categoria: "A" },
    { ":id": "3", nombre: "Otra", categoria: "A" }, // :id repetido → duplicado en muestra
  ];
  const p = profileRows("x", rows);
  assert.equal(p.muestra_size, 4);
  assert.equal(p.duplicados_en_muestra, 1);
  const nombre = p.columnas.find((c) => c.columna === "nombre");
  assert.equal(nombre.nulos_pct, 25);
  assert.equal(nombre.distintos, 2);
  assert.equal(nombre.top[0].valor, "Acme");
  assert.equal(nombre.top[0].n, 2);
});

test("registerSource + resolveSource: fuente dinámica queda disponible para el motor de conectores sin tocar código", () => {
  const db = seededDb();
  const cfg = registerSource(db, {
    id: "abcd-1234", targetDomain: "mineria", nombre: "Catastro minero (piloto)",
    where: "anio='2026'", priority: "P2", schedule: "mensual",
  });
  assert.equal(cfg.id, "abcd-1234");
  assert.equal(cfg.domain, "mineria");
  assert.equal(cfg.kind, "socrata");
  assert.equal(typeof cfg.mapRow, "function");

  // fuente estática falsa: no conoce "abcd-1234" → debe caer al explorer
  const fakeStaticGetSource = (id) => { throw new Error(`fuente desconocida: ${id}`); };
  const resolved = resolveSource(db, "abcd-1234", fakeStaticGetSource);
  assert.equal(resolved.id, "abcd-1234");
  assert.equal(resolved.where, "anio='2026'");

  assert.equal(listExplorerSources(db).length, 1);
});

test("resolveSource prioriza la fuente estática sobre la dinámica cuando el id coincide", () => {
  const db = seededDb();
  registerSource(db, { id: "gdxc-w37w", targetDomain: "otra", nombre: "no debería usarse" });
  const staticSource = { id: "gdxc-w37w", domain: "territorio" };
  const fakeStaticGetSource = (id) => (id === "gdxc-w37w" ? staticSource : (() => { throw new Error("?"); })());
  assert.equal(resolveSource(db, "gdxc-w37w", fakeStaticGetSource), staticSource);
});

test("resolveSource lanza si el id no existe en ninguna de las dos fuentes", () => {
  const db = seededDb();
  const fakeStaticGetSource = () => { throw new Error("no existe"); };
  assert.throws(() => resolveSource(db, "no-existe", fakeStaticGetSource), /fuente desconocida/);
});

test("genericMapRow: descarta metacolumnas Socrata, conserva el resto en campos + extra", () => {
  const m = genericMapRow({ ":id": "row-1", ":created_at": "2026-01-01", nombre: "X", valor: 10 });
  assert.equal(m.idFuente, "row-1");
  assert.deepEqual(m.campos, { nombre: "X", valor: 10 });
  assert.equal(m.extra[":id"], "row-1");
  assert.match(m.searchBlob, /X/);
});

test("exportSample: CSV escapa comas/comillas y csv/json cubren los formatos soportados", () => {
  const rows = [{ nombre: 'Ac"me, SAS', valor: 1 }];
  const csv = exportSample(rows, "csv");
  assert.match(csv, /"Ac""me, SAS"/);
  const json = JSON.parse(exportSample(rows, "json"));
  assert.equal(json[0].nombre, 'Ac"me, SAS');
  assert.throws(() => exportSample(rows, "parquet"), /no soportado/);
});
