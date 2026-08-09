import type { ReactNode } from "react";
import { ApiError } from "../api/cliente";
import type { Dominio } from "../api/tipos";

export const DOMINIO_LABEL: Record<Dominio, string> = {
  territorio: "Territorio",
  vial: "Infraestructura",
  economia: "Economía",
  agro: "Agro",
  contratacion: "Contratación",
  entidades: "Entidades",
  mineria: "Minería",
};

const DOMINIO_COLOR: Record<Dominio, string> = {
  territorio: "var(--color-dom-territorio)",
  vial: "var(--color-dom-vial)",
  economia: "var(--color-dom-economia)",
  agro: "var(--color-dom-agro)",
  contratacion: "var(--color-dom-contratacion)",
  entidades: "var(--color-dom-entidades)",
  mineria: "var(--color-dom-mineria)",
};

/** Etiqueta de dominio: color + texto. La identidad nunca queda solo en el color. */
export function ChipDominio({ dominio }: { dominio: Dominio }) {
  const color = DOMINIO_COLOR[dominio] ?? "var(--color-neutral)";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-2xs text-ink-muted">
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: color }} />
      {DOMINIO_LABEL[dominio] ?? dominio}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface shadow-card ${className}`}>
      {children}
    </section>
  );
}

export function CardHead({ titulo, extra }: { titulo: ReactNode; extra?: ReactNode }) {
  return (
    <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
      <h2 className="text-base font-semibold text-ink">{titulo}</h2>
      {extra ? <div className="ml-auto flex items-center gap-2">{extra}</div> : null}
    </header>
  );
}

/**
 * Dato ausente. Se usa en vez de 0 o "—" mudo: un hueco de dato debe
 * distinguirse de un cero medido.
 */
export function SinDato({ motivo = "sin dato en la fuente" }: { motivo?: string }) {
  return (
    <span className="text-ink-subtle" title={motivo}>
      —
    </span>
  );
}

export function Numero({ valor }: { valor: number | null | undefined }) {
  if (valor === null || valor === undefined) return <SinDato />;
  return <span className="num">{valor.toLocaleString("es-CO")}</span>;
}

export function FechaRelativa({ iso }: { iso: string | null }) {
  if (!iso) return <SinDato />;
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  const txt =
    min < 1 ? "hace instantes"
    : min < 60 ? `hace ${min} min`
    : min < 1440 ? `hace ${Math.round(min / 60)} h`
    : `hace ${Math.round(min / 1440)} d`;
  return <time dateTime={iso} title={iso}>{txt}</time>;
}

export function Cargando({ filas = 4 }: { filas?: number }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="Cargando">
      {Array.from({ length: filas }, (_, i) => <div key={i} className="skel h-8 w-full" />)}
    </div>
  );
}

/**
 * Estado vacío. Explica por qué no hay nada y qué haría que lo hubiera,
 * en lugar de dejar la vista muda o rellenarla con ejemplos.
 */
export function Vacio({ titulo, detalle, accion }: { titulo: string; detalle?: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-base font-medium text-ink">{titulo}</p>
      {detalle ? <p className="max-w-md text-sm text-ink-muted">{detalle}</p> : null}
      {accion}
    </div>
  );
}

export function Error_({ error, contexto }: { error: unknown; contexto?: string }) {
  const api = error instanceof ApiError ? error : null;
  const esRed = !api;
  return (
    <div className="m-4 rounded-md border border-error/30 bg-error-soft px-4 py-3">
      <p className="text-sm font-medium text-error">
        {esRed ? "No se pudo contactar la API" : `Error ${api.status}`}
        {contexto ? ` · ${contexto}` : ""}
      </p>
      <p className="mt-0.5 text-xs text-ink-muted">
        {error instanceof Error ? error.message : String(error)}
      </p>
      {esRed ? (
        <p className="mt-1.5 text-2xs text-ink-muted">
          Verificá que el backend esté corriendo (<code className="font-mono">npm start</code>) y que haya
          datos ingeridos (<code className="font-mono">npm run etl</code>).
        </p>
      ) : null}
    </div>
  );
}

/** Enlace a la fuente oficial del registro. Presente donde haya un dato que citar. */
export function EnlaceFuente({ url, children }: { url: string; children?: ReactNode }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-accent hover:underline"
    >
      {children ?? "Fuente oficial"}
      <svg aria-hidden className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 4h6v6M20 4l-9 9M19 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
      </svg>
    </a>
  );
}
