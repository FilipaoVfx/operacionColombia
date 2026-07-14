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

test("rm_contratos_depto + rm_top_proveedores_depto + rm_entidades_depto agregan por dominio nuevo", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  const store = new WriteStore(db);
  const contratoSource = { id: "secop", domain: "contratacion", nombre: "SECOP", endpoint: "http://x", kind: "socrata" };
  const entidadSource = { id: "chip", domain: "entidades", nombre: "CHIP", endpoint: "http://x", kind: "socrata" };
  [
    { proveedor: "ACME SAS", valor_contrato: 600000000, anio: 2026 },
    { proveedor: "ACME SAS", valor_contrato: 900000000, anio: 2026 },
    { proveedor: "OTRA SAS", valor_contrato: 500000000, anio: 2026 },
  ].forEach((c, i) => store.upsert({
    ...buildRecord({ source: contratoSource, idFuente: i, campos: c }),
    divipola_depto: "05",
  }));
  store.upsert({
    ...buildRecord({ source: entidadSource, idFuente: 0, campos: { razon_social: "ENTIDAD X" } }),
    divipola_depto: "05",
  });

  buildViews(db, { domain: "contratacion" });
  buildViews(db, { domain: "entidades" });

  const contratos = db.prepare("SELECT contratos, valor_total FROM rm_contratos_depto WHERE cod_dpto='05'").get();
  assert.equal(contratos.contratos, 3);
  assert.equal(contratos.valor_total, 2000000000);

  const top = db.prepare("SELECT proveedor, contratos, valor_total FROM rm_top_proveedores_depto WHERE cod_dpto='05' ORDER BY valor_total DESC").all();
  assert.equal(top[0].proveedor, "ACME SAS");
  assert.equal(top[0].contratos, 2);
  assert.equal(top[0].valor_total, 1500000000);

  const entidades = db.prepare("SELECT entidades FROM rm_entidades_depto WHERE cod_dpto='05'").get();
  assert.equal(entidades.entidades, 1);
});
