import { useQuery } from "@tanstack/react-query";
import type {
  ListadoEntidades, FichaEntidad, EvidenciaEntidad, RegistroConLinaje, Meta, TipoEntidad,
} from "./tipos";

/**
 * Cliente de la API. Sin capa de datos de ejemplo ni valores por defecto
 * inventados: si el backend no responde, la vista muestra el error; si responde
 * vacío, la vista muestra su estado vacío.
 */
export class ApiError extends Error {
  constructor(readonly status: number, readonly url: string, mensaje: string) {
    super(mensaje);
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal: signal ?? null, headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detalle = `HTTP ${res.status}`;
    try {
      const cuerpo = (await res.json()) as { error?: string };
      if (cuerpo?.error) detalle = cuerpo.error;
    } catch { /* respuesta sin cuerpo JSON */ }
    throw new ApiError(res.status, path, detalle);
  }
  return (await res.json()) as T;
}

const qs = (params: Record<string, string | number | null | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export interface FiltrosEntidades {
  tipo?: TipoEntidad | null;
  depto?: string | null;
  dominio?: string | null;
  q?: string | null;
  limit?: number;
  offset?: number;
}

export const useMeta = () =>
  useQuery({
    queryKey: ["meta"],
    queryFn: ({ signal }) => get<Meta>("/api/meta", signal),
    staleTime: 5 * 60_000,
  });

export const useEntidades = (f: FiltrosEntidades) =>
  useQuery({
    queryKey: ["entidades", f],
    queryFn: ({ signal }) => get<ListadoEntidades>(`/api/entidades${qs({ ...f })}`, signal),
    placeholderData: (previa) => previa, // conserva la página anterior al pasar de página
  });

export const useEntidad = (id: string | null) =>
  useQuery({
    queryKey: ["entidad", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) => get<FichaEntidad>(`/api/entidades/${encodeURIComponent(id!)}`, signal),
    retry: (intentos, err) => !(err instanceof ApiError && err.status === 404) && intentos < 2,
  });

export const useEvidencia = (id: string | null, offset = 0, limit = 25) =>
  useQuery({
    queryKey: ["entidad-registros", id, offset, limit],
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      get<EvidenciaEntidad>(`/api/entidades/${encodeURIComponent(id!)}/registros${qs({ offset, limit })}`, signal),
    placeholderData: (previa) => previa,
  });

export const useRegistro = (id: string | null) =>
  useQuery({
    queryKey: ["registro", id],
    enabled: Boolean(id),
    queryFn: ({ signal }) => get<RegistroConLinaje>(`/api/registros/${encodeURIComponent(id!)}`, signal),
  });
