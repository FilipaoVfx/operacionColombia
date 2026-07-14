// Panel OSINT unificado (M10, rediseño shell): sidebar de vistas + command palette
// (Ctrl K) + inspector de linaje. Selector DIVIPOLA global filtra toda la vista activa.
// Vanilla JS + Leaflet + Chart.js. Consume el Read API (M9).

const $ = (id) => document.getElementById(id);
const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("es-CO"));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const relTime = (iso) => {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
};

// paleta validada (dataviz: categórica dark, CVD ΔE 113.5 protan, contraste ≥3:1)
const COLOR_A = "#3987e5"; // serie-a · red vial / PIB
const COLOR_B = "#c98500"; // serie-b · municipios
const INK = { grid: "rgba(51,65,85,.45)", text: "#94a3b8" };

const state = { view: "overview", depto: "", offset: 0, limit: 40, total: 0, meta: null };

const TABLE_COLS = {
  territorio: [["cod_mpio", "Código"], ["nom_mpio", "Municipio"], ["dpto", "Departamento"], ["tipo", "Tipo"]],
  vial: [["codigo_vial", "Código"], ["nombre_tramo", "Tramo"], ["territorial", "Territorial"], ["longitud_km", "km"]],
  economia: [["anio", "Año"], ["departamento", "Depto"], ["actividad", "Actividad"], ["valor_miles_millones", "Valor (mm COP)"]],
  agro: [["cultivo", "Cultivo"], ["municipio", "Municipio"], ["produccion_t", "Producción (t)"], ["area_sembrada_ha", "Sembrada (ha)"]],
  contratacion: [["entidad", "Entidad"], ["proveedor", "Proveedor"], ["valor_contrato", "Valor (COP)"], ["estado", "Estado"], ["fecha_firma", "Firma"]],
  entidades: [["nit", "NIT"], ["razon_social", "Razón social"], ["departamento", "Departamento"], ["ciudad", "Ciudad"], ["telefono", "Teléfono"]],
};
// "vial" se muestra como "Infraestructura" en nav/breadcrumb: es la única fuente de infraestructura real hoy.
const DOM_LABEL = { territorio: "Territorio", vial: "Infraestructura", economia: "Economía", agro: "Agro", contratacion: "Contratación", entidades: "Entidades" };
const DOM_ICON = { territorio: "pin", vial: "route", economia: "chart", agro: "leaf", contratacion: "file", entidades: "users" };

// secciones del roadmap (BACKLOG_MEJORAS_OSINT.md) sin conector/API aún: nav visible,
// vista placeholder honesta — sin inventar cifras.
const PLACEHOLDER_META = {
  kg: { label: "Knowledge Graph", icon: "graph", note: "Grafo de relaciones entre entidades — backlog A2." },
  mineria: { label: "Minería", icon: "pickaxe", note: "Requiere conector ANM (catastro minero / títulos) — no implementado." },
  conflicto: { label: "Conflicto", icon: "shield", note: "Fuente de datos de conflicto aún no conectada." },
  regalias: { label: "Regalías", icon: "coins", note: "Requiere conector SICODIS/regalías — no implementado." },
  dashboards: { label: "Dashboards", icon: "dashboard", note: "Dashboards personalizables — backlog." },
  logs: { label: "Logs & Alertas", icon: "alert", note: "Monitoreo operacional (logs, alertas) — backlog." },
  config: { label: "Configuración", icon: "settings", note: "Configuración de usuario/sistema — pendiente." },
};

let map, layerMunis, layerVial, chart, sourcesChart;
let pendingFocus = null; // registro a enfocar en el mapa al montar overview

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------------------
// iconos inline (stroke currentColor, sin dependencias)
// ---------------------------------------------------------------------------
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  pin: '<path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19h6.5a3.5 3.5 0 0 0 0-7h-6a3.5 3.5 0 0 1 0-7h6.5"/>',
  chart: '<path d="M4 20h16"/><path d="M7 20v-7"/><path d="M12 20V6"/><path d="M17 20v-10"/>',
  leaf: '<path d="M12 21c0-5 1-9 8-13-1 8-3 12-8 13z"/><path d="M12 21c0-4-1-7-6-10 1 6 2 8 6 10z"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.5-4.5"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9.5 4v16"/>',
  x: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10.5 13.5"/><path d="M19 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  map: '<path d="m9 4-5 2v14l5-2 6 2 5-2V4l-5 2-6-2z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><circle cx="17" cy="9" r="2.3"/><path d="M15.5 14c2.7.4 4.5 2.3 4.5 6"/>',
  graph: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M7.8 7.2 10.5 16"/><path d="M16.2 7.2 13.5 16"/><path d="M8.2 6h7.6"/>',
  shield: '<path d="M12 3l7 3v6c0 5-3.2 8-7 9-3.8-1-7-4-7-9V6z"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3.2"/><path d="M3 7v10c0 1.8 2.7 3.2 6 3.2s6-1.4 6-3.2V7"/><path d="M15 10.3c2.4.4 4 1.5 4 2.9v6c0 1.4-1.8 2.5-4 2.9"/>',
  plug: '<path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
  workflow: '<rect x="3" y="4" width="6" height="5" rx="1.3"/><rect x="15" y="4" width="6" height="5" rx="1.3"/><rect x="9" y="15" width="6" height="5" rx="1.3"/><path d="M6 9v3a3 3 0 0 0 3 3"/><path d="M18 9v3a3 3 0 0 1-3 3"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  pickaxe: '<path d="M4 4c4 1 7 4 8 8"/><path d="M20 4c-4 1-7 4-8 8"/><path d="M9 13l-6 7"/><path d="M15 13l6 7"/>',
  file: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 12h5M9.5 15.5h5"/>',
};
const icon = (name, cls = "h-4 w-4") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ""}</svg>`;

// ---------------------------------------------------------------------------
// navegación / shell
// ---------------------------------------------------------------------------
const NAV = [
  { section: "Panorama", items: [{ id: "overview", label: "Inicio", icon: "dashboard" }] },
  {
    section: "Explorar",
    items: [
      { id: "entidades", label: DOM_LABEL.entidades, icon: DOM_ICON.entidades },
      { id: "kg", label: PLACEHOLDER_META.kg.label, icon: PLACEHOLDER_META.kg.icon },
      { id: "mapa", label: "Mapa", icon: "map" },
      { id: "territorio", label: DOM_LABEL.territorio, icon: DOM_ICON.territorio },
      { id: "contratacion", label: DOM_LABEL.contratacion, icon: DOM_ICON.contratacion },
      { id: "mineria", label: PLACEHOLDER_META.mineria.label, icon: PLACEHOLDER_META.mineria.icon },
      { id: "agro", label: DOM_LABEL.agro, icon: DOM_ICON.agro },
      { id: "vial", label: DOM_LABEL.vial, icon: DOM_ICON.vial },
      { id: "economia", label: DOM_LABEL.economia, icon: DOM_ICON.economia },
      { id: "conflicto", label: PLACEHOLDER_META.conflicto.label, icon: PLACEHOLDER_META.conflicto.icon },
      { id: "regalias", label: PLACEHOLDER_META.regalias.label, icon: PLACEHOLDER_META.regalias.icon },
    ],
  },
  {
    section: "Datos",
    items: [
      { id: "explorer", label: "Explorer", icon: "search" },
      { id: "fuentes", label: "Datasets", icon: "database" },
      { id: "conectores", label: "Conectores", icon: "plug" },
      { id: "etl", label: "ETL Center", icon: "workflow" },
    ],
  },
  {
    section: "Monitoreo",
    items: [
      { id: "dashboards", label: PLACEHOLDER_META.dashboards.label, icon: PLACEHOLDER_META.dashboards.icon },
      { id: "logs", label: PLACEHOLDER_META.logs.label, icon: PLACEHOLDER_META.logs.icon },
    ],
  },
  { section: "Sistema", items: [{ id: "config", label: PLACEHOLDER_META.config.label, icon: PLACEHOLDER_META.config.icon }] },
];

const REAL_DOMAINS = ["territorio", "vial", "economia", "agro", "contratacion", "entidades"];

const VIEWS = {
  overview: { title: "Inicio", mount: mountOverview, unmount: unmountOverview },
  ...Object.fromEntries(REAL_DOMAINS.map((d) => [d, { title: DOM_LABEL[d], mount: () => mountDomain(d) }])),
  fuentes: { title: "Datasets", mount: mountFuentes },
  explorer: { title: "Explorer", mount: mountExplorer },
  mapa: { title: "Mapa", mount: mountMapaFull, unmount: unmountMapaFull },
  conectores: { title: "Conectores", mount: mountConectores },
  etl: { title: "ETL Center", mount: mountEtl },
  proveedores: { title: "Top proveedores", mount: mountProveedores },
  ...Object.fromEntries(Object.entries(PLACEHOLDER_META).map(([id, m]) => [id, { title: m.label, mount: () => mountPlaceholder(id) }])),
};

function renderNav() {
  $("nav").innerHTML = NAV.map((sec) => `
    <p class="nav-section px-2.5 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider text-slate-600">${sec.section}</p>
    ${sec.items.map((it) => `
      <button data-view="${it.id}" title="${it.label}"
        class="nav-item flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left
        ${it.id === state.view ? "bg-ink-700 text-white" : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"}">
        <span class="shrink-0">${icon(it.icon)}</span><span class="nav-label truncate">${it.label}</span>
      </button>`).join("")}
  `).join("");
}

function renderBreadcrumb() {
  const deptoName = state.depto && state.meta
    ? state.meta.departamentos.find((d) => d.codigo === state.depto)?.nombre
    : null;
  const sep = '<li class="text-slate-600">/</li>';
  $("breadcrumb").innerHTML = [
    `<li class="shrink-0 text-slate-500">Operación Colombia</li>`,
    sep,
    `<li class="truncate font-medium text-slate-200">${VIEWS[state.view].title}</li>`,
    ...(deptoName ? [sep, `<li class="truncate text-serie-b">${esc(deptoName)}</li>`] : []),
  ].join("");
}

function route(viewId) {
  VIEWS[state.view]?.unmount?.();
  state.view = viewId;
  state.offset = 0;
  history.replaceState(null, "", viewId === "overview" ? "#" : `#${viewId}`);
  renderNav();
  renderBreadcrumb();
  VIEWS[viewId].mount();
}

// ---------------------------------------------------------------------------
// vista: overview (mapa + KPIs + PIB)
// ---------------------------------------------------------------------------
// acentos puramente decorativos (chip de ícono, no codifican datos) — variedad visual estilo mockup
const TINT = { blue: "#3987e5", amber: "#c98500", violet: "#8b5cf6", teal: "#14b8a6", rose: "#f43f5e", slate: "#94a3b8", cyan: "#22d3ee" };

const kpiTile = (id, label, iconName, tint, subId) => `
  <div class="flex items-start gap-3 rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-3">
    <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style="background:${tint}1a;color:${tint}">${icon(iconName, "h-4 w-4")}</span>
    <div class="min-w-0">
      <p class="truncate text-2xs uppercase tracking-wider text-slate-500">${label}</p>
      <p id="${id}" class="mt-0.5 text-xl font-semibold text-white"><span class="skel inline-block h-6 w-16"></span></p>
      ${subId ? `<p id="${subId}" class="mt-0.5 truncate text-2xs text-slate-500"></p>` : ""}
    </div>
  </div>`;

function mountOverview() {
  const activas = state.meta ? state.meta.fuentes.filter((f) => f.estado === "ACTIVA").length : null;
  const conectores = state.meta ? new Set(state.meta.fuentes.map((f) => f.conector)).size : null;
  const ultimaSync = state.meta?.ultima_corrida?.[0]?.finished_at ?? null;

  $("view").innerHTML = `
    <div class="space-y-4 p-4">
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        ${kpiTile("kpiEntidades", "Entidades indexadas", "users", TINT.cyan)}
        ${kpiTile("kpiMunis", "Municipios", "pin", TINT.blue)}
        ${kpiTile("kpiKm", "Infraestructura (km)", "route", TINT.violet, "kpiTramosSub")}
        ${kpiTile("kpiPib", "PIB (mm COP)", "chart", TINT.amber, "kpiPibAnio")}
        ${kpiTile("kpiAgro", "Agro (t)", "leaf", TINT.teal, "kpiAgroDetalle")}
        ${kpiTile("kpiContratos", "Contratos (mm COP)", "file", TINT.rose, "kpiContratosSub")}
        ${kpiTile("kpiTotal", "Registros", "database", TINT.slate)}
      </div>

      <div class="grid gap-4 xl:grid-cols-3">
        <div class="relative overflow-hidden rounded-xl border border-ink-700 bg-ink-900 xl:col-span-2">
          <div class="flex items-center gap-2 border-b border-ink-700/70 px-3.5 py-2 text-[13px]">
            <span class="text-slate-400">${icon("map")}</span>
            <span class="font-medium text-slate-200">Actividad geoespacial</span>
            <span class="ml-auto flex items-center gap-3 text-2xs text-slate-500">
              <span><span style="color:${COLOR_B}">●</span> Municipios · <span style="color:${COLOR_A}">━</span> Infraestructura vial</span>
              <button id="goMapa" class="font-medium text-serie-a hover:underline">Ver mapa completo</button>
            </span>
          </div>
          <div id="map" class="h-[380px]"></div>
          <div id="mapSpinner" class="absolute inset-0 z-[1000] hidden place-items-center bg-ink-950/40">
            <div class="h-8 w-8 animate-spin rounded-full border-2 border-ink-600 border-t-serie-a"></div>
          </div>
        </div>
        <div class="flex flex-col rounded-xl border border-ink-700 bg-ink-900">
          <div class="flex items-center gap-2 border-b border-ink-700/70 px-3.5 py-2 text-[13px]">
            <span class="font-medium text-slate-200">Actividad reciente</span>
            <button id="goEtl" class="ml-auto text-2xs font-medium text-serie-a hover:underline">Ver todo</button>
          </div>
          <div id="activityFeed" class="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
            ${Array.from({ length: 3 }, () => `<div class="skel h-12 w-full"></div>`).join("")}
          </div>
        </div>
      </div>

      <div class="grid gap-4 xl:grid-cols-3">
        <div class="flex flex-col rounded-xl border border-ink-700 bg-ink-900 p-3.5">
          <div class="flex items-center gap-2">
            <div class="min-w-0">
              <h3 class="text-[13px] font-medium text-slate-200">Fuentes de datos</h3>
              <p class="text-2xs text-slate-500">por conector</p>
            </div>
          </div>
          <div class="relative mt-2 min-h-[160px] flex-1"><canvas id="sourcesChart"></canvas></div>
          <button id="goFuentes" class="mt-2 rounded-lg border border-ink-600 bg-ink-800 py-1.5 text-[13px] text-slate-300 hover:bg-ink-700">Ver catálogo completo</button>
        </div>
        <div class="flex flex-col rounded-xl border border-ink-700 bg-ink-900 p-3.5">
          <h3 class="text-[13px] font-medium text-slate-200">PIB a precios corrientes <span id="chartScope" class="font-normal text-slate-500"></span></h3>
          <p class="text-2xs text-slate-500">miles de millones COP · DANE</p>
          <div class="relative mt-2 min-h-[180px] flex-1"><canvas id="pibChart"></canvas></div>
        </div>
        <div class="flex flex-col rounded-xl border border-ink-700 bg-ink-900 p-3.5">
          <div class="flex items-center gap-2 text-[13px]">
            <h3 class="font-medium text-slate-200">Top proveedores</h3>
            <span class="ml-auto text-2xs text-slate-500">contratos ≥500M · 2026</span>
          </div>
          <div class="mt-2 flex justify-between px-0.5 text-2xs uppercase tracking-wider text-slate-500">
            <span>Proveedor</span><span>Contratos · Valor</span>
          </div>
          <div id="topProveedores" class="mt-1 flex-1 space-y-1.5">
            ${Array.from({ length: 4 }, () => `<div class="skel h-8 w-full"></div>`).join("")}
          </div>
          <button id="goProveedores" class="mt-2 rounded-lg border border-ink-600 bg-ink-800 py-1.5 text-[13px] text-slate-300 hover:bg-ink-700">Ver todos los proveedores</button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div class="flex items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-2.5">
          <span class="text-emerald-400">${icon("plug", "h-4 w-4")}</span>
          <div><p class="text-2xs uppercase tracking-wider text-slate-500">Fuentes activas</p>
          <p class="mt-0.5 text-[15px] font-semibold text-white">${activas === null ? "—" : fmt(activas)}</p></div>
        </div>
        <div class="flex items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-2.5">
          <span class="text-slate-400">${icon("workflow", "h-4 w-4")}</span>
          <div><p class="text-2xs uppercase tracking-wider text-slate-500">Conectores</p>
          <p class="mt-0.5 text-[15px] font-semibold text-white">${conectores === null ? "—" : fmt(conectores)}</p></div>
        </div>
        <div class="flex items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-2.5">
          <span class="text-slate-400">${icon("database", "h-4 w-4")}</span>
          <div><p class="text-2xs uppercase tracking-wider text-slate-500">Registros totales</p>
          <p id="kpiTotalFooter" class="mt-0.5 text-[15px] font-semibold text-white">—</p></div>
        </div>
        <div class="flex items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-900 px-3.5 py-2.5">
          <span class="text-slate-400">${icon("panel", "h-4 w-4")}</span>
          <div><p class="text-2xs uppercase tracking-wider text-slate-500">Última sincronización</p>
          <p class="mt-0.5 text-[15px] font-semibold text-white">${esc(relTime(ultimaSync))}</p></div>
        </div>
      </div>
    </div>`;

  initMap();
  loadKpis().catch(viewError);
  loadMapLayers().then(() => {
    if (!pendingFocus) return;
    focusRecord(pendingFocus);
    pendingFocus = null;
  }).catch(viewError);
  renderActivityFeed();
  drawSourcesChart();
  $("goMapa").addEventListener("click", () => route("mapa"));
  $("goEtl").addEventListener("click", () => route("etl"));
  $("goFuentes").addEventListener("click", () => route("fuentes"));
  $("goProveedores").addEventListener("click", () => route("proveedores"));
}

function renderActivityFeed() {
  const el = $("activityFeed");
  if (!el || !state.meta) return;
  const dominioBySource = Object.fromEntries(state.meta.fuentes.map((f) => [f.source_id, f.dominio]));
  const runs = state.meta.ultima_corrida ?? [];
  el.innerHTML = runs.map((r) => `
    <div class="flex items-start gap-2.5 rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-2 text-[13px]">
      <span class="mt-0.5 shrink-0 text-slate-500">${icon(DOM_ICON[dominioBySource[r.source_id]] ?? "database", "h-3.5 w-3.5")}</span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-slate-200">${esc(r.source_id)}</p>
        <p class="text-2xs text-slate-500">${fmt(r.filas)} filas · ${esc(relTime(r.finished_at))}</p>
      </div>
    </div>`).join("") || `<p class="p-2 text-2xs text-slate-500">Sin corridas registradas.</p>`;
}

function drawSourcesChart() {
  const canvas = $("sourcesChart");
  if (!canvas || !state.meta) return;
  const counts = {};
  for (const f of state.meta.fuentes) counts[f.conector] = (counts[f.conector] ?? 0) + 1;
  const labels = Object.keys(counts);
  const palette = [COLOR_A, COLOR_B, "#64748b", "#94a3b8"];
  const total = state.meta.fuentes.length;
  if (sourcesChart) { sourcesChart.destroy(); sourcesChart = null; }
  sourcesChart = new Chart(canvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data: labels.map((l) => counts[l]), backgroundColor: labels.map((_, i) => palette[i % palette.length]), borderColor: "#0f172a", borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "68%",
      plugins: {
        legend: {
          position: "right", labels: {
            color: INK.text, boxWidth: 10, font: { size: 11 },
            generateLabels: (c) => c.data.labels.map((l, i) => ({
              text: `${l} (${counts[l]})`, fillStyle: palette[i % palette.length], strokeStyle: palette[i % palette.length],
            })),
          },
        },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed} fuente(s)` } },
      },
    },
    plugins: [{
      id: "centerTotal",
      afterDraw(c) {
        const { ctx, chartArea } = c;
        ctx.save();
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#e2e8f0"; ctx.font = "600 20px inherit";
        ctx.fillText(String(total), (chartArea.left + chartArea.right) / 2, (chartArea.top + chartArea.bottom) / 2 - 6);
        ctx.fillStyle = "#64748b"; ctx.font = "11px inherit";
        ctx.fillText("total", (chartArea.left + chartArea.right) / 2, (chartArea.top + chartArea.bottom) / 2 + 12);
        ctx.restore();
      },
    }],
  });
}

function unmountOverview() {
  unmountMapState();
  if (chart) { chart.destroy(); chart = null; }
  if (sourcesChart) { sourcesChart.destroy(); sourcesChart = null; }
}

// ---------------------------------------------------------------------------
// vista: mapa a pantalla completa (reusa el motor de mapa de overview)
// ---------------------------------------------------------------------------
function mountMapaFull() {
  $("view").innerHTML = `
    <div class="relative h-full">
      <div id="map" class="h-full"></div>
      <div id="mapSpinner" class="absolute inset-0 z-[1000] hidden place-items-center bg-ink-950/40">
        <div class="h-8 w-8 animate-spin rounded-full border-2 border-ink-600 border-t-serie-a"></div>
      </div>
    </div>`;
  initMap();
  loadMapLayers().catch(viewError);
}
function unmountMapaFull() { unmountMapState(); }

// ---------------------------------------------------------------------------
// vista: conectores (agregado real de dataset_meta por tipo de conector)
// ---------------------------------------------------------------------------
function mountConectores() {
  const grupos = {};
  for (const f of state.meta.fuentes) {
    (grupos[f.conector] ??= { fuentes: [], filas: 0 }).fuentes.push(f);
    grupos[f.conector].filas += f.filas ?? 0;
  }
  const card = (nombre, g) => `
    <div class="rounded-xl border border-ink-700 bg-ink-900 p-3.5">
      <div class="flex items-center gap-2">
        <span class="grid h-8 w-8 place-items-center rounded-lg bg-ink-800" style="color:${COLOR_A}">${icon("plug", "h-4 w-4")}</span>
        <div class="min-w-0">
          <p class="truncate text-[13px] font-semibold text-white">${esc(nombre)}</p>
          <p class="text-2xs text-slate-500">${g.fuentes.length} fuente(s) · ${fmt(g.filas)} filas</p>
        </div>
      </div>
      <ul class="mt-2.5 space-y-1 text-2xs text-slate-400">
        ${g.fuentes.map((f) => `<li class="flex justify-between gap-2"><span class="truncate">${esc(f.nombre)}</span><span class="shrink-0 rounded-full px-1.5 ${f.estado === "ACTIVA" ? "bg-emerald-950 text-emerald-400" : "bg-amber-950 text-amber-400"}">${esc(f.estado)}</span></li>`).join("")}
      </ul>
    </div>`;
  $("view").innerHTML = `
    <div class="p-4">
      <div class="mb-3 flex items-center gap-2.5">
        <span class="text-slate-400">${icon("plug", "h-5 w-5")}</span>
        <h2 class="text-[15px] font-semibold text-white">Conectores</h2>
        <span class="rounded-full border border-ink-600 bg-ink-800 px-2 py-0.5 text-2xs text-slate-400">${Object.keys(grupos).length} tipo(s)</span>
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">${Object.entries(grupos).map(([n, g]) => card(n, g)).join("")}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// vista: ETL Center (corridas + estado/frecuencia por fuente)
// ---------------------------------------------------------------------------
function mountEtl() {
  const m = state.meta;
  $("view").innerHTML = `
    <div class="p-4">
      <div class="mb-3 flex items-center gap-2.5">
        <span class="text-slate-400">${icon("workflow", "h-5 w-5")}</span>
        <h2 class="text-[15px] font-semibold text-white">ETL Center</h2>
      </div>
      <h3 class="mb-2 text-[13px] font-medium text-slate-300">Últimas corridas</h3>
      <div class="mb-5 space-y-1.5">
        ${(m.ultima_corrida ?? []).map((r) => `
          <div class="flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px]">
            <span class="h-1.5 w-1.5 rounded-full ${r.resultado === "ok" ? "bg-emerald-500" : "bg-red-500"}"></span>
            <span class="font-mono text-2xs text-slate-400">${esc(r.source_id)}</span>
            <span class="text-slate-300">${fmt(r.filas)} filas</span>
            <span class="ml-auto text-2xs text-slate-500">${esc(relTime(r.finished_at))}</span>
          </div>`).join("") || `<p class="text-2xs text-slate-500">Sin corridas registradas.</p>`}
      </div>
      <h3 class="mb-2 text-[13px] font-medium text-slate-300">Pipelines por fuente</h3>
      <div class="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
        <table class="w-full text-left text-[13px]">
          <thead class="border-b border-ink-700 bg-ink-850 text-2xs uppercase tracking-wider text-slate-500">
            <tr><th class="px-3 py-2">Fuente</th><th class="px-3 py-2">Conector</th><th class="px-3 py-2">Frecuencia</th><th class="px-3 py-2">Estado</th></tr>
          </thead>
          <tbody class="divide-y divide-ink-700/50">
            ${m.fuentes.map((f) => `
              <tr>
                <td class="px-3 py-2 text-slate-200">${esc(f.nombre)}</td>
                <td class="px-3 py-2 font-mono text-2xs">${esc(f.conector)}</td>
                <td class="px-3 py-2">${esc(f.frecuencia)}</td>
                <td class="px-3 py-2"><span class="rounded-full px-2 py-0.5 text-2xs ${f.estado === "ACTIVA" ? "bg-emerald-950 text-emerald-400" : "bg-amber-950 text-amber-400"}">${esc(f.estado)}</span></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// vista: top proveedores (ranking nacional, rm_top_proveedores_depto)
// ---------------------------------------------------------------------------
async function mountProveedores() {
  $("view").innerHTML = `
    <div class="p-4">
      <div class="mb-3 flex items-center gap-2.5">
        <span class="text-slate-400">${icon("file", "h-5 w-5")}</span>
        <h2 class="text-[15px] font-semibold text-white">Top proveedores</h2>
        <span class="rounded-full border border-ink-600 bg-ink-800 px-2 py-0.5 text-2xs text-slate-400">contratos ≥500M COP · 2026 · SECOP II</span>
      </div>
      <div class="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
        <table class="w-full text-left text-[13px]">
          <thead class="border-b border-ink-700 bg-ink-850 text-2xs uppercase tracking-wider text-slate-500">
            <tr><th class="px-3 py-2">Proveedor</th><th class="px-3 py-2">Contratos</th><th class="px-3 py-2">Valor total (mm COP)</th></tr>
          </thead>
          <tbody id="provBody" class="divide-y divide-ink-700/50">
            ${Array.from({ length: 10 }, () => `<tr><td colspan="3" class="px-3 py-2"><div class="skel h-4 w-full"></div></td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  const k = await api(`/api/kpi?top=50${state.depto ? `&depto=${state.depto}` : ""}`);
  if (!$("provBody")) return;
  $("provBody").innerHTML = k.top_proveedores.map((p) => `
    <tr>
      <td class="px-3 py-1.5 text-slate-200">${esc(p.proveedor)}</td>
      <td class="px-3 py-1.5">${fmt(p.contratos)}</td>
      <td class="px-3 py-1.5">${fmt(Math.round(p.valor_total / 1e9))}</td>
    </tr>`).join("") || `<tr><td colspan="3" class="px-3 py-6 text-center text-slate-500">Sin datos para este filtro</td></tr>`;
}

// ---------------------------------------------------------------------------
// vista: placeholder genérico (secciones del roadmap sin conector aún)
// ---------------------------------------------------------------------------
function mountPlaceholder(id) {
  const m = PLACEHOLDER_META[id];
  $("view").innerHTML = `
    <div class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <span class="grid h-14 w-14 place-items-center rounded-2xl border border-dashed border-ink-600 text-slate-500">${icon(m.icon, "h-6 w-6")}</span>
      <h2 class="text-[15px] font-semibold text-white">${esc(m.label)}</h2>
      <span class="rounded-full border border-ink-600 bg-ink-800 px-2.5 py-0.5 text-2xs uppercase tracking-wider text-slate-500">Próximamente</span>
      <p class="max-w-sm text-[13px] text-slate-500">${esc(m.note)}</p>
    </div>`;
}

function viewError(err) {
  console.error(err);
  const v = $("view");
  v.insertAdjacentHTML("afterbegin",
    `<p class="m-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-[13px] text-red-300">Error cargando datos: ${esc(err.message)}</p>`);
}

// --- mapa ---
let programmaticMove = false;
let mapReq = 0; // descarta respuestas obsoletas si el usuario sigue moviendo el mapa
let spinnerTimer;

function unmountMapState() {
  mapReq++; // invalida respuestas en vuelo
  clearTimeout(spinnerTimer);
  if (map) { map.remove(); map = null; }
}

function initMap() {
  map = L.map("map", { zoomControl: true }).setView([4.6, -73.1], 6);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO", maxZoom: 18,
  }).addTo(map);
  layerMunis = L.layerGroup().addTo(map);
  layerVial = L.layerGroup().addTo(map);
  // leyenda con etiqueta de texto: identidad nunca solo-color
  L.control.layers(null, {
    [`<span style="color:${COLOR_B}">●</span> Municipios (DANE)`]: layerMunis,
    [`<span style="color:${COLOR_A}">━</span> Red vial (INVIAS)`]: layerVial,
  }, { collapsed: true, position: "topright" }).addTo(map);

  // carga por bbox: pan/zoom del usuario recarga solo el viewport visible.
  // Los movimientos programáticos (fitBounds tras cambiar depto) no recargan:
  // esa carga ya trajo el depto completo.
  let moveTimer;
  map.on("moveend", () => {
    if (programmaticMove) { programmaticMove = false; return; }
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => loadMapLayers({ bboxOnly: true }).catch(console.error), 250);
  });
}

// spinner sobre el mapa: solo aparece si la carga supera 500 ms (budget M10)
function spinnerOn() {
  clearTimeout(spinnerTimer);
  spinnerTimer = setTimeout(() => $("mapSpinner")?.classList.replace("hidden", "grid"), 500);
}
function spinnerOff() {
  clearTimeout(spinnerTimer);
  $("mapSpinner")?.classList.replace("grid", "hidden");
}

function popupHtml(p) {
  const nombre = p.nom_mpio || p.nombre_tramo || p.id_interno;
  const filas = Object.entries(p)
    .filter(([k, v]) => v !== null && v !== "" && !["id_interno", "fuente_url", "dominio", "fuente", "divipola_muni", "divipola_depto"].includes(k))
    .slice(0, 8)
    .map(([k, v]) => `<div class="flex justify-between gap-3"><span style="color:#94a3b8">${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join("");
  return `<div style="min-width:200px">
    <div style="font-weight:600;margin-bottom:6px">${esc(nombre)}</div>${filas}
    <div style="margin-top:8px;display:flex;gap:10px">
      <a href="${esc(p.fuente_url)}" target="_blank" style="color:${COLOR_A}">Fuente oficial ↗</a>
      <a href="#" data-linaje="${esc(p.id_interno)}" style="color:${COLOR_B}">Detalle / linaje</a>
    </div></div>`;
}

/**
 * bboxOnly=true (pan/zoom): pide solo el viewport actual y no reencuadra.
 * bboxOnly=false (arranque / cambio de depto): pide el filtro completo y reencuadra.
 */
async function loadMapLayers({ bboxOnly = false } = {}) {
  if (!map) return;
  const req = ++mapReq;
  const d = state.depto ? `&depto=${state.depto}` : "";
  const bb = bboxOnly ? `&bbox=${map.getBounds().toBBoxString()}` : "";
  spinnerOn();
  let munis, vial;
  try {
    [munis, vial] = await Promise.all([
      api(`/api/registros?dominio=territorio&format=geojson&limit=2000${d}${bb}`),
      api(`/api/registros?dominio=vial&format=geojson&limit=2000${d}${bb}`),
    ]);
  } finally {
    if (req === mapReq) spinnerOff();
  }
  if (req !== mapReq || !map) return;
  layerMunis.clearLayers();
  layerVial.clearLayers();

  const bounds = [];
  for (const f of munis.features) {
    const [lon, lat] = f.geometry.coordinates;
    bounds.push([lat, lon]);
    L.circleMarker([lat, lon], {
      radius: 4.5, weight: 1.5, color: "#0b1120", fillColor: COLOR_B, fillOpacity: 0.9,
    }).bindPopup(() => popupHtml(f.properties)).addTo(layerMunis);
  }
  for (const f of vial.features) {
    L.geoJSON(f, { style: { color: COLOR_A, weight: 2, opacity: 0.85 } })
      .bindPopup(() => popupHtml(f.properties)).addTo(layerVial);
  }
  if (bboxOnly) return;
  programmaticMove = true;
  if (state.depto && bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
  else map.setView([4.6, -73.1], 6);
  // si la vista no cambió, moveend nunca dispara y el flag quedaría colgado
  setTimeout(() => { programmaticMove = false; }, 400);
}

function focusRecord(rec) {
  if (!map || !rec.geom) return;
  const gj = L.geoJSON(rec.geom);
  programmaticMove = true;
  map.fitBounds(gj.getBounds(), { padding: [60, 60], maxZoom: 12 });
  setTimeout(() => { programmaticMove = false; }, 400);
  L.popup().setLatLng(gj.getBounds().getCenter())
    .setContent(popupHtml({ ...rec.campos, id_interno: rec.id_interno, fuente_url: rec.fuente_url }))
    .openOn(map);
}

// --- KPIs + gráfico ---
async function loadKpis() {
  const k = await api(`/api/kpi${state.depto ? `?depto=${state.depto}` : ""}`);
  if (!$("kpiMunis")) return; // la vista cambió mientras cargaba
  $("kpiEntidades").textContent = fmt(k.entidades_total);
  $("kpiMunis").textContent = fmt(k.municipios);
  $("kpiKm").textContent = fmt(k.vial_km);
  $("kpiTramosSub").textContent = `${fmt(k.vial_tramos)} tramos · INVIAS`;
  $("kpiPib").textContent = k.pib_ultimo ? fmt(k.pib_ultimo.valor) : "—";
  $("kpiPibAnio").textContent = k.pib_ultimo ? `año ${k.pib_ultimo.anio} · DANE` : "";
  $("kpiAgro").textContent = k.agro_produccion_t ? fmt(k.agro_produccion_t) : "—";
  $("kpiAgroDetalle").textContent = k.agro_anio ? `${fmt(k.agro_area_ha)} ha sembradas · EVA ${k.agro_anio}` : "EVA · MinAgricultura";
  $("kpiTotal").textContent = fmt(k.registros_total);
  if ($("kpiTotalFooter")) $("kpiTotalFooter").textContent = fmt(k.registros_total);
  $("kpiContratos").textContent = k.contratos_valor_total ? fmt(Math.round(k.contratos_valor_total / 1e9)) : "—";
  $("kpiContratosSub").textContent = `${fmt(k.contratos_total)} contratos · SECOP II`;
  renderTopProveedores(k.top_proveedores);
  drawChart(k.pib_serie);
}

function renderTopProveedores(list) {
  const el = $("topProveedores");
  if (!el) return;
  el.innerHTML = (list ?? []).map((p) => `
    <div class="flex items-center justify-between gap-2 rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[13px]">
      <span class="min-w-0 flex-1 truncate text-slate-300">${esc(p.proveedor)}</span>
      <span class="shrink-0 text-2xs text-slate-500">${fmt(p.contratos)} · ${fmt(Math.round(p.valor_total / 1e9))} mm COP</span>
    </div>`).join("") || `<p class="text-2xs text-slate-500">Sin datos para este filtro.</p>`;
}

function drawChart(serie) {
  const canvas = $("pibChart");
  if (!canvas) return;
  const deptoName = state.depto ? state.meta?.departamentos.find((d) => d.codigo === state.depto)?.nombre : null;
  $("chartScope").textContent = deptoName ? `— ${deptoName}` : "— Colombia";
  const data = {
    labels: serie.map((s) => s.anio),
    datasets: [{
      data: serie.map((s) => s.valor),
      backgroundColor: COLOR_A,
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
  else chart = new Chart(canvas, { type: "bar", data, options: opts });
}

// ---------------------------------------------------------------------------
// vista: dominio (tabla paginada + export)
// ---------------------------------------------------------------------------
function mountDomain(dom) {
  $("view").innerHTML = `
    <div class="p-4">
      <div class="mb-3 flex items-center gap-2.5">
        <span class="text-slate-400">${icon(DOM_ICON[dom], "h-5 w-5")}</span>
        <h2 class="text-[15px] font-semibold text-white">${DOM_LABEL[dom]}</h2>
        <span id="tblCount" class="rounded-full border border-ink-600 bg-ink-800 px-2 py-0.5 text-2xs text-slate-400"><span class="skel inline-block h-3 w-10"></span></span>
        <button id="exportCsv" class="ml-auto flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-[13px] text-slate-300 hover:bg-ink-700">
          ${icon("external", "h-3.5 w-3.5")} Exportar CSV
        </button>
      </div>
      <div class="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-[13px]">
            <thead id="tblHead" class="border-b border-ink-700 bg-ink-850 text-2xs uppercase tracking-wider text-slate-500"></thead>
            <tbody id="tblBody" class="divide-y divide-ink-700/50">
              ${Array.from({ length: 8 }, () => `<tr><td colspan="9" class="px-3 py-2"><div class="skel h-4 w-full"></div></td></tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div class="flex items-center gap-2 border-t border-ink-700 px-3 py-2 text-[13px]">
          <span id="tblInfo" class="text-2xs text-slate-500"></span>
          <div class="ml-auto flex gap-1.5">
            <button id="prevPg" class="rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1 text-slate-300 hover:bg-ink-700 disabled:opacity-40">←</button>
            <button id="nextPg" class="rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1 text-slate-300 hover:bg-ink-700 disabled:opacity-40">→</button>
          </div>
        </div>
      </div>
      <p class="mt-2 text-2xs text-slate-500">Clic en una fila abre el detalle con linaje completo (OKR O4).</p>
    </div>`;

  $("prevPg").addEventListener("click", () => { if (state.offset > 0) { state.offset -= state.limit; loadTable(dom).catch(viewError); } });
  $("nextPg").addEventListener("click", () => { if (state.offset + state.limit < state.total) { state.offset += state.limit; loadTable(dom).catch(viewError); } });
  $("exportCsv").addEventListener("click", () => {
    const d = state.depto ? `&depto=${state.depto}` : "";
    window.open(`/api/registros?dominio=${dom}&format=csv&limit=5000${d}`, "_blank");
  });
  $("tblBody").addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    openInspector(await api(`/api/registros/${encodeURIComponent(tr.dataset.id)}`));
  });
  loadTable(dom).catch(viewError);
}

async function loadTable(dom) {
  const d = state.depto ? `&depto=${state.depto}` : "";
  const out = await api(`/api/registros?dominio=${dom}&limit=${state.limit}&offset=${state.offset}${d}`);
  if (!$("tblBody")) return;
  state.total = out.total;
  const cols = TABLE_COLS[dom];
  $("tblCount").textContent = `${fmt(out.total)} registros`;
  $("tblHead").innerHTML = `<tr>${cols.map(([, l]) => `<th class="px-3 py-2 font-medium">${l}</th>`).join("")}</tr>`;
  $("tblBody").innerHTML = out.items.map((it) =>
    `<tr data-id="${esc(it.id_interno)}" class="cursor-pointer hover:bg-ink-700/50">${cols.map(([k]) => `<td class="px-3 py-1.5">${esc(it.campos[k] ?? "—")}</td>`).join("")}</tr>`
  ).join("") || `<tr><td class="px-3 py-6 text-center text-slate-500">Sin registros para este filtro</td></tr>`;
  $("tblInfo").textContent = out.total
    ? `${fmt(state.offset + 1)}–${fmt(Math.min(state.offset + state.limit, state.total))} de ${fmt(state.total)}`
    : "";
  $("prevPg").disabled = state.offset === 0;
  $("nextPg").disabled = state.offset + state.limit >= state.total;
}

// ---------------------------------------------------------------------------
// vista: fuentes de datos (metadata registry M2)
// ---------------------------------------------------------------------------
function mountFuentes() {
  const m = state.meta;
  const fila = (f) => `
    <tr class="hover:bg-ink-700/40">
      <td class="px-3 py-2 font-medium text-slate-200">${esc(f.nombre)}</td>
      <td class="px-3 py-2">${DOM_LABEL[f.dominio] ?? esc(f.dominio)}</td>
      <td class="px-3 py-2 font-mono text-2xs">${esc(f.source_id)}</td>
      <td class="px-3 py-2">${esc(f.conector)}</td>
      <td class="px-3 py-2">${fmt(f.filas)}</td>
      <td class="px-3 py-2">${esc(f.frecuencia)}</td>
      <td class="px-3 py-2 text-2xs text-slate-500">${esc((f.last_updated || "").slice(0, 10))}</td>
      <td class="px-3 py-2"><span class="rounded-full px-2 py-0.5 text-2xs ${f.estado === "ACTIVA" ? "bg-emerald-950 text-emerald-400" : "bg-amber-950 text-amber-400"}">${esc(f.estado)}</span></td>
    </tr>`;
  $("view").innerHTML = `
    <div class="p-4">
      <div class="mb-3 flex items-center gap-2.5">
        <span class="text-slate-400">${icon("database", "h-5 w-5")}</span>
        <h2 class="text-[15px] font-semibold text-white">Fuentes de datos</h2>
        <span class="rounded-full border border-ink-600 bg-ink-800 px-2 py-0.5 text-2xs text-slate-400">versión de datos ${esc(m.version_datos)}</span>
      </div>
      <div class="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-[13px]">
            <thead class="border-b border-ink-700 bg-ink-850 text-2xs uppercase tracking-wider text-slate-500">
              <tr><th class="px-3 py-2">Fuente</th><th class="px-3 py-2">Dominio</th><th class="px-3 py-2">ID</th><th class="px-3 py-2">Conector</th><th class="px-3 py-2">Filas</th><th class="px-3 py-2">Frecuencia</th><th class="px-3 py-2">Actualizada</th><th class="px-3 py-2">Estado</th></tr>
            </thead>
            <tbody class="divide-y divide-ink-700/50">${m.fuentes.map(fila).join("")}</tbody>
          </table>
        </div>
      </div>
      <h3 class="mb-2 mt-5 text-[13px] font-medium text-slate-300">Últimas corridas ETL</h3>
      <div class="space-y-1.5">
        ${m.ultima_corrida.map((r) => `
          <div class="flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px]">
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            <span class="font-mono text-2xs text-slate-400">${esc(r.source_id)}</span>
            <span class="text-slate-300">${fmt(r.filas)} filas</span>
            <span class="ml-auto text-2xs text-slate-500">${esc((r.finished_at || "").replace("T", " ").slice(0, 16))}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// inspector (detalle + linaje, OKR O4)
// ---------------------------------------------------------------------------
function openInspector(rec) {
  const insp = $("inspector");
  const titulo = rec.campos.nom_mpio || rec.campos.nombre_tramo || rec.campos.cultivo || rec.campos.actividad || rec.id_interno;
  const filas = Object.entries(rec.campos)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => `<div class="flex justify-between gap-3 border-b border-ink-700/40 py-1.5"><span class="shrink-0 text-slate-500">${esc(k)}</span><span class="break-all text-right text-slate-200">${esc(v)}</span></div>`)
    .join("");
  insp.innerHTML = `
    <div class="flex h-12 shrink-0 items-center gap-2 border-b border-ink-700/70 px-3.5">
      <span class="text-slate-400">${icon(DOM_ICON[rec.dominio] ?? "database")}</span>
      <p class="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">${esc(titulo)}</p>
      <button id="inspClose" class="rounded-md p-1 text-slate-500 hover:bg-ink-700 hover:text-slate-200">${icon("x")}</button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 text-[13px]">
      <p class="mb-2 text-2xs uppercase tracking-wider text-slate-500">${DOM_LABEL[rec.dominio] ?? esc(rec.dominio)} · ${esc(rec.fuente)}</p>
      ${filas}
      <div class="mt-4 rounded-lg border border-ink-700 bg-ink-850 p-3">
        <p class="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-serie-b">Linaje (OKR O4)</p>
        <div class="space-y-1 text-2xs text-slate-400">
          <p><span class="text-slate-500">id:</span> <span class="font-mono">${esc(rec.id_interno)}</span></p>
          <p><span class="text-slate-500">conector:</span> ${esc(rec.conector)} · <span class="text-slate-500">versión dataset:</span> ${esc(rec.version_dataset)}</p>
          <p><span class="text-slate-500">ingesta:</span> ${esc(rec.fecha_ingesta)}</p>
          <p><span class="text-slate-500">transformaciones:</span> ${rec.transformaciones.map(esc).join(" · ")}</p>
          <p><span class="text-slate-500">hash:</span> <span class="font-mono">${esc(rec.hash.slice(0, 16))}…</span></p>
        </div>
      </div>
      <div class="mt-3 flex gap-2">
        <a href="${esc(rec.fuente_url)}" target="_blank"
          class="flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-slate-300 hover:bg-ink-700">
          ${icon("external", "h-3.5 w-3.5")} Fuente oficial
        </a>
        ${rec.geom ? `<button id="inspMap" class="flex items-center gap-1.5 rounded-lg bg-serie-a px-2.5 py-1.5 text-white hover:brightness-110">${icon("map", "h-3.5 w-3.5")} Ver en mapa</button>` : ""}
      </div>
    </div>`;
  insp.style.display = "flex";
  insp.classList.remove("hidden");
  $("inspClose").addEventListener("click", closeInspector);
  $("inspMap")?.addEventListener("click", () => {
    closeInspector();
    if (state.view === "overview") focusRecord(rec);
    else { pendingFocus = rec; route("overview"); }
  });
}

function closeInspector() {
  const insp = $("inspector");
  insp.style.display = "none";
  insp.classList.add("hidden");
  insp.innerHTML = "";
}

// linaje desde popups del mapa (delegado)
document.addEventListener("click", async (e) => {
  const a = e.target.closest("[data-linaje]");
  if (!a) return;
  e.preventDefault();
  openInspector(await api(`/api/registros/${encodeURIComponent(a.dataset.linaje)}`));
});

// ---------------------------------------------------------------------------
// command palette (búsqueda global M7, Ctrl K)
// ---------------------------------------------------------------------------
let palActive = 0, palHits = [], searchTimer;

function openPalette() {
  $("paletteWrap").classList.replace("hidden", "flex");
  const input = $("paletteInput");
  input.focus();
  input.select();
  renderPalette();
}
function closePalette() {
  $("paletteWrap").classList.replace("flex", "hidden");
}

function renderPalette() {
  const list = $("paletteResults");
  const q = $("paletteInput").value.trim();
  if (q.length < 2) {
    list.innerHTML = `<li class="px-4 py-6 text-center text-[13px] text-slate-500">Escribe al menos 2 caracteres — busca municipios, tramos viales, cultivos, actividades…</li>`;
    $("paletteMeta").textContent = "";
    return;
  }
  list.innerHTML = palHits.map((h, i) => `
    <li><button data-idx="${i}" class="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] ${i === palActive ? "bg-ink-700 text-white" : "text-slate-300 hover:bg-ink-800"}">
      <span class="shrink-0 text-slate-500">${icon(DOM_ICON[h.dominio] ?? "database", "h-3.5 w-3.5")}</span>
      <span class="min-w-0 flex-1 truncate">${esc(h.label)}</span>
      <span class="shrink-0 text-2xs uppercase text-slate-500">${DOM_LABEL[h.dominio] ?? esc(h.dominio)}</span>
      ${h.con_geom ? `<span class="shrink-0 text-slate-500">${icon("map", "h-3 w-3")}</span>` : ""}
    </button></li>`).join("")
    || `<li class="px-4 py-6 text-center text-[13px] text-slate-500">Sin resultados para «${esc(q)}»</li>`;
}

async function runSearch() {
  const q = $("paletteInput").value.trim();
  if (q.length < 2) { palHits = []; palActive = 0; renderPalette(); return; }
  const d = state.depto ? `&depto=${state.depto}` : "";
  const res = await api(`/api/search?q=${encodeURIComponent(q)}&limit=20${d}`);
  palHits = res.hits;
  palActive = 0;
  const fac = (res.facetas?.dominio ?? [])
    .map((f) => `${DOM_LABEL[f.valor ?? f.dominio] ?? f.valor ?? f.dominio} ${f.n ?? f.count ?? ""}`.trim())
    .join(" · ");
  $("paletteMeta").textContent = res.total ? `${fmt(res.total)} resultados${fac ? ` · ${fac}` : ""}` : "";
  renderPalette();
}

async function openHit(h) {
  closePalette();
  openInspector(await api(`/api/registros/${encodeURIComponent(h.id_interno)}`));
}

function initPalette() {
  $("searchBtn").addEventListener("click", openPalette);
  $("paletteWrap").addEventListener("click", (e) => { if (e.target === $("paletteWrap")) closePalette(); });
  $("paletteInput").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch().catch(console.error), 250);
  });
  $("paletteInput").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); palActive = Math.min(palActive + 1, palHits.length - 1); renderPalette(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palActive = Math.max(palActive - 1, 0); renderPalette(); }
    else if (e.key === "Enter" && palHits[palActive]) openHit(palHits[palActive]).catch(console.error);
  });
  $("paletteResults").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-idx]");
    if (b) openHit(palHits[Number(b.dataset.idx)]).catch(console.error);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
    else if (e.key === "Escape") closePalette();
  });
}

// ---------------------------------------------------------------------------
// arranque
// ---------------------------------------------------------------------------
function initShell() {
  document.querySelectorAll(".icon[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  $("sidebarToggle").innerHTML = icon("panel");
  $("sidebarToggle").addEventListener("click", () => $("sidebar").classList.toggle("collapsed"));
  $("nav").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b && b.dataset.view !== state.view) route(b.dataset.view);
  });
  initPalette();
}

window.addEventListener("DOMContentLoaded", async () => {
  initShell();
  renderNav();

  state.meta = await api("/api/meta");
  const total = state.meta.dominios.reduce((s, d) => s + d.n, 0);
  $("sysStatus").innerHTML = `
    <p class="flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> versión de datos ${esc(state.meta.version_datos)}</p>
    <p class="mt-0.5">${fmt(total)} registros · ${state.meta.fuentes.length} fuentes</p>`;

  // selector DIVIPOLA global en la topbar: filtra la vista activa completa
  $("topStatus").innerHTML = `
    <select id="deptoSel" title="Filtro territorial global (DIVIPOLA)"
      class="max-w-[220px] rounded-lg border border-ink-600 bg-ink-800 px-2 py-1.5 text-[13px] text-slate-300 outline-none hover:border-slate-500">
      <option value="">Colombia — todos</option>
      ${state.meta.departamentos.map((d) => `<option value="${d.codigo}">${esc(d.nombre)} (${d.municipios})</option>`).join("")}
    </select>`;
  $("deptoSel").addEventListener("change", (e) => {
    state.depto = e.target.value;
    route(state.view); // remonta la vista activa con el filtro nuevo
  });

  // deep-link: /#vial, /#fuentes, …
  const initial = location.hash.slice(1);
  route(VIEWS[initial] ? initial : "overview");
});
