#!/usr/bin/env node
// CLI del geo indexer (PLANNING M10 — carga por bbox):
//   node services/geo-indexer/cli.js build [--domain <d>]
//   node services/geo-indexer/cli.js status
import { openOsintDb } from "../../packages/metadata/registry.js";
import { buildGeoIndex, migrateGeo } from "./index.js";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = new Map();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) args.set(rest[i].slice(2), rest[i + 1]?.startsWith("--") || rest[i + 1] === undefined ? true : rest[++i]);
  }
  const db = openOsintDb();
  migrateGeo(db);

  if (cmd === "build") {
    console.log(buildGeoIndex(db, args.has("domain") ? String(args.get("domain")) : null));
  } else if (cmd === "status") {
    console.table(db.prepare("SELECT dominio, COUNT(*) indexados FROM geo_bbox GROUP BY dominio").all());
  } else {
    console.log("uso: cli.js build [--domain d] | status");
    process.exitCode = cmd ? 1 : 0;
  }
  db.close();
}

main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
