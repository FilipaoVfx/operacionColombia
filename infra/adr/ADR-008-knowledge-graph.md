# ADR-008 — Knowledge graph store

- **Estado:** PROPUESTO
- **Fecha:** 2026-07-06
- **Bloquea:** M12

## Contexto
Store del grafo de entidades: Postgres recursivo, Neo4j o RDF/oxigraph.

## Decisión (propuesta)
Diferir hasta M12 (Ola 4, depende de M6 Entity Resolution). Candidato inicial: tablas
nodos/aristas en SQL con CTEs recursivas; Neo4j solo si las consultas multi-salto lo exigen.
