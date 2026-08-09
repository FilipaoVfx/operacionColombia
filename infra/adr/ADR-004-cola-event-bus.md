# ADR-004 — Cola / event bus

- **Estado:** ACEPTADO
- **Fecha:** 2026-07-06 · aceptado 2026-07-07 (apertura de M5)
- **Bloquea:** M5

## Contexto
Mecanismo de colas para ETL asíncrono: tabla-cola SQL, BullMQ/Redis o Cloudflare Queues.

## Decisión
**Tabla-cola SQL** en SQLite (misma `osint.db`): tabla `jobs` con claim atómico
(`UPDATE … RETURNING`), dedupe por índice único parcial, reintentos con backoff
exponencial (30 s base) y dead-letter (`estado='muerto'`). Implementada en
`/services/orchestrator/queue.js`; cero servicios extra, transaccional con el write store.

## Consecuencias
- Un solo archivo de estado; jobs y datos comparten transacción cuando conviene.
- Concurrencia limitada por SQLite (un writer): suficiente para el catálogo actual.
- Migrar a broker dedicado (BullMQ/Redis o Cloudflare Queues) solo bajo carga real;
  el contrato `Queue` (enqueue/claim/complete/fail) aísla ese cambio.
