A continuación tienes un **SRS enfocado en datos de calidad vial** que puedes entregar a tu equipo técnico: cubre **todos los portales, URLs y pasos de conexión/consulta** que ya hemos identificado, pensados para que tu backend pueda recolectar y exponer datos vía tu propia API y que el frontend HTML los consuma de forma rápida.

***

## **SRS – Sistema de Información Vial Unificada (SIVU)**  
### **Objetivo SRS**  
- Describir cómo conectar y consultar datos viales de alta calidad de todos los portales oficiales relevantes.  
- Definir esquemas de consulta, formatos y endpoints de consumo (sin obligar al frontend a hablar directamente con ellos).

***

## 1. Fuentes de datos y URLs

### 1.1 Datos abiertos nacionales – Red vial (datos.gov.co)

- **Portal principal**:  
  - `https://www.datos.gov.co`  
  - API SODA (Socrata) para conjuntos de datos vía REST.  [datos.gov](https://www.datos.gov.co)  

- **Conjunto de "Red Vial Nacional" (INVIAS)**  
  - ID del dataset: `cn9e-d2hx` (Red Vial INVIAS).  [datos.gov](https://www.datos.gov.co/api/v3/views/cn9e-d2hx/export.csv?accessType=DOWNLOAD&app_token=bHWsGtRFRP9x8Hl8lYivqM1hQ)  
  - **URLs de consulta (endpoint SODA)**  
    - `https://www.datos.gov.co/api/v3/views/cn9e-d2hx/rows.csv?accessType=DOWNLOAD` (CSV completo).  [datos.gov](https://www.datos.gov.co/api/v3/views/cn9e-d2hx/export.csv?accessType=DOWNLOAD&app_token=bHWsGtRFRP9x8Hl8lYivqM1hQ)  
    - `https://www.datos.gov.co/api/views/cn9e-d2hx/rows.csv` (alternativa directa).  [datos.gov](https://www.datos.gov.co/resource/cn9e-d2hx.csv)  
    - **JSON (API REST)**:  
      - `https://www.datos.gov.co/api/v3/views/cn9e-d2hx/query.json` (con filtros via `q=` y `where=`).  [youtube](https://www.youtube.com/watch?v=zy52XgnW2hQ)  

- **Uso en el backend**  
  - Descargar periódicamente CSV/JSON.  
  - ETL:  
    - Normalizar columnas (código vial, departamento, municipio, tipo, estado, pavimentación, longitud).  
    - Guardar en tabla `red_vial_invia` con geometría WKT/GeoJSON.  

***

### 1.2 Instituto Nacional de Vías (INVIAS) – Open Data / ArcGIS

- **Portal de datos abiertos de INVIAS**  
  - `https://hermes2.invias.gov.co` (Sistema de Información Vial).  [hermes2.invias.gov](https://hermes2.invias.gov.co)  
  - `https://inviasopendata-invias.opendata.arcgis.com` (portal ArcGIS open data).  [inviasopendata-invias.opendata.arcgis](https://inviasopendata-invias.opendata.arcgis.com)  

- **Servicios ArcGIS REST (geoespaciales)**  
  - Mapa de carreteras – Red Vial (INVIAS):  
    - `https://hermes2.invias.gov.co/server/rest/services/MapaCarreteras/RedVial/MapServer/0` (capa de tramos vía).  [hermes2.invias.gov](https://hermes2.invias.gov.co/server/rest/services/MapaCarreteras/RedVial/MapServer/info/iteminfo)  
    - `https://hermes2.invias.gov.co/arcgis/rest/services/OpenData/ServiciosOpenData/MapServer` (OpenData Genérico).  [hermes.invias.gov](https://hermes.invias.gov.co/arcgis/rest/services/OpenData/ServiciosOpenData/MapServer?f=jsapi)  

- **Forma de consulta (REST + GeoJSON)**  
  - Endpoint de capa:  
    - `.../RedVial/MapServer/0/query`  
  - Parámetros comunes:  
    - `where=1=1`  
    - `returnGeometry=true`  
    - `outSR=4326`  
    - `f=json` o `f=geojson` (si soportado).  [hermes2.invias.gov](https://hermes2.invias.gov.co/server/rest/services/MapaCarreteras/RedVial/MapServer/info/iteminfo)  

- **Uso en el backend**  
  - Script Python que:  
    - Hace GET a `/query` con `where=1=1` y `outSR=4326`.  
    - Extrae `geometry` en GeoJSON y lo almacena como `geom` en PostGIS.  
  - Normalizar atributos:  
    - `tipo_via`, `estado`, `nombre_tramo`, `codigo`, `longitud`, `departamento`, `municipio`.  

***

### 1.3 ANI – Concesiones y tráfico (datos abiertos)

- **Portal de datos abiertos ANI**  
  - `https://www.ani.gov.co/basic-page/indices-de-transparencia-21793` (índices de transparencia y datos).  [ani.gov](https://www.ani.gov.co/basic-page/indices-de-transparencia-21793)  
  - Conjuntos de datos:  
    - Listado de concesiones, tráfico vehicular, tarifas de peajes, recaudo.  [ani.gov](https://www.ani.gov.co/basic-page/indices-de-transparencia-21793)  

- **URLs típicas de descarga**  
  - Ejemplo (estructura genérica del portal ANI):  
    - `https://www.ani.gov.co/datos-abiertos-[carpeta]/[archivo].csv` (o `.xlsx`).  [ani.gov](https://www.ani.gov.co/basic-page/indices-de-transparencia-21793)  

- **Uso en el backend**  
  - Script de descarga periódica (cron) de archivos CSV/Excel.  
  - Transformación:  
    - Relacionar `concesión` con `tramo vial` (vía nombres de carreteras o códigos).  
    - Guardar en `vias_concesionadas` (tipo vía, tráfico promedio, peajes, recaudo anual).  

***

### 1.4 ICDE – Datos abiertos geoespaciales (transporte)

- **Portal de datos abiertos ICDE**  
  - `https://datos.icde.gov.co`  [datos.icde.gov](https://datos.icde.gov.co)  
  - Búsqueda por etiqueta `transporte`.  [datos.icde.gov](https://datos.icde.gov.co/search?tags=transporte)  

- **Ejemplo de conjunto relevante**  
  - Filtro de búsqueda: `tags=transporte`.  [datos.icde.gov](https://datos.icde.gov.co/search?tags=transporte)  
  - Capas de red vial primaria/secundaria, infraestructura vial.  [icde.gov](https://www.icde.gov.co)  

- **Forma de consulta**  
  - Descarga directa de Shapefile/GeoJSON/CSV desde el portal (botón de descarga).  [icde.gov](https://www.icde.gov.co/comunicaciones/noticias/conoce-el-servicio-de-descarga-de-datos-abiertos-de-la-icde)  
  - Alternativa: servicios WMS/WFS vía `https://www.icde.gov.co` (gestión de datos geoespaciales – GECO).  [icde.gov](https://www.icde.gov.co)  

- **Uso en el backend**  
  - Script que:  
    - Descarga GeoJSON/Shapefile de ICDE por capa (vía URL directa o CSV).  
    - Carga con `ogr2ogr` o Python (GeoPandas) a PostGIS en `red_vial_icde`.  
  - Cruce con `red_vial_invia` usando `ST_Intersects` o match por nombre de tramo.  

***

### 1.5 Datos abiertos Bogotá – Red vial POT

- **Dataset de red vial Bogotá (POT)**  
  - `https://datosabiertos.bogota.gov.co/en/dataset/red-infraestructura-vial-bogota-d-c`  [datosabiertos.bogota.gov](https://datosabiertos.bogota.gov.co/en/dataset/red-infraestructura-vial-bogota-d-c)  
  - Conjunto de datos de la **infraestructura vial del POT de Bogotá**.  

- **URL de descarga**  
  - Enlace de datos geográficos (Shapefile/GeoJSON/CSV) proporcionado en el dataset.  [datosabiertos.bogota.gov](https://datosabiertos.bogota.gov.co/en/dataset/red-infraestructura-vial-bogota-d-c)  

- **Uso en el backend**  
  - Script de carga específica para Bogotá:  
    - Guardar en `vias_bogota` (con todos sus atributos del diccionario de datos).  
  - Relacionar `vias_bogota` con `red_vial_invia` si hay coincidencia de tramos.  

***

### 1.6 Ministerio de Transporte – Datos abiertos generales

- **Sección de datos abiertos Ministerio de Transporte**  
  - `https://www.mintransporte.gov.co/publicaciones/11903/datos-abiertos/`  [mintransporte.gov](https://mintransporte.gov.co/publicaciones/11903/datos-abiertos/)  
  - Recomienda el uso del **catálogo nacional de datos abiertos (datos.gov.co)** como fuente principal.  [mintransporte.gov](https://mintransporte.gov.co/publicaciones/11903/datos-abiertos/)  

- **Implicación técnica**  
  - No necesitas llamar directamente a MinTransporte para la mayoría de datos vial; sí usar `datos.gov.co` + INVIAS + ANI + ICDE.  [datos.gov](https://www.datos.gov.co)  

***

## 2. Procedimiento técnico de conexión y consulta (paso a paso)

### Paso 1 – Definir las fuentes que usarás

- **Fuentes de datos viales centrales**:  
  - `datos.gov.co` (red vial INVIAS: `cn9e-d2hx`).  [datos.gov](https://www.datos.gov.co)  
  - INVIAS Open Data (ArcGIS REST / JSON).  [hermes2.invias.gov](https://hermes2.invias.gov.co)  
  - ANI (concesiones y tráfico).  [ani.gov](https://www.ani.gov.co/basic-page/indices-de-transparencia-21793)  
  - ICDE (red vial primaria/secundaria).  [datos.icde.gov](https://datos.icde.gov.co)  
  - POT Bogotá (opcional, si quieres profundizar en Bogotá).  [datosabiertos.bogota.gov](https://datosabiertos.bogota.gov.co/en/dataset/red-infraestructura-vial-bogota-d-c)  

***

### Paso 2 – Estructura de datos vial unificada (PostGIS)

Creamos en tu base una tabla de referencia:

```sql
CREATE TABLE vias_unificadas (
    id_vial SERIAL PRIMARY KEY,
    codigo_vial TEXT,              -- código vial canónico (ej. desde INVIAS o datos.gov.co)
    nombre_tramo TEXT,
    tipo_vial TEXT,                -- nacional, departamental, municipal, rural
    estado_vial TEXT,              -- bueno, regular, malo, etc.
    pavimentada BOOLEAN,
    longitud_km NUMERIC(10,2),
    geom GEOGRAPHY(MULTILINESTRING, 4326),  -- geometría vial
    fuente TEXT,                   -- ej. datos.gov.co, invias_arcgis, ani, icde, pot_bogota
    fecha_actualizacion TIMESTAMP,
    extra_attributes JSONB          -- atributos adicionales específicos de cada fuente
);
```

***

### Paso 3 – Scripts de ingesta (ETL)

Para cada fuente:

#### a) datos.gov.co – Red Vial INVIAS

- **Script**:  
  - Descargar CSV/JSON vía:  
    - `https://www.datos.gov.co/api/v3/views/cn9e-d2hx/query.json?limit=1000000`  
  - Extraer campos relevantes:  
    - `nombre`, `tipo`, `estado`, `pavimentacion`, `longitud`, `departamento`, `municipio`, `geo_shape` (GeoJSON/WKT).  
- **ETL**:  
  - Normalizar `tipo` y `estado` a categorías comunes.  
  - Convertir `geo_shape` a `MULTILINESTRING` y cargar en `vias_unificadas` con `fuente = 'datos.gov.co'`.

***

#### b) INVIAS ArcGIS REST (Red Vial)

- **Script**:  
  - Hacer GET a:  
    - `https://hermes2.invias.gov.co/server/rest/services/MapaCarreteras/RedVial/MapServer/0/query`  
    - Parámetros: `where=1=1&returnGeometry=true&outSR=4326&f=json`.  [hermes2.invias.gov](https://hermes2.invias.gov.co/server/rest/services/MapaCarreteras/RedVial/MapServer/info/iteminfo)  
- **ETL**:  
  - Iterar por `features` y extraer:  
    - `attributes` (nombre, tipo, estado, código, etc.).  
    - `geometry` (Array de puntos → GeoJSON LineString).  
  - Normalizar y guardar en `vias_unificadas` con `fuente = 'invias_arcgis'`.

***

#### c) ANI – Tráfico y concesiones

- **Script**:  
  - Descargar CSV/Excel de ANI (vía URLs de datos abiertos ANI).  [ani.gov](https://www.ani.gov.co/basic-page/indices-de-transparencia-21793)  
- **ETL**:  
  - Realizar `JOIN` entre nombres de carreteras/vías y `vias_unificadas.nombre_tramo`.  
  - Guardar atributos de tráfico, peajes, recaudo en `vias_unificadas.extra_attributes`.

***

#### d) ICDE – Red vial vía datos abiertos

- **Script**:  
  - Desde `https://datos.icde.gov.co` con `tags=transporte`, descarga Shapefile/GeoJSON.  [datos.icde.gov](https://datos.icde.gov.co/search?tags=transporte)  
- **ETL**:  
  - Usar GeoPandas/ogr2ogr para cargar en PostGIS.  
  - Cruce vía `ST_Intersects` o por nombre de tramo.  
  - Guardar en `vias_unificadas` con `fuente = 'icde'`.

***

#### e) POT Bogotá – Red vial Bogotá

- **Script**:  
  - Descargar dataset de red vial Bogotá desde `datosabiertos.bogota.gov.co`.  [datosabiertos.bogota.gov](https://datosabiertos.bogota.gov.co/en/dataset/red-infraestructura-vial-bogota-d-c)  
- **ETL**:  
  - Cargar datos geográficos en `vias_bogota`.  
  - Relacionar con `vias_unificadas` por geometría o nombre de tramo.  

***

### Paso 4 – API vial propia (Backend FastAPI + PostGIS)

Diseñar los endpoints que tu frontend HTML consumirá (ejemplos):

- **`GET /vias/region?depto=VALLE&bbox=...`**  
  - Respuesta: GeoJSON de tramos viales en el departamento, con atributos.  
- **`GET /vias/filter?tipo=NACIONAL&estado=BUENO`**  
  - Retorna `vias_unificadas` filtradas.  
- **`GET /vias/search?q=Panamericana`**  
  - Auto‑completado.  
- **`GET /kpi/vias/region?depto=VALLE`**  
  - JSON con KPIs (km totales, % buen estado, % pavimentadas, etc.).  

Todos estos endpoints se basan en consultas sobre `vias_unificadas` en PostGIS, con índices espaciales y de atributos.  [avantgeo](https://avantgeo.com/aplicaciones-gis-fastapi-backend/)  

***

### Paso 5 – Frontend HTML / JS (conexión a tu API)

- **Objetivo**:  
  - Consumir solo endpoints de tu API vial propia, no de los portales.  
- **Ejemplo de conexión desde el frontend**:
  - `fetch('/vias/region?depto=VALLE&bbox=-76.5,3.5,-76.0,4.0')`  
  - Recibir GeoJSON ligero, renderizarlo en Leaflet/MapLibre.  

***

Si quieres, en el siguiente mensaje puedo darte:

- Un **archivo Markdown listo para GitHub** con el SRS completísimo (incluye URLs exactas, ejemplos de JSON/GeoJSON, y un ETL pseudocódigo).  
- O un **boilerplate FastAPI + PostGIS + ETL Python** para que tu equipo arranque en 10 minutos.