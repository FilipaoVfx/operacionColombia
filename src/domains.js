// Coded-value domains extracted from the INVIAS ArcGIS RedVial layer
// (MapaCarreteras/RedVial/MapServer/1). Fields store integer codes; these maps
// turn them into human labels during ingestion.

export const CATEGORIA = {
  1: "Primer Orden",
  2: "Segundo Orden",
  3: "Tercer Orden",
  4: "Por Definir",
};

// Normalized "tipo_vial" used by the PRD (nacional / departamental / terciaria).
export const CATEGORIA_TIPO = {
  1: "Nacional",
  2: "Departamental",
  3: "Terciaria",
  4: "Por Definir",
};

export const SUPERFICIE = {
  1: "Pavimentada",
  2: "Sin Pavimentar",
  3: "Por Definir",
};

export const CALZADA = {
  1: "Sencilla",
  2: "Doble",
  3: "Por Definir",
};

export const ADMINISTRADOR = {
  1: "INVIAS",
  2: "ANI",
  3: "Concesion Departamental",
  4: "FINDETER",
  5: "Vias Desuso",
  6: "INVIAS - Convenios",
};

export const GRUPO_ADMIN = {
  1: "Grupo 1",
  2: "Grupo 2",
  3: "Grupo 3",
  4: "Grupo 4",
  5: "Grupo 5",
  6: "Grupo 6",
  7: "Grupo 7",
  8: "FINDETER",
  9: "No Aplica",
  10: "Por Definir",
};

// INVIAS "Territorial" doubles as the regional / departmental dimension.
export const TERRITORIAL = {
  0: "No Aplica",
  1: "Antioquia",
  2: "Atlantico",
  3: "Bolivar",
  4: "Boyaca",
  5: "Caldas",
  6: "Caqueta",
  7: "Casanare",
  8: "Cauca",
  9: "Cesar",
  10: "Choco",
  11: "Cordoba",
  12: "Cundinamarca",
  13: "Guajira",
  14: "Huila",
  15: "Magdalena",
  16: "Meta",
  17: "Narino",
  18: "Norte de Santander",
  19: "Putumayo",
  20: "Quindio",
  21: "Risaralda",
  22: "Santander",
  23: "Sucre",
  24: "Tolima",
  25: "Valle del Cauca",
  26: "Ocana",
  27: "Planta Central",
  28: "ANI",
  29: "Por Definir",
};

export const REVISION = {
  1: "Revisado",
  2: "No Revisado",
};

// Subconjunto geografico de TERRITORIAL: solo departamentos reales.
// El resto (Ocana, Planta Central, ANI, No Aplica, Por Definir) son
// territoriales administrativas/no geograficas de INVIAS.
export const DEPARTAMENTOS = new Set([
  "Antioquia", "Atlantico", "Bolivar", "Boyaca", "Caldas", "Caqueta",
  "Casanare", "Cauca", "Cesar", "Choco", "Cordoba", "Cundinamarca",
  "Guajira", "Huila", "Magdalena", "Meta", "Narino", "Norte de Santander",
  "Putumayo", "Quindio", "Risaralda", "Santander", "Sucre", "Tolima",
  "Valle del Cauca",
]);

export function esDepartamento(region) {
  return DEPARTAMENTOS.has(region);
}

// Decode a raw value that may already be a label or a numeric code (string/number).
export function decode(map, raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null; // limpia valores en blanco (" ") de la fuente
  // codigo numerico conocido -> etiqueta
  const asNum = Number(s);
  if (Number.isInteger(asNum) && map[asNum] !== undefined) return map[asNum];
  return s; // ya es una etiqueta de texto
}
