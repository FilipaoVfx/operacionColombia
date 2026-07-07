// C3 — FileConnector con streaming (PLANNING M5): CSV grande se procesa por chunks
// (leer → parsear N filas → yield batch → siguiente chunk), memoria estable sin OOM.
// source.endpoint = ruta local del archivo; source.csv = { sep?, encoding? }.
import { createReadStream, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const BATCH_SIZE = 5000;

export async function discover(source) {
  const st = statSync(source.endpoint);
  // hash barato para freshness: tamaño + mtime (no leer 2 GB solo para discover)
  const hash = createHash("sha256").update(`${st.size}:${st.mtimeMs}`).digest("hex");
  let esquema = null;
  for await (const batch of fetch(source, null, 1)) {
    esquema = Object.keys(batch.rows[0] ?? {}).map((name) => ({ name }));
    break;
  }
  return { filas: null, hash, esquema };
}

export async function healthcheck(source) {
  return existsSync(source.endpoint) ? "ok" : "down";
}

/** AsyncIterable<RawBatch>: parsea el CSV línea a línea sin cargar el archivo entero. */
export async function* fetch(source, _cursor = null, batchSize = BATCH_SIZE) {
  const sep = source.csv?.sep ?? ",";
  const encoding = source.csv?.encoding ?? "utf8";
  let header = null;
  let rows = [];
  let offset = 0;

  for await (const line of readLines(source.endpoint, encoding)) {
    if (line === "") continue;
    const fields = parseCsvLine(line, sep);
    if (!header) { header = fields.map((h) => h.trim()); continue; }
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = fields[i] ?? null;
    rows.push(row);
    if (rows.length >= batchSize) {
      yield { sourceId: source.id, rows, cursor: { offset }, fetchedAt: new Date().toISOString() };
      offset += rows.length;
      rows = [];
    }
  }
  if (rows.length) {
    yield { sourceId: source.id, rows, cursor: { offset }, fetchedAt: new Date().toISOString() };
  }
}

/** Líneas desde stream con buffer acotado; respeta saltos de línea dentro de comillas. */
async function* readLines(path, encoding) {
  let buf = "";
  for await (const chunk of createReadStream(path, { encoding })) {
    buf += chunk;
    let start = 0;
    let inQuotes = false;
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === "\n" && !inQuotes) {
        yield buf.slice(start, i).replace(/\r$/, "");
        start = i + 1;
      }
    }
    buf = buf.slice(start);
  }
  if (buf.length) yield buf.replace(/\r$/, "");
}

/** Parser CSV mínimo: separador configurable, comillas dobles con escape "". */
export function parseCsvLine(line, sep = ",") {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
