# ADR-008 — Knowledge graph store

- **Estado:** ACEPTADO
- **Fecha:** 2026-07-14
- **Bloquea:** M12

## Contexto
Store del grafo de entidades: Postgres recursivo, Neo4j o RDF/oxigraph.

## Decisión
**Tablas nodos/aristas en SQLite + CTEs recursivas**, en la misma DB que el catálogo de
entidades (M6):

- Nodos = tabla `entidades` existente (M6); no se duplica el catálogo.
- Aristas = `grafo_aristas (src, dst, tipo, peso, muestra)`, derivadas por co-ocurrencia
  tipada de entidades sobre el mismo registro unificado (reglas explícitas por par de
  tipos; co-ocurrencias sin semántica clara NO generan arista → controla la explosión
  de relaciones).
- Consultas multi-salto con `WITH RECURSIVE`, profundidad acotada a 3.
- Rebuild idempotente (DELETE + rebuild), disparado por fan-out M5 tras entity-res.
- Dedupe SECOP respetado: solo registros `preferida=1` aportan peso.

## Preguntas §2.3
- **Escala:** grafo actual ~20k nodos; SQLite maneja millones de aristas con índices
  (src, dst). Lectura vía Read API con caché por versión (M15).
- **Cuello de botella:** CTE recursiva profunda → acotada a depth ≤ 3 + LIMIT.
- **Costo:** cero infraestructura adicional; mismo backup/versionado que el resto.
- **Salida:** si consultas multi-salto reales exigen más (depth > 3, caminos mínimos
  masivos, centralidad), migrar aristas a Neo4j/oxigraph — el contrato Graph API
  (vecinos/concentración/stats) no cambia.
