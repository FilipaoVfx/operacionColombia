import { useEffect, useRef } from "react";
import { Chart, registerables } from "chart.js";
import { TreemapController, TreemapElement } from "chartjs-chart-treemap";
import { SankeyController, Flow } from "chartjs-chart-sankey";
import { MatrixController, MatrixElement } from "chartjs-chart-matrix";
import type { ChartConfiguration } from "chart.js";

// Registro único para toda la app. Este módulo solo se carga en las rutas de
// análisis (import dinámico), así que el resto del panel no paga estos bytes.
Chart.register(...registerables, TreemapController, TreemapElement, SankeyController, Flow, MatrixController, MatrixElement);

Chart.defaults.font.family =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = "#64748b";
Chart.defaults.plugins.legend.display = false;
Chart.defaults.maintainAspectRatio = false;

/**
 * Escala secuencial valor → color. Sustituye a `visualMap` de ECharts, que es lo
 * único que esa librería aportaba de más para estas vistas. Una sola definición
 * mantiene la codificación consistente entre gráficos.
 */
export function escalaSecuencial(v: number, max: number): string {
  if (!Number.isFinite(v) || max <= 0) return "#f1f5f9";
  const t = Math.min(1, Math.max(0, v / max));
  // de azul muy claro a azul del acento; la luminosidad decrece de forma monótona
  const l = 96 - 52 * Math.sqrt(t);
  const s = 45 + 40 * Math.sqrt(t);
  return `hsl(217 ${s.toFixed(0)}% ${l.toFixed(0)}%)`;
}

export const fmtCOP = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const mm = v / 1e9;
  if (mm >= 1000) return `${(mm / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} bn COP`;
  if (mm >= 1) return `${mm.toLocaleString("es-CO", { maximumFractionDigits: 1 })} mm COP`;
  return `${(v / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 0 })} M COP`;
};

/** Envoltorio de canvas: crea el gráfico, lo actualiza y lo destruye al desmontar. */
export function Grafico({ config, alto = 300, titulo }: { config: ChartConfiguration; alto?: number; titulo: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvas.current) return;
    chart.current = new Chart(canvas.current, config);
    return () => { chart.current?.destroy(); chart.current = null; };
  }, [config]);

  return (
    <div style={{ height: alto }} className="relative">
      {/* el canvas es opaco para lectores de pantalla: la etiqueta lo describe */}
      <canvas ref={canvas} role="img" aria-label={titulo} />
    </div>
  );
}
