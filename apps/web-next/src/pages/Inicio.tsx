import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useConcentracion, useEntidades, useGrafoStats, useMeta } from "../api/cliente";
import {
  Card, CardHead, Cargando, ChipDominio, DOMINIO_LABEL, Error_, FechaRelativa, Numero, Vacio,
} from "../components/base";
import type { TipoEntidad } from "../api/tipos";

const TIPO_LABEL: Record<TipoEntidad, string> = {
  Empresa: "Empresas",
  EntidadPublica: "Entidades públicas",
  Contrato: "Contratos",
  Municipio: "Municipios",
  Departamento: "Departamentos",
  TramoVial: "Tramos viales",
};

/**
 * Inicio entidad-céntrico: entrar por búsqueda o por composición del catálogo.
 *
 * El mockup abría con saludo personalizado, tarjetas de tarea, insights
 * automáticos y alertas. Nada de eso tiene respaldo hoy (no hay sesión, ni motor
 * de detección, ni histórico), así que la portada la ocupa lo que sí existe: la
 * búsqueda, qué hay en el catálogo, y el único agregado computable —concentración
 * de relaciones, que es un conteo de aristas, no un puntaje.
 */
export function PaginaInicio() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <Buscador />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Catalogo />
          <Concentracion />
        </div>
        <div className="space-y-4">
          <Cobertura />
          <Fuentes />
        </div>
      </div>
    </div>
  );
}

function Buscador() {
  const [q, setQ] = useState("");
  const [, navegar] = useLocation();

  return (
    <header className="rounded-lg border border-line bg-surface px-5 py-6 shadow-card">
      <h1 className="text-2xl font-semibold text-ink">¿Qué querés investigar?</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Buscá una empresa, una entidad pública, un contrato o un territorio. Cada resultado
        abre su ficha con las fuentes que lo respaldan.
      </p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          navegar(q.trim() ? `/entidades?q=${encodeURIComponent(q.trim())}` : "/entidades");
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nombre de empresa, entidad o contrato…"
          aria-label="Buscar entidades"
          className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-base text-ink outline-none placeholder:text-ink-subtle focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Buscar
        </button>
      </form>
    </header>
  );
}

/** Composición del catálogo por tipo. Cada tipo entra al listado ya filtrado. */
function Catalogo() {
  const { data, isPending, error } = useEntidades({ limit: 1 });

  return (
    <Card>
      <CardHead
        titulo="Catálogo de entidades"
        extra={data ? <span className="text-2xs text-ink-muted"><Numero valor={data.total} /> en total</span> : null}
      />
      {error ? <Error_ error={error} contexto="catálogo" />
      : isPending ? <Cargando filas={3} />
      : !data || data.facetas.tipo.length === 0 ? (
        <Vacio
          titulo="Catálogo vacío"
          detalle="Todavía no se resolvieron entidades. Corré la ingesta con el orquestador (services/orchestrator/cli.js tick), que además dispara la resolución."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
          {data.facetas.tipo.map((t) => (
            <li key={t.tipo}>
              <Link
                href={`/entidades?tipo=${t.tipo}`}
                className="block bg-surface px-4 py-3 hover:bg-surface-muted"
              >
                <p className="text-2xs uppercase tracking-wider text-ink-muted">
                  {TIPO_LABEL[t.tipo] ?? t.tipo}
                </p>
                <p className="mt-0.5 text-xl font-semibold text-ink"><Numero valor={t.n} /></p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const RELACIONES = [
  { arista: "adjudicado_a", tipo: "Empresa", titulo: "Empresas con más contratos adjudicados" },
  { arista: "contratado_por", tipo: "EntidadPublica", titulo: "Entidades con más contratos suscritos" },
] as const;

function Concentracion() {
  const [sel, setSel] = useState(0);
  const r = RELACIONES[sel]!;
  const { data, isPending, error } = useConcentracion(r.arista, r.tipo, null, 8);
  const stats = useGrafoStats();
  const max = Math.max(1, ...(data ?? []).map((d) => d.relaciones));

  return (
    <Card>
      <CardHead
        titulo="Concentración"
        extra={
          <select
            value={sel}
            onChange={(e) => setSel(Number(e.target.value))}
            className="rounded border border-line bg-surface px-2 py-1 text-2xs text-ink-body"
          >
            {RELACIONES.map((x, i) => <option key={x.arista} value={i}>{x.arista}</option>)}
          </select>
        }
      />
      <p className="px-4 pt-2.5 text-2xs text-ink-muted">
        {r.titulo}. Cuenta relaciones del grafo derivadas por co-ocurrencia (ADR-008)
        {stats.data ? ` sobre ${stats.data.aristas.toLocaleString("es-CO")} aristas` : ""}.
      </p>
      {error ? <Error_ error={error} contexto="concentración" />
      : isPending ? <Cargando filas={5} />
      : !data || data.length === 0 ? (
        <Vacio
          titulo="Sin relaciones de este tipo"
          detalle="El grafo se construye en el fan-out del orquestador tras cada ingesta."
        />
      ) : (
        <ol className="space-y-1 p-3">
          {data.map((d, i) => (
            <li key={d.id_entidad} className="relative">
              <span aria-hidden className="absolute inset-y-0 left-0 rounded bg-accent-soft"
                    style={{ width: `${(100 * d.relaciones) / max}%` }} />
              <Link
                href={`/entidades/${encodeURIComponent(d.id_entidad)}`}
                className="relative flex items-center gap-2 rounded px-2.5 py-1.5 hover:bg-surface-muted/60"
              >
                <span className="w-4 shrink-0 text-2xs text-ink-subtle">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {d.nombre_canonico ?? <span className="text-ink-subtle">sin nombre</span>}
                </span>
                <span className="num shrink-0 text-2xs text-ink-muted">{d.relaciones}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** Cobertura por dominio: registros ingeridos, no porcentaje de "cobertura nacional". */
function Cobertura() {
  const { data, isPending, error } = useMeta();
  const total = data?.dominios.reduce((a, d) => a + d.n, 0) ?? 0;
  const max = Math.max(1, ...(data?.dominios ?? []).map((d) => d.n));

  return (
    <Card>
      <CardHead titulo="Registros por dominio" />
      {error ? <Error_ error={error} contexto="dominios" />
      : isPending ? <Cargando filas={4} />
      : !data || data.dominios.length === 0 ? (
        <Vacio titulo="Sin registros" detalle="No se ha corrido la ingesta." />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {data.dominios.map((d) => (
              <li key={d.dominio} className="px-4 py-2">
                <div className="flex items-center justify-between gap-2">
                  <ChipDominio dominio={d.dominio} />
                  <span className="num text-2xs text-ink-muted"><Numero valor={d.n} /></span>
                </div>
                <div aria-hidden className="mt-1 h-1 rounded bg-neutral-soft">
                  <div className="h-1 rounded bg-accent/40" style={{ width: `${(100 * d.n) / max}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2 text-2xs text-ink-muted">
            <Numero valor={total} /> registros · {data.departamentos.length} departamentos en DIVIPOLA
          </p>
        </>
      )}
    </Card>
  );
}

function Fuentes() {
  const { data, isPending, error } = useMeta();

  return (
    <Card>
      <CardHead
        titulo="Fuentes"
        extra={data ? <span className="text-2xs text-ink-muted">{data.fuentes.length}</span> : null}
      />
      {error ? <Error_ error={error} contexto="fuentes" />
      : isPending ? <Cargando filas={4} />
      : !data || data.fuentes.length === 0 ? (
        <Vacio titulo="Sin fuentes registradas" />
      ) : (
        <ul className="divide-y divide-line">
          {data.fuentes.map((f) => (
            <li key={f.source_id} className="px-4 py-2">
              <p className="truncate text-sm text-ink" title={f.nombre}>{f.nombre}</p>
              <p className="mt-0.5 flex items-center gap-2 text-2xs text-ink-muted">
                <span>{DOMINIO_LABEL[f.dominio] ?? f.dominio}</span>
                <span aria-hidden>·</span>
                <span><Numero valor={f.filas} /> filas</span>
                <span aria-hidden>·</span>
                <FechaRelativa iso={f.last_updated} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
