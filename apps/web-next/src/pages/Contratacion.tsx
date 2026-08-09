import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHead, Cargando, Error_, Numero, Vacio } from "../components/base";
import { Grafico, escalaSecuencial, fmtCOP } from "../components/grafico";
import { useMeta } from "../api/cliente";
import type { Chart, ChartConfiguration } from "chart.js";

// Los datasets de treemap/sankey/matrix vienen de plugins y no encajan en los
// tipos del core, de ahí el `as never`. Eso deja sin inferir los callbacks, así
// que se anotan a mano en vez de dejarlos en `any` implícito.
type CtxRaw = { raw?: unknown };
type CtxChart = { chart: Chart };

interface PorDeptoAnio { cod_dpto: string; departamento: string | null; anio: number | null; contratos: number; valor_total: number | null }
interface PorProveedor { cod_dpto: string; departamento: string | null; proveedor: string; contratos: number; valor_total: number | null }
interface Flujo { entidad: string; proveedor: string; contratos: number; valor_total: number | null }
interface Agregados {
  depto: string | null;
  totales: { contratos: number; valor_total: number };
  anios: number[];
  por_depto_anio: PorDeptoAnio[];
  por_proveedor: PorProveedor[];
  flujo_entidad_proveedor: Flujo[];
}

/**
 * Análisis de contratación. Todo sale de /api/contratacion/agregados, que a su vez
 * lee los read models con el dedupe SECOP aplicado: un contrato publicado en dos
 * datasets cuenta una vez. Los contratos sin valor se cuentan pero no suman monto.
 */
export function PaginaContratacion() {
  const [depto, setDepto] = useState<string | null>(null);
  const meta = useMeta();
  const { data, isPending, error } = useQuery({
    queryKey: ["contratacion-agregados", depto],
    queryFn: async ({ signal }) => {
      const r = await fetch(`/api/contratacion/agregados${depto ? `?depto=${depto}` : ""}`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as Agregados;
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-ink">Contratación</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            Contratos de SECOP. Un mismo contrato publicado en varios datasets cuenta una sola vez.
          </p>
        </div>
        <select
          value={depto ?? ""}
          onChange={(e) => setDepto(e.target.value || null)}
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink-body"
          disabled={!meta.data}
        >
          <option value="">Todo el país</option>
          {meta.data?.departamentos.map((d) => <option key={d.codigo} value={d.codigo}>{d.nombre}</option>)}
        </select>
      </header>

      {error ? <Error_ error={error} contexto="agregados de contratación" />
      : isPending ? <Cargando filas={8} />
      : !data || data.totales.contratos === 0 ? (
        <Card>
          <Vacio
            titulo="Sin contratos para este filtro"
            detalle="Si el catálogo está vacío, corré la ingesta con el orquestador: node services/orchestrator/cli.js tick"
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Cifra rotulo="Contratos" valor={<Numero valor={data.totales.contratos} />} />
            <Cifra rotulo="Valor total" valor={fmtCOP(data.totales.valor_total)} />
          </div>
          <Concentracion datos={data.por_proveedor} />
          <div className="grid gap-4 xl:grid-cols-2">
            <MapaCalor datos={data.por_depto_anio} anios={data.anios} />
            <FlujoContratacion datos={data.flujo_entidad_proveedor} />
          </div>
        </>
      )}
    </div>
  );
}

function Cifra({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3 shadow-card">
      <p className="text-2xs uppercase tracking-wider text-ink-muted">{rotulo}</p>
      <p className="mt-0.5 text-xl font-semibold text-ink">{valor}</p>
    </div>
  );
}

/** Treemap depto → proveedor. El área codifica valor contratado. */
function Concentracion({ datos }: { datos: PorProveedor[] }) {
  const config = useMemo<ChartConfiguration>(() => {
    const filas = datos.filter((d) => (d.valor_total ?? 0) > 0);
    const max = Math.max(1, ...filas.map((d) => d.valor_total ?? 0));
    return {
      type: "treemap",
      data: {
        datasets: [{
          tree: filas,
          key: "valor_total",
          groups: ["departamento", "proveedor"],
          spacing: 1,
          borderWidth: 1,
          borderColor: "#ffffff",
          backgroundColor: (ctx: CtxRaw) => {
            const raw = ctx.raw as { v?: number } | undefined;
            return escalaSecuencial(raw?.v ?? 0, max);
          },
          labels: {
            display: true,
            color: "#0f172a",
            font: { size: 10 },
            // El plugin recorta a media palabra si el texto no entra, y con
            // 'hidden' esconde la etiqueta entera. Ninguna de las dos sirve:
            // se acorta acá a un largo que sí entra en la baldosa típica, y el
            // nombre completo queda en el tooltip.
            formatter: (ctx: CtxRaw) => {
              const raw = ctx.raw as { g?: string; v?: number } | undefined;
              if (!raw?.g) return "";
              const n = raw.g.length > 16 ? `${raw.g.slice(0, 15)}…` : raw.g;
              return [n, fmtCOP(raw.v ?? 0)];
            },
          },
        }] as never,
      },
      options: {
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => String((items[0]?.raw as { g?: string })?.g ?? ""),
              label: (item) => fmtCOP((item.raw as { v?: number })?.v ?? 0),
            },
          },
        },
      },
    };
  }, [datos]);

  if (!datos.some((d) => (d.valor_total ?? 0) > 0)) {
    return (
      <Card>
        <CardHead titulo="Concentración por proveedor" />
        <Vacio titulo="Sin montos" detalle="Ningún contrato del filtro tiene valor registrado." />
      </Card>
    );
  }
  return (
    <Card>
      <CardHead
        titulo="Concentración por proveedor"
        extra={<span className="text-2xs text-ink-muted">área y color = valor contratado</span>}
      />
      <div className="p-3">
        <Grafico config={config} alto={360} titulo="Treemap de valor contratado por departamento y proveedor" />
      </div>
    </Card>
  );
}

/** Matriz depto × año. El color codifica valor; el eje no miente sobre ausencias. */
function MapaCalor({ datos, anios }: { datos: PorDeptoAnio[]; anios: number[] }) {
  const { config, deptos } = useMemo(() => {
    const porDepto = new Map<string, number>();
    for (const d of datos) porDepto.set(d.departamento ?? d.cod_dpto, (porDepto.get(d.departamento ?? d.cod_dpto) ?? 0) + (d.valor_total ?? 0));
    const lista = [...porDepto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n]) => n);
    const max = Math.max(1, ...datos.map((d) => d.valor_total ?? 0));
    const celdas = datos
      .filter((d) => d.anio != null && lista.includes(d.departamento ?? d.cod_dpto))
      .map((d) => ({ x: String(d.anio), y: d.departamento ?? d.cod_dpto, v: d.valor_total ?? 0, n: d.contratos }));

    const cfg: ChartConfiguration = {
      type: "matrix",
      data: {
        datasets: [{
          data: celdas,
          backgroundColor: (ctx: CtxRaw) => escalaSecuencial((ctx.raw as { v: number })?.v ?? 0, max),
          borderWidth: 1,
          borderColor: "#ffffff",
          width: ({ chart }: CtxChart) => (chart.chartArea?.width ?? 0) / Math.max(1, anios.length) - 3,
          height: ({ chart }: CtxChart) => (chart.chartArea?.height ?? 0) / Math.max(1, lista.length) - 3,
        }] as never,
      },
      options: {
        scales: {
          x: { type: "category", labels: anios.map(String), offset: true, grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { type: "category", labels: lista, offset: true, grid: { display: false }, ticks: { font: { size: 10 }, autoSkip: false } },
        },
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => {
                const r = items[0]?.raw as { y: string; x: string } | undefined;
                return r ? `${r.y} · ${r.x}` : "";
              },
              label: (item) => {
                const r = item.raw as { v: number; n: number };
                return [`${fmtCOP(r.v)}`, `${r.n} contrato(s)`];
              },
            },
          },
        },
      },
    };
    return { config: cfg, deptos: lista };
  }, [datos, anios]);

  if (!anios.length || !deptos.length) {
    return (
      <Card>
        <CardHead titulo="Valor por departamento y año" />
        <Vacio titulo="Sin dimensión temporal" detalle="Los contratos del filtro no tienen año registrado." />
      </Card>
    );
  }
  return (
    <Card>
      <CardHead
        titulo="Valor por departamento y año"
        extra={<span className="text-2xs text-ink-muted">top 15 · color = valor</span>}
      />
      <div className="p-3">
        <Grafico config={config} alto={Math.max(240, deptos.length * 22 + 60)} titulo="Mapa de calor de valor contratado por departamento y año" />
      </div>
    </Card>
  );
}

/** Sankey entidad → proveedor. El grosor codifica valor. */
function FlujoContratacion({ datos }: { datos: Flujo[] }) {
  const config = useMemo<ChartConfiguration>(() => {
    const filas = datos.filter((d) => (d.valor_total ?? 0) > 0).slice(0, 25);
    const corto = (s: string) => (s.length > 34 ? `${s.slice(0, 32)}…` : s);
    return {
      type: "sankey",
      data: {
        datasets: [{
          data: filas.map((d) => ({ from: corto(d.entidad), to: corto(d.proveedor), flow: d.valor_total ?? 0 })),
          colorFrom: "#93c5fd",
          colorTo: "#2563eb",
          colorMode: "gradient",
          alpha: 0.55,
          size: "max",
        }] as never,
      },
      options: {
        plugins: {
          tooltip: {
            callbacks: {
              label: (item) => {
                const r = item.raw as { from: string; to: string; flow: number };
                return `${r.from} → ${r.to}: ${fmtCOP(r.flow)}`;
              },
            },
          },
        },
      },
    };
  }, [datos]);

  if (!datos.some((d) => (d.valor_total ?? 0) > 0)) {
    return (
      <Card>
        <CardHead titulo="Flujo entidad → proveedor" />
        <Vacio titulo="Sin montos" detalle="Ningún par entidad–proveedor del filtro tiene valor." />
      </Card>
    );
  }
  return (
    <Card>
      <CardHead
        titulo="Flujo entidad → proveedor"
        extra={<span className="text-2xs text-ink-muted">top 25 · grosor = valor</span>}
      />
      <div className="p-3">
        <Grafico config={config} alto={420} titulo="Diagrama de flujo de valor contratado entre entidades y proveedores" />
      </div>
    </Card>
  );
}
