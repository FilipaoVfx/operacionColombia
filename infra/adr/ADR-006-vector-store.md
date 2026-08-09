# ADR-006 — Vector store / embeddings

- **Estado:** DIFERIDO (a M13)
- **Fecha:** 2026-07-07
- **Bloquea:** M13

## Contexto
Dónde viven los embeddings para búsqueda semántica: pgvector, sqlite-vss o proveedor externo.

## Decisión
Al abrir M7 se decidió **diferir el índice vectorial a M13**: el full-text FTS5 (ADR-005)
cubre las consultas actuales y los embeddings solo aportan valor con RAG/agentes (M13).
Candidato inicial: sqlite-vss (coherente con ADR-002); pgvector si ADR-002 migra a
Postgres. Embeddings por batch y solo campos relevantes (control de costo). La búsqueda
híbrida (fusión lexical + semántica) se retoma junto con este ADR.
