import { useRegistro } from "../api/cliente";
import { Card, CardHead, Cargando, ChipDominio, EnlaceFuente, Error_, SinDato } from "../components/base";

/**
 * Registro con su linaje completo (OKR O4). Es el final de toda cadena de la
 * aplicación: cualquier cifra debe poder abrirse hasta acá y de acá a la fuente.
 */
export function PaginaRegistro({ id }: { id: string }) {
  const { data, isPending, error } = useRegistro(id);

  if (isPending) return <Cargando filas={6} />;
  if (error) return <Error_ error={error} contexto="registro" />;
  if (!data) return null;

  const campos = Object.entries(data.campos).filter(([, v]) => v !== null && v !== "");

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <header>
        <ChipDominio dominio={data.dominio} />
        <h1 className="mt-1 font-mono text-lg font-semibold text-ink">{data.id_interno}</h1>
        <p className="mt-0.5 text-sm text-ink-muted">{data.fuente}</p>
      </header>

      <Card>
        <CardHead titulo="Campos normalizados" />
        {campos.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-ink-muted">El registro no tiene campos poblados.</div>
        ) : (
          <dl className="divide-y divide-line text-sm">
            {campos.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 px-4 py-2">
                <dt className="shrink-0 font-mono text-xs text-ink-muted">{k}</dt>
                <dd className="break-all text-right text-ink">{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      <Card>
        <CardHead titulo="Linaje" extra={<span className="text-2xs text-ink-muted">OKR O4</span>} />
        <dl className="divide-y divide-line text-sm">
          <Fila t="Conector">{data.conector}</Fila>
          <Fila t="Versión del dataset">{data.version_dataset}</Fila>
          <Fila t="Fecha de ingesta">{data.fecha_ingesta}</Fila>
          <Fila t="Transformaciones">
            {data.transformaciones.length
              ? <span className="font-mono text-xs">{data.transformaciones.join(" · ")}</span>
              : <SinDato />}
          </Fila>
          <Fila t="Hash del contenido">
            <span className="font-mono text-xs">{data.hash}</span>
          </Fila>
          <Fila t="Territorio">
            {data.divipola_muni ?? data.divipola_depto
              ? <span className="font-mono text-xs">
                  {data.divipola_muni ? `mpio ${data.divipola_muni}` : `dpto ${data.divipola_depto}`}
                </span>
              : <SinDato motivo="no resuelto contra DIVIPOLA" />}
          </Fila>
        </dl>
        <div className="border-t border-line px-4 py-3">
          <EnlaceFuente url={data.fuente_url}>Ver en la fuente oficial</EnlaceFuente>
        </div>
      </Card>

      {Object.keys(data.extra).length > 0 && (
        <Card>
          <CardHead
            titulo="Campos originales"
            extra={<span className="text-2xs text-ink-muted">tal como los publica la fuente</span>}
          />
          <pre className="overflow-x-auto px-4 py-3 font-mono text-2xs text-ink-body">
            {JSON.stringify(data.extra, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}

function Fila({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2">
      <dt className="shrink-0 text-ink-muted">{t}</dt>
      <dd className="break-all text-right text-ink">{children}</dd>
    </div>
  );
}
