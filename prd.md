Perfecto: asumo el rol de **Ingeniero de Requisitos** y te entrego un **PRD híbrido + SRS vitaminado** orientado a que tu equipo técnico pueda implementar el sistema. El objetivo es claro:

> **Construir un frontend HTML lo más simple posible, que permita consultar y visualizar la mayor cantidad de datos viales posibles desde los endpoints públicos de portales (datos.gov.co, INVIAS, ANI, ICDE, etc.), priorizando rendimiento (búsquedas en pocos milisegundos) y una experiencia de usuario tipo dashboard/mapa interactivo.**

***

## 1. Requisito padre (objetivo del sistema)

### Nombre del sistema
**“Sistema de Información Vial Unificada – FRONT” (SIVU‑Front)**

### Objetivo general
Proporcionar un **frontend estático en HTML puro** (CSS/JS) que permita al usuario **consultar, filtrar y visualizar datos viales de Colombia** a través de una API intermedia, obteniendo la **máxima cantidad de información posible** de los portales abiertos (datos.gov.co, INVIAS, ANI, ICDE, etc.) con **bajas latencias de consulta (pocos ms)** y una experiencia de usuario tipo mapa interactivo + dashboard.

### Alcance del FRONT
- Frontend construido **sin frameworks pesados** (solo HTML/CSS/JS inicialmente).  
- Funciona como **capa de visualización**:  
  - Llama a una API propia (tu backend) que agrega datos de portales externos.  
  - No se encarga de ETL, mapeo ni integración de datos, solo **consulta y visualización**.  
- Debe ser **rápido, ligero y usable** incluso en dispositivos medianos.  

***

## 2. Requisitos funcionales (PRD)

### RF1 – Consulta de datos viales por región

- El usuario debe poder:  
  - Seleccionar **departamento, municipio o región** (via dropdown o mapa).  
  - Ver un listado o mapa de **tramos viales** asociados a esa región.  
- El frontend debe:  
  - Llamar al endpoint `GET /vias/region?depto=VALLE&limit=1000` y renderizar resultados en **mapa + tabla**.  
  - Mostrar geometrías mediante **Leaflet / MapLibre** o similar, usando **GeoJSON ligero**.  

### RF2 – Filtros por atributos de vías

- El usuario debe poder filtrar:  
  - Tipo de vía (nacional, departamental, municipal, rural).  
  - Estado (bueno, regular, malo).  
  - Pavimentación (pavimentada / no pavimentada).  
  - Categoría de tráfico o peaje (si aplica).  
- El frontend debe:  
  - Enviar filtros vía parámetros al endpoint, ej. `GET /vias/filter?tipo=NACIONAL&estado=BUENO`.  
  - Permitir combinar filtros y ver resultados en **menos de 500 ms** (métrica de UX).  

### RF3 – Visualización en mapa interactivo

- El frontend debe mostrar:  
  - Un **mapa central** con capas de tramos viales coloreados por:  
    - Estado (ej. verde, amarillo, rojo).  
    - Tipo de vía (grosor de línea o color).  
  - Al hacer clic en un tramo, mostrar un **popup** con:  
    - Nombre, código, longitud, tipo, estado.  
    - Enlaces de referencia a portales oficiales.  
- Debe soportar:  
  - Zoom/pan fluido.  
  - Carga **por bounding box** (`bbox=left,bottom,right,top`) para evitar sobrecargar el navegador.  

### RF4 – Tabla y listado de datos

- El usuario debe poder:  
  - Ver tramos en **tabla paginada** (10–50 por página).  
  - Ordenar columnas: depto, municipio, longitud, estado, tipo.  
  - Exportar vista actual (CSV/JSON).  
- El frontend debe:  
  - Usar endpoints tipo `GET /vias/region?format=table` o `GET /vias/region?format=csv` (tu backend puede serializar).  

### RF5 – Búsqueda por palabra clave y código vial

- El usuario debe poder:  
  - Buscar por: **nombre de tramo, código vial, municipio, carretera**.  
  - Ver coincidencias en tiempo casi real (auto‑completado).  
- El frontend debe:  
  - Usar endpoint `GET /vias/search?q=Panamericana&limit=10`.  
  - Mostrar resultados en **dropdown sugerido** y permitir “zoom a tramo” al hacer clic.  

### RF6 – Métricas y KPIs visuales (dashboard)

- El frontend debe mostrar:  
  - **Tarjetas de KPI** por región:  
    - Total km vías.  
    - % vías en buen estado.  
    - % pavimentadas.  
  - Gráficos simples (Chart.js o similar):  
    - Barras por estado vial por departamento.  
    - Pastel por tipo de vía.  
- Estos gráficos se alimentan de endpoints API tipo:  
  - `GET /kpi/vias/region?depto=VALLE`  
  - `GET /kpi/vias/overall`  

### RF7 – Rendimiento y carga de datos

- El frontend debe:  
  - Mostrar **spinner/indicador** solo si la respuesta dura > 500 ms.  
  - Limitar la carga inicial de datos (ej. solo 500 tramos visibles en mapa).  
  - Usar **paginación** y **bbox** para mapas:  
    - No cargar todo Colombia de una sola vez.  
- El backend (no parte del FRONT) debe:  
  - Responder a consultas comunes en **< 300–500 ms** (SRS detallado aparte).  

***

## 3. Requisitos no funcionales (SRS ligero)

### RNF1 – Rendimiento

- **Objetivo de latencia**:  
  - Consultas estándar (filtros por región y estado) deben responder en **≤ 500 ms**.  [youtube](https://www.youtube.com/watch?v=3A99vFIGyus)  
- **Frontend ligero**:  
  - Bundle JS total < 500 KB.  
  - Mapa se carga en **≤ 1.5 s** en buena red móvil.  

### RNF2 – Escalabilidad y sostenibilidad

- El frontend debe ser **estático** (HTML + recursos en CDN) para tolerar alto tráfico.  
- El backend puede escalar:  
  - Uso de **caché** (Redis, CloudFront) para datos de mapas pesados.  

### RNF3 – Compatibilidad y accesibilidad

- Soportar:  
  - Navegadores actuales (Chrome, Edge, Firefox, Safari).  
  - Pantallas móviles (responsive).  
- Asegurar:  
  - Contraste mínimo de texto.  
  - Leyendas de mapas legibles.  

### RNF4 – Integración con portales oficiales

- El frontend debe:  
  - Incluir, en vistas de detalle, **enlaces hacia** INVIAS, datos.gov.co, ANI, ICDE, etc., como fuente oficial.  [hermes2.invias.gov](https://hermes2.invias.gov.co)  

***

## 4. Arquitectura de alto nivel (vista para el equipo técnico)

- **Cliente (Frontend)**  
  - HTML5 + CSS3 + JS puro (opcionalmente Leaflet/MapLibre, Chart.js).  
  - Solo interpone llamadas a tu API vial unificada (no a los portales directamente).  

- **API vial unificada (Backend)**  
  - Endpoints ej.:  
    - `GET /vias/region`  
    - `GET /vias/filter`  
    - `GET /vias/search`  
    - `GET /kpi/vias/...`  
  - Internamente:  
    - Consume datos.gov.co, INVIAS, ANI, ICDE, etc.  
    - Almacena en **PostgreSQL + PostGIS** para consultas rápidas.  
    - Usa índices espaciales, caché y serialización eficiente (GeoJSON ligero).  [avantgeo](https://avantgeo.com/aplicaciones-gis-fastapi-backend/)  

- **Datos fuente**  
  - Red vial datos.gov.co, INVIAS Open Data, ANI, ICDE, y otros que quieras agregar.  [inviasopendata-invias.opendata.arcgis](https://inviasopendata-invias.opendata.arcgis.com)  

***

## 5. Guía de UX/Interfaz (para que el equipo no se “pierda”)

- **Home / Landing**  
  - Mapa grande central + filtros laterales izquierdos + paneles de KPI derechos.  

- **Flujo de consulta típico**  
  1. Usuario elige **departamento**.  
  2. Mapa se centra y muestra tramos coloreados por estado.  
  3. Usuario aplica **filtro de estado / tipo**.  
  4. Usuario hace clic en un tramo → popup con detalles + enlaces oficiales.  
  5. Opcionalmente, descarga CSV con la vista actual.  

- **Prioridades de rendimiento**  
  - 1. Paginar / limitar datos por bbox.  
  - 2. Cache del backend (objetivo: evitar recalcular KPIs en cada request).  
  - 3. Uso de **vector tiles** (en el futuro) para mapas de alto detalle.  [avantgeo](https://avantgeo.com/aplicaciones-gis-fastapi-backend/)  

***

## 6. Indicadores de éxito (KPIs de producto)

Para medir si el sistema cumple el objetivo:

- **Latencia promedio** de respuesta de las consultas principales < 500 ms.  
- **% de consultas** que se responden con datos completos (no errores 5xx).  
- **Nº de tramos** que se pueden ver en mapa sin caídas de rendimiento.  
- **Tiempo de carga inicial** de la vista mapa < 1.5 s.  

***

Si quieres, en el siguiente mensaje puedo:

- Detallar el **SRS técnico** (endpoints exactos, schemas de respuesta, ejemplos de GeoJSON).  
- Darte un **wireframe textual** para que el equipo de UX pueda dibujarlo.  

¿Quieres que lo estructuré ahora como un archivo Markdown tipo “PRD.md” listo para GitHub / Notion?