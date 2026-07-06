# ADR-005 — Search engine

- **Estado:** PROPUESTO
- **Fecha:** 2026-07-06
- **Bloquea:** M7

## Contexto
Motor de búsqueda full-text: SQLite FTS5, Meilisearch, Typesense o pg+pgvector.

## Decisión (propuesta)
**SQLite FTS5** sobre `search_blob` del registro unificado (cero dependencias, <100 ms a
este volumen). Migrar a Meilisearch/Typesense cuando el corpus supere ~5M documentos o se
necesiten facetas/typo-tolerance avanzadas. Decidir formalmente al abrir M7.
