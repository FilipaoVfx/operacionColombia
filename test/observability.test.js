import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { migrate, WriteStore } from "../packages/metadata/registry.js";
import { buildRecord } from "../packages/core-model/index.js";
import { buildViews } from "../services/views-builder/index.js";
import { buildSearchIndex } from "../services/search-indexer/index.js";
import { createApp } from "../apps/api/server.js";
import { Metrics, budgetReport, createLogger, BUDGET } from "../packages/observability/index.js";

test("Metrics: percentiles y contadores por ruta", () => {
  const m = new Metrics();
  for (let i = 1; i <= 100; i++) m.observe("/api/kpi", i);
  m.observe("/api/kpi", 999, { error: true });
  m.observe("/api/kpi", 1, { cacheHit: true });
  const snap = m.snapshot();
  const r = snap.por_ruta["/api/kpi"];
  assert.equal(r.n, 102);
  assert.equal(r.errores, 1);
  assert.equal(r.cache_hits, 1);
  assert.ok(r.p95_ms >= 90 && r.p95_ms <= 999);
  assert.ok(r.p50_ms >= 40 && r.p50_ms <= 60);
});

test("createLogger: JSON estructurado con módulo y nivel", () => {
  const lines = [];
  const log = createLogger("etl", { sink: (l) => lines.push(l) });
  log.warn("fuente caída", { source: "x" });
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.level, "warn");
  assert.equal(parsed.module, "etl");
  assert.equal(parsed.source, "x");
  assert.ok(parsed.ts);
});

test("budgetReport: dispara alertas al violar budget y ok=true si cumple", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const m = new Metrics();
  m.observe("/api/kpi", 10);
  let rep = budgetReport(db, m);
  assert.equal(rep.ok, true);
  assert.equal(rep.budget.p95_api_ms, BUDGET.p95_api_ms);

  for (let i = 0; i < 50; i++) m.observe("/api/registros", 500); // viola P95<150
  rep = budgetReport(db, m);
  assert.equal(rep.ok, false);
  assert.ok(rep.alertas.some((a) => a.metrica === "p95_api_ms"));

  // corrida ETL con error → alerta etl_error
  db.prepare("INSERT INTO etl_runs (source_id, started_at, finished_at, resultado) VALUES ('s1','2026-01-01','2026-01-01','error')").run();
  rep = budgetReport(db, m);
  assert.ok(rep.alertas.some((a) => a.metrica === "etl_error" && a.fuente === "s1"));
});

// --- integración: /api/status sobre el servidor real ---
const source = { id: "s1", domain: "territorio", nombre: "S", endpoint: "http://x", kind: "socrata" };
const db = new DatabaseSync(":memory:");
migrate(db);
const store = new WriteStore(db);
store.upsert({ ...buildRecord({ source, idFuente: "05001", campos: { cod_mpio: "05001", nom_mpio: "Medellín" } }), divipola_depto: "05" });
db.prepare("INSERT INTO etl_runs (source_id, started_at, finished_at, resultado) VALUES ('s1','2026-01-01T00:00:00','2026-01-01T00:00:30','ok')").run();
buildViews(db);
buildSearchIndex(db);
const server = http.createServer(createApp(db));
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
after(() => server.close());

test("/api/status: reporta api + etl + freshness + alertas; el caché cuenta hits", async () => {
  await fetch(`${base}/api/kpi`);
  await fetch(`${base}/api/kpi`); // 2ª: hit de caché en memoria
  const st = await (await fetch(`${base}/api/status`)).json();
  assert.ok(st.budget);
  assert.ok(st.api.por_ruta["/api/kpi"].n >= 2);
  assert.ok(st.api.por_ruta["/api/kpi"].cache_hits >= 1);
  assert.equal(st.etl[0].source_id, "s1");
  assert.ok(Array.isArray(st.freshness));
  assert.ok(Array.isArray(st.alertas));
});
