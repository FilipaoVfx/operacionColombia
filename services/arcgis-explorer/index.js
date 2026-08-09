// Explorador ArcGIS (contraparte C2 del Socrata Explorer M11).
//
// Un MapServer publica N capas y cada capa su propio esquema: no se puede escribir
// un mapRow contra una fuente ArcGIS sin antes ver qué capas hay, qué campos declara
// cada una y qué tan pobladas están. Este módulo es ese paso previo — descubrimiento
// y perfilado — y no toca la base: solo lee la fuente y devuelve un informe.
//
// Métrica clave para este proyecto: `cobertura_territorial`. Un dominio nuevo solo
// aporta si sus registros cruzan con el resto por DIVIPOLA (README §7.4); una capa
// sin municipio/departamento resoluble es un silo, por muchas filas que traiga.
import { normName } from "../../packages/core-model/index.js";

const UA = { "User-Agent": "operacionColombia-ETL/1.0", Accept: "application/json" };

async function fetchJson(url, { tries = 3, timeout = 30000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      // ArcGIS responde 200 con {error:{...}} — hay que mirarlo explícitamente
      if (j && j.error) throw new Error(`ArcGIS ${j.error.code}: ${j.error.message}`);
      return j;
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 800 * 2 ** i));
    }
  }
  throw lastErr;
}

/** true si la URL apunta al servicio (…/MapServer) y no a una capa (…/MapServer/3). */
export function esUrlDeServicio(url) {
  return /\/(Map|Feature)Server\/?$/i.test(String(url).split("?")[0]);
}

/** Capas publicadas por un MapServer/FeatureServer. */
export async function listLayers(serviceUrl) {
  const base = String(serviceUrl).replace(/\/$/, "");
  const info = await fetchJson(`${base}?f=json`);
  const capas = [...(info.layers ?? []), ...(info.tables ?? [])];
  return {
    servicio: info.serviceDescription || info.description || null,
    spatialReference: info.spatialReference?.latestWkid ?? info.spatialReference?.wkid ?? null,
    maxRecordCount: info.maxRecordCount ?? null,
    capas: capas.map((l) => ({
      id: l.id,
      nombre: l.name,
      tipo: l.type ?? null,               // 'Feature Layer' | 'Table'
      geometria: l.geometryType ?? null,
      url: `${base}/${l.id}`,
    })),
  };
}

/** Metadata de una capa: campos declarados, conteo real y clave primaria. */
export async function describeLayer(layerUrl) {
  const base = String(layerUrl).replace(/\/$/, "");
  const info = await fetchJson(`${base}?f=json`);
  let filas = null;
  try {
    filas = (await fetchJson(`${base}/query?where=1%3D1&returnCountOnly=true&f=json`)).count ?? null;
  } catch { /* algunas capas no permiten count; no es fatal para el perfil */ }
  return {
    nombre: info.name ?? null,
    descripcion: info.description || null,
    geometria: info.geometryType ?? null,
    objectIdField: info.objectIdField ?? null,
    globalIdField: info.globalIdField || null,
    spatialReference: info.extent?.spatialReference?.latestWkid ?? info.extent?.spatialReference?.wkid ?? null,
    maxRecordCount: info.maxRecordCount ?? null,
    filas,
    campos: (info.fields ?? []).map((f) => ({ nombre: f.name, tipo: f.type, alias: f.alias ?? null })),
  };
}

/** Muestra de features en GeoJSON/WGS84 (misma proyección que usa el conector). */
export async function sampleLayer(layerUrl, { sample = 300, where = "1=1" } = {}) {
  const params = new URLSearchParams({
    where, outFields: "*", returnGeometry: "true", outSR: "4326",
    geometryPrecision: "6", resultRecordCount: String(Math.min(sample, 2000)),
    f: "geojson",
  });
  const fc = await fetchJson(`${String(layerUrl).replace(/\/$/, "")}/query?${params}`);
  return fc.features ?? [];
}

const esVacio = (v) => v == null || v === "" || v === "N/A" || v === "NULL";

function statsNumericas(valores) {
  const nums = valores.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  const orden = [...nums].sort((a, b) => a - b);
  const p = (q) => orden[Math.min(orden.length - 1, Math.floor(q * orden.length))];
  return {
    min: orden[0], max: orden.at(-1),
    media: +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(3),
    p50: p(0.5), ceros: nums.filter((n) => n === 0).length,
  };
}

/**
 * Perfil de una muestra de features GeoJSON: por columna nulos/cardinalidad/top y,
 * si es numérica, rango. Sobre la geometría: presencia y vértices (una geometría de
 * 0 vértices tras generalizar es un polígono colapsado — ver `maxAllowableOffset`).
 */
export function profileFeatures(features, { topN = 5 } = {}) {
  const props = features.map((f) => f.properties ?? {});
  const cols = new Set();
  for (const p of props) for (const k of Object.keys(p)) cols.add(k);

  const columnas = [...cols].map((col) => {
    const valores = props.map((p) => p[col]);
    const noVacios = valores.filter((v) => !esVacio(v));
    const conteo = new Map();
    for (const v of noVacios) {
      const k = typeof v === "object" ? JSON.stringify(v) : String(v);
      conteo.set(k, (conteo.get(k) ?? 0) + 1);
    }
    return {
      columna: col,
      nulos_pct: props.length ? +(100 * (props.length - noVacios.length) / props.length).toFixed(1) : 0,
      distintos: conteo.size,
      // cardinalidad 1 = columna constante (candidata a descartar del modelo canónico)
      constante: conteo.size === 1,
      numerica: statsNumericas(noVacios),
      top: [...conteo].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([valor, n]) => ({ valor, n })),
    };
  }).sort((a, b) => a.nulos_pct - b.nulos_pct);

  const conGeom = features.filter((f) => f.geometry?.coordinates?.length).length;
  const vertices = features.map((f) => {
    let n = 0;
    const walk = (c) => { if (typeof c[0] === "number") n++; else c.forEach(walk); };
    if (f.geometry?.coordinates) walk(f.geometry.coordinates);
    return n;
  });

  return {
    muestra: features.length,
    columnas,
    geometria: {
      con_geometria_pct: features.length ? +(100 * conGeom / features.length).toFixed(1) : 0,
      tipos: [...new Set(features.map((f) => f.geometry?.type).filter(Boolean))],
      vertices_min: vertices.length ? Math.min(...vertices) : null,
      vertices_media: vertices.length ? Math.round(vertices.reduce((a, b) => a + b, 0) / vertices.length) : null,
      colapsadas: vertices.filter((v) => v > 0 && v < 3).length,
    },
  };
}

/**
 * Diccionario de alias → campo canónico. Las fuentes ArcGIS colombianas no comparten
 * convención de nombres (mayúsculas, con/sin tilde, abreviaturas), así que el mapeo se
 * resuelve por candidatos y se verifica contra el esquema real, en vez de fijarlo a ciegas.
 */
export function pickField(campos, candidatos) {
  const nombres = campos.map((c) => (typeof c === "string" ? c : c.nombre));
  const idx = new Map(nombres.map((n) => [normName(n).replace(/[^A-Z0-9]/g, ""), n]));
  for (const cand of candidatos) {
    const hit = idx.get(normName(cand).replace(/[^A-Z0-9]/g, ""));
    if (hit) return hit;
  }
  // segundo intento: coincidencia por prefijo (CODIGO_EXPEDIENTE ~ EXPEDIENTE)
  for (const cand of candidatos) {
    const c = normName(cand).replace(/[^A-Z0-9]/g, "");
    for (const [k, orig] of idx) if (k.includes(c) || c.includes(k)) return orig;
  }
  return null;
}

/** Aplica un diccionario {canonico: [alias...]} al esquema y reporta qué quedó sin resolver. */
export function suggestMapping(campos, diccionario) {
  const mapeo = {};
  const faltantes = [];
  for (const [canonico, alias] of Object.entries(diccionario)) {
    const hit = pickField(campos, alias);
    if (hit) mapeo[canonico] = hit;
    else faltantes.push(canonico);
  }
  return { mapeo, faltantes };
}

/**
 * Cobertura territorial de la muestra: sin esto el dominio no cruza con los demás.
 * `resolver` es un DivipolaResolver; si no se pasa, solo se mide presencia del campo.
 */
export function coberturaTerritorial(features, { campoMuni, campoDepto, resolver } = {}) {
  const props = features.map((f) => f.properties ?? {});
  const conMuni = props.filter((p) => campoMuni && !esVacio(p[campoMuni])).length;
  const conDepto = props.filter((p) => campoDepto && !esVacio(p[campoDepto])).length;
  let resueltosMuni = null, resueltosDepto = null;
  if (resolver) {
    resueltosMuni = props.filter((p) => campoMuni && resolver.resolveMunicipio({
      nombre: p[campoMuni], depto: campoDepto ? p[campoDepto] : undefined,
    })).length;
    resueltosDepto = props.filter((p) => campoDepto && resolver.resolveDepto({ nombre: p[campoDepto] })).length;
  }
  const pct = (n) => (props.length && n != null ? +(100 * n / props.length).toFixed(1) : null);
  return {
    campo_municipio: campoMuni ?? null,
    campo_departamento: campoDepto ?? null,
    con_municipio_pct: pct(conMuni),
    con_departamento_pct: pct(conDepto),
    resuelve_municipio_pct: pct(resueltosMuni),
    resuelve_departamento_pct: pct(resueltosDepto),
  };
}
