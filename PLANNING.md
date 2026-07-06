# PLANNING — Roadmap Modular de Ejecución (Operación Colombia OSINT)

> **Audiencia:** el agente de código (Claude Code / SDK) que va a construir la plataforma.
> **Propósito:** convertir la visión ([README](README.md)), el catálogo de fuentes
> ([CATALOGO-DATOS.md](CATALOGO-DATOS.md)), la filosofía de arquitectura (`ard.md`) y el
> backlog ([BACKLOG_MEJORAS_OSINT.md](BACKLOG_MEJORAS_OSINT.md)) en un **plan modular,
> secuenciado y con criterios de aceptación** que un agente pueda ejecutar módulo por módulo.
>
> **Regla de oro (de `ard.md`):** *cada operación costosa se ejecuta una sola vez; cada
> consulta del usuario responde en milisegundos.* Ninguna petición de usuario toca la fuente
> oficial en caliente.
>
> **Fecha:** 2026-07-06 · **Estado:** plan aprobado para ejecución por olas.

---

## 0. Cómo usa el agente este documento

### 0.1 Principios de trabajo
1. **Un módulo a la vez.** No empezar un módulo sin cerrar sus dependencias (ver grafo §3).
2. **Contrato primero.** Antes de codear, definir/leer la **interfaz** que el módulo expone
   (§6). Los módulos se comunican solo por contratos, nunca por internos.
3. **Definition of Done (DoD) global** — un módulo está "terminado" solo si cumple TODO:
   - [ ] Código + interfaz pública documentada.
   - [ ] Pruebas (unit + al menos 1 de integración con datos reales de la fuente).
   - [ ] Campos de **linaje** poblados en cada registro (§6.3).
   - [ ] Métricas de **observabilidad** emitidas (filas, tiempo, errores) (§7.4).
   - [ ] Cumple el **Performance Budget** aplicable (§2.3). Si no cumple, **no está terminado**.
   - [ ] Entrada en el **Metadata Registry** si toca una fuente nueva.
   - [ ] README/ADR del módulo actualizado.
4. **No lockear tecnología sin ADR.** Toda decisión estructural (DB, search engine, colas,
   runtime) se registra como **ADR** (§2.4) antes de implementar.
5. **Pragmatismo incremental.** Reusar el piloto (Node + `node:sqlite`) como semilla; migrar
   a la arquitectura objetivo por módulo, no en un big-bang (§2.5).
6. **Todo asíncrono, todo paginado, todo con cursor.** Nunca `SELECT *`, nunca cargar un
   archivo completo en memoria (streaming §M5).

### 0.2 Cómo elegir la siguiente tarea
- Mirar §10 (checklist maestro) → tomar el primer módulo con estado `PENDIENTE` cuyas
  dependencias estén en `HECHO`.
- Dentro del módulo, ejecutar el checklist en orden.
- Si aparece trabajo fuera del módulo, **no hacerlo inline**: anotarlo en el backlog.

### 0.3 Orden de lectura de los documentos del repo
1. `README.md` — visión, OKRs, dominios.
2. `CATALOGO-DATOS.md` — fuentes, IDs, conectores C1–C4, casos de uso.
3. `ard.md` — principios de arquitectura y performance budget.
4. `BACKLOG_MEJORAS_OSINT.md` — features futuras (entidades, grafo, search).
5. **este `PLANNING.md`** — cómo construirlo.
6. `srs.md` / `prd.md` — detalle técnico del piloto vial.

### 0.4 Convenciones de repositorio (objetivo)
```
/apps
  /api            # Read API (CQRS lado lectura) — stateless
  /web            # Frontend panel (mapa/tabla/kpi)
/services
  /connectors     # Motor de conectores C1..C4 (M1)
  /orchestrator   # Colas, scheduler, workers ETL (M5)
  /normalizer     # Normalización + DIVIPOLA (M3)
  /entity-res     # Entity resolution (M6)
  /search-indexer # Indexado full-text + vector (M7)
  /views-builder  # Materialized views (M8)
  /graph          # Knowledge graph (M12)
  /ai             # RAG + agentes (M13)
/packages
  /core-model     # Esquema de registro unificado + tipos (contrato §6.3)
  /metadata       # Metadata Registry + versionado + lineage (M2)
  /divipola       # Tabla maestra territorial (M3)
  /contracts      # Interfaces compartidas (Connector, Job, Event)
  /observability  # Logger + métricas (M14)
/infra
  /adr            # Architecture Decision Records
  /migrations     # Migraciones de esquema
/data             # Datos locales (gitignored)
/docs             # README, CATALOGO, ard, BACKLOG, PLANNING
```
> El piloto actual (`src/`, `public/`) se **refactoriza** hacia `services/connectors`
> (a partir de `ingest.js`) y `apps/api` + `apps/web` (a partir de `server.js` + `public/`).

### 0.5 Convenciones de código
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`),
  scope = módulo (`feat(connectors): ...`).
- **Idempotencia:** toda ingesta se puede re-ejecutar sin duplicar (upsert por `id_fuente`+`hash`).
- **Stateless por defecto:** API, search, normalizador = sin estado. Estado solo en storage/colas.
- **Feature flags** por dominio y por módulo para activar verticales gradualmente.

---

## 1. Estado actual (baseline)

| Aspecto | Estado |
|---------|--------|
| Piloto | **SIVU** (dominio vial) funcional end-to-end |
| Runtime | Node ≥ 22.5, cero dependencias (`node:http`, `node:sqlite`, `node:zlib`) |
| Ingesta | `src/ingest.js` — ETL ArcGIS INVIAS → SQLite (paginado, reintentos, transacción/página) |
| Storage | SQLite (`data/sivu.db`), WAL, índices por atributo + bbox |
| API | `src/server.js` — HTTP propio, SoQL-like filters, gzip, cache headers, statement cache |
| Front | `public/` — vanilla JS + Leaflet, mapa/tabla/KPI/búsqueda/export |

**Qué se reusa como semilla:**
- `ingest.js` (fetch paginado + `mapFeature` + insert transaccional) → **plantilla del conector C2 y del contrato `Connector`** (M1).
- `server.js` (router + `buildWhere` + prepared cache + gzip) → **base del Read API** (M9).
- `db.js` (schema + índices + WAL) → **base del storage** (M4) y del modelo unificado (M3).
- `domains.js` (decodificación de dominios INVIAS) → **patrón de normalizador por fuente** (M3).

---

## 2. Arquitectura objetivo (north star)

### 2.1 Principios (condensados de `ard.md`)
1. **Nunca consultar la fuente oficial en una petición de usuario.** Scheduler → ETL → base local → usuario.
2. **ETL asíncrono por etapas** (detectar cambios → cola → workers → normalizar → indexar → storage).
3. **CQRS:** separar escritura (ETL) de lectura (API). La lectura nunca pega a la base transaccional.
4. **Materialized views:** KPIs/agregados precalculados, no `SUM()/GROUP BY` en caliente sobre millones de filas.
5. **Todo indexado** (municipio, depto, empresa, NIT, contrato, mineral, fecha, tipo) + Full Text aparte.
6. **Search engine separado** del storage transaccional.
7. **Caché agresiva** en capas (edge/CDN → API → search → DB).
8. **Todo paginado** con cursor.
9. **Streaming** para datasets enormes (nunca cargar 2 GB en memoria).
10. **Inmutabilidad** de datasets históricos (versionado) → cacheo máximo.

### 2.2 Diagrama de capas (objetivo)
```
                Cloudflare CDN / Edge cache
                       │
                API Gateway (stateless)
                       │
        ┌──────────────┼──────────────┐
     Search API     Graph API      Admin API
        └──────────────┼──────────────┘
                  Query Router
        ┌──────────────┼──────────────┐
   Full-Text      Knowledge Graph   Analytics/Views
        └──────────────┼──────────────┘
              Materialized Views (read models)
                       │
                 Primary Storage (write)
                       │
                Event Bus / Queue
        ┌────────┬────────┬────────┬────────┐
     Socrata   ArcGIS   Scrapers  Files   Reddit/X
      (C1)      (C2)      (C4)     (C3)    (futuro)
```

### 2.3 Performance Budget (criterio de aceptación transversal)
> Toda feature que no cumpla su presupuesto **no se considera terminada**.

| Métrica | Objetivo |
|---|---|
| P95 API | < 150 ms |
| P99 API | < 300 ms |
| Búsqueda full-text | < 100 ms |
| Consulta por ID | < 20 ms |
| Carga dashboard | < 1 s |
| ETL incremental | < 5 min |
| Tiempo de indexación (desde ingesta) | < 30 s |
| Cache hit (edge) | > 95 % |
| Error rate | < 0.1 % |
| Disponibilidad | ≥ 99.9 % |

**Preguntas obligatorias por decisión técnica** (de `ard.md`): ¿qué pasa con 100 vs 10.000
concurrentes? ¿cuál es el cuello de botella? ¿cómo escala horizontalmente? ¿costo por millón
de consultas? ¿% cacheable? ¿qué pasa si la fuente externa cae? ¿qué es stateless y qué tiene estado?

### 2.4 ADRs requeridos (decidir antes de lockear)
Cada ADR responde las preguntas de §2.3 y vive en `/infra/adr`.

| ADR | Decisión | Opciones a evaluar | Bloquea |
|-----|----------|--------------------|---------|
| ADR-001 | Runtime/hosting | Node local · Cloudflare Workers · contenedores | M4, M9 |
| ADR-002 | Storage de escritura | SQLite · Postgres · DuckDB | M4, M5 |
| ADR-003 | Read model / views | Postgres MV · tablas SQLite precalc · Parquet+DuckDB | M8, M9 |
| ADR-004 | Cola / event bus | Tabla-cola SQL · BullMQ/Redis · Cloudflare Queues | M5 |
| ADR-005 | Search engine | SQLite FTS5 · Meilisearch · Typesense · pg + pgvector | M7 |
| ADR-006 | Vector store / embeddings | pgvector · sqlite-vss · proveedor externo | M7, M13 |
| ADR-007 | Formato histórico columnar | Parquet · DuckDB · ninguno | M4, M2 |
| ADR-008 | Knowledge graph store | Postgres recursivo · Neo4j · RDF/oxigraph | M12 |

> **Recomendación de arranque (sujeta a ADR):** mantener SQLite/DuckDB para dominios chicos y
> el piloto; usar **Postgres** (o DuckDB+Parquet) para dominios pesados (SECOP, comex). Search
> con **FTS5** al inicio, migrar a Meilisearch/Typesense cuando el volumen lo exija. Colas con
> **tabla-cola SQL** al inicio (simple, transaccional), migrar a broker dedicado bajo carga.

### 2.5 Estrategia de migración (pragmatismo → objetivo)
- **No** reescribir el piloto de cero. Cada módulo **extrae** una pieza del monolito piloto a
  un servicio con contrato, sin romper lo que funciona.
- Orden de extracción: conectores (M1) → normalización (M3) → storage/CQRS (M4) → API (M9).
- El vial sigue vivo como **caso de prueba de regresión** durante toda la migración.

---

## 3. Mapa modular y dependencias

```
M0 Scaffolding
   └─> M1 Connector Engine ──┬─> M5 Orchestration (colas/scheduler/streaming)
        │                    │
        ├─> M2 Metadata/Lineage/Versioning/Freshness
        │
   M3 DIVIPOLA + Normalización + Modelo unificado
        │
        └─> M4 Storage + CQRS ──┬─> M8 Materialized Views ─> M9 Read API + Cache ─> M10 Frontend
                                │
                                ├─> M6 Entity Resolution ─> M12 Knowledge Graph
                                │
                                └─> M7 Search (FTS + vector + híbrido)
M11 Socrata Explorer  (usa M1/M2)
M13 IA / RAG / Agentes (usa M7/M12)
M14 Observabilidad     (transversal, desde M1)
M15 Caching            (transversal, desde M9)
Cross: Gobernanza PII · Legal/Licencias · Performance Gates
```

**Olas de ejecución:**
- **Ola 1 — Fundaciones de ingesta:** M0, M1, M2, M3, M4.
- **Ola 2 — Ingesta a escala:** M5, M6, M8.
- **Ola 3 — Acceso y experiencia:** M9, M7, M10, M15.
- **Ola 4 — Exploración e inteligencia:** M11, M12, M13.
- **Transversal continuo:** M14, gobernanza, legal, performance gates.

Mapeo a fases del README: Ola 1–2 ≈ F1–F2 · Ola 3 ≈ F3 · Ola 4 ≈ F4–F5.

---

## 4. Módulos detallados

> Plantilla por módulo: **Objetivo · Valor · Depende de · Habilita · Entregables · Tareas ·
> Contrato · Aceptación (incl. budget) · Pruebas · Fuera de scope · Riesgos.**

### M0 — Scaffolding & convenciones
- **Objetivo:** estructura de monorepo (§0.4), ADR base, CI, feature flags, contratos vacíos.
- **Valor:** todos los módulos aterrizan en un esqueleto consistente.
- **Depende de:** —  **Habilita:** todo.
- **Entregables:** árbol de carpetas; `/packages/contracts` con interfaces stub; `/infra/adr/ADR-000-template.md`; pipeline CI (lint+test); convención de commits; `.env.example`.
- **Tareas:**
  - [ ] Crear layout `/apps /services /packages /infra /data /docs`.
  - [ ] Mover docs actuales a `/docs` (o dejar en raíz con enlaces).
  - [ ] Definir plantilla ADR y crear ADR-001..008 en estado `PROPUESTO`.
  - [ ] Configurar test runner (`node --test`) y lint.
  - [ ] Sistema de feature flags (config por dominio/módulo).
- **Contrato expuesto:** convenciones + stubs de `/packages/contracts`.
- **Aceptación:** `npm test` corre en verde vacío; CI pasa; ADRs creados.
- **Pruebas:** smoke de arranque.
- **Fuera de scope:** lógica de negocio.
- **Riesgos:** sobre-ingeniería temprana → mantener stubs mínimos.

### M1 — Connector Engine (C1–C4 bajo una interfaz) ⭐ núcleo
- **Objetivo:** generalizar la ingesta en un **motor de conectores** con interfaz única
  (BACKLOG I). Implementar **C1 (Socrata/SODA)** primero; portar **C2 (ArcGIS)** desde `ingest.js`.
- **Valor:** un solo motor alimenta la mayoría del catálogo; C1 desbloquea 6 dominios.
- **Depende de:** M0.  **Habilita:** M2, M3, M5, M11.
- **Entregables:**
  - `/services/connectors` con `SocrataConnector` (C1), `ArcgisConnector` (C2),
    `FileConnector` (C3, stub), `ScrapeConnector` (C4, stub).
  - Registro de fuentes (`sources.config`) parametrizable por `id`, `$where`, dominio.
  - CLI `connectors run --source <id>` para ingesta manual.
- **Tareas:**
  - [ ] Definir contrato `Connector` (§6.1) en `/packages/contracts`.
  - [ ] `SocrataConnector`: paginación `$limit/$offset`, `$where` incremental, `$$app_token`,
        formatos json/csv/geojson, backoff/reintentos (reusar patrón `fetchJson` del piloto).
  - [ ] `ArcgisConnector`: extraer de `ingest.js` (bbox, `outSR=4326`, `maxAllowableOffset`, paginado).
  - [ ] `FileConnector` (C3): descarga + hash + streaming parse (Excel/CSV) — implementación en M5/streaming.
  - [ ] `ScrapeConnector` (C4): interfaz + placeholder (implementación real tras auditoría legal).
  - [ ] Healthcheck por fuente + manejo de "fuente caída" (no romper la corrida).
  - [ ] Emisión de métricas por corrida (a M14).
- **Contrato expuesto:** `Connector` (§6.1), `RawBatch` (§6.2).
- **Aceptación:**
  - C1 baja ≥ 3 datasets reales (ej. `jbjy-vk9h`, `si2v-pbq5`, `uejq-wxrr`) en streaming, paginado.
  - Re-ejecución **idempotente** (mismo hash → no duplica).
  - ETL incremental por `$where=fecha > X`. Budget: ETL incremental < 5 min por fuente media.
- **Pruebas:** unit (paginación, backoff, incremental) + integración contra Socrata real (dataset chico).
- **Fuera de scope:** normalización (M3), orquestación/colas (M5).
- **Riesgos:** rate limit sin `app_token` → depende del bloqueante #1 (registrar token).

### M2 — Metadata Registry + Versionado + Lineage + Freshness
- **Objetivo:** catálogo vivo de datasets con metadatos, versiones, linaje y frescura
  (BACKLOG A3, A4, F, G).
- **Valor:** trazabilidad total (OKR O4), detección de cambios, cacheo por inmutabilidad.
- **Depende de:** M0, M1.  **Habilita:** M5, M11, gobernanza.
- **Entregables:** `/packages/metadata` con store de registro + API interna.
- **Tareas:**
  - [ ] Esquema Metadata Registry (§6.4): nombre, descripción, licencia, cobertura, frecuencia,
        propietario, esquema, última_actualización, tags, conector, prioridad, dominio, estado.
  - [ ] Versionado de dataset: historial de esquema, `version`, compatibilidad, migraciones.
  - [ ] Freshness: `last_checked`, `last_updated`, `hash`, `etag`, `frecuencia_esperada`,
        detección de cambios (comparar hash/etag antes de re-ingerir).
  - [ ] Lineage por registro: `fuente`, `version`, `conector`, `transformaciones[]`, `hash`, `fecha_ingesta`.
  - [ ] Auto-registro: cada corrida de M1 escribe/actualiza metadata.
- **Contrato expuesto:** `MetadataRegistry` (read/write), `DatasetVersion`.
- **Aceptación:** cada fuente ingerida tiene entrada completa; cambio de esquema queda versionado;
  re-ingesta se **salta** si `hash/etag` no cambió.
- **Pruebas:** simular cambio de esquema y de contenido; verificar versión + skip por hash.
- **Fuera de scope:** UI del explorer (M11).
- **Riesgos:** fuentes sin `etag` → fallback a hash de contenido.

### M3 — DIVIPOLA + Normalización + Modelo unificado ⭐ pegamento
- **Objetivo:** tabla maestra territorial + normalizadores por fuente al **registro unificado**.
- **Valor:** llave de cruce inter-dominio (sin esto no hay OSINT, solo silos).
- **Depende de:** M1.  **Habilita:** M4, M6, M7, M8.
- **Entregables:** `/packages/divipola`, `/services/normalizer` con normalizador por dominio.
- **Tareas:**
  - [ ] Ingerir **DIVIPOLA** (código depto/municipio + nombres oficiales) vía C1/C3.
  - [ ] Tabla de departamentos + alias/normalización de nombres (sin acentos, mayúsculas).
  - [ ] Contrato de **registro unificado** (§6.3): campos canónicos + geo + `divipola_muni/depto`
        + `entidad_refs` + `extra` (JSON, nunca descarta atributo original).
  - [ ] Normalizador por dominio (patrón `domains.js` del piloto): map fuente → registro unificado.
  - [ ] Resolución territorial: mapear municipio/depto de cada fuente → código DIVIPOLA
        (match exacto + normalizado; los no resueltos van a cola de revisión).
  - [ ] Normalización geográfica: reproyectar todo a **WGS84** (INVIAS viene en wkid 9377).
- **Contrato expuesto:** `UnifiedRecord` (§6.3), `Normalizer<Domain>`.
- **Aceptación:** ≥ 95 % de registros con `divipola_muni` resuelto en dominios con municipio;
  geometrías en WGS84; `extra` conserva 100 % de atributos originales.
- **Pruebas:** casos de nombres ambiguos (ej. "San Antonio" en varios deptos), reproyección.
- **Fuera de scope:** unir empresas/NIT (eso es M6).
- **Riesgos:** nombres municipales duplicados → requiere depto para desambiguar.

### M4 — Storage + CQRS
- **Objetivo:** separar **store de escritura** (ETL) del **read model** (lectura), decidido por ADR-002/003.
- **Valor:** las consultas nunca pegan a la base transaccional; escala lectura y escritura por separado.
- **Depende de:** M3.  **Habilita:** M8, M9, M6, M7.
- **Entregables:** capa de persistencia con migraciones (`/infra/migrations`), write store + proyección a read store.
- **Tareas:**
  - [ ] Resolver **ADR-002/003/007** (SQLite vs Postgres vs DuckDB/Parquet; read model; histórico columnar).
  - [ ] Esquema de escritura (registro unificado + lineage) con **upsert idempotente** (`id_fuente`+`hash`).
  - [ ] Índices obligatorios (BACKLOG): municipio, depto, empresa, NIT, contrato, mineral, fecha, tipo + bbox espacial.
  - [ ] Proyección write → read (event/trigger) que alimenta read models (base de M8).
  - [ ] Estrategia por volumen: dominios chicos en SQLite/DuckDB local; SECOP/comex en store pesado.
  - [ ] Inmutabilidad: snapshots versionados de datasets históricos.
- **Contrato expuesto:** `WriteStore`, `ReadStore` (interfaces).
- **Aceptación:** consulta por ID < 20 ms; upsert idempotente comprobado; separación write/read real.
- **Pruebas:** carga de 1M filas sintéticas; medir latencias vs budget.
- **Fuera de scope:** vistas materializadas de KPI (M8), API HTTP (M9).
- **Riesgos:** elegir mal el store pesado → mitigar con benchmark antes de lockear (ADR).

### M5 — Orchestration (colas + scheduler + streaming + fan-out)
- **Objetivo:** ETL totalmente asíncrono por etapas, con colas, scheduler y streaming (ard 2,8,9; concurrencia).
- **Valor:** ingesta a escala sin bloquear; scrapers/ETLs/API no compiten.
- **Depende de:** M1, M4.  **Habilita:** ingesta masiva de todo el catálogo.
- **Entregables:** `/services/orchestrator` (scheduler + workers + cola).
- **Tareas:**
  - [ ] Resolver **ADR-004** (tabla-cola vs broker).
  - [ ] Scheduler por periodicidad de fuente (SECOP diario, EVA semestral, PIB anual) — M2 freshness.
  - [ ] Cola de trabajos: `enqueue(job)`, workers idempotentes, reintentos con backoff, dead-letter.
  - [ ] **Streaming** en `FileConnector`: parse por chunks (Excel/CSV grandes) → normalize → insert → next chunk.
  - [ ] **Fan-out** tras normalizar: storage → search → embeddings → graph (en paralelo, no secuencial).
  - [ ] Separación física de cargas: ETL/scrapers/API/embeddings como procesos independientes.
  - [ ] Detección de cambios antes de encolar (skip si `hash/etag` igual).
- **Contrato expuesto:** `Job` (§6.5), `Queue`, `Scheduler`.
- **Aceptación:** correr N fuentes concurrentes sin degradar API; reintento y dead-letter funcionan;
  archivo de 2 GB procesado sin OOM (streaming). Budget: indexación < 30 s desde ingesta.
- **Pruebas:** inyectar fallo de worker (reintento), archivo grande (memoria estable), fuente caída.
- **Fuera de scope:** lógica de cada índice destino (M7/M8/M12).
- **Riesgos:** colas mal dimensionadas → observabilidad (M14) desde el día uno.

### M6 — Entity Resolution + Catálogo de entidades
- **Objetivo:** entidades canónicas (Empresa, Contrato, Municipio, Proyecto, Título, Persona)
  y su deduplicación/relación (BACKLOG A1, D).
- **Valor:** pasar de "filas" a "entidades" cruzables; base del grafo.
- **Depende de:** M3, M4.  **Habilita:** M12, análisis cruzados.
- **Entregables:** `/services/entity-res` + catálogo de entidades con IDs internos estables.
- **Tareas:**
  - [ ] Definir entidades canónicas + IDs internos estables + relaciones a datasets.
  - [ ] Matching por **NIT** (entidades/proveedores), por **código** (vial, DIVIPOLA), por **nombre normalizado**.
  - [ ] Alias y reglas de deduplicación (dedupe SECOP I/II/Integrado — bloqueante #8).
  - [ ] Cola de revisión para matches dudosos (umbral de confianza).
- **Contrato expuesto:** `Entity`, `EntityRef`, `ResolveResult`.
- **Aceptación:** proveedor con múltiples grafías se resuelve a 1 entidad; contratos no se triplican.
- **Pruebas:** set de NITs con ruido; nombres con variaciones; medir precisión/recall.
- **Fuera de scope:** visualización de grafo (M12).
- **Riesgos:** falsos positivos en match por nombre → exigir NIT o revisión humana sobre umbral.

### M7 — Search (full-text + vector + híbrido)
- **Objetivo:** motor de búsqueda separado (ard 6): full-text, vectorial, híbrido, facetas, autocompletado (BACKLOG C).
- **Valor:** búsqueda < 100 ms independiente del storage.
- **Depende de:** M3, M4 (+ M5 fan-out).  **Habilita:** M10, M13.
- **Entregables:** `/services/search-indexer` + índice de búsqueda.
- **Tareas:**
  - [ ] Resolver **ADR-005/006** (engine + vector store).
  - [ ] Índice full-text (FTS5 al inicio) sobre `search_blob` unificado.
  - [ ] Índice vectorial (embeddings) para búsqueda semántica.
  - [ ] Búsqueda **híbrida** (fusión lexical + semántica) + **facetas** (dominio, depto, tipo) + **autocompletado**.
  - [ ] Indexado incremental vía fan-out (M5): nuevo registro indexado < 30 s.
- **Contrato expuesto:** `SearchIndex.query()`, `SearchIndex.upsert()`.
- **Aceptación:** full-text < 100 ms; autocompletar fluido; facetas correctas; indexación < 30 s.
- **Pruebas:** consultas frecuentes ("Cali"), relevancia híbrida, latencia bajo carga.
- **Fuera de scope:** RAG/LLM (M13).
- **Riesgos:** costo de embeddings a escala → batch + solo campos relevantes.

### M8 — Materialized Views + Analytics
- **Objetivo:** precalcular KPIs/agregados (ard 4). Nada de `SUM()/GROUP BY` en caliente.
- **Valor:** dashboards < 1 s a cualquier escala.
- **Depende de:** M4.  **Habilita:** M9, M10.
- **Entregables:** `/services/views-builder` + read models (top contratistas, km por depto, producción por municipio…).
- **Tareas:**
  - [ ] Catálogo de vistas por dominio (KPIs del README §7/§10 + casos de uso del catálogo).
  - [ ] Builder incremental: recalcular solo lo afectado por la última ingesta (via fan-out M5).
  - [ ] Versionar vistas (inmutabilidad para cacheo).
- **Contrato expuesto:** `ReadModel` (tabla/consulta precalculada).
- **Aceptación:** carga dashboard < 1 s; KPI leído con `SELECT` directo, sin agregación en caliente.
- **Pruebas:** comparar KPI precalculado vs cálculo directo (correctitud) sobre dataset grande.
- **Fuera de scope:** render (M10).
- **Riesgos:** vistas desactualizadas → invalidación por evento de ingesta.

### M9 — Read API + Query Router + Cache
- **Objetivo:** API de lectura stateless (CQRS lado lectura), paginada por cursor, con caché (ard 1,7,8).
- **Valor:** contrato único para el front; P95 < 150 ms.
- **Depende de:** M4, M8 (+ M7 para search endpoints).  **Habilita:** M10, M15.
- **Entregables:** `/apps/api` (extiende `server.js`) + query router + capa de caché.
- **Tareas:**
  - [ ] Endpoints por dominio (map/tabla/kpi/search/by-id) — reusar `buildWhere`/prepared del piloto.
  - [ ] Paginación por **cursor** (no offset profundo), `LIMIT` siempre.
  - [ ] Query router: dirige a read model / search / graph según endpoint.
  - [ ] Caché de API + headers (`Cache-Control`, `ETag`) + colapso de peticiones idénticas.
  - [ ] Respuestas GeoJSON/CSV/JSON; gzip (ya en piloto).
- **Contrato expuesto:** OpenAPI del Read API.
- **Aceptación:** P95 < 150 ms, P99 < 300 ms, by-id < 20 ms; nunca pega a write store; nunca `SELECT *`.
- **Pruebas:** carga 500 req/s; verificar cache hit; latencias vs budget.
- **Fuera de scope:** escritura (solo lectura), edge/CDN (M15).
- **Riesgos:** N+1 en joins → resolver con read models (M8), no en API.

### M10 — Frontend panel unificado
- **Objetivo:** panel multi-dominio (mapa/tabla/KPI) con **selector único de territorio** (DIVIPOLA) que filtra todo.
- **Valor:** experiencia OSINT: un municipio → contratos + agro + minería + regalías + conflicto juntos.
- **Depende de:** M9.  **Habilita:** entrega de valor al usuario final.
- **Entregables:** `/apps/web` (evoluciona `public/`).
- **Tareas:**
  - [ ] Reusar mapa/tabla/KPI/búsqueda/export del piloto; generalizar por dominio (capas conmutables).
  - [ ] Selector de territorio DIVIPOLA global; filtros combinables por dominio.
  - [ ] Popups con **enlace a la fuente oficial** (trazabilidad visible) + disclaimer en conflicto.
  - [ ] Vistas por dominio alimentadas por read models (M8) y search (M7).
  - [ ] Carga por bbox + paginación; spinner solo si > 500 ms.
- **Contrato expuesto:** consume Read API (M9).
- **Aceptación:** carga inicial < 1.5 s (OKR); bundle < 500 KB; responsive; cada dato enlaza su fuente.
- **Pruebas:** e2e por dominio; Lighthouse; móvil.
- **Fuera de scope:** features avanzadas del explorer (M11).
- **Riesgos:** mapa pesado → vector tiles a futuro (backlog).

### M11 — Socrata Explorer
- **Objetivo:** descubrir/explorar/perfilar datasets de datos.gov.co (BACKLOG B).
- **Valor:** acelera incorporar nuevas fuentes C1 (autoservicio).
- **Depende de:** M1, M2.  **Habilita:** escalado de fuentes.
- **Entregables:** módulo Explorer (discovery, preview, query builder, quality profile, export).
- **Tareas:**
  - [ ] Discovery: buscar datasets por institución/categoría/keyword (API de catálogo Socrata).
  - [ ] Exploración: preview + metadata + estadísticas básicas.
  - [ ] Query Builder visual de SoQL + exportar la consulta como fuente registrada (a M1).
  - [ ] Perfil de calidad: nulos, duplicados, cobertura, distribución de columnas.
  - [ ] Visualizaciones rápidas (tabla/series/mapa/histograma) + export (JSON/CSV/GeoJSON/Parquet/SQLite).
  - [ ] Programación ETL (diario/semanal/mensual) → registra job en M5.
- **Contrato expuesto:** genera `sources.config` + `Job` para M1/M5.
- **Aceptación:** desde el Explorer se registra una fuente nueva y queda ingiriendo sin tocar código.
- **Pruebas:** alta de un dataset nuevo end-to-end.
- **Fuera de scope:** fuentes no-Socrata.
- **Riesgos:** heterogeneidad de esquemas → perfil de calidad obligatorio antes de promover a P1.

### M12 — Knowledge Graph
- **Objetivo:** grafo de nodos/relaciones entre contratos, empresas, municipios, regalías, minería, infraestructura (BACKLOG A2).
- **Valor:** consultas relacionales tipo "qué empresa concentra contratos + títulos mineros en zona de conflicto".
- **Depende de:** M6.  **Habilita:** M13, análisis avanzado.
- **Entregables:** `/services/graph` + Graph API.
- **Tareas:**
  - [ ] Resolver **ADR-008** (store de grafo).
  - [ ] Modelo de nodos (Empresa, Municipio, Contrato, Título, Proyecto…) y relaciones.
  - [ ] Poblado desde entidades (M6) vía fan-out (M5).
  - [ ] Consultas de grafo (vecindad, caminos, concentración).
- **Contrato expuesto:** Graph API.
- **Aceptación:** resolver una consulta multi-salto de ejemplo del README (vía × concesión × peaje / empresa × contrato × conflicto).
- **Pruebas:** correctitud de relaciones; latencia de consulta acotada.
- **Fuera de scope:** IA (M13).
- **Riesgos:** explosión de relaciones → limitar profundidad + índices.

### M13 — IA / RAG / Agentes de investigación
- **Objetivo:** capa de IA sobre search + graph para consultas en lenguaje natural y agentes OSINT (BACKLOG J9–J10).
- **Valor:** "pregunta y obtén respuesta con fuentes"; automatiza investigación.
- **Depende de:** M7, M12.  **Habilita:** producto diferenciado.
- **Entregables:** `/services/ai` (RAG pipeline + agentes).
- **Tareas:**
  - [ ] RAG: retrieval híbrido (M7) + grafo (M12) → contexto citado.
  - [ ] Respuestas **siempre con fuente** (coherente con principio OSINT; nada sin linaje).
  - [ ] Agentes de investigación (multi-paso) sobre el corpus.
  - [ ] Guardrails: no inventar; si no hay dato, decirlo.
- **Contrato expuesto:** endpoint de consulta NL.
- **Aceptación:** respuesta cita fuentes reales del corpus; sin alucinación en set de prueba.
- **Pruebas:** batería de preguntas con ground-truth; verificación de citas.
- **Fuera de scope:** modelos propios (se usan modelos Claude vía API).
- **Riesgos:** alucinación → grounding estricto + citas obligatorias.

### M14 — Observabilidad (transversal)
- **Objetivo:** métricas de ETL, tiempos por conector, filas, errores, alertas, dashboard (BACKLOG H).
- **Depende de:** M1 (se instrumenta desde el primer conector).  **Habilita:** operar con budget.
- **Entregables:** `/packages/observability` + dashboard operativo.
- **Tareas:**
  - [ ] Logger estructurado + métricas (contadores/histogramas) por módulo.
  - [ ] Métricas ETL: tiempo por conector, filas procesadas, errores, freshness.
  - [ ] Métricas API/Search: latencias P95/P99, cache hit, error rate.
  - [ ] Alertas por umbral (budget §2.3) + dashboard.
- **Aceptación:** todo el budget §2.3 es **medible** en el dashboard; alertas disparan.
- **Riesgos:** métricas caras → muestreo.

### M15 — Caching (transversal)
- **Objetivo:** caché en capas edge/CDN → API → search → DB (ard 7).
- **Depende de:** M9.  **Habilita:** cumplir budget bajo carga.
- **Tareas:**
  - [ ] Cache edge/CDN (según ADR-001) con inmutabilidad + `ETag`.
  - [ ] Cache de API y de search; colapso de peticiones idénticas (single-flight).
  - [ ] Invalidación por versión de dataset/vista (M2/M8).
- **Aceptación:** cache hit edge > 95 %; "1000 buscan Cali → 1 consulta a la base".
- **Riesgos:** invalidación incorrecta → clavar en versión inmutable, no en TTL ciego.

---

## 5. Cross-cutting (obligatorio en todos los módulos)

### 5.1 Gobernanza de datos sensibles (PII)
- Conflicto/víctimas: **solo agregados**, nada individualizable. Aplicar filtro de gobernanza
  en M3 antes de persistir. Documentar por fuente. Bloquea M-conflicto hasta política escrita.

### 5.2 Legal / licencias
- Auditoría de licencia por fuente **antes** de ingerir (crítico para C4/scrape: Indepaz, portales privados).
- Registrar licencia en Metadata Registry (M2). Sin licencia verificada → fuente queda en `BLOQUEADA`.

### 5.3 Seguridad
- Secretos (`app_token`, credenciales) fuera del repo (`.env`, secrets manager).
- Rate-limit y validación de input en Read API. CORS controlado.

### 5.4 Performance gates
- Cada PR de feature declara su impacto en el budget (§2.3). CI falla si degrada P95/errores.

### 5.5 Testing
- Unit + integración (contra fuente real, dataset chico) + regresión del **vial** (piloto vivo)
  + carga (para M4/M7/M9).

---

## 6. Contratos entre módulos

### 6.1 Connector (M1)
```ts
interface Connector {
  kind: 'socrata' | 'arcgis' | 'file' | 'scrape';
  discover(source: SourceConfig): Promise<SourceMeta>;      // esquema + conteo + etag
  fetch(source: SourceConfig, cursor?: Cursor): AsyncIterable<RawBatch>; // streaming + paginado
  healthcheck(source: SourceConfig): Promise<'ok'|'down'|'changed'>;
}
interface SourceConfig {
  id: string;            // p.ej. 'jbjy-vk9h'
  kind: Connector['kind'];
  domain: string;        // 'contratacion' | 'mineria' | ...
  endpoint: string;
  where?: string;        // SoQL incremental
  priority: 'P0'|'P1'|'P2'|'P3';
  schedule: 'diario'|'semanal'|'mensual';
}
```

### 6.2 RawBatch (M1 → M3)
```ts
interface RawBatch {
  sourceId: string;
  rows: unknown[];       // crudo de la fuente
  cursor: Cursor;        // para reanudar
  fetchedAt: string;     // ISO
  etag?: string; hash?: string;
}
```

### 6.3 UnifiedRecord (M3, núcleo del sistema)
```ts
interface UnifiedRecord {
  // identidad + linaje (obligatorio, OKR O4)
  id_interno: string;            // estable
  id_fuente: string;             // id original en la fuente
  dominio: string;
  fuente: string; fuente_url: string;
  conector: string; version_dataset: string;
  hash: string;                  // dedupe/idempotencia
  fecha_ingesta: string; fecha_actualizacion_fuente?: string;
  transformaciones: string[];    // lineage
  // territorio (llave de cruce)
  divipola_muni?: string; divipola_depto?: string;
  geom?: GeoJSON;                // WGS84
  // entidades (M6)
  entidad_refs?: EntityRef[];    // NIT, empresa, contrato...
  // canónicos por dominio + bolsa que nunca descarta
  campos: Record<string, unknown>;
  extra: Record<string, unknown>;
}
```

### 6.4 MetadataRegistry (M2)
```ts
interface DatasetMeta {
  sourceId: string; nombre: string; descripcion: string;
  licencia: string; cobertura: string; frecuencia: string;
  propietario: string; esquema: JSONSchema; tags: string[];
  dominio: string; conector: string; prioridad: string;
  version: string; ultima_actualizacion: string;
  last_checked: string; last_updated: string; etag?: string; hash?: string;
  estado: 'ACTIVA'|'BLOQUEADA'|'PENDIENTE_LICENCIA';
}
```

### 6.5 Job / Queue (M5)
```ts
interface Job {
  jobId: string; type: 'ingest'|'normalize'|'index'|'view'|'graph';
  sourceId?: string; cursor?: Cursor; attempt: number; enqueuedAt: string;
}
```

---

## 7. Índice / Checklist maestro

| Módulo | Ola | Depende de | Estado |
|--------|-----|------------|--------|
| M0 Scaffolding | 1 | — | PENDIENTE |
| M1 Connector Engine ⭐ | 1 | M0 | PENDIENTE |
| M2 Metadata/Lineage/Versioning/Freshness | 1 | M0, M1 | PENDIENTE |
| M3 DIVIPOLA + Normalización ⭐ | 1 | M1 | PENDIENTE |
| M4 Storage + CQRS | 1 | M3 | PENDIENTE |
| M5 Orchestration (colas/scheduler/streaming) | 2 | M1, M4 | PENDIENTE |
| M6 Entity Resolution | 2 | M3, M4 | PENDIENTE |
| M8 Materialized Views | 2 | M4 | PENDIENTE |
| M9 Read API + Cache | 3 | M4, M8 | PENDIENTE |
| M7 Search (FTS+vector+híbrido) | 3 | M3, M4 | PENDIENTE |
| M10 Frontend unificado | 3 | M9 | PENDIENTE |
| M15 Caching | 3 | M9 | PENDIENTE |
| M11 Socrata Explorer | 4 | M1, M2 | PENDIENTE |
| M12 Knowledge Graph | 4 | M6 | PENDIENTE |
| M13 IA / RAG / Agentes | 4 | M7, M12 | PENDIENTE |
| M14 Observabilidad | transversal | M1 | PENDIENTE |

**Primer paso concreto para el agente:** cerrar bloqueantes de gobernanza/legal/token
(CATALOGO §5) → **M0** → **M1 (C1 Socrata)** contra un dataset chico (ej. `kgyi-qc7j` PIB) →
**M3 DIVIPOLA** → probar cruce. A partir de ahí, seguir el checklist por olas.

---

## 8. Riesgos globales y mitigación

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Elegir mal storage/search antes de medir | rediseño costoso | ADR + benchmark con datos reales antes de lockear |
| SECOP/comex desbordan SQLite | ingesta inviable | store pesado (Postgres/DuckDB) por ADR-002; streaming M5 |
| Scraping ilegal (C4) | riesgo legal | auditoría de licencia (5.2) bloquea ingesta sin luz verde |
| PII de víctimas | daño + legal | solo agregados, filtro en M3, política escrita (5.1) |
| Fuente cambia esquema | ingesta rota | versionado + drift detection (M2) |
| Fuente cae | corrida rota | healthcheck + skip + reintentos (M1/M5) |
| Perder trazabilidad | rompe OKR O4 | lineage obligatorio en UnifiedRecord (6.3), gate en DoD |

---

## 9. Trazabilidad a OKRs (README §5)
- **O1 (capa unificada + trazable):** M1, M2, M3, M4 + lineage (6.3).
- **O2 (panel usable + budget):** M8, M9, M10, M15 + Performance Budget (2.3).
- **O3 (escalar 1→N dominios):** Connector Engine (M1) + Socrata Explorer (M11) + framework de vertical.
- **O4 (gobernanza + confianza):** Metadata (M2) + gobernanza/legal (5.1/5.2) + lineage.

---

*Documento vivo. Actualizar el estado del checklist (§7) al cerrar cada módulo. Referencias:
[README](README.md) · [CATALOGO-DATOS](CATALOGO-DATOS.md) · `ard.md` · [BACKLOG](BACKLOG_MEJORAS_OSINT.md).*
