import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { migrate, WriteStore } from "../packages/metadata/registry.js";
import { buildRecord } from "../packages/core-model/index.js";
import { loadDivipola } from "../packages/divipola/index.js";
import { resolveDomain } from "../services/entity-res/index.js";
import { buildGraph } from "../services/graph/index.js";
import { createApp } from "../apps/api/server.js";

const secop = { id: "jbjy-vk9h", domain: "contratacion", nombre: "SECOP II", endpoint: "https://datos.gov.co/x", kind: "socrata" };
const chip = { id: "5c7g-ptic", domain: "entidades", nombre: "CHIP", endpoint: "https://datos.gov.co/y", kind: "socrata" };

// Fixture de prueba (no dato de producto): dos contratos de la misma empresa en
// departamentos distintos, más la entidad pública que los suscribe.
function fixtureDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  loadDivipola(db, [
    { cod_mpio: "05001", cod_dpto: "05", nom_mpio: "MEDELLÍN", dpto: "ANTIOQUIA", latitud: "6.25", longitud: "-75.56" },
    { cod_mpio: "27001", cod_dpto: "27", nom_mpio: "QUIBDÓ", dpto: "CHOCÓ", latitud: "5.69", longitud: "-76.66" },
  ]);
  const store = new WriteStore(db);
  const contrato = (n, depto, muni) => store.upsert({
    ...buildRecord({
      source: secop, idFuente: `C${n}`,
      campos: {
        entidad: "ALCALDÍA DE PRUEBA", nit_entidad: "899999999",
        proveedor: "CONSTRUCTORA X S.A.S.", documento_proveedor: "900111222",
        referencia: `CTO-${n}`, valor_contrato: 1_000_000_000 * n, anio: 2026,
      },
      searchBlob: `constructora x alcaldia de prueba`,
    }),
    divipola_depto: depto, divipola_muni: muni,
  });
  contrato(1, "05", "05001");
  contrato(2, "05", "05001");
  contrato(3, "27", "27001");
  store.upsert({
    ...buildRecord({
      source: chip, idFuente: "E1",
      campos: { nit: "899999999", razon_social: "ALCALDÍA DE PRUEBA", departamento: "ANTIOQUIA", ciudad: "MEDELLÍN" },
      searchBlob: "alcaldia de prueba",
    }),
    divipola_depto: "05", divipola_muni: "05001",
  });
  resolveDomain(db, "contratacion");
  resolveDomain(db, "entidades");
  buildGraph(db);
  return db;
}

const db = fixtureDb();
const server = http.createServer(createApp(db));
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
after(() => server.close());

const get = async (p) => (await fetch(`${base}${p}`)).json();

test("listado de entidades: agrega registros, fuentes y territorios reales", async () => {
  const out = await get("/api/entidades?tipo=Empresa");
  assert.ok(out.total >= 1);
  const emp = out.items.find((i) => i.nombre_canonico.includes("CONSTRUCTORA X"));
  assert.ok(emp, "la empresa aparece en el listado");
  assert.equal(emp.tipo, "Empresa");
  assert.equal(emp.registros, 3, "sus 3 contratos");
  assert.equal(emp.fuentes, 1);
  // territorios vienen de los registros, ordenados por volumen — no se infiere "principal"
  assert.equal(emp.territorios[0].cod, "05");
  assert.equal(emp.territorios[0].registros, 2);
  assert.equal(emp.territorios[1].cod, "27");
});

test("filtro por departamento acota a entidades con registros allí", async () => {
  const choco = await get("/api/entidades?tipo=Empresa&depto=27");
  assert.equal(choco.items.length, 1);
  const vacio = await get("/api/entidades?tipo=Empresa&depto=99");
  assert.equal(vacio.total, 0);
  assert.deepEqual(vacio.items, [], "sin resultados devuelve lista vacía, no datos de relleno");
});

test("búsqueda por nombre normalizado (sin acentos ni mayúsculas)", async () => {
  const out = await get("/api/entidades?q=constructora");
  assert.ok(out.items.some((i) => i.nombre_canonico.includes("CONSTRUCTORA X")));
});

test("ficha: identidad, clave, territorios, fuentes y procedencia del vínculo", async () => {
  const { items } = await get("/api/entidades?tipo=Empresa&q=constructora");
  const ficha = await get(`/api/entidades/${encodeURIComponent(items[0].id_entidad)}`);

  assert.equal(ficha.tipo, "Empresa");
  assert.equal(ficha.clave.tipo, "nit", "la entidad se ancla a una llave verificable");
  assert.equal(ficha.registros_total, 3);
  assert.equal(ficha.fuentes[0].fuente, "SECOP II");
  assert.ok(ficha.fuentes[0].fuente_url.startsWith("https://"), "cada fuente enlaza a su origen");
  // vínculos = con qué método se ligó cada registro (M6): es procedencia, no puntaje
  assert.ok(ficha.vinculos.length >= 1);
  assert.ok(["nit", "codigo", "nombre", "alias"].includes(ficha.vinculos[0].metodo));
  assert.equal(ficha.territorios.length, 2);
});

test("ficha: relaciones del grafo con la evidencia que las respalda", async () => {
  const { items } = await get("/api/entidades?tipo=Empresa&q=constructora");
  const ficha = await get(`/api/entidades/${encodeURIComponent(items[0].id_entidad)}`);
  assert.ok(ficha.relaciones.length > 0);
  const r = ficha.relaciones[0];
  assert.ok(r.tipo && r.otro_nombre, "la relación nombra la contraparte");
  assert.ok(r.muestra, "y trae el id_interno del registro que la evidencia");
});

test("evidencia paginada: los registros que respaldan la entidad", async () => {
  const { items } = await get("/api/entidades?tipo=Empresa&q=constructora");
  const id = encodeURIComponent(items[0].id_entidad);
  const p1 = await get(`/api/entidades/${id}/registros?limit=2`);
  assert.equal(p1.total, 3);
  assert.equal(p1.items.length, 2);
  assert.ok(p1.items[0].campos.referencia, "trae los campos del registro");
  assert.ok(p1.items[0].metodo, "y cómo se vinculó a la entidad");
  const p2 = await get(`/api/entidades/${id}/registros?limit=2&offset=2`);
  assert.equal(p2.items.length, 1);
});

test("entidad inexistente devuelve 404, no una ficha vacía", async () => {
  const res = await fetch(`${base}/api/entidades/Empresa:nit:000`);
  assert.equal(res.status, 404);
  const res2 = await fetch(`${base}/api/entidades/Empresa:nit:000/registros`);
  assert.equal(res2.status, 404);
});

test("tipo inválido se ignora en vez de romper (no inyecta SQL)", async () => {
  const out = await get("/api/entidades?tipo=';DROP TABLE entidades;--");
  assert.equal(out.filtros.tipo, null);
  assert.ok(out.total >= 1, "la tabla sigue viva");
});
