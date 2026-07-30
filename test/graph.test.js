import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, WriteStore } from "../packages/metadata/registry.js";
import { buildRecord } from "../packages/core-model/index.js";
import { resolveDomain, dedupeContratos } from "../services/entity-res/index.js";
import { buildGraph, vecinos, concentracion, graphStats } from "../services/graph/index.js";

const src = (id, domain) => ({ id, domain, nombre: id, endpoint: "http://x", kind: "socrata" });

function seededDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const store = new WriteStore(db);
  // 2 contratos de la misma empresa con la misma entidad pública en Bogotá (11)
  for (const [i, ref] of [["C1", "R-1"], ["C2", "R-2"]]) {
    store.upsert({ ...buildRecord({
      source: src("jbjy-vk9h", "contratacion"), idFuente: i,
      campos: { nit_entidad: "899999063", entidad: "MinTransporte", documento_proveedor: "900123456", proveedor: "ACME SAS", referencia: ref, departamento: "Bogotá" },
    }), divipola_depto: "11" });
  }
  // contrato de otra empresa en Antioquia (05)
  store.upsert({ ...buildRecord({
    source: src("jbjy-vk9h", "contratacion"), idFuente: "C3",
    campos: { nit_entidad: "899999063", entidad: "MinTransporte", documento_proveedor: "800555", proveedor: "OTRA LTDA", referencia: "R-3", departamento: "Antioquia" },
  }), divipola_depto: "05" });
  resolveDomain(db, "contratacion");
  dedupeContratos(db);
  return db;
}

test("buildGraph: aristas tipadas desde co-ocurrencia (Contrato→Empresa/EntidadPublica/Depto)", () => {
  const db = seededDb();
  const res = buildGraph(db);
  assert.equal(res.resultado, "ok");
  assert.ok(res.aristas > 0);
  const tipos = new Set(db.prepare("SELECT DISTINCT tipo FROM grafo_aristas").all().map((r) => r.tipo));
  assert.ok(tipos.has("adjudicado_a"));
  assert.ok(tipos.has("contratado_por"));
  assert.ok(tipos.has("ubicado_en"));
});

test("vecinos multi-salto: empresa → contratos (1) → entidad pública (2)", () => {
  const db = seededDb();
  buildGraph(db);
  const empresa = "Empresa:nit:900123456";
  const d1 = vecinos(db, empresa, { depth: 1 });
  assert.ok(d1.nodos.some((n) => n.tipo === "Contrato" && n.dist === 1), "contratos a 1 salto");
  const d2 = vecinos(db, empresa, { depth: 2 });
  assert.ok(d2.nodos.some((n) => n.tipo === "EntidadPublica" && n.dist === 2), "entidad pública a 2 saltos");
  assert.ok(d2.aristas.length >= d1.aristas.length);
});

test("concentración: ACME (2 contratos) sobre OTRA (1); filtro por depto respeta ubicación", () => {
  const db = seededDb();
  buildGraph(db);
  const top = concentracion(db, {});
  assert.equal(top[0].id_entidad, "Empresa:nit:900123456");
  assert.ok(top[0].relaciones > top.at(-1).relaciones || top.length === 1);
  const bogota = concentracion(db, { depto: "11" });
  assert.ok(bogota.every((r) => r.id_entidad !== "Empresa:nit:800555"), "OTRA no opera en Bogotá");
});

test("buildGraph idempotente y stats coherentes", () => {
  const db = seededDb();
  const a = buildGraph(db);
  const b = buildGraph(db);
  assert.equal(a.aristas, b.aristas);
  const st = graphStats(db);
  assert.equal(st.aristas, db.prepare("SELECT COUNT(*) c FROM grafo_aristas").get().c);
  assert.ok(st.nodos > 0);
});
