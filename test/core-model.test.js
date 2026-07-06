import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, stableStringify, normName, buildRecord } from "../packages/core-model/index.js";

test("stableStringify es independiente del orden de claves", () => {
  assert.equal(stableStringify({ a: 1, b: [2, { c: 3, d: 4 }] }), stableStringify({ b: [2, { d: 4, c: 3 }], a: 1 }));
});

test("sha256 estable para objetos equivalentes", () => {
  assert.equal(sha256({ x: 1, y: 2 }), sha256({ y: 2, x: 1 }));
  assert.notEqual(sha256({ x: 1 }), sha256({ x: 2 }));
});

test("normName: acentos, mayúsculas, espacios", () => {
  assert.equal(normName("  Medellín "), "MEDELLIN");
  assert.equal(normName("Bogotá, D.C."), "BOGOTA D C");
  assert.equal(normName("san  andrés"), "SAN ANDRES");
});

test("buildRecord: identidad y linaje completos (OKR O4)", () => {
  const source = { id: "test-src", domain: "prueba", nombre: "Test", endpoint: "http://x", kind: "socrata" };
  const rec = buildRecord({ source, idFuente: 42, campos: { a: 1 }, searchBlob: "Fútbol" });
  assert.equal(rec.id_interno, "test-src:42");
  assert.equal(rec.dominio, "prueba");
  assert.ok(rec.hash.length === 64);
  assert.ok(rec.fecha_ingesta);
  assert.equal(rec.search_blob, "futbol");
});
