import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../packages/metadata/registry.js";
import { Queue } from "../services/orchestrator/queue.js";
import { scheduleDue, PERIOD_MS } from "../services/orchestrator/scheduler.js";
import { workUntilEmpty } from "../services/orchestrator/worker.js";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

test("cola: enqueue con dedupe colapsa duplicados vivos, no los terminados", () => {
  const q = new Queue(freshDb());
  const a = q.enqueue({ tipo: "ingest", dedupeKey: "ingest:x" });
  assert.ok(a);
  assert.equal(q.enqueue({ tipo: "ingest", dedupeKey: "ingest:x" }), null, "duplicado vivo");
  q.complete(q.claim().job_id);
  assert.ok(q.enqueue({ tipo: "ingest", dedupeKey: "ingest:x" }), "terminado no bloquea");
});

test("cola: claim atómico respeta run_after (backoff)", () => {
  const q = new Queue(freshDb());
  q.enqueue({ tipo: "t", runAfter: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(q.claim(), null, "backoff no vencido");
  q.enqueue({ tipo: "t2" });
  assert.equal(q.claim().tipo, "t2");
});

test("cola: reintentos con backoff y dead-letter al agotar", () => {
  const q = new Queue(freshDb());
  q.enqueue({ tipo: "t", maxIntentos: 2 });
  const now = Date.now();

  let job = q.claim();
  assert.equal(q.fail(job.job_id, new Error("boom"), now), "reintento");
  assert.equal(q.claim(new Date(now).toISOString()), null, "en backoff");
  job = q.claim(new Date(now + 31_000).toISOString());
  assert.ok(job, "backoff vencido → reclamable");
  assert.equal(q.fail(job.job_id, new Error("boom2"), now), "muerto", "intentos agotados");
  assert.equal(q.deadLetter()[0].error, "boom2");
});

test("scheduler: encola solo fuentes vencidas según periodicidad", () => {
  const db = freshDb();
  const q = new Queue(db);
  const sources = [
    { id: "a", schedule: "diario" },
    { id: "b", schedule: "anual" },
  ];
  // ambas sin corrida previa → ambas vencidas
  assert.equal(scheduleDue(db, q, sources).length, 2);
  // corrida ok reciente para 'b' → solo 'a' vence al día siguiente
  db.prepare("INSERT INTO etl_runs (source_id, started_at, resultado) VALUES (?,?,?)")
    .run("b", new Date().toISOString(), "ok");
  q.complete(q.claim().job_id); q.complete(q.claim().job_id); // liberar dedupe
  const due = scheduleDue(db, q, sources, Date.now() + PERIOD_MS.diario + 1000);
  assert.deepEqual(due.map((d) => d.sourceId), ["a"]);
});

test("worker: procesa cola, fan-out encola derivados, error va a reintento", async () => {
  const q = new Queue(freshDb());
  const seen = [];
  const handlers = {
    async ingest(payload, { queue }) {
      seen.push(`ingest:${payload.s}`);
      queue.enqueue({ tipo: "views", payload: { domain: "d" } });
    },
    async views(payload) { seen.push(`views:${payload.domain}`); },
    async falla() { throw new Error("worker roto"); },
  };
  q.enqueue({ tipo: "ingest", payload: { s: 1 } });
  q.enqueue({ tipo: "falla", maxIntentos: 1 });
  const done = await workUntilEmpty(q, handlers);
  assert.deepEqual(seen, ["ingest:1", "views:d"], "fan-out procesado en la misma corrida");
  assert.equal(done.ok, 2);
  assert.equal(done.muerto, 1);
});
