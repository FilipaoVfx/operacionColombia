import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { migrate, WriteStore } from "../packages/metadata/registry.js";
import { buildRecord } from "../packages/core-model/index.js";
import { loadDivipola } from "../packages/divipola/index.js";
import { dedupeContratos } from "../services/entity-res/index.js";
import { buildViews } from "../services/views-builder/index.js";
import { createApp } from "../apps/api/server.js";

const secopII = { id: "jbjy-vk9h", domain: "contratacion", nombre: "SECOP II", endpoint: "https://datos.gov.co/a", kind: "socrata" };
const integrado = { id: "rpmr-utcd", domain: "contratacion", nombre: "SECOP Integrado", endpoint: "https://datos.gov.co/b", kind: "socrata" };

function fixtureDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  loadDivipola(db, [
    { cod_mpio: "05001", cod_dpto: "05", nom_mpio: "MEDELLÍN", dpto: "ANTIOQUIA", latitud: "6", longitud: "-75" },
    { cod_mpio: "27001", cod_dpto: "27", nom_mpio: "QUIBDÓ", dpto: "CHOCÓ", latitud: "5", longitud: "-76" },
  ]);
  const store = new WriteStore(db);
  const ctr = (source, ref, entidad, proveedor, valor, anio, depto) => store.upsert({
    ...buildRecord({
      source, idFuente: `${source.id}-${ref}`,
      campos: {
        entidad, nit_entidad: "899000001", proveedor, documento_proveedor: "900000001",
        referencia: ref, valor_contrato: valor, anio,
      },
      searchBlob: `${entidad} ${proveedor}`,
    }),
    divipola_depto: depto, divipola_muni: depto === "05" ? "05001" : "27001",
  });

  ctr(secopII, "R-1", "ALCALDÍA A", "CONSTRUCTORA X", 3_000_000_000, 2026, "05");
  ctr(secopII, "R-2", "ALCALDÍA A", "CONSTRUCTORA X", 1_000_000_000, 2025, "05");
  ctr(secopII, "R-3", "ALCALDÍA B", "SUMINISTROS Y", 2_000_000_000, 2026, "27");
  // mismo contrato R-1 publicado también en Integrado: debe contar UNA vez
  ctr(integrado, "R-1", "ALCALDÍA A", "CONSTRUCTORA X", 3_000_000_000, 2026, "05");
  // contrato sin valor: no debe inventarse un monto
  ctr(secopII, "R-4", "ALCALDÍA B", "SUMINISTROS Y", null, 2026, "27");

  dedupeContratos(db);
  buildViews(db);
  return db;
}

const db = fixtureDb();
const server = http.createServer(createApp(db));
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
after(() => server.close());

const get = async (p) => (await fetch(`${base}${p}`)).json();

test("agregados: totales excluyen el duplicado de SECOP Integrado", async () => {
  const a = await get("/api/contratacion/agregados");
  // 4 contratos únicos (R-1..R-4); el R-1 duplicado no suma
  assert.equal(a.totales.contratos, 4);
  assert.equal(a.totales.valor_total, 6_000_000_000, "3000+1000+2000 M, sin contar el duplicado ni el nulo");
});

test("depto × año: la matriz del mapa de calor sale de rm_contratos_depto", async () => {
  const a = await get("/api/contratacion/agregados");
  assert.deepEqual(a.anios, [2025, 2026]);
  const ant2026 = a.por_depto_anio.find((r) => r.cod_dpto === "05" && r.anio === 2026);
  assert.equal(ant2026.contratos, 1, "el duplicado no infla el conteo");
  assert.equal(ant2026.valor_total, 3_000_000_000);
  assert.equal(ant2026.departamento, "ANTIOQUIA", "el nombre viene de DIVIPOLA, no de la fuente");
});

test("por proveedor: alimenta el treemap con jerarquía depto → proveedor", async () => {
  const a = await get("/api/contratacion/agregados");
  const top = a.por_proveedor[0];
  assert.equal(top.proveedor, "CONSTRUCTORA X");
  assert.equal(top.valor_total, 4_000_000_000, "sus dos contratos, sin el duplicado");
  assert.ok(a.por_proveedor.every((p) => p.cod_dpto && p.departamento));
});

test("flujo entidad → proveedor: pares para el Sankey, sin duplicados", async () => {
  const a = await get("/api/contratacion/agregados");
  const f = a.flujo_entidad_proveedor.find((x) => x.entidad === "ALCALDÍA A");
  assert.equal(f.proveedor, "CONSTRUCTORA X");
  assert.equal(f.contratos, 2, "R-1 y R-2; el R-1 de Integrado no cuenta");
  assert.equal(f.valor_total, 4_000_000_000);
});

test("un contrato sin valor no aporta monto pero sí se cuenta", async () => {
  const a = await get("/api/contratacion/agregados");
  const choco = a.por_depto_anio.filter((r) => r.cod_dpto === "27" && r.anio === 2026)[0];
  assert.equal(choco.contratos, 2, "R-3 y R-4");
  assert.equal(choco.valor_total, 2_000_000_000, "solo el que tiene valor; el nulo no inventa monto");
});

test("filtro por departamento acota todos los agregados a la vez", async () => {
  const a = await get("/api/contratacion/agregados?depto=27");
  assert.equal(a.depto, "27");
  assert.ok(a.por_depto_anio.every((r) => r.cod_dpto === "27"));
  assert.ok(a.por_proveedor.every((r) => r.cod_dpto === "27"));
  assert.ok(a.flujo_entidad_proveedor.every((r) => r.entidad === "ALCALDÍA B"));
  assert.equal(a.totales.contratos, 2);
});

test("base sin contratación devuelve estructura vacía, no error ni relleno", async () => {
  const vacia = new DatabaseSync(":memory:");
  migrate(vacia);
  buildViews(vacia);
  const s = http.createServer(createApp(vacia));
  await new Promise((r) => s.listen(0, r));
  const out = await (await fetch(`http://localhost:${s.address().port}/api/contratacion/agregados`)).json();
  assert.equal(out.totales.contratos, 0);
  assert.deepEqual(out.por_proveedor, []);
  assert.deepEqual(out.flujo_entidad_proveedor, []);
  assert.deepEqual(out.anios, []);
  s.close();
});
