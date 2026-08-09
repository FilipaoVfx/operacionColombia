import { useState } from "react";
import { Link } from "wouter";
import { useEntidades, useMeta } from "../api/cliente";
import { Card, Cargando, Error_, FechaRelativa, Numero, SinDato, Vacio } from "../components/base";
import type { TipoEntidad } from "../api/tipos";

const TIPOS: TipoEntidad[] = ["Empresa", "EntidadPublica", "Contrato", "Municipio", "Departamento", "TramoVial"];
const PAGINA = 50;

/**
 * Listado de entidades. Las columnas son las del mockup que tienen respaldo:
 * se eliminaron Riesgo (no existe el insumo) y Tendencia (no hay histórico).
 * "Última señal" se nombra por lo que realmente es: última ingesta.
 */
export function PaginaEntidades() {
  const [tipo, setTipo] = useState<TipoEntidad | null>(null);
  const [depto, setDepto] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);

  const meta = useMeta();
  const { data, isPending, error } = useEntidades({ tipo, depto, q: q || null, limit: PAGINA, offset });

  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setOffset(0); };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <header>
        <h1 className="text-2xl font-semibold text-ink">Entidades</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Catálogo resuelto desde los registros ingeridos: empresas, entidades públicas,
          contratos y territorios, unificados por NIT, código o nombre normalizado.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => reset(setQ)(e.target.value)}
          placeholder="Buscar por nombre…"
          className="w-64 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-accent"
        />
        <select
          value={tipo ?? ""}
          onChange={(e) => reset(setTipo)((e.target.value || null) as TipoEntidad | null)}
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink-body"
        >
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={depto ?? ""}
          onChange={(e) => reset(setDepto)(e.target.value || null)}
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink-body"
          disabled={!meta.data}
        >
          <option value="">Todos los departamentos</option>
          {meta.data?.departamentos.map((d) => (
            <option key={d.codigo} value={d.codigo}>{d.nombre}</option>
          ))}
        </select>
        {data ? (
          <span className="ml-auto text-2xs text-ink-muted">
            <Numero valor={data.total} /> entidades
          </span>
        ) : null}
      </div>

      <Card>
        {error ? <Error_ error={error} contexto="listado de entidades" />
        : isPending ? <Cargando filas={8} />
        : data && data.items.length === 0 ? (
          <Vacio
            titulo="Sin entidades para este filtro"
            detalle={
              data.total === 0 && !q && !tipo && !depto
                ? "El catálogo está vacío: todavía no se ha corrido la ingesta. Ejecutá npm run etl y luego node services/entity-res/cli.js."
                : "Probá quitando algún filtro."
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-muted text-2xs uppercase tracking-wider text-ink-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Entidad</th>
                    <th className="px-4 py-2 font-medium">Tipo</th>
                    <th className="px-4 py-2 font-medium">Territorios</th>
                    <th className="px-4 py-2 font-medium">Registros</th>
                    <th className="px-4 py-2 font-medium">Fuentes</th>
                    <th className="px-4 py-2 font-medium">Última ingesta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data?.items.map((e) => (
                    <tr key={e.id_entidad} className="hover:bg-surface-muted">
                      <td className="px-4 py-2">
                        <Link href={`/entidades/${encodeURIComponent(e.id_entidad)}`}
                              className="font-medium text-ink hover:text-accent hover:underline">
                          {e.nombre_canonico ?? <span className="text-ink-subtle">sin nombre en la fuente</span>}
                        </Link>
                        <p className="font-mono text-2xs text-ink-subtle">
                          {e.clave_tipo}: {e.clave_valor}
                        </p>
                      </td>
                      <td className="px-4 py-2 text-ink-body">{e.tipo}</td>
                      <td className="px-4 py-2">
                        {e.territorios.length === 0 ? <SinDato motivo="sin departamento resuelto" /> : (
                          <span className="text-ink-body">
                            {e.territorios[0]?.nombre ?? e.territorios[0]?.cod}
                            {e.territorios.length > 1 && (
                              <span className="text-2xs text-ink-muted"> +{e.territorios.length - 1}</span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2"><Numero valor={e.registros} /></td>
                      <td className="px-4 py-2"><Numero valor={e.fuentes} /></td>
                      <td className="px-4 py-2 text-2xs text-ink-muted">
                        <FechaRelativa iso={e.ultima_ingesta} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 border-t border-line px-4 py-2">
              <span className="text-2xs text-ink-muted">
                {data ? `${offset + 1}–${Math.min(offset + PAGINA, data.total)} de ${data.total}` : null}
              </span>
              <div className="ml-auto flex gap-1.5">
                <button onClick={() => setOffset((o) => Math.max(0, o - PAGINA))} disabled={offset === 0}
                        className="rounded border border-line px-2 py-1 text-2xs text-ink-body hover:bg-surface-muted disabled:opacity-40">
                  Anterior
                </button>
                <button onClick={() => setOffset((o) => o + PAGINA)}
                        disabled={!data || offset + PAGINA >= data.total}
                        className="rounded border border-line px-2 py-1 text-2xs text-ink-body hover:bg-surface-muted disabled:opacity-40">
                  Siguiente
                </button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
