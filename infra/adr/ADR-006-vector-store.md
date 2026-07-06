# ADR-006 — Vector store / embeddings

- **Estado:** PROPUESTO
- **Fecha:** 2026-07-06
- **Bloquea:** M7, M13

## Contexto
Dónde viven los embeddings para búsqueda semántica: pgvector, sqlite-vss o proveedor externo.

## Decisión (propuesta)
Diferir hasta M7/M13. Candidato inicial: sqlite-vss (coherente con ADR-002); pgvector si
ADR-002 migra a Postgres. Embeddings por batch y solo campos relevantes (control de costo).
