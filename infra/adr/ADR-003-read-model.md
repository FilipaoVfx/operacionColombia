# ADR-003 — Read model / materialized views

- **Estado:** PROPUESTO
- **Fecha:** 2026-07-06
- **Bloquea:** M8, M9

## Contexto
Cómo materializar KPIs/agregados: Postgres MV, tablas SQLite precalculadas o Parquet+DuckDB.

## Opciones evaluadas
| Opción | Pros | Contras |
|--------|------|---------|
| Tablas SQLite precalc | Coherente con ADR-002, simple | Recalcular = job propio |
| Postgres MV | REFRESH nativo | Requiere migrar ADR-002 |
| Parquet + DuckDB | Analítica masiva | Complejidad temprana |

## Decisión (propuesta)
Tablas SQLite precalculadas regeneradas al final de cada corrida ETL (invalidación por
evento de ingesta, no TTL). Decidir formalmente al abrir M8.
