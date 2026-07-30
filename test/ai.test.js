import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, WriteStore } from "../packages/metadata/registry.js";
import { buildRecord } from "../packages/core-model/index.js";
import { buildSearchIndex } from "../services/search-indexer/index.js";
import { resolveDomain } from "../services/entity-res/index.js";
import { buildGraph } from "../services/graph/index.js";
import { retrieve, ask } from "../services/ai/index.js";

const src = { id: "jbjy-vk9h", domain: "contratacion", nombre: "SECOP II", endpoint: "https://datos.gov.co/x", kind: "socrata" };

function seededDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const store = new WriteStore(db);
  store.upsert({ ...buildRecord({
    source: src, idFuente: "C1",
    campos: { nit_entidad: "899", entidad: "MinTransporte", documento_proveedor: "900", proveedor: "ACME SAS", referencia: "R-1", valor_contrato: 900000000, departamento: "Bogotá" },
    searchBlob: "acme sas mintransporte via bogota pavimentacion",
  }), divipola_depto: "11" });
  buildSearchIndex(db);
  resolveDomain(db, "contratacion");
  buildGraph(db);
  return db;
}

test("retrieve: evidencia con cita (fuente + url) y expansión de grafo", () => {
  const db = seededDb();
  const ctx = retrieve(db, "acme pavimentacion");
  assert.equal(ctx.evidencias.length, 1);
  const ev = ctx.evidencias[0];
  assert.equal(ev.cita.fuente, "SECOP II");
  assert.ok(ev.cita.url.startsWith("https://datos.gov.co"));
  assert.ok(ev.entidades.some((e) => e.tipo === "Empresa"));
  assert.ok(ctx.grafo.length > 0, "vecindad de grafo incluida");
});

test("guardrail: sin evidencia → modo sin-datos, jamás respuesta inventada", async () => {
  const db = seededDb();
  const out = await ask(db, "produccion de litio en marte", { apiKey: "k", llm: async () => { throw new Error("no debe llamarse"); } });
  assert.equal(out.modo, "sin-datos");
  assert.equal(out.respuesta, null);
});

test("sin API key: modo solo-recuperacion devuelve evidencia citada sin redacción", async () => {
  const db = seededDb();
  const out = await ask(db, "acme pavimentacion", { apiKey: undefined });
  assert.equal(out.modo, "solo-recuperacion");
  assert.equal(out.respuesta, null);
  assert.equal(out.evidencias.length, 1);
});

test("rag: el LLM recibe contexto con citas numeradas y relaciones de grafo", async () => {
  const db = seededDb();
  let recibido;
  const out = await ask(db, "quien gano contratos de pavimentacion acme", {
    apiKey: "test-key",
    llm: async ({ prompt, system }) => { recibido = { prompt, system }; return "ACME SAS ganó 1 contrato por 900000000 [1]."; },
  });
  assert.equal(out.modo, "rag");
  assert.ok(out.respuesta.includes("[1]"));
  assert.ok(recibido.prompt.includes("[1] (contratacion)"), "contexto numerado");
  assert.ok(recibido.prompt.includes("datos.gov.co"), "URL de la fuente viaja en el contexto");
  assert.ok(recibido.prompt.includes("adjudicado_a"), "relaciones del grafo en el contexto");
  assert.ok(recibido.system.includes("no inventes"));
});
