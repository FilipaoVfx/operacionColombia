# ADR-002 — Storage de escritura

- **Estado:** ACEPTADO (revisar al integrar SECOP/comex)
- **Fecha:** 2026-07-06
- **Bloquea:** M4, M5

## Contexto
Dónde persiste el write store del registro unificado: SQLite, Postgres o DuckDB.

## Opciones evaluadas
| Opción | Pros | Contras |
|--------|------|---------|
| SQLite (node:sqlite, WAL) | Cero dependencias, transaccional, suficiente para dominios chicos/medios; ya probado en piloto | Un escritor; datasets de decenas de GB lo estresan |
| Postgres | Concurrencia, MV nativas, pgvector | Servicio extra que operar; innecesario hoy |
| DuckDB + Parquet | Analítica columnar barata | No es store transaccional de escritura |

## Decisión
**SQLite WAL** (`data/osint.db`) para el write store con upsert idempotente
(`id_interno` + `hash`). Dominios pesados (SECOP I/II, comercio exterior) **no** entran
aquí sin revisar este ADR: umbral de migración a Postgres ≈ >5 GB por dominio o >2
escritores concurrentes.

## Consecuencias
- Simplicidad operativa máxima; backup = copiar archivo.
- La proyección a read models (M8) puede ser tablas SQLite precalculadas (ADR-003).
