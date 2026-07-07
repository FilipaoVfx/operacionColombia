# ADR-005 — Search engine

- **Estado:** ACEPTADO
- **Fecha:** 2026-07-07
- **Bloquea:** M7

## Contexto
Motor de búsqueda full-text: SQLite FTS5, Meilisearch, Typesense o pg+pgvector.

## Decisión
**SQLite FTS5** (tabla externa `search_fts` en la misma `osint.db`) sobre el `search_blob`
del registro unificado, con ranking `bm25`, facetas por dominio/depto y autocompletado por
prefijo. Indexado incremental por hash disparado por el fan-out de M5 (budget < 30 s).
Implementado en `/services/search-indexer` y expuesto vía `/api/search` (M9).

## Consecuencias
- Cero dependencias nuevas; búsqueda < 100 ms al volumen actual; índice reconstruible
  desde el write store (`cli.js build`).
- Sin typo-tolerance ni sinónimos: FTS5 es matching lexical con prefijo.
- Migrar a Meilisearch/Typesense cuando el corpus supere ~5M documentos o se necesite
  typo-tolerance; el contrato `search()/upsert()/autocomplete()` aísla ese cambio.
- Búsqueda semántica/híbrida queda en ADR-006 (diferida a M13).
