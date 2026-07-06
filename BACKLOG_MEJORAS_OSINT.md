# Backlog de Mejoras y Features (Fuera de Scope)

## Objetivo

Consolidar todas las mejoras detectadas durante la revisión del catálogo
de fuentes de datos y ampliar la arquitectura para evolucionar desde un
ETL hacia una plataforma OSINT basada en entidades, búsqueda y grafos.

## A. Arquitectura

### A1. Catálogo de Entidades

-   Definir entidades canónicas (Empresa, Contrato, Municipio, Proyecto,
    Título Minero, Persona, etc.).
-   Modelar relaciones entre entidades y datasets.
-   Crear identificadores internos estables.

### A2. Knowledge Graph

-   Diseñar modelo de nodos y relaciones.
-   Resolver relaciones entre contratos, empresas, municipios, regalías,
    minería e infraestructura.
-   Preparar consultas tipo grafo.

### A3. Metadata Registry

-   Registrar automáticamente:
    -   nombre
    -   descripción
    -   licencia
    -   cobertura
    -   frecuencia
    -   propietario
    -   esquema
    -   última actualización
    -   tags

### A4. Versionado de Datasets

-   Historial de cambios de esquema.
-   Compatibilidad entre versiones.
-   Migraciones automáticas.

------------------------------------------------------------------------

## B. Socrata Explorer

### B1. Descubrimiento

-   Buscar datasets.
-   Filtrar por institución, categoría y palabras clave.

### B2. Exploración

-   Vista previa.
-   Metadata.
-   Estadísticas básicas.

### B3. Query Builder

-   Constructor visual de SoQL.
-   Exportar consultas.

### B4. Perfil de Calidad

-   Nulos.
-   Duplicados.
-   Cobertura.
-   Distribución de columnas.

### B5. Visualizaciones rápidas

-   Tabla.
-   Series.
-   Mapas.
-   Histogramas.

### B6. Exportación

-   JSON
-   CSV
-   GeoJSON
-   Parquet
-   SQLite

### B7. Programación ETL

-   Refresh diario.
-   Semanal.
-   Mensual.

------------------------------------------------------------------------

## C. Search

-   Índice Full Text.
-   Índice vectorial.
-   Búsqueda híbrida.
-   Facetas.
-   Autocompletado.

------------------------------------------------------------------------

## D. Entity Resolution

-   Matching por NIT.
-   Matching por nombres.
-   Matching geográfico.
-   Alias.
-   Reglas de deduplicación.

------------------------------------------------------------------------

## E. Calidad del dato

-   Data Quality Score.
-   Validación de geometrías.
-   Validación de rangos.
-   Completitud.
-   Freshness Score.

------------------------------------------------------------------------

## F. Freshness

-   last_checked
-   last_updated
-   hash
-   etag
-   frecuencia esperada
-   detección de cambios

------------------------------------------------------------------------

## G. Lineage

Cada registro debe conservar: - fuente - versión - conector -
transformaciones - hash - fecha de ingesta

------------------------------------------------------------------------

## H. Observabilidad

-   Métricas de ETL.
-   Tiempo por conector.
-   Filas procesadas.
-   Errores.
-   Alertas.
-   Dashboard.

------------------------------------------------------------------------

## I. Motor de Conectores

Generalizar: - C1 Socrata - C2 ArcGIS - C3 Descargas - C4 Scraping

Todos bajo la misma interfaz.

------------------------------------------------------------------------

## J. Roadmap sugerido

1.  Metadata Registry
2.  Connector Engine
3.  DIVIPOLA
4.  Normalización
5.  Entity Resolution
6.  Search Index
7.  Knowledge Graph
8.  Dashboards
9.  IA / RAG
10. Agentes de investigación

## Resultado esperado

Evolucionar desde un catálogo ETL hacia una plataforma OSINT con: -
ingestión escalable - entidades unificadas - búsqueda híbrida -
conocimiento relacional - soporte para IA y consultas complejas.
