import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, WriteStore } from "../packages/metadata/registry.js";
import { buildRecord } from "../packages/core-model/index.js";
import { buildSearchIndex, searchQuery, autocomplete } from "../services/search-indexer/index.js";

const source = { id: "s1", domain: "territorio", nombre: "S", endpoint: "http://x", kind: "socrata" };

function seededDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const store = new WriteStore(db);
  const munis = [
    ["05001", "Medellín", "05"],
    ["76001", "Cali", "76"],
    ["76109", "Buenaventura", "76"],
  ];
  for (const [cod, nom, dpto] of munis) {
    store.upsert({
      ...buildRecord({
        source, idFuente: cod,
        campos: { cod_mpio: cod, nom_mpio: nom },
        searchBlob: `${cod} ${nom}`,
      }),
      divipola_depto: dpto,
    });
  }
  return db;
}

test("indexado incremental: solo nuevos/cambiados; reindex tras update", () => {
  const db = seededDb();
  assert.equal(buildSearchIndex(db).indexados, 3);
  assert.equal(buildSearchIndex(db).indexados, 0, "sin cambios no reindexa");
  const store = new WriteStore(db);
  store.upsert({
    ...buildRecord({ source, idFuente: "05001", campos: { cod_mpio: "05001", nom_mpio: "Medellín", tipo: "CM" }, searchBlob: "05001 medellin capital" }),
    divipola_depto: "05",
  });
  assert.equal(buildSearchIndex(db).indexados, 1, "hash cambiado → reindexa solo ese");
});

test("query: acentos-insensible, prefijo y filtro por depto", () => {
  const db = seededDb();
  buildSearchIndex(db);
  assert.equal(searchQuery(db, { q: "medellin" }).hits[0].label, "Medellín", "sin acento encuentra con acento");
  assert.equal(searchQuery(db, { q: "buenav" }).total, 1, "prefijo del último término");
  assert.equal(searchQuery(db, { q: "cali", depto: "05" }).total, 0, "filtro depto excluye");
  assert.equal(searchQuery(db, { q: "cali", depto: "76" }).total, 1);
});

test("facetas: conteo por depto sobre el match completo", () => {
  const db = seededDb();
  buildSearchIndex(db);
  // '76' aparece en el search_blob de los dos municipios del Valle (cod_mpio)
  const f = searchQuery(db, { q: "76" }).facetas;
  const valle = f.depto.find((d) => d.valor === "76");
  assert.equal(valle.n, 2);
});

test("autocomplete: labels distintos por prefijo", () => {
  const db = seededDb();
  buildSearchIndex(db);
  const out = autocomplete(db, "me");
  assert.equal(out[0].label, "Medellín");
});

test("operadores FTS del usuario no rompen la consulta", () => {
  const db = seededDb();
  buildSearchIndex(db);
  assert.doesNotThrow(() => searchQuery(db, { q: 'cali AND "OR( NEAR' }));
});
