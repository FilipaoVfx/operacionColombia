# ADR-003 — Read model / materialized views

- **Estado:** ACEPTADO
- **Fecha:** 2026-07-06 · aceptado 2026-07-14
- **Bloquea:** M8, M9

## Contexto
Cómo materializar KPIs/agregados: Postgres MV, tablas SQLite precalculadas o Parquet+DuckDB.

## Opciones evaluadas
| Opción | Pros | Contras |
|--------|------|---------|
| Tablas SQLite precalc | Coherente con ADR-002, simple | Recalcular = job propio |
| Postgres MV | REFRESH nativo | Requiere migrar ADR-002 |
| Parquet + DuckDB | Analítica masiva | Complejidad temprana |

## Decisión
Tablas SQLite precalculadas (`rm_*`) regeneradas por el fan-out de M5 tras cada ingesta
(invalidación por evento, no TTL), versionadas en `read_models` como clave de caché.
Implementado así en M8/M9/M15; funciona dentro del budget con los dominios actuales.
