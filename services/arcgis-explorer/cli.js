#!/usr/bin/env node
// Descubrimiento y perfilado de servicios ArcGIS, previo a escribir un mapRow.
//
//   node services/arcgis-explorer/cli.js <urlServicio>                  → lista capas
//   node services/arcgis-explorer/cli.js <urlCapa> --profile            → perfil de la capa
//   node services/arcgis-explorer/cli.js <urlCapa> --profile --sample 500 --json
//
// El perfil imprime, además del esquema, las dos cifras que deciden si vale la pena
// ingerir la capa: qué tan pobladas están sus columnas y qué porcentaje cruza con DIVIPOLA.
import {
  listLayers, describeLayer, sampleLayer, profileFeatures,
  suggestMapping, coberturaTerritorial, esUrlDeServicio,
} from "./index.js";
import { DICCIONARIO_MINERIA } from "../connectors/sources.config.js";
import { openOsintDb } from "../../packages/metadata/registry.js";
import { DivipolaResolver } from "../../packages/divipola/index.js";

function resolverOpcional() {
  try {
    const db = openOsintDb();
    const n = db.prepare("SELECT COUNT(*) c FROM divipola").get().c;
    if (!n) { db.close(); return null; }
    return new DivipolaResolver(db);
  } catch { return null; }
}

async function main() {
  const [url, ...rest] = process.argv.slice(2);
  if (!url) {
    console.log("uso: cli.js <urlServicioOCapa> [--profile] [--sample N] [--dict mineria] [--json]");
    process.exitCode = 1;
    return;
  }
  const args = new Map();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      args.set(rest[i].slice(2), rest[i + 1]?.startsWith("--") || rest[i + 1] === undefined ? true : rest[++i]);
    }
  }
  const json = args.has("json");

  if (esUrlDeServicio(url) || !args.has("profile")) {
    const out = await listLayers(url);
    if (json) return console.log(JSON.stringify(out, null, 2));
    console.log(`\nServicio: ${out.servicio ?? "(sin descripción)"}`);
    console.log(`SRID nativo: ${out.spatialReference ?? "?"} · maxRecordCount: ${out.maxRecordCount ?? "?"}\n`);
    console.table(out.capas.map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, geometria: c.geometria })));
    console.log("\nPerfilá una capa con:  cli.js <url>/<id> --profile\n");
    return;
  }

  const meta = await describeLayer(url);
  const features = await sampleLayer(url, { sample: Number(args.get("sample")) || 300 });
  const perfil = profileFeatures(features);

  const dict = args.get("dict") === "mineria" || args.get("dict") === true ? DICCIONARIO_MINERIA : null;
  const sugerencia = dict ? suggestMapping(meta.campos, dict) : null;
  const cobertura = sugerencia
    ? coberturaTerritorial(features, {
        campoMuni: sugerencia.mapeo.municipio,
        campoDepto: sugerencia.mapeo.departamento,
        resolver: resolverOpcional(),
      })
    : null;

  if (json) return console.log(JSON.stringify({ meta, perfil, sugerencia, cobertura }, null, 2));

  console.log(`\nCapa: ${meta.nombre}  (${meta.geometria ?? "sin geometría"})`);
  console.log(`Filas: ${meta.filas ?? "?"} · OID: ${meta.objectIdField ?? "?"} · SRID: ${meta.spatialReference ?? "?"} · maxRecordCount: ${meta.maxRecordCount ?? "?"}`);
  if (meta.descripcion) console.log(`Descripción: ${meta.descripcion.slice(0, 300)}`);

  console.log(`\n— Columnas (muestra de ${perfil.muestra}) —`);
  console.table(perfil.columnas.map((c) => ({
    columna: c.columna,
    "nulos %": c.nulos_pct,
    distintos: c.distintos,
    cte: c.constante ? "sí" : "",
    rango: c.numerica ? `${c.numerica.min}…${c.numerica.max}` : "",
    ejemplo: c.top[0]?.valor?.slice?.(0, 40) ?? c.top[0]?.valor ?? "",
  })));

  console.log(`\n— Geometría —`);
  console.log(`  con geometría: ${perfil.geometria.con_geometria_pct}% · tipos: ${perfil.geometria.tipos.join(", ") || "—"}`);
  console.log(`  vértices: mín ${perfil.geometria.vertices_min} · media ${perfil.geometria.vertices_media} · colapsadas (<3): ${perfil.geometria.colapsadas}`);

  if (sugerencia) {
    console.log(`\n— Mapeo sugerido (canónico ← campo real) —`);
    console.table(Object.entries(sugerencia.mapeo).map(([k, v]) => ({ canonico: k, campo: v })));
    if (sugerencia.faltantes.length) console.log(`  sin resolver: ${sugerencia.faltantes.join(", ")}`);
  }
  if (cobertura) {
    console.log(`\n— Cobertura territorial (decide si el dominio cruza) —`);
    console.table([cobertura]);
  }
  console.log();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
