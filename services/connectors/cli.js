#!/usr/bin/env node
// CLI del motor de conectores (PLANNING M1):
//   node services/connectors/cli.js list
//   node services/connectors/cli.js run --source <id> [--force]
//   node services/connectors/cli.js run --all [--force]
//   node services/connectors/cli.js status
import { SOURCES, getSource } from "./sources.config.js";
import * as socrata from "./socrata.js";
import * as arcgis from "./arcgis.js";
import * as file from "./file.js";
import { assertConnector } from "../../packages/contracts/index.js";
import { openOsintDb, MetadataRegistry, WriteStore } from "../../packages/metadata/registry.js";
import { buildRecord } from "../../packages/core-model/index.js";
import { loadDivipola, DivipolaResolver } from "../../packages/divipola/index.js";
import { resolveSource, listExplorerSources } from "../socrata-explorer/index.js";

const CONNECTORS = {
  socrata: assertConnector(socrata, "socrata"),
  arcgis: assertConnector(arcgis, "arcgis"),
  file: assertConnector(file, "file"),
};

export async function runSource(db, source, { force = false } = {}) {
  const connector = CONNECTORS[source.kind];
  if (!connector) throw new Error(`conector no implementado: ${source.kind}`);
  const registry = new MetadataRegistry(db);
  const store = new WriteStore(db);
  const resolver = new DivipolaResolver(db);

  console.log(`\n[${source.id}] ${source.nombre} (${source.kind}/${source.domain})`);

  const health = await connector.healthcheck(source);
  if (health === "down") {
    console.warn(`[${source.id}] fuente caída — se omite sin romper la corrida`);
    return { resultado: "skip", motivo: "down" };
  }

  const meta = await connector.discover(source);
  if (!force && registry.isFresh(source.id, meta)) {
    registry.upsert(source, meta);
    console.log(`[${source.id}] sin cambios (etag/hash igual) — skip re-ingesta`);
    return { resultado: "skip", motivo: "fresh" };
  }
  const { version } = registry.upsert(source, meta);

  const runId = registry.startRun(source.id);
  const stats = { filas: 0, insertadas: 0, actualizadas: 0, sin_cambio: 0, errores: 0 };
  try {
    for await (const batch of connector.fetch(source)) {
      // fuente maestra territorial: poblar divipola ANTES de resolver, para que
      // sus propios registros salgan con divipola_muni resuelto (M3)
      if (source.isDivipolaMaster) loadDivipola(db, batch.rows);
      db.exec("BEGIN");
      try {
        for (const row of batch.rows) {
          try {
            const m = source.mapRow(row, { resolver });
            if (!m || m.idFuente == null) { stats.errores++; continue; }
            const divi = m.divipola ? resolver.resolveMunicipio(m.divipola) : null;
            const rec = buildRecord({
              source,
              idFuente: m.idFuente,
              campos: m.campos,
              extra: m.extra,
              geom: m.geom ?? null,
              divipola_muni: divi?.cod_mpio ?? null,
              divipola_depto: divi?.cod_dpto ?? m.deptoCode ?? null,
              transformaciones: [
                "mapRow",
                ...(divi ? [`divipola:${divi.via}`] : m.deptoCode ? ["divipola:depto"] : []),
              ],
              versionDataset: String(version),
              searchBlob: m.searchBlob ?? "",
            });
            const out = store.upsert(rec);
            stats.filas++;
            if (out === "inserted") stats.insertadas++;
            else if (out === "updated") stats.actualizadas++;
            else stats.sin_cambio++;
          } catch (e) {
            stats.errores++;
            if (stats.errores <= 3) console.warn(`  ! fila con error: ${e.message}`);
          }
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      process.stdout.write(`  batch offset=${batch.cursor.offset} filas=${stats.filas}\r`);
    }
    registry.finishRun(runId, { ...stats, resultado: "ok" });
    console.log(`\n[${source.id}] ok: ${stats.filas} filas (${stats.insertadas} nuevas, ${stats.actualizadas} actualizadas, ${stats.sin_cambio} sin cambio, ${stats.errores} errores)`);
    return { resultado: "ok", ...stats };
  } catch (e) {
    registry.finishRun(runId, { ...stats, errores: stats.errores + 1, resultado: "error" });
    throw e;
  }
}

function printStatus(db) {
  const rows = db.prepare(`
    SELECT m.source_id, m.dominio, m.conector, m.version, m.filas, m.last_checked, m.last_updated, m.estado,
           (SELECT COUNT(*) FROM registros r WHERE r.id_interno LIKE m.source_id || ':%') registros
    FROM dataset_meta m ORDER BY m.source_id
  `).all();
  console.table(rows);
  const runs = db.prepare("SELECT * FROM etl_runs ORDER BY run_id DESC LIMIT 10").all();
  console.table(runs);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = new Map();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) args.set(rest[i].slice(2), rest[i + 1]?.startsWith("--") || rest[i + 1] === undefined ? true : rest[++i]);
  }
  const db = openOsintDb();

  if (cmd === "list") {
    const all = [...SOURCES, ...listExplorerSources(db)];
    console.table(all.map((s) => ({ id: s.id, kind: s.kind, domain: s.domain, priority: s.priority, schedule: s.schedule, nombre: s.nombre })));
  } else if (cmd === "status") {
    printStatus(db);
  } else if (cmd === "run") {
    const force = args.has("force");
    const targets = args.has("all") ? [...SOURCES, ...listExplorerSources(db)] : [resolveSource(db, String(args.get("source")), getSource)];
    let failed = 0;
    for (const s of targets) {
      try {
        await runSource(db, s, { force });
      } catch (e) {
        failed++;
        console.error(`[${s.id}] ERROR: ${e.message}`);
      }
    }
    if (failed) process.exitCode = 1;
  } else {
    console.log("uso: cli.js list | status | run --source <id> [--force] | run --all [--force]");
    process.exitCode = cmd ? 1 : 0;
  }
  db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error("ERROR:", e); process.exit(1); });
}
