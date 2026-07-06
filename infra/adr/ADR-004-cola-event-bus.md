# ADR-004 — Cola / event bus

- **Estado:** PROPUESTO
- **Fecha:** 2026-07-06
- **Bloquea:** M5

## Contexto
Mecanismo de colas para ETL asíncrono: tabla-cola SQL, BullMQ/Redis o Cloudflare Queues.

## Decisión (propuesta)
**Tabla-cola SQL** en SQLite (simple, transaccional, sin servicios extra), con
`enqueue(job)`, workers idempotentes, reintentos con backoff y dead-letter. Migrar a
broker dedicado solo bajo carga real. Decidir formalmente al abrir M5.
