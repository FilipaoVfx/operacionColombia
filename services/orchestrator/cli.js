#!/usr/bin/env node
// CLI del orquestador (PLANNING M5):
//   node services/orchestrator/cli.js tick            # scheduler + drenar cola
//   node services/orchestrator/cli.js work [--max N]  # solo drenar cola
//   node services/orchestrator/cli.js enqueue --tipo <t> [--payload '{"k":1}']
//   node services/orchestrator/cli.js status
import { openOsintDb } from "../../packages/metadata/registry.js";
import { SOURCES } from "../connectors/sources.config.js";
import { listExplorerSources } from "../socrata-explorer/index.js";
import { Queue } from "./queue.js";
import { scheduleDue } from "./scheduler.js";
import { createHandlers, workUntilEmpty } from "./worker.js";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = new Map();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) args.set(rest[i].slice(2), rest[i + 1]?.startsWith("--") || rest[i + 1] === undefined ? true : rest[++i]);
  }
  const db = openOsintDb();
  const queue = new Queue(db);

  if (cmd === "tick") {
    const recovered = queue.recoverStale();
    if (recovered) console.log(`recuperados ${recovered} jobs huérfanos`);
    const due = scheduleDue(db, queue, [...SOURCES, ...listExplorerSources(db)]);
    console.log(due.length ? `encoladas ${due.length} ingestas: ${due.map((d) => d.sourceId).join(", ")}` : "ninguna fuente vencida");
    const done = await workUntilEmpty(queue, createHandlers(db), { log: console.log });
    console.log("resumen:", done);
  } else if (cmd === "work") {
    const max = args.has("max") ? Number(args.get("max")) : Infinity;
    const done = await workUntilEmpty(queue, createHandlers(db), { max, log: console.log });
    console.log("resumen:", done);
  } else if (cmd === "enqueue") {
    const tipo = String(args.get("tipo"));
    const payload = args.has("payload") ? JSON.parse(String(args.get("payload"))) : null;
    const id = queue.enqueue({ tipo, payload });
    console.log(id != null ? `job ${id} encolado` : "duplicado (dedupe) — ya hay un job vivo");
  } else if (cmd === "status") {
    console.table(queue.stats());
    const dead = queue.deadLetter();
    if (dead.length) { console.log("dead-letter:"); console.table(dead); }
  } else {
    console.log("uso: cli.js tick | work [--max N] | enqueue --tipo <t> [--payload json] | status");
    process.exitCode = cmd ? 1 : 0;
  }
  db.close();
}

main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
