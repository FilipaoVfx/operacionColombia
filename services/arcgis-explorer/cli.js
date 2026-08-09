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
import { DICCIONARIO_MINERIA, ANM_SERVICE } from "../connectors/sources.config.js";
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
  // Los flags y el destino pueden venir en cualquier orden: `npm run x -- 3`
  // los deja DESPUÉS de los del script, así que no se puede asumir posición.
  const argv = process.argv.slice(2);
  const args = new Map();
  const libres = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { libres.push(a); continue; }
    const sig = argv[i + 1];
    args.set(a.slice(2), sig === undefined || sig.startsWith("--") ? true : argv[++i]);
  }

  // Pegar una URL entre comillas en una terminal es frágil: si el editor las
  // convierte en entidades HTML, bash parte el comando por el `&` y ejecuta
  // pedazos sueltos. Por eso el destino es opcional y admite solo el id de capa:
  //   cli.js                 → capas de ANM_SERVICE
  //   cli.js 3 --profile     → perfila la capa 3 de ANM_SERVICE
  //   cli.js <url> --profile → cualquier otro servicio ArcGIS
  let url = libres[0];
  if (!url || /^\d+$/.test(url)) {
    const base = ANM_SERVICE.replace(/\/$/, "");
    url = url ? `${base}/${url}` : base;
    if (!args.has("json")) console.log(`(usando ANM_SERVICE: ${url})`);
  }

  const json = args.has("json");

  if (esUrlDeServicio(url) || !args.has("profile")) {
    const out = await listLayers(url);
    if (json) return console.log(JSON.stringify(out, null, 2));
    console.log(`\nServicio: ${out.servicio ?? "(sin descripción)"}`);
    console.log(`SRID nativo: ${out.spatialReference ?? "?"} · maxRecordCount: ${out.maxRecordCount ?? "?"}\n`);
    console.table(out.capas.map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, geometria: c.geometria })));
    console.log("\nPerfilá una capa con:  npm run anm:perfil -- <id>\n");
    return;
  }

  const meta = await describeLayer(url);
  if (!meta.campos.length) {
    console.error(
      `\nLa capa "${meta.nombre ?? url}" no declara campos: casi seguro es un Group Layer ` +
      `(un contenedor, no una capa de datos). Elegí una de tipo 'Feature Layer' del listado:\n` +
      `  npm run anm\n`
    );
    process.exitCode = 1;
    return;
  }
  const features = await sampleLayer(url, { sample: Number(args.get("sample")) || 300 });
  const perfil = profileFeatures(features, { campos: meta.campos });

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
  console.log(`Última edición de la capa: ${meta.ultima_edicion ?? "no publicada por el servicio"}`);
  if (meta.descripcion) console.log(`Descripción: ${meta.descripcion.slice(0, 300)}`);

  console.log(`\n— Columnas (muestra de ${perfil.muestra}) —`);
  console.table(perfil.columnas.map((c) => ({
    columna: c.columna,
    "nulos %": c.nulos_pct,
    distintos: c.distintos,
    cte: c.constante ? "sí" : "",
    rango: c.fechas ? `${c.fechas.desde} … ${c.fechas.hasta}` : c.numerica ? `${c.numerica.min}…${c.numerica.max}` : "",
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
