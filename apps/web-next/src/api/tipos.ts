// Tipos derivados de las respuestas reales de apps/api/server.js.
// Cada campo existe en la API; no se declara nada que el backend no devuelva.

export type TipoEntidad =
  | "Empresa" | "EntidadPublica" | "Contrato" | "Municipio" | "Departamento" | "TramoVial";

export type Dominio =
  | "territorio" | "vial" | "economia" | "agro" | "contratacion" | "entidades" | "mineria";

/** Departamento donde la entidad tiene registros. Sale de los datos, no se elige uno "principal". */
export interface Territorio {
  cod: string;
  nombre: string | null;
  registros: number;
}

export interface EntidadListada {
  id_entidad: string;
  tipo: TipoEntidad;
  nombre_canonico: string | null;
  clave_tipo: "nit" | "codigo" | "nombre";
  clave_valor: string;
  registros: number;
  fuentes: number;
  dominios: number;
  ultima_ingesta: string | null;
  territorios: Territorio[];
}

export interface ListadoEntidades {
  total: number;
  limit: number;
  offset: number;
  filtros: { tipo: string | null; depto: string | null; dominio: string | null; q: string | null };
  items: EntidadListada[];
}

export interface FuenteDeEntidad {
  fuente: string;
  fuente_url: string;
  dominio: Dominio;
  registros: number;
  ultima_ingesta: string | null;
}

/** Cómo se ligó el registro a la entidad (M6). Es procedencia de la resolución, no un puntaje de calidad. */
export interface VinculoEntidad {
  metodo: "nit" | "codigo" | "nombre" | "alias";
  confianza: number;
  n: number;
}

export interface RelacionEntidad {
  tipo: string;
  peso: number;
  /** id_interno del registro que evidencia la relación: permite abrir el linaje. */
  muestra: string | null;
  otro_id: string;
  otro_tipo: TipoEntidad;
  otro_nombre: string | null;
}

export interface FichaEntidad {
  id_entidad: string;
  tipo: TipoEntidad;
  nombre: string | null;
  clave: { tipo: string; valor: string };
  atributos: Record<string, unknown>;
  creado_en: string | null;
  alias: { alias_norm: string; origen: string | null }[];
  territorios: Territorio[];
  fuentes: FuenteDeEntidad[];
  vinculos: VinculoEntidad[];
  relaciones: RelacionEntidad[];
  registros_total: number;
}

export interface RegistroDeEntidad {
  id_interno: string;
  dominio: Dominio;
  fuente: string;
  fuente_url: string;
  divipola_muni: string | null;
  divipola_depto: string | null;
  fecha_ingesta: string;
  campos: Record<string, unknown>;
  metodo: string;
  confianza: number;
}

export interface EvidenciaEntidad {
  total: number;
  limit: number;
  offset: number;
  items: RegistroDeEntidad[];
}

export interface RegistroConLinaje {
  id_interno: string;
  dominio: Dominio;
  fuente: string;
  fuente_url: string;
  conector: string;
  version_dataset: string;
  hash: string;
  fecha_ingesta: string;
  transformaciones: string[];
  divipola_muni: string | null;
  divipola_depto: string | null;
  campos: Record<string, unknown>;
  extra: Record<string, unknown>;
  geom?: unknown;
}

export interface Meta {
  version_datos: string;
  dominios: { dominio: Dominio; n: number }[];
  departamentos: { codigo: string; nombre: string; municipios: number }[];
  fuentes: {
    source_id: string; nombre: string; dominio: Dominio; conector: string;
    prioridad: string; frecuencia: string; version: number; filas: number | null;
    last_checked: string | null; last_updated: string | null; estado: string;
  }[];
  ultima_corrida: { source_id: string; finished_at: string; filas: number; resultado: string }[];
}
