import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as file from "../services/connectors/file.js";

function csvSource(content, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "csv-"));
  const path = join(dir, "data.csv");
  writeFileSync(path, content);
  return { id: "f1", kind: "file", endpoint: path, ...extra };
}

test("streaming: emite batches del tamaño pedido sin cargar todo", async () => {
  const lines = ["id,nombre"];
  for (let i = 0; i < 25; i++) lines.push(`${i},fila ${i}`);
  const source = csvSource(lines.join("\n"));
  const batches = [];
  for await (const b of file.fetch(source, null, 10)) batches.push(b);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map((b) => b.rows.length), [10, 10, 5]);
  assert.deepEqual(batches.map((b) => b.cursor.offset), [0, 10, 20]);
  assert.equal(batches[0].rows[0].nombre, "fila 0");
});

test("CSV: comillas, separador escapado y salto de línea dentro de campo", async () => {
  const source = csvSource('id,txt\n1,"hola, mundo"\n2,"linea\npartida"\n3,"comilla "" doble"');
  const rows = [];
  for await (const b of file.fetch(source)) rows.push(...b.rows);
  assert.equal(rows[0].txt, "hola, mundo");
  assert.equal(rows[1].txt, "linea\npartida");
  assert.equal(rows[2].txt, 'comilla " doble');
});

test("discover/healthcheck: hash de freshness y archivo faltante", async () => {
  const source = csvSource("a,b\n1,2");
  const meta = await file.discover(source);
  assert.ok(meta.hash);
  assert.deepEqual(meta.esquema.map((c) => c.name), ["a", "b"]);
  assert.equal(await file.healthcheck(source), "ok");
  assert.equal(await file.healthcheck({ endpoint: "/no/existe.csv" }), "down");
});
