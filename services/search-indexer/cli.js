#!/usr/bin/env node
// CLI del search indexer (PLANNING M7):
//   node services/search-indexer/cli.js build [--domain <d>]
//   node services/search-indexer/cli.js query --q "<texto>" [--dominio d] [--depto 05]
//   node services/search-indexer/cli.js status
import { openOsintDb } from "../../packages/metadata/registry.js";
import { buildSearchIndex, searchQuery, migrateSearch } from "./index.js";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = new Map();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) args.set(rest[i].slice(2), rest[i + 1]?.startsWith("--") || rest[i + 1] === undefined ? true : rest[++i]);
  }
  const db = openOsintDb();
  migrateSearch(db);

  if (cmd === "build") {
    console.log(buildSearchIndex(db, args.has("domain") ? String(args.get("domain")) : null));
  } else if (cmd === "query") {
    const out = searchQuery(db, {
      q: String(args.get("q") ?? ""),
      dominio: args.has("dominio") ? String(args.get("dominio")) : null,
      depto: args.has("depto") ? String(args.get("depto")) : null,
    });
    console.table(out.hits);
    console.log("facetas:", JSON.stringify(out.facetas), "total:", out.total);
  } else if (cmd === "status") {
    console.table(db.prepare("SELECT dominio, COUNT(*) indexados FROM search_fts GROUP BY dominio").all());
  } else {
    console.log("uso: cli.js build [--domain d] | query --q <texto> [--dominio d] [--depto dd] | status");
    process.exitCode = cmd ? 1 : 0;
  }
  db.close();
}

main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
