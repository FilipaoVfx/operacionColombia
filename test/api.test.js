import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { migrate, WriteStore } from "../packages/metadata/registry.js";
import { buildRecord } from "../packages/core-model/index.js";
import { buildViews } from "../services/views-builder/index.js";
import { buildSearchIndex } from "../services/search-indexer/index.js";
import { createApp, createFixedWindowRateLimiter } from "../apps/api/server.js";

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
  const r1 = await fetch(`${base}/api/kpi`, { headers: { Origin: base } });
  const etag = r1.headers.get("etag");
  assert.ok(etag);
  const r2 = await fetch(`${base}/api/kpi`, {
    headers: { "If-None-Match": etag, Origin: base },
  });
  assert.equal(r2.status, 304);
  assert.equal(r2.headers.get("access-control-allow-origin"), base);
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

// PLANNING §5.3 — /api/explorer/register alimenta el scheduler del ETL: escritura sin
// auth = cualquiera inyecta fuentes. Falla cerrado si no hay token en el servidor.
test("register sin EXPLORER_ADMIN_TOKEN configurado: 503, no escribe", async () => {
  delete process.env.EXPLORER_ADMIN_TOKEN;
  const r = await fetch(`${base}/api/explorer/register`, {
    method: "POST", body: JSON.stringify({ id: "abcd-1234", targetDomain: "mineria" }),
  });
  assert.equal(r.status, 503);
});

test("register con token inválido: 401; con token válido: 201", async () => {
  process.env.EXPLORER_ADMIN_TOKEN = "s3creto-de-prueba";
  const malo = await fetch(`${base}/api/explorer/register`, {
    method: "POST", headers: { "X-Admin-Token": "otro-token-largo" },
    body: JSON.stringify({ id: "abcd-1234", targetDomain: "mineria" }),
  });
  assert.equal(malo.status, 401);

  const bueno = await fetch(`${base}/api/explorer/register`, {
    method: "POST", headers: { "X-Admin-Token": "s3creto-de-prueba" },
    body: JSON.stringify({ id: "abcd-1234", targetDomain: "mineria" }),
  });
  assert.equal(bueno.status, 201);
  assert.equal((await bueno.json()).fuente.id, "abcd-1234");
  delete process.env.EXPLORER_ADMIN_TOKEN;
});

test("explorer rechaza dominio fuera de la allowlist con 400, no 502", async () => {
  const r = await fetch(`${base}/api/explorer/preview?id=abcd-1234&domain=169.254.169.254`);
  assert.equal(r.status, 400);
  assert.match((await r.json()).detail, /no permitido/);
});

test("CORS permite mismo origen y bloquea orígenes externos no configurados", async () => {
  const mismoOrigen = await fetch(`${base}/api/health`, { headers: { Origin: base } });
  assert.equal(mismoOrigen.status, 200);
  assert.equal(mismoOrigen.headers.get("access-control-allow-origin"), base);

  const externo = await fetch(`${base}/api/health`, {
    headers: { Origin: "https://sitio-no-autorizado.example" },
  });
  assert.equal(externo.status, 403);
  assert.equal(externo.headers.get("access-control-allow-origin"), null);

  const preflight = await fetch(`${base}/api/explorer/register`, {
    method: "OPTIONS",
    headers: { Origin: base, "Access-Control-Request-Method": "POST" },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-methods"), /POST/);
});

test("IA limita por IP antes de invocar el proveedor pago", async () => {
  let llamadas = 0;
  const limitedServer = http.createServer(createApp(db, {
    aiAsk: async () => { llamadas++; return { modo: "prueba" }; },
    aiRateLimitMax: 2,
    aiRateLimitWindowMs: 60_000,
  }));
  await new Promise((resolve) => limitedServer.listen(0, resolve));
  const limitedBase = `http://localhost:${limitedServer.address().port}`;
  const headers = { "X-Forwarded-For": "203.0.113.10" };
  try {
    const r1 = await fetch(`${limitedBase}/api/ai/ask?q=uno`, { headers });
    const r2 = await fetch(`${limitedBase}/api/ai/ask?q=dos`, { headers });
    const r3 = await fetch(`${limitedBase}/api/ai/ask?q=tres`, { headers });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 429);
    assert.equal(r3.headers.get("x-ratelimit-remaining"), "0");
    assert.ok(Number(r3.headers.get("retry-after")) >= 1);
    assert.equal(llamadas, 2, "la petición limitada no consume el proveedor");
  } finally {
    await new Promise((resolve) => limitedServer.close(resolve));
  }
});

test("el límite de IA aísla clientes y se reinicia al vencer la ventana", () => {
  let now = 1_000;
  const limiter = createFixedWindowRateLimiter({ max: 1, windowMs: 500, now: () => now });
  assert.equal(limiter.take("cliente-a").allowed, true);
  assert.equal(limiter.take("cliente-a").allowed, false);
  assert.equal(limiter.take("cliente-b").allowed, true, "otro cliente conserva su cuota");
  now = 1_500;
  assert.equal(limiter.take("cliente-a").allowed, true, "la cuota vuelve tras la ventana");
});

test("el límite de IA acota la memoria ante clientes de alta cardinalidad", () => {
  const limiter = createFixedWindowRateLimiter({ max: 1, windowMs: 60_000, maxBuckets: 2 });
  assert.equal(limiter.take("cliente-a").allowed, true);
  assert.equal(limiter.take("cliente-b").allowed, true);
  assert.equal(limiter.take("cliente-c").allowed, true);
  assert.equal(limiter.take("cliente-d").allowed, false, "clientes excedentes comparten una cuota acotada");
  assert.equal(limiter.take("cliente-a").allowed, false, "las cuotas existentes no se desalojan");
});

test("meta expone qué dominios tienen geometría y su extensión real", async () => {
  const m = await (await fetch(`${base}/api/meta`)).json();
  // el fixture de este archivo son municipios sin geometría: la capa no debe ofrecerse
  assert.ok(Array.isArray(m.geo), "meta.geo existe aunque no haya geometrías");
  for (const d of m.dominios) {
    assert.equal(typeof d.con_geom, "number", `${d.dominio} declara con_geom`);
    assert.ok(d.con_geom <= d.n, "no puede haber más geometrías que registros");
  }
  for (const g of m.geo) {
    assert.ok(g.min_lon <= g.max_lon && g.min_lat <= g.max_lat, "extensión coherente");
  }
});
