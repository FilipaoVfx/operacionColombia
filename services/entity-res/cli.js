#!/usr/bin/env node
// CLI de entity resolution (PLANNING M6):
//   node services/entity-res/cli.js run [--domain <d>]
//   node services/entity-res/cli.js status
//   node services/entity-res/cli.js revision            # cola de revisión pendiente
import { openOsintDb } from "../../packages/metadata/registry.js";
import { resolveDomain, migrateEntities } from "./index.js";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = new Map();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) args.set(rest[i].slice(2), rest[i + 1]?.startsWith("--") || rest[i + 1] === undefined ? true : rest[++i]);
  }
  const db = openOsintDb();
  migrateEntities(db);

  if (cmd === "run") {
    const domain = args.has("domain") ? String(args.get("domain")) : null;
    console.log(resolveDomain(db, domain));
  } else if (cmd === "status") {
    console.table(db.prepare("SELECT tipo, COUNT(*) entidades FROM entidades GROUP BY tipo ORDER BY tipo").all());
    console.table(db.prepare("SELECT metodo, COUNT(*) vinculos FROM entidad_registros GROUP BY metodo").all());
  } else if (cmd === "revision") {
    console.table(db.prepare("SELECT rev_id, tipo, nombre, motivo, creado_en FROM entidad_revision WHERE resuelto=0 ORDER BY rev_id DESC LIMIT 50").all());
  } else {
    console.log("uso: cli.js run [--domain d] | status | revision");
    process.exitCode = cmd ? 1 : 0;
  }
  db.close();
}

main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
