# ADR-007 — Formato histórico columnar

- **Estado:** ACEPTADO
- **Fecha:** 2026-07-06 · aceptado 2026-07-14
- **Bloquea:** M4, M2

## Contexto
Snapshots versionados de datasets históricos: Parquet, DuckDB o ninguno.

## Decisión
Por ahora **ninguno**: el versionado de esquema vive en `dataset_version` (M2) y los datos
actuales en el write store. Introducir Parquet cuando haya requisito real de series
históricas inmutables (ej. SECOP mensual); reabrir este ADR entonces.
