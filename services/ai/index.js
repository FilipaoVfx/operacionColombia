// M13 — IA / RAG (PLANNING BACKLOG J9–J10): consultas en lenguaje natural sobre el
// corpus OSINT. Retrieval híbrido: FTS (M7) + expansión por grafo (M12); el LLM solo
// redacta sobre la evidencia recuperada y cita cada afirmación — principio OSINT:
// nada sin linaje. Sin ANTHROPIC_API_KEY el endpoint degrada a "solo recuperación"
// (evidencia citada sin redacción), nunca a texto sin fuente.
import { searchQuery } from "../search-indexer/index.js";
import { vecinos, migrateGraph } from "../graph/index.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Recupera evidencia citada para una pregunta: hits FTS con su registro completo
 * (fuente + URL oficial) y, para los primeros hits, entidades y vecindad de grafo.
 */
export function retrieve(db, pregunta, { limit = 8 } = {}) {
  migrateGraph(db);
  const { hits } = searchQuery(db, { q: pregunta, limit });

  const getReg = db.prepare(
    "SELECT id_interno, dominio, fuente, fuente_url, divipola_depto, divipola_muni, campos FROM registros WHERE id_interno=?"
  );
  const getEnts = db.prepare(`
    SELECT e.id_entidad, e.tipo, e.nombre_canonico FROM entidad_registros er
    JOIN entidades e ON e.id_entidad = er.id_entidad WHERE er.id_interno=?
  `);

  const evidencias = [];
  const entidadesVistas = new Set();
  for (const h of hits) {
    const reg = getReg.get(h.id_interno);
    if (!reg) continue;
    const ents = getEnts.all(h.id_interno);
    for (const e of ents) entidadesVistas.add(e.id_entidad);
    evidencias.push({
      id_interno: reg.id_interno,
      dominio: reg.dominio,
      label: h.label,
      campos: JSON.parse(reg.campos),
      entidades: ents,
      cita: { fuente: reg.fuente, url: reg.fuente_url },
    });
  }

  // expansión de grafo: vecindad de las entidades top (contexto relacional citable)
  const grafo = [];
  for (const id of [...entidadesVistas].slice(0, 3)) {
    const v = vecinos(db, id, { depth: 1, limit: 20 });
    grafo.push({ entidad: id, vecinos: v.nodos.filter((n) => n.dist > 0), aristas: v.aristas });
  }

  return { pregunta, evidencias, grafo };
}

const SYSTEM = `Eres el analista OSINT del panel "Operación Colombia" (datos abiertos oficiales).
Reglas estrictas:
- Responde SOLO con la evidencia del contexto. Si el contexto no alcanza, di exactamente qué falta; no inventes.
- Cada afirmación factual lleva su cita [n] apuntando a la evidencia usada.
- Cifras: cópialas literales del contexto, sin recalcular ni redondear.
- Responde en español, conciso.`;

/**
 * Pregunta en NL → respuesta redactada con citas [n] + evidencias.
 * deps.llm inyectable para tests; sin API key → modo "solo-recuperacion".
 */
export async function ask(db, pregunta, { apiKey = process.env.ANTHROPIC_API_KEY, model = DEFAULT_MODEL, limit = 8, llm = callClaude } = {}) {
  const ctx = retrieve(db, pregunta, { limit });

  // guardrail: sin evidencia no hay nada que redactar (ni que alucinar)
  if (!ctx.evidencias.length) {
    return { pregunta, respuesta: null, modo: "sin-datos", evidencias: [],
             nota: "no hay registros en el corpus que respondan la pregunta" };
  }
  if (!apiKey) {
    return { pregunta, respuesta: null, modo: "solo-recuperacion", evidencias: ctx.evidencias, grafo: ctx.grafo,
             nota: "sin ANTHROPIC_API_KEY: se devuelve la evidencia citada sin redacción" };
  }

  const contexto = ctx.evidencias.map((e, i) =>
    `[${i + 1}] (${e.dominio}) ${e.label}\ncampos: ${JSON.stringify(e.campos)}\nfuente: ${e.cita.fuente} — ${e.cita.url}`
  ).join("\n\n");
  const relaciones = ctx.grafo.length
    ? "\n\nRelaciones (grafo):\n" + ctx.grafo.map((g) =>
        g.aristas.map((a) => `${a.src} -${a.tipo}(${a.peso})-> ${a.dst}`).join("\n")).join("\n")
    : "";

  const respuesta = await llm({
    apiKey, model, system: SYSTEM,
    prompt: `Contexto:\n${contexto}${relaciones}\n\nPregunta: ${pregunta}`,
  });
  return { pregunta, respuesta, modo: "rag", evidencias: ctx.evidencias, grafo: ctx.grafo };
}

async function callClaude({ apiKey, model, system, prompt }) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 1024, system, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Claude API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") ?? "";
}
