// Modelo unificado: helpers de identidad, hash y linaje (PLANNING §6.3, OKR O4).
import { createHash } from "node:crypto";

export function sha256(value) {
  const s = typeof value === "string" ? value : stableStringify(value);
  return createHash("sha256").update(s).digest("hex");
}

// JSON.stringify con claves ordenadas — hash estable independiente del orden de propiedades.
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

export function stripAccents(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Normalización nominal (llave de cruce §7.4 README): sin acentos, mayúsculas, sin dobles espacios.
export function normName(s) {
  return stripAccents(String(s ?? "")).toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}

/** Construye un UnifiedRecord completo a partir de lo que emite mapRow. */
export function buildRecord({ source, idFuente, campos, extra = {}, geom = null, divipola_muni = null, divipola_depto = null, transformaciones = [], versionDataset = "1", searchBlob = "" }) {
  const id_fuente = String(idFuente);
  const hash = sha256({ campos, extra, geom });
  return {
    id_interno: `${source.id}:${id_fuente}`,
    id_fuente,
    dominio: source.domain,
    fuente: source.nombre,
    fuente_url: source.endpoint,
    conector: source.kind,
    version_dataset: versionDataset,
    hash,
    fecha_ingesta: new Date().toISOString(),
    transformaciones,
    divipola_muni,
    divipola_depto,
    geom,
    campos,
    extra,
    search_blob: stripAccents(searchBlob).toLowerCase(),
  };
}
