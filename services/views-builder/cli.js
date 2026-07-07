#!/usr/bin/env node
// CLI de vistas materializadas (PLANNING M8):
//   node services/views-builder/cli.js build [--domain <d>] [--view <rm_x>]
//   node services/views-builder/cli.js status
import { openOsintDb } from "../../packages/metadata/registry.js";
import { buildViews, viewsStatus } from "./index.js";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = new Map();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) args.set(rest[i].slice(2), rest[i + 1]?.startsWith("--") || rest[i + 1] === undefined ? true : rest[++i]);
  }
  const db = openOsintDb();

  if (cmd === "build") {
    const out = buildViews(db, {
      domain: args.has("domain") ? String(args.get("domain")) : null,
      view: args.has("view") ? String(args.get("view")) : null,
    });
    console.table(out.built);
  } else if (cmd === "status") {
    console.table(viewsStatus(db));
  } else {
    console.log("uso: cli.js build [--domain d] [--view rm_x] | status");
    process.exitCode = cmd ? 1 : 0;
  }
  db.close();
}

main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
