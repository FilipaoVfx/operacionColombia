/* SIVU - controlador del dashboard (vanilla JS). Consume la API propia. */
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const state = {
  departamento: "",        // territorial geografica (un solo valor)
  territAdmin: new Set(),  // territoriales no departamentales (ANI, Planta Central, ...)
  tipo: new Set(),
  superficie: new Set(),
  admin: new Set(),
  pav: "",
  colorBy: "tipo_vial",
  table: { page: 0, pageSize: 50, sort: null, dir: "asc", total: 0, open: false },
};

let map, layer, meta;
let selectedId = null;
const charts = {};

const PALETTES = {
  tipo_vial: { Nacional: "#3b82f6", Departamental: "#22c55e", Terciaria: "#f59e0b", "Por Definir": "#94a3b8" },
  superficie: { Pavimentada: "#22c55e", "Sin Pavimentar": "#ef4444", "Por Definir": "#94a3b8" },
  administrador: {
    INVIAS: "#3b82f6", ANI: "#a855f7", "Concesion Departamental": "#f59e0b",
    FINDETER: "#14b8a6", "INVIAS - Convenios": "#06b6d4", "Vias Desuso": "#ef4444",
  },
};
const DEFAULT_COLOR = "#64748b";

function colorFor(props) {
  const pal = PALETTES[state.colorBy] || {};
  return pal[props[state.colorBy]] || DEFAULT_COLOR;
}

// ----- parametros de filtro compartidos -----
function filterParams() {
  const p = new URLSearchParams();
  // departamento (geografico) y otras territoriales comparten la columna region;
  // se combinan como OR (IN) porque cada tramo tiene una sola territorial.
  const regions = [];
  if (state.departamento) regions.push(state.departamento);
  if (state.territAdmin.size) regions.push(...state.territAdmin);
  if (regions.length) p.set("region", regions.join(","));
  if (state.tipo.size) p.set("tipo", [...state.tipo].join(","));
  if (state.superficie.size) p.set("superficie", [...state.superficie].join(","));
  if (state.admin.size) p.set("administrador", [...state.admin].join(","));
  if (state.pav) p.set("pavimentada", state.pav);
  return p;
}

// ----- fetch con spinner (>500ms) y cancelacion -----
let inflight = 0;
let spinTimer = null;
function spinOn() {
  inflight++;
  if (!spinTimer) spinTimer = setTimeout(() => $("#spinner").classList.remove("hidden"), 500);
}
function spinOff() {
  inflight = Math.max(0, inflight - 1);
  if (inflight === 0) {
    clearTimeout(spinTimer); spinTimer = null;
    $("#spinner").classList.add("hidden");
  }
}
async function getJson(url, signal) {
  spinOn();
  try {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { spinOff(); }
}

const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("es-CO"));

// ============================================================ init
document.addEventListener("DOMContentLoaded", init);

async function init() {
  initMap();
  try {
    meta = await getJson("/api/meta");
  } catch (e) {
    $("#loadBadge").textContent = "Error cargando datos. ¿Está corriendo el servidor?";
    return;
  }
  hydrateMeta();
  wireEvents();
  await refreshAll();
  if (meta.bbox) {
    map.fitBounds([[meta.bbox.miny, meta.bbox.minx], [meta.bbox.maxy, meta.bbox.maxx]], { padding: [20, 20] });
  }
}

function initMap() {
  map = L.map("map", { preferCanvas: true, zoomControl: true, attributionControl: true })
    .setView([4.6, -74.1], 6);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap &copy; CARTO · Datos: INVIAS',
  }).addTo(map);
}

function hydrateMeta() {
  const date = meta.ingested_at ? new Date(meta.ingested_at).toLocaleString("es-CO") : "";
  $("#sourceLine").textContent = `${meta.source || "Red Vial Nacional · INVIAS"} · actualizado ${date}`;

  // departamento (solo geograficos)
  const sel = $("#fDepartamento");
  meta.departamentos.forEach((r) => {
    const o = document.createElement("option");
    o.value = r.v; o.textContent = `${r.v} (${r.c})`;
    sel.appendChild(o);
  });
  buildChecks("#fTerritorial", "territAdmin", meta.territoriales_otras);
  buildChecks("#fTipo", "tipo", meta.tipos);
  buildChecks("#fSuperficie", "superficie", meta.superficies);
  buildChecks("#fAdmin", "admin", meta.administradores);
}

function buildChecks(container, key, items) {
  const box = $(container);
  box.innerHTML = "";
  items.forEach((it) => {
    const id = `${key}_${it.v}`.replace(/[^a-z0-9_]/gi, "");
    const lbl = document.createElement("label");
    lbl.className = "flex items-center justify-between gap-2 text-sm cursor-pointer";
    lbl.innerHTML = `<span class="flex items-center gap-2 min-w-0">
        <input type="checkbox" id="${id}" value="${it.v}" class="accent-blue-500 shrink-0">
        <span class="truncate">${it.v}</span></span>
        <span class="text-[11px] text-slate-500 shrink-0">${it.c}</span>`;
    lbl.querySelector("input").addEventListener("change", (e) => {
      const set = state[key];
      e.target.checked ? set.add(e.target.value) : set.delete(e.target.value);
      state.table.page = 0;
      refreshAll();
    });
    box.appendChild(lbl);
  });
}

function wireEvents() {
  $("#fDepartamento").addEventListener("change", (e) => { state.departamento = e.target.value; state.table.page = 0; refreshAll(); });
  $$('input[name="pav"]').forEach((r) =>
    r.addEventListener("change", (e) => { state.pav = e.target.value; state.table.page = 0; refreshAll(); }));
  $("#colorBy").addEventListener("change", (e) => { state.colorBy = e.target.value; restyle(); buildLegend(); });
  $("#resetFilters").addEventListener("click", resetFilters);

  // tabla
  $("#toggleTable").addEventListener("click", () => toggleTable(true));
  $("#closeTable").addEventListener("click", () => toggleTable(false));
  $("#pgPrev").addEventListener("click", () => { if (state.table.page > 0) { state.table.page--; loadTable(); } });
  $("#pgNext").addEventListener("click", () => {
    const { page, pageSize, total } = state.table;
    if ((page + 1) * pageSize < total) { state.table.page++; loadTable(); }
  });
  $$("th[data-sort]").forEach((th) =>
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (state.table.sort === col) state.table.dir = state.table.dir === "asc" ? "desc" : "asc";
      else { state.table.sort = col; state.table.dir = "asc"; }
      state.table.page = 0; loadTable();
    }));
  $("#exportCsv").addEventListener("click", () => {
    const p = filterParams(); p.set("format", "csv"); p.set("limit", "10000");
    window.open("/api/vias?" + p.toString(), "_blank");
  });
  $("#exportJson").addEventListener("click", exportJson);

  wireSearch();
}

function resetFilters() {
  state.departamento = ""; state.pav = "";
  state.tipo.clear(); state.superficie.clear(); state.admin.clear(); state.territAdmin.clear();
  $("#fDepartamento").value = "";
  $$('#fTipo input, #fSuperficie input, #fAdmin input, #fTerritorial input').forEach((c) => (c.checked = false));
  $('input[name="pav"][value=""]').checked = true;
  state.table.page = 0;
  refreshAll();
}

// ============================================================ refresh
async function refreshAll() {
  await Promise.all([loadMap(), loadKpi(), state.table.open ? loadTable() : Promise.resolve()]);
}

let mapAbort;
async function loadMap() {
  mapAbort?.abort();
  mapAbort = new AbortController();
  const p = filterParams(); p.set("limit", "5000");
  try {
    const fc = await getJson("/api/vias?" + p.toString(), mapAbort.signal);
    drawMap(fc);
    const pr = fc.properties || {};
    $("#loadBadge").textContent =
      `${fmt(pr.returned)} tramos en mapa` + (pr.truncated ? ` (de ${fmt(pr.total)})` : "");
  } catch (e) {
    if (e.name !== "AbortError") $("#loadBadge").textContent = "Error al cargar el mapa";
  }
}

function drawMap(fc) {
  if (layer) layer.remove();
  layer = L.geoJSON(fc, {
    style: (f) => ({ color: colorFor(f.properties), weight: weightFor(f.properties), opacity: 0.9 }),
    onEachFeature: (f, lyr) => {
      lyr.on("click", () => { selectedId = f.properties.id; restyle(); openPopup(f, lyr); });
    },
  }).addTo(map);
  buildLegend();
}

function weightFor(props) {
  if (selectedId && props.id === selectedId) return 6;
  if (props.tipo_vial === "Nacional") return 3;
  if (props.tipo_vial === "Departamental") return 2.2;
  return 1.6;
}
function restyle() {
  if (!layer) return;
  layer.setStyle((f) => ({ color: colorFor(f.properties), weight: weightFor(f.properties), opacity: 0.9 }));
}

function openPopup(f, lyr) {
  const p = f.properties;
  const row = (k, v) => (v == null || v === "" ? "" : `<div class="flex justify-between gap-3"><span class="text-slate-400">${k}</span><span class="text-right">${v}</span></div>`);
  const pav = p.pavimentada === true ? "Sí" : p.pavimentada === false ? "No" : "Sin dato";
  const html = `
    <div class="space-y-1 text-[13px]" style="min-width:220px">
      <div class="text-sm font-semibold text-white">${p.nombre_tramo || "Tramo"}</div>
      <div class="text-[11px] text-slate-400 mb-1">Código ${p.codigo_vial || "—"}</div>
      ${row("Tipo", p.tipo_vial)}
      ${row("Superficie", p.superficie)}
      ${row("Pavimentada", pav)}
      ${row("Calzada", p.calzada)}
      ${row("Región", p.region)}
      ${row("Administrador", p.administrador)}
      ${row("Longitud", p.longitud_km != null ? p.longitud_km.toFixed(2) + " km" : null)}
      <a href="${p.fuente_oficial}" target="_blank" rel="noopener"
         class="mt-1 block text-[11px] text-blue-400 hover:text-blue-300">Ver fuente oficial (INVIAS) ↗</a>
    </div>`;
  lyr.bindPopup(html, { maxWidth: 300 }).openPopup();
}

function buildLegend() {
  const el = $("#legend");
  const pal = PALETTES[state.colorBy] || {};
  const labels = {
    tipo_vial: "Tipo de vía", superficie: "Superficie", administrador: "Administrador",
  }[state.colorBy];
  const entries = Object.entries(pal);
  el.innerHTML =
    `<div class="mb-1.5 font-medium text-slate-300">${labels}</div>` +
    entries.map(([k, c]) =>
      `<div class="flex items-center gap-2 py-0.5"><span class="inline-block h-1.5 w-4 rounded" style="background:${c}"></span><span class="text-slate-300">${k}</span></div>`
    ).join("");
  el.classList.remove("hidden");
}

// ============================================================ KPIs + charts
async function loadKpi() {
  let k;
  try { k = await getJson("/api/kpi?" + filterParams().toString()); }
  catch { return; }

  $("#kpiKm").textContent = fmt(Math.round(k.total_km));
  $("#kpiSeg").textContent = fmt(k.total_segmentos);
  $("#kpiPav").textContent = k.pct_pavimentada == null ? "s/d" : k.pct_pavimentada + "%";
  $("#kpiPavNote").textContent =
    `Solo ${k.pct_clasificado || 0}% de la red tiene dato de superficie (${fmt(Math.round(k.km_clasificado))} km).`;
  $("#kpiScope").textContent = scopeLabel();

  renderDoughnut("chartTipo", k.por_tipo, "tipo_vial");
  renderBar("chartRegion", (k.por_region || []).slice(0, 10));
  renderDoughnut("chartAdmin", k.por_administrador, "administrador");
}

function scopeLabel() {
  const parts = [];
  if (state.departamento) parts.push(state.departamento);
  if (state.territAdmin.size) parts.push([...state.territAdmin].join("/"));
  if (state.tipo.size) parts.push([...state.tipo].join("/"));
  if (state.superficie.size) parts.push([...state.superficie].join("/"));
  if (state.pav === "1") parts.push("pavimentada");
  if (state.pav === "0") parts.push("sin pavimentar");
  return parts.length ? parts.join(" · ") : "toda la red";
}

const CHART_TXT = "#cbd5e1";
function renderDoughnut(id, rows, dim) {
  const labels = rows.map((r) => r.label || "Sin dato");
  const data = rows.map((r) => r.km);
  const pal = PALETTES[dim] || {};
  const colors = labels.map((l) => pal[l] || DEFAULT_COLOR);
  upsertChart(id, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#0f172a", borderWidth: 2 }] },
    options: {
      plugins: { legend: { position: "bottom", labels: { color: CHART_TXT, boxWidth: 10, font: { size: 10 } } } },
      cutout: "58%",
    },
  });
}
function renderBar(id, rows) {
  const labels = rows.map((r) => r.label || "Sin dato");
  const data = rows.map((r) => r.km);
  upsertChart(id, {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: "#3b82f6", borderRadius: 3 }] },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_TXT, font: { size: 10 } }, grid: { color: "#1e293b" } },
        y: { ticks: { color: CHART_TXT, font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}
function upsertChart(id, cfg) {
  if (charts[id]) { charts[id].data = cfg.data; charts[id].options = cfg.options; charts[id].update(); }
  else charts[id] = new Chart($("#" + id), cfg);
}

// ============================================================ tabla
function toggleTable(open) {
  state.table.open = open;
  $("#tablePanel").classList.toggle("hidden", !open);
  if (open) loadTable();
  setTimeout(() => map.invalidateSize(), 60);
}

async function loadTable() {
  const p = filterParams();
  p.set("format", "table");
  p.set("limit", String(state.table.pageSize));
  p.set("offset", String(state.table.page * state.table.pageSize));
  if (state.table.sort) { p.set("sort", state.table.sort); p.set("dir", state.table.dir); }
  let res;
  try { res = await getJson("/api/vias?" + p.toString()); } catch { return; }
  state.table.total = res.total;

  const tb = $("#tableBody");
  tb.innerHTML = res.items.map((it) => `
    <tr class="border-b border-ink-700 hover:bg-ink-700/50 cursor-pointer" data-id="${it.id}">
      <td class="px-3 py-1.5 font-mono text-[11px]">${it.codigo_vial || "—"}</td>
      <td class="px-3 py-1.5">${it.nombre_tramo || ""}</td>
      <td class="px-3 py-1.5">${it.tipo_vial || ""}</td>
      <td class="px-3 py-1.5">${it.superficie || "—"}</td>
      <td class="px-3 py-1.5">${it.region || "—"}</td>
      <td class="px-3 py-1.5">${it.administrador || "—"}</td>
      <td class="px-3 py-1.5 text-right">${it.longitud_km != null ? it.longitud_km.toFixed(2) : ""}</td>
    </tr>`).join("");
  tb.querySelectorAll("tr").forEach((tr) =>
    tr.addEventListener("click", () => zoomToId(Number(tr.dataset.id))));

  $("#tableCount").textContent = `${fmt(res.total)} resultados`;
  const from = res.total ? state.table.page * state.table.pageSize + 1 : 0;
  const to = Math.min((state.table.page + 1) * state.table.pageSize, res.total);
  $("#pgInfo").textContent = `${from}–${to} de ${fmt(res.total)}`;
  $("#pgPrev").disabled = state.table.page === 0;
  $("#pgNext").disabled = to >= res.total;
}

async function exportJson() {
  const p = filterParams(); p.set("limit", "10000");
  const fc = await getJson("/api/vias?" + p.toString());
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "vias_sivu.geojson"; a.click();
  URL.revokeObjectURL(a.href);
}

// ============================================================ búsqueda + zoom
function wireSearch() {
  const input = $("#search");
  const box = $("#searchResults");
  let t, ac;
  input.addEventListener("input", () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 2) { box.classList.add("hidden"); return; }
    t = setTimeout(async () => {
      ac?.abort(); ac = new AbortController();
      let rows;
      try { rows = await getJson("/api/search?q=" + encodeURIComponent(q) + "&limit=12", ac.signal); }
      catch { return; }
      if (!rows.length) { box.innerHTML = `<div class="px-3 py-2 text-sm text-slate-500">Sin coincidencias</div>`; box.classList.remove("hidden"); return; }
      box.innerHTML = rows.map((r) => `
        <button data-id="${r.id}" class="block w-full px-3 py-2 text-left hover:bg-ink-700">
          <div class="text-sm text-slate-100">${r.label}</div>
          <div class="text-[11px] text-slate-500">${r.sublabel || ""}</div>
        </button>`).join("");
      box.classList.remove("hidden");
      box.querySelectorAll("button").forEach((b) =>
        b.addEventListener("click", () => {
          box.classList.add("hidden"); input.value = "";
          zoomToId(Number(b.dataset.id));
        }));
    }, 200);
  });
  document.addEventListener("click", (e) => {
    if (!box.contains(e.target) && e.target !== input) box.classList.add("hidden");
  });
}

async function zoomToId(id) {
  let feat;
  try { feat = await getJson("/api/vias/" + id); } catch { return; }
  selectedId = id;
  const gj = L.geoJSON(feat, { style: { color: "#fbbf24", weight: 6, opacity: 1 } });
  const b = gj.getBounds();
  map.fitBounds(b, { padding: [60, 60], maxZoom: 12 });
  restyle();
  // popup en el centro del tramo
  const c = b.getCenter();
  const p = feat.properties;
  L.popup({ maxWidth: 300 })
    .setLatLng(c)
    .setContent(buildPopupHtml(p))
    .openOn(map);
}

function buildPopupHtml(p) {
  const row = (k, v) => (v == null || v === "" ? "" : `<div class="flex justify-between gap-3"><span class="text-slate-400">${k}</span><span class="text-right">${v}</span></div>`);
  const pav = p.pavimentada === true ? "Sí" : p.pavimentada === false ? "No" : "Sin dato";
  return `<div class="space-y-1 text-[13px]" style="min-width:220px">
    <div class="text-sm font-semibold text-white">${p.nombre_tramo || "Tramo"}</div>
    <div class="text-[11px] text-slate-400 mb-1">Código ${p.codigo_vial || "—"}</div>
    ${row("Tipo", p.tipo_vial)} ${row("Superficie", p.superficie)} ${row("Pavimentada", pav)}
    ${row("Región", p.region)} ${row("Administrador", p.administrador)}
    ${row("Longitud", p.longitud_km != null ? p.longitud_km.toFixed(2) + " km" : null)}
    <a href="${p.fuente_oficial}" target="_blank" rel="noopener" class="mt-1 block text-[11px] text-blue-400 hover:text-blue-300">Ver fuente oficial (INVIAS) ↗</a>
  </div>`;
}
