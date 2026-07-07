// Panel OSINT unificado (M10): selector DIVIPOLA global → filtra mapa, KPIs, gráfico y tabla.
// Vanilla JS + Leaflet + Chart.js. Consume el Read API (M9).

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("es-CO"));

// paleta validada (dataviz: categórica dark, CVD ΔE 113)
const COLOR_VIAL = "#3987e5";
const COLOR_MUNI = "#c98500";
const INK = { grid: "rgba(51,65,85,.45)", text: "#94a3b8" };

const state = { depto: "", dominio: "territorio", offset: 0, limit: 40, total: 0 };

const TABLE_COLS = {
  territorio: [["cod_mpio", "Código"], ["nom_mpio", "Municipio"], ["dpto", "Departamento"], ["tipo", "Tipo"]],
  vial: [["codigo_vial", "Código"], ["nombre_tramo", "Tramo"], ["territorial", "Territorial"], ["longitud_km", "km"]],
  economia: [["anio", "Año"], ["departamento", "Depto"], ["actividad", "Actividad"], ["valor_miles_millones", "Valor"]],
};
const DOM_LABEL = { territorio: "Territorio", vial: "Vial", economia: "Economía" };

let map, layerMunis, layerVial, chart;

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------------------
// mapa
// ---------------------------------------------------------------------------
function initMap() {
  map = L.map("map", { zoomControl: true }).setView([4.6, -73.1], 6);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 18,
  }).addTo(map);
  layerMunis = L.layerGroup().addTo(map);
  layerVial = L.layerGroup().addTo(map);
  // leyenda con etiqueta de texto: identidad nunca solo-color
  L.control.layers(null, {
    '<span style="color:#c98500">●</span> Municipios (DANE)': layerMunis,
    '<span style="color:#3987e5">━</span> Red vial (INVIAS)': layerVial,
  }, { collapsed: false, position: "topright" }).addTo(map);
}

function popupHtml(p) {
  const nombre = p.nom_mpio || p.nombre_tramo || p.id_interno;
  const filas = Object.entries(p)
    .filter(([k, v]) => v !== null && v !== "" && !["id_interno", "fuente_url", "dominio"].includes(k))
    .slice(0, 8)
    .map(([k, v]) => `<div class="flex justify-between gap-3"><span style="color:#94a3b8">${k}</span><b>${v}</b></div>`)
    .join("");
  return `<div style="min-width:200px">
    <div style="font-weight:600;margin-bottom:6px">${nombre}</div>${filas}
    <div style="margin-top:8px;display:flex;gap:10px">
      <a href="${p.fuente_url}" target="_blank" style="color:#3987e5">Fuente oficial ↗</a>
      <a href="#" data-linaje="${p.id_interno}" style="color:#c98500">Linaje</a>
    </div></div>`;
}

async function loadMapLayers() {
  const d = state.depto ? `&depto=${state.depto}` : "";
  const [munis, vial] = await Promise.all([
    api(`/api/registros?dominio=territorio&format=geojson&limit=2000${d}`),
    api(`/api/registros?dominio=vial&format=geojson&limit=2000${d}`),
  ]);
  layerMunis.clearLayers();
  layerVial.clearLayers();

  const bounds = [];
  for (const f of munis.features) {
    const [lon, lat] = f.geometry.coordinates;
    bounds.push([lat, lon]);
    L.circleMarker([lat, lon], {
      radius: 4.5, weight: 1.5, color: "#0b1120", fillColor: COLOR_MUNI, fillOpacity: 0.9,
    }).bindPopup(() => popupHtml(f.properties)).addTo(layerMunis);
  }
  for (const f of vial.features) {
    L.geoJSON(f, { style: { color: COLOR_VIAL, weight: 2, opacity: 0.85 } })
      .bindPopup(() => popupHtml(f.properties)).addTo(layerVial);
  }
  if (state.depto && bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
  else if (!state.depto) map.setView([4.6, -73.1], 6);
}

// linaje en popup (delegado)
document.addEventListener("click", async (e) => {
  const a = e.target.closest("[data-linaje]");
  if (!a) return;
  e.preventDefault();
  const rec = await api(`/api/registros/${encodeURIComponent(a.dataset.linaje)}`);
  alert(
    `LINAJE (OKR O4)\n\nid: ${rec.id_interno}\nfuente: ${rec.fuente}\nconector: ${rec.conector} · versión dataset: ${rec.version_dataset}\ningesta: ${rec.fecha_ingesta}\ntransformaciones: ${rec.transformaciones.join(" → ")}\nhash: ${rec.hash.slice(0, 16)}…`
  );
});

// ---------------------------------------------------------------------------
// KPIs + gráfico PIB
// ---------------------------------------------------------------------------
async function loadKpis() {
  const k = await api(`/api/kpi${state.depto ? `?depto=${state.depto}` : ""}`);
  $("kpiMunis").textContent = fmt(k.municipios);
  $("kpiKm").textContent = fmt(k.vial_km);
  $("kpiTramos").textContent = fmt(k.vial_tramos);
  $("kpiPib").textContent = k.pib_ultimo ? fmt(k.pib_ultimo.valor) : "—";
  $("kpiPibAnio").textContent = k.pib_ultimo ? `· ${k.pib_ultimo.anio}` : "";
  $("kpiTotal").textContent = fmt(k.registros_total);
  drawChart(k.pib_serie);
}

function drawChart(serie) {
  const sel = $("deptoSel");
  $("chartScope").textContent = state.depto ? `— ${sel.options[sel.selectedIndex].text}` : "— Colombia";
  const data = {
    labels: serie.map((s) => s.anio),
    datasets: [{
      data: serie.map((s) => s.valor),
      backgroundColor: COLOR_VIAL,
      borderRadius: { topLeft: 4, topRight: 4 },   // extremo de dato redondeado, base anclada
      barPercentage: 0.7, categoryPercentage: 0.9,
    }],
  };
  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },                  // una sola serie: el título la nombra
      tooltip: { callbacks: { label: (c) => ` ${fmt(c.parsed.y)} mm COP` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: INK.text, maxTicksLimit: 7, font: { size: 10 } } },
      y: { grid: { color: INK.grid }, border: { display: false }, ticks: { color: INK.text, font: { size: 10 }, callback: (v) => v >= 1000 ? `${v / 1000}k` : v } },
    },
  };
  if (chart) { chart.data = data; chart.options = opts; chart.update(); }
  else chart = new Chart($("pibChart"), { type: "bar", data, options: opts });
}

// ---------------------------------------------------------------------------
// tabla multi-dominio
// ---------------------------------------------------------------------------
function renderTabs() {
  $("domTabs").innerHTML = Object.entries(DOM_LABEL).map(([d, label]) =>
    `<button data-dom="${d}" class="rounded-lg px-2.5 py-1 ${d === state.dominio ? "bg-serie-vial text-white" : "border border-ink-600 bg-ink-700 text-slate-300 hover:bg-ink-600"}">${label}</button>`
  ).join("");
}

async function loadTable() {
  const d = state.depto ? `&depto=${state.depto}` : "";
  const out = await api(`/api/registros?dominio=${state.dominio}&limit=${state.limit}&offset=${state.offset}${d}`);
  state.total = out.total;
  const cols = TABLE_COLS[state.dominio];
  $("tblHead").innerHTML = `<tr>${cols.map(([, l]) => `<th class="px-2.5 py-1.5 font-medium">${l}</th>`).join("")}</tr>`;
  $("tblBody").innerHTML = out.items.map((it) =>
    `<tr class="hover:bg-ink-700/50">${cols.map(([k]) => `<td class="px-2.5 py-1.5">${it.campos[k] ?? "—"}</td>`).join("")}</tr>`
  ).join("");
  $("tblInfo").textContent = `${fmt(state.offset + 1)}–${fmt(Math.min(state.offset + state.limit, state.total))} de ${fmt(state.total)}`;
}

// ---------------------------------------------------------------------------
// búsqueda global
// ---------------------------------------------------------------------------
let searchTimer;
function initSearch() {
  const input = $("search"), list = $("searchResults");
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { list.classList.add("hidden"); return; }
    searchTimer = setTimeout(async () => {
      const hits = await api(`/api/search?q=${encodeURIComponent(q)}${state.depto ? `&depto=${state.depto}` : ""}`);
      list.innerHTML = hits.map((h) =>
        `<li><button data-id="${h.id_interno}" data-geom="${h.con_geom}" class="w-full px-3 py-2 text-left text-sm hover:bg-ink-700">
          <span class="text-slate-500 text-[10px] uppercase mr-1.5">${DOM_LABEL[h.dominio] ?? h.dominio}</span>${h.label}</button></li>`
      ).join("") || `<li class="px-3 py-2 text-sm text-slate-500">Sin resultados</li>`;
      list.classList.remove("hidden");
    }, 250);
  });
  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-id]");
    if (!btn) return;
    list.classList.add("hidden");
    input.value = "";
    const rec = await api(`/api/registros/${encodeURIComponent(btn.dataset.id)}`);
    if (rec.geom) {
      const gj = L.geoJSON(rec.geom);
      map.fitBounds(gj.getBounds(), { padding: [60, 60], maxZoom: 12 });
      L.popup().setLatLng(gj.getBounds().getCenter())
        .setContent(popupHtml({ ...rec.campos, id_interno: rec.id_interno, fuente_url: rec.fuente_url })).openOn(map);
    } else {
      alert(`${rec.fuente}\n${JSON.stringify(rec.campos, null, 2)}\n\nFuente oficial: ${rec.fuente_url}`);
    }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#search,#searchResults")) list.classList.add("hidden"); });
}

// ---------------------------------------------------------------------------
// arranque
// ---------------------------------------------------------------------------
async function refresh() {
  await Promise.all([loadKpis(), loadMapLayers(), loadTable()]);
}

window.addEventListener("DOMContentLoaded", async () => {
  initMap();
  initSearch();
  renderTabs();

  const meta = await api("/api/meta");
  $("deptoSel").innerHTML += meta.departamentos
    .map((d) => `<option value="${d.codigo}">${d.nombre} (${d.municipios})</option>`).join("");
  $("fuentesLine").textContent = "Fuentes: " + meta.fuentes.map((f) => `${f.nombre} [${f.conector}]`).join(" · ");

  $("deptoSel").addEventListener("change", (e) => { state.depto = e.target.value; state.offset = 0; refresh(); });
  $("domTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-dom]");
    if (!b) return;
    state.dominio = b.dataset.dom; state.offset = 0;
    renderTabs(); loadTable();
  });
  $("prevPg").addEventListener("click", () => { if (state.offset > 0) { state.offset -= state.limit; loadTable(); } });
  $("nextPg").addEventListener("click", () => { if (state.offset + state.limit < state.total) { state.offset += state.limit; loadTable(); } });
  $("exportCsv").addEventListener("click", () => {
    const d = state.depto ? `&depto=${state.depto}` : "";
    window.open(`/api/registros?dominio=${state.dominio}&format=csv&limit=5000${d}`, "_blank");
  });

  await refresh();
});
