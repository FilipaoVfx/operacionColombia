import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLocation } from "wouter";
import { useMeta } from "../api/cliente";
import { Cargando, DOMINIO_LABEL, Error_, Numero, Vacio } from "../components/base";
import type { Dominio } from "../api/tipos";

const COLOR_DOMINIO: Record<string, string> = {
  territorio: "#0891b2", vial: "#7c3aed", economia: "#b45309",
  agro: "#059669", contratacion: "#e11d48", entidades: "#2563eb", mineria: "#a16207",
};

// Techo por capa en cada petición. El servidor pagina y filtra por bbox contra
// el índice geo_bbox; si una capa lo alcanza, se avisa en la leyenda en vez de
// dibujar un subconjunto en silencio.
const LIMITE = 2000;

interface Feature { type: "Feature"; geometry: unknown; properties: Record<string, unknown> }
interface FC { type: "FeatureCollection"; features: Feature[]; properties?: { returned: number; total: number } }

/**
 * Mapa por capas. Solo se ofrecen los dominios que realmente tienen geometría
 * (meta.geo), y el encuadre inicial sale de la extensión real de los datos, no
 * de coordenadas fijas. La carga es por bbox: al mover el mapa se pide solo lo
 * visible, contra el índice precalculado.
 */
export function PaginaMapa() {
  const meta = useMeta();
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const capas = useRef<Map<string, L.LayerGroup>>(new Map());
  const peticion = useRef(0);
  const [, navegar] = useLocation();

  const [activos, setActivos] = useState<Set<string>>(new Set());
  const [cargando, setCargando] = useState(false);
  const [conteos, setConteos] = useState<Record<string, { mostrados: number; total: number }>>({});
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const conGeom = useMemo(
    () => (meta.data?.geo ?? []).filter((g) => g.n > 0),
    [meta.data],
  );

  // primera vez que llega meta: se encienden todas las capas disponibles
  useEffect(() => {
    if (conGeom.length && activos.size === 0) setActivos(new Set(conGeom.map((g) => g.dominio)));
  }, [conGeom, activos.size]);

  const cargar = useCallback(async (dominios: Set<string>) => {
    const m = mapa.current;
    if (!m || dominios.size === 0) return;
    const req = ++peticion.current;
    const bbox = m.getBounds().toBBoxString();
    // el indicador solo aparece si la carga se pasa del presupuesto (§2.3)
    const t = setTimeout(() => { if (req === peticion.current) setCargando(true); }, 500);
    try {
      const resultados = await Promise.all([...dominios].map(async (dom) => {
        const r = await fetch(`/api/registros?dominio=${dom}&format=geojson&limit=${LIMITE}&bbox=${bbox}`);
        if (!r.ok) throw new Error(`${dom}: HTTP ${r.status}`);
        return [dom, (await r.json()) as FC] as const;
      }));
      if (req !== peticion.current) return; // llegó tarde: el usuario ya movió el mapa
      setErrorCarga(null);
      const nuevos: Record<string, { mostrados: number; total: number }> = {};
      for (const [dom, fc] of resultados) {
        const grupo = capas.current.get(dom);
        if (!grupo) continue;
        grupo.clearLayers();
        const color = COLOR_DOMINIO[dom] ?? "#475569";
        L.geoJSON(fc as never, {
          pointToLayer: (_f, latlng) =>
            L.circleMarker(latlng, { radius: 4, weight: 1, color, fillColor: color, fillOpacity: 0.75 }),
          style: () => ({ color, weight: 2, opacity: 0.85, fillOpacity: 0.25 }),
          onEachFeature: (f, capa) => capa.bindPopup(popup(f.properties as Record<string, unknown>)),
        }).addTo(grupo);
        nuevos[dom] = { mostrados: fc.features.length, total: fc.properties?.total ?? fc.features.length };
      }
      setConteos(nuevos);
    } catch (e) {
      if (req === peticion.current) setErrorCarga(e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(t);
      if (req === peticion.current) setCargando(false);
    }
  }, []);

  // Clave estable de los dominios disponibles: si `meta` se revalida y devuelve
  // lo mismo, el mapa no se destruye y se vuelve a crear (perdería el encuadre).
  const claveGeo = conGeom.map((g) => g.dominio).join(",");

  // inicialización del mapa (una sola vez por conjunto de dominios)
  useEffect(() => {
    if (!contenedor.current || mapa.current || !conGeom.length) return;
    const m = L.map(contenedor.current, { zoomControl: true, attributionControl: true });
    mapa.current = m;

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO", maxZoom: 18,
    }).addTo(m);

    // encuadre a la extensión real de los datos, no a coordenadas fijas
    const bounds = L.latLngBounds(
      conGeom.map((g) => L.latLng(g.min_lat, g.min_lon)),
    );
    for (const g of conGeom) bounds.extend(L.latLng(g.max_lat, g.max_lon));
    m.fitBounds(bounds, { padding: [24, 24] });

    for (const g of conGeom) capas.current.set(g.dominio, L.layerGroup().addTo(m));

    let temporizador: ReturnType<typeof setTimeout>;
    m.on("moveend", () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => setActivos((a) => new Set(a)), 250); // dispara recarga
    });

    return () => { m.remove(); mapa.current = null; capas.current.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveGeo]);

  // las capas apagadas se quitan del mapa sin perder su contenido
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    for (const [dom, grupo] of capas.current) {
      if (activos.has(dom)) { if (!m.hasLayer(grupo)) grupo.addTo(m); }
      else if (m.hasLayer(grupo)) m.removeLayer(grupo);
    }
    void cargar(activos);
  }, [activos, cargar]);

  // clic en "linaje" dentro del popup → ficha del registro
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    const alClick = (e: L.LeafletMouseEvent) => {
      const destino = (e.originalEvent?.target as HTMLElement | null)?.closest?.("[data-linaje]");
      if (!destino) return;
      e.originalEvent.preventDefault();
      navegar(`/registros/${encodeURIComponent(destino.getAttribute("data-linaje")!)}`);
    };
    m.on("popupopen", () => m.getContainer().addEventListener("click", alClick as never));
    return () => m.getContainer()?.removeEventListener("click", alClick as never);
  }, [navegar]);

  if (meta.isPending) return <Cargando filas={6} />;
  if (meta.error) return <Error_ error={meta.error} contexto="mapa" />;
  if (!conGeom.length) {
    return (
      <div className="p-4">
        <Vacio
          titulo="Ningún dominio tiene geometría"
          detalle="El mapa se dibuja desde el índice geoespacial, que se construye en el fan-out del orquestador tras cada ingesta."
        />
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div ref={contenedor} className="h-full w-full bg-surface-muted" />

      <div className="absolute right-3 top-3 z-[1000] w-60 rounded-lg border border-line bg-surface/95 shadow-pop backdrop-blur">
        <p className="border-b border-line px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
          Capas
        </p>
        <ul className="p-1.5">
          {conGeom.map((g) => {
            const c = conteos[g.dominio];
            const truncada = c && c.mostrados >= LIMITE;
            return (
              <li key={g.dominio}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={activos.has(g.dominio)}
                    onChange={(e) => setActivos((a) => {
                      const n = new Set(a);
                      if (e.target.checked) n.add(g.dominio); else n.delete(g.dominio);
                      return n;
                    })}
                  />
                  <span aria-hidden className="size-2.5 shrink-0 rounded-sm"
                        style={{ background: COLOR_DOMINIO[g.dominio] ?? "#475569" }} />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {DOMINIO_LABEL[g.dominio as Dominio] ?? g.dominio}
                  </span>
                  <span className="num shrink-0 text-2xs text-ink-muted">
                    {c ? <Numero valor={c.mostrados} /> : <Numero valor={g.n} />}
                  </span>
                </label>
                {truncada && (
                  <p className="px-1.5 pb-1 text-2xs text-warn">
                    tope de {LIMITE} alcanzado — acercá para ver el resto
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="border-t border-line px-3 py-1.5 text-2xs text-ink-muted">
          Se carga solo lo visible al mover el mapa.
        </p>
      </div>

      {cargando && (
        <div className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full border border-line bg-surface px-3 py-1 text-2xs text-ink-muted shadow-card">
          cargando…
        </div>
      )}
      {errorCarga && (
        <div className="absolute bottom-3 left-1/2 z-[1000] -translate-x-1/2 rounded-md border border-error/30 bg-error-soft px-3 py-1.5 text-2xs text-error shadow-card">
          {errorCarga}
        </div>
      )}
    </div>
  );
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Popup: los campos del registro y el enlace a su linaje. Nada calculado. */
function popup(p: Record<string, unknown>): string {
  const titulo = p.nom_mpio ?? p.nombre_tramo ?? p.expediente ?? p.id_interno;
  const omitir = new Set(["id_interno", "fuente_url", "dominio", "fuente", "divipola_muni", "divipola_depto"]);
  const filas = Object.entries(p)
    .filter(([k, v]) => !omitir.has(k) && v !== null && v !== "")
    .slice(0, 8)
    .map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:12px">
        <span style="color:#64748b">${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join("");
  return `<div style="min-width:220px;font-size:12px">
    <div style="font-weight:600;margin-bottom:6px">${esc(titulo)}</div>${filas}
    <div style="margin-top:8px;display:flex;gap:12px">
      ${p.fuente_url ? `<a href="${esc(p.fuente_url)}" target="_blank" rel="noopener" style="color:#2563eb">Fuente oficial ↗</a>` : ""}
      <a href="#" data-linaje="${esc(p.id_interno)}" style="color:#2563eb">Linaje</a>
    </div></div>`;
}
