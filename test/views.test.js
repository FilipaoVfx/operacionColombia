import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrate, WriteStore } from "../packages/metadata/registry.js";
import { buildRecord } from "../packages/core-model/index.js";
import { buildViews, viewsStatus } from "../services/views-builder/index.js";

const source = { id: "pib", domain: "economia", nombre: "PIB", endpoint: "http://x", kind: "socrata" };

function seededDb() {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const store = new WriteStore(db);
  const filas = [
    { anio: 2023, departamento: "Antioquia", valor_miles_millones: 100, depto: "05" },
    { anio: 2023, departamento: "Antioquia", valor_miles_millones: 50, depto: "05" },
    { anio: 2023, departamento: "Valle del Cauca", valor_miles_millones: 80, depto: "76" },
  ];
  filas.forEach((f, i) => store.upsert({
    ...buildRecord({ source, idFuente: i, campos: { anio: f.anio, departamento: f.departamento, valor_miles_millones: f.valor_miles_millones, tipo_precios: "constantes" } }),
    divipola_depto: f.depto,
  }));
  return db;
}

test("KPI precalculado == cálculo directo (correctitud del read model)", () => {
  const db = seededDb();
  buildViews(db, { domain: "economia" });
  const precalc = db.prepare("SELECT pib_miles_millones FROM rm_pib_depto_anio WHERE cod_dpto='05'").get();
  const directo = db.prepare(`
    SELECT SUM(json_extract(campos,'$.valor_miles_millones')) v FROM registros WHERE divipola_depto='05'
  `).get();
  assert.equal(precalc.pib_miles_millones, directo.v);
  // lectura del KPI = SELECT directo, sin agregación en caliente
  assert.equal(db.prepare("SELECT COUNT(*) c FROM rm_pib_depto_anio").get().c, 2);
});

test("rebuild incremental por dominio: solo vistas afectadas + transversales", () => {
  const db = seededDb();
  const out = buildViews(db, { domain: "economia" });
  const names = out.built.map((b) => b.view);
  assert.ok(names.includes("rm_pib_depto_anio"));
  assert.ok(names.includes("rm_resumen_dominio"), "transversal siempre entra");
  assert.ok(!names.includes("rm_vial_depto"), "dominio no afectado se salta");
});

test("versionado: cada rebuild sube version (clave de caché)", () => {
  const db = seededDb();
  buildViews(db, { view: "rm_resumen_dominio" });
  buildViews(db, { view: "rm_resumen_dominio" });
  const v = viewsStatus(db).find((r) => r.view_name === "rm_resumen_dominio");
  assert.equal(v.version, 2);
});
