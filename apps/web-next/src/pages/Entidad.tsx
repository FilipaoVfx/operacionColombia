import { useState } from "react";
import { Link } from "wouter";
import { useEntidad, useEvidencia } from "../api/cliente";
import {
  Card, CardHead, Cargando, ChipDominio, EnlaceFuente, Error_, FechaRelativa,
  Numero, SinDato, Vacio,
} from "../components/base";
import type { FichaEntidad, VinculoEntidad } from "../api/tipos";

const METODO_TEXTO: Record<VinculoEntidad["metodo"], string> = {
  nit: "por NIT",
  codigo: "por código oficial",
  nombre: "por nombre normalizado",
  alias: "por grafía alternativa",
};

/**
 * Ficha de entidad. Todo lo que muestra sale de entidad_registros → registros:
 * qué la identifica, dónde tiene registros, de qué fuentes, cómo se vinculó y
 * con qué se relaciona. No hay puntajes ni tendencias: no existe el dato.
 */
export function PaginaEntidad({ id }: { id: string }) {
  const { data, isPending, error } = useEntidad(id);

  if (isPending) return <Cargando filas={6} />;
  if (error) return <Error_ error={error} contexto="ficha de entidad" />;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <Encabezado e={data} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Evidencia id={id} total={data.registros_total} />
          <Relaciones e={data} />
        </div>
        <div className="space-y-4">
          <Identidad e={data} />
          <Fuentes e={data} />
          <Territorios e={data} />
        </div>
      </div>
    </div>
  );
}

function Encabezado({ e }: { e: FichaEntidad }) {
  return (
    <header className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-2xs uppercase tracking-wider text-ink-muted">{e.tipo}</p>
        <h1 className="mt-0.5 text-2xl font-semibold text-ink">
          {e.nombre ?? <span className="text-ink-subtle">Entidad sin nombre en la fuente</span>}
        </h1>
        <p className="mt-1 font-mono text-2xs text-ink-subtle">{e.id_entidad}</p>
      </div>
      <dl className="flex gap-6 text-right">
        <div>
          <dt className="text-2xs uppercase tracking-wider text-ink-muted">Registros</dt>
          <dd className="text-xl font-semibold text-ink"><Numero valor={e.registros_total} /></dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-wider text-ink-muted">Fuentes</dt>
          <dd className="text-xl font-semibold text-ink"><Numero valor={e.fuentes.length} /></dd>
        </div>
      </dl>
    </header>
  );
}

function Identidad({ e }: { e: FichaEntidad }) {
  return (
    <Card>
      <CardHead titulo="Identidad" />
      <dl className="divide-y divide-line text-sm">
        <Fila termino="Llave">
          <span className="font-mono text-xs">{e.clave.tipo}: {e.clave.valor}</span>
        </Fila>
        <Fila termino="Tipo">{e.tipo}</Fila>
        <Fila termino="En el catálogo desde">
          {e.creado_en ? <FechaRelativa iso={e.creado_en} /> : <SinDato />}
        </Fila>
      </dl>

      <div className="border-t border-line px-4 py-3">
        <p className="text-2xs uppercase tracking-wider text-ink-muted">Cómo se vinculó</p>
        <p className="mt-1 text-xs text-ink-muted">
          Método con que cada registro se ligó a esta entidad (resolución M6).
        </p>
        <ul className="mt-2 space-y-1">
          {e.vinculos.map((v) => (
            <li key={v.metodo} className="flex items-center justify-between text-sm">
              <span>{METODO_TEXTO[v.metodo] ?? v.metodo}</span>
              <span className="num text-ink-muted">
                {v.n} · confianza {v.confianza}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {e.alias.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-muted">
            Grafías observadas ({e.alias.length})
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {e.alias.map((a) => (
              <li key={a.alias_norm}
                  className="rounded border border-line bg-surface-muted px-1.5 py-0.5 text-2xs text-ink-body">
                {a.alias_norm}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Fila({ termino, children }: { termino: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2">
      <dt className="shrink-0 text-ink-muted">{termino}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

function Fuentes({ e }: { e: FichaEntidad }) {
  return (
    <Card>
      <CardHead titulo="Fuentes" />
      {e.fuentes.length === 0 ? (
        <Vacio titulo="Sin fuentes" detalle="Esta entidad no tiene registros vinculados." />
      ) : (
        <ul className="divide-y divide-line">
          {e.fuentes.map((f) => (
            <li key={`${f.fuente}-${f.dominio}`} className="px-4 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{f.fuente}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <ChipDominio dominio={f.dominio} />
                    <span className="text-2xs text-ink-muted">
                      <Numero valor={f.registros} /> registros
                    </span>
                  </div>
                </div>
                <EnlaceFuente url={f.fuente_url} />
              </div>
              <p className="mt-1 text-2xs text-ink-subtle">
                actualizado <FechaRelativa iso={f.ultima_ingesta} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Territorios({ e }: { e: FichaEntidad }) {
  const max = Math.max(1, ...e.territorios.map((t) => t.registros));
  return (
    <Card>
      <CardHead titulo="Territorios" />
      {e.territorios.length === 0 ? (
        <Vacio
          titulo="Sin territorio resuelto"
          detalle="Ningún registro de esta entidad tiene departamento resuelto contra DIVIPOLA."
        />
      ) : (
        <ul className="divide-y divide-line">
          {e.territorios.map((t) => (
            <li key={t.cod} className="relative px-4 py-2">
              <span aria-hidden className="absolute inset-y-0 left-0 bg-accent-soft"
                    style={{ width: `${(100 * t.registros) / max}%` }} />
              <span className="relative flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-ink">
                  {t.nombre ?? <span className="font-mono text-xs">cod. {t.cod}</span>}
                </span>
                <span className="num shrink-0 text-ink-muted">{t.registros}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Relaciones({ e }: { e: FichaEntidad }) {
  const porTipo = e.relaciones.reduce<Record<string, typeof e.relaciones>>((acc, r) => {
    (acc[r.tipo] ??= []).push(r);
    return acc;
  }, {});

  return (
    <Card>
      <CardHead
        titulo="Relaciones"
        extra={<span className="text-2xs text-ink-muted">derivadas por co-ocurrencia (ADR-008)</span>}
      />
      {e.relaciones.length === 0 ? (
        <Vacio
          titulo="Sin relaciones"
          detalle="No hay otras entidades que compartan registro con esta."
        />
      ) : (
        <div className="divide-y divide-line">
          {Object.entries(porTipo).map(([tipo, lista]) => (
            <div key={tipo} className="px-4 py-3">
              <p className="text-2xs uppercase tracking-wider text-ink-muted">
                {tipo.replace(/_/g, " ")} · {lista.length}
              </p>
              <ul className="mt-1.5 space-y-1">
                {lista.slice(0, 12).map((r) => (
                  <li key={`${r.otro_id}-${r.tipo}`}
                      className="flex items-center gap-2 rounded border border-line bg-surface-muted px-2.5 py-1.5">
                    <span className="shrink-0 text-2xs text-ink-muted">{r.otro_tipo}</span>
                    <Link href={`/entidades/${encodeURIComponent(r.otro_id)}`}
                          className="min-w-0 flex-1 truncate text-sm text-ink hover:text-accent hover:underline">
                      {r.otro_nombre ?? r.otro_id}
                    </Link>
                    {r.muestra && (
                      <Link href={`/registros/${encodeURIComponent(r.muestra)}`}
                            className="shrink-0 text-2xs text-accent hover:underline">
                        evidencia
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              {lista.length > 12 && (
                <p className="mt-1 text-2xs text-ink-subtle">y {lista.length - 12} más</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const PAGINA = 25;

function Evidencia({ id, total }: { id: string; total: number }) {
  const [offset, setOffset] = useState(0);
  const { data, isPending, error } = useEvidencia(id, offset, PAGINA);

  return (
    <Card>
      <CardHead
        titulo="Evidencia"
        extra={<span className="text-2xs text-ink-muted"><Numero valor={total} /> registros</span>}
      />
      {error ? <Error_ error={error} contexto="evidencia" />
      : isPending ? <Cargando />
      : data && data.items.length === 0 ? (
        <Vacio titulo="Sin registros" detalle="Esta entidad no tiene registros vinculados." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-muted text-2xs uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Dominio</th>
                  <th className="px-4 py-2 font-medium">Registro</th>
                  <th className="px-4 py-2 font-medium">Vínculo</th>
                  <th className="px-4 py-2 font-medium">Ingesta</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data?.items.map((r) => (
                  <tr key={r.id_interno} className="hover:bg-surface-muted">
                    <td className="px-4 py-2"><ChipDominio dominio={r.dominio} /></td>
                    <td className="max-w-xs truncate px-4 py-2 font-mono text-2xs text-ink-body">
                      {r.id_interno}
                    </td>
                    <td className="px-4 py-2 text-2xs text-ink-muted">
                      {METODO_TEXTO[r.metodo as VinculoEntidad["metodo"]] ?? r.metodo}
                    </td>
                    <td className="px-4 py-2 text-2xs text-ink-muted">
                      <FechaRelativa iso={r.fecha_ingesta} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/registros/${encodeURIComponent(r.id_interno)}`}
                            className="text-2xs text-accent hover:underline">
                        linaje
                      </Link>
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
              <button
                onClick={() => setOffset((o) => Math.max(0, o - PAGINA))}
                disabled={offset === 0}
                className="rounded border border-line px-2 py-1 text-2xs text-ink-body hover:bg-surface-muted disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setOffset((o) => o + PAGINA)}
                disabled={!data || offset + PAGINA >= data.total}
                className="rounded border border-line px-2 py-1 text-2xs text-ink-body hover:bg-surface-muted disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
