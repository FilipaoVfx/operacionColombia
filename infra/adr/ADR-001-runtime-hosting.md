# ADR-001 — Runtime y hosting

- **Estado:** ACEPTADO
- **Fecha:** 2026-07-06
- **Bloquea:** M4, M9

## Contexto
Dónde corre la plataforma: Node local, Cloudflare Workers o contenedores.

## Opciones evaluadas
| Opción | Pros | Contras |
|--------|------|---------|
| Node local + nginx | Cero dependencias, node:sqlite nativo, control total, coincide con el piloto | Escala vertical primero; HA manual |
| Cloudflare Workers | Edge cache global, serverless | Sin node:sqlite; reescritura del piloto; límites de CPU en ETL |
| Contenedores (Docker/k8s) | Portabilidad | Sobre-ingeniería para el volumen actual |

## Decisión
**Node ≥ 22 local detrás de nginx** (reverse proxy, gzip, cache de estáticos), servicio
systemd. El servidor de la app es stateless respecto a peticiones (estado solo en SQLite),
así que escalar horizontalmente después = réplicas + read-only DB o migración por ADR-002.

## Consecuencias
- nginx aporta la capa edge/cache local (M15 inicia aquí; CDN externo cuando haga falta).
- ETL y API comparten host por ahora; separar procesos cuando M5 lo exija.
- Revisitar si el tráfico supera lo que una VM maneja (ver budget §2.3 del PLANNING).
