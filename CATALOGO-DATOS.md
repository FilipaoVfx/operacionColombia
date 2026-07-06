# Catálogo de Fuentes de Datos — Operación Colombia (OSINT)

> Catálogo formal de fuentes para la **fase de ingesta (ETL)**. Complementa el §7 del
> [README](README.md). Filosofía: recolectar la mayor cantidad de datos públicos posible,
> priorizando **APIs**, normalizando a un modelo único y **citando siempre la fuente**.
>
> **Fecha de investigación:** 2026-07-06 · **Método:** relevamiento de portales oficiales.

---

## 1. Taxonomía de acceso (4 tipos de conector)

Toda fuente cae en uno de 4 patrones. Construir **un conector por tipo** cubre N fuentes.

| Tipo | Descripción | Esfuerzo | Ejemplos |
|------|-------------|----------|----------|
| **C1 — SODA / Socrata** | API REST de `datos.gov.co`. SoQL (tipo SQL), paginación, filtros. **Prioritario.** | Bajo | SECOP, ANM, ANI, EVA, PIB, Víctimas |
| **C2 — ArcGIS REST / OGC (WFS/WMS)** | Servicios geoespaciales. GeoJSON/features por bbox. | Medio | INVIAS (hecho), ANM geo, IGAC, ANI feature services |
| **C3 — Descarga de archivo** | CSV/Excel/SHP publicados. Sin API; descarga + parseo periódico. | Medio | ANH (pozos), DIAN (comex), DANE |
| **C4 — Scrape / endpoint interno** | Portal sin API pública; hay que extraer del front o de su API interna. | Alto | MapaRegalías, Indepaz, ANH (gráficas PNG) |

### 1.1 Patrón C1 — SODA / Socrata (llave maestra)

Casi todo `datos.gov.co` es Socrata. Endpoint universal por dataset:

```
https://www.datos.gov.co/resource/{id}.json?$limit=50000&$offset=0
```

- **SoQL:** `$select`, `$where`, `$group`, `$order`, `$q` (texto libre), `$limit`, `$offset`.
- **Formatos:** `.json`, `.csv`, `.geojson` (datasets geográficos).
- **Auth:** sin key funciona; `$$app_token` sube el rate limit (registro gratis).
- **Ejemplo real** (contratos de un departamento, paginado):
  ```
  https://www.datos.gov.co/resource/jbjy-vk9h.json?departamento=VALLE%20DEL%20CAUCA&$limit=50000&$offset=0
  ```
- **Ingesta incremental:** filtrar por `$where=fecha_de_firma > 'YYYY-MM-DD'` para refresco.

**Un solo conector C1 (parametrizable por `id` + `$where`) alimenta la mayoría del catálogo.**

---

## 2. Catálogo por dominio

Prioridad de ingesta: **P0** hecho · **P1** siguiente (alto valor + fácil) · **P2** medio · **P3** backlog.

> Cada dominio trae: tabla de fuentes · **caso de uso por fuente** · **1 historia de usuario**
> con flujo end-to-end, anclada en la **fuente core** (⭐) del dominio.

### 2.1 Contratación pública
| Fuente | ID / endpoint | Conector | Granularidad | Prioridad |
|--------|---------------|----------|--------------|-----------|
| ⭐ SECOP II — Contratos Electrónicos | `jbjy-vk9h` | C1 | contrato | **P1** |
| SECOP II — Procesos de Contratación | `p6dx-8zbt` | C1 | proceso | P1 |
| Contratos SECOP II | `tb27-zmix` | C1 | contrato | P2 |
| SECOP Integrado (I + II) | `rpmr-utcd` | C1 | contrato | P2 |
| PROCESOS SECOP II | `isgz-hpk3` | C1 | proceso | P2 |

Fuente: ANCP — Colombia Compra Eficiente. **Volumen alto (millones de filas)** → revisar
storage (SQLite puede no escalar; ver Tareas fuera de scope).

**Casos de uso por fuente**
- **Contratos Electrónicos `jbjy-vk9h`** — rastrear a quién y cuánto contrata cada entidad; detectar concentración de proveedores.
- **Procesos `p6dx-8zbt`** — ver licitaciones abiertas/desiertas, modalidad y tiempos de adjudicación.
- **Contratos `tb27-zmix`** — vista alterna de contratos para validación cruzada de montos.
- **SECOP Integrado `rpmr-utcd`** — serie histórica I+II para tendencias multi-año de gasto.
- **PROCESOS `isgz-hpk3`** — pipeline de procesos para alertas de nuevas oportunidades/anomalías.

**Historia de usuario (core ⭐ `jbjy-vk9h`)**
> *Como analista anticorrupción, quiero ver todos los contratos de un municipio filtrados por
> proveedor y valor, para detectar concentración sospechosa de adjudicaciones.*

**Flujo**
1. Ingesta: conector **C1** baja `jbjy-vk9h` con `$where=departamento='...'`, paginado 50k.
2. Normaliza al modelo (entidad, proveedor+NIT, valor, fecha, objeto) + `fuente` + enlace oficial.
3. Usuario abre panel **Contratación**, filtra municipio + rango de valor.
4. KPI: total contratado, top-10 proveedores por monto, % de adjudicación directa.
5. Ve un proveedor con 60 % del monto → clic → lista de sus contratos → enlace a la ficha oficial SECOP.
6. Exporta CSV para el reporte.

### 2.2 Minería
| Fuente | ID / endpoint | Conector | Granularidad | Prioridad |
|--------|---------------|----------|--------------|-----------|
| ⭐ ANM — Títulos Mineros Anotaciones RMN | `si2v-pbq5` | C1 | título | **P1** |
| ANM — Volumen Explotación Minerales / Regalías | `r85m-vv6c` | C1 | mineral × municipio | **P1** |
| ANM — Catastro minero (capas geo) | `geo.anm.gov.co/webgis/services/ANM/ServiciosANM/MapServer/WFSServer` | C2 (WFS) | polígono título | P2 |

Geovisor ANM: 17+ capas (catastro, restitución, áreas petroleras, arqueología) cruzables.

**Casos de uso por fuente**
- **Títulos RMN `si2v-pbq5`** — saber quién tiene título minero, dónde, en qué estado y para qué mineral.
- **Volumen/Regalías `r85m-vv6c`** — cuánto se explota y qué regalía paga cada municipio por mineral.
- **Catastro geo (WFS)** — dibujar los polígonos de títulos y detectar solapamiento con áreas protegidas.

**Historia de usuario (core ⭐ `si2v-pbq5`)**
> *Como investigador ambiental, quiero mapear los títulos mineros vigentes de un municipio y
> cruzarlos con áreas protegidas, para identificar minería en zonas sensibles.*

**Flujo**
1. **C1** baja `si2v-pbq5` (titular, mineral, estado, municipio).
2. **C2** (WFS ANM) trae los polígonos geográficos de esos títulos.
3. Normaliza atributos + reproyecta geometría a WGS84.
4. Panel **Minería**: capa de títulos coloreada por estado; superpone capa IGAC de áreas protegidas.
5. Filtra municipio → ve títulos activos que intersectan una reserva.
6. Clic en título → titular + mineral + volumen (`r85m-vv6c`) + enlace al RMN oficial.

### 2.3 Hidrocarburos / petróleo
| Fuente | ID / endpoint | Conector | Granularidad | Prioridad |
|--------|---------------|----------|--------------|-----------|
| ⭐ ANH — Pozos con Declaración de Comercialidad | `anh.gov.co/documents/3700/BD_Pozos_ANH...xlsx` | C3 (Excel) | pozo | P2 |
| ANH — Producción (petróleo/gas, por campo/depto) | web (gráficas PNG) | C4 | campo/depto | P3 |
| ANH — Mapa de Tierras (áreas E&P) | ArcGIS (por confirmar endpoint) | C2 | bloque | P3 |
| SECOP-2 ANH (gasto de la entidad) | `jpvn-r535` | C1 | contrato | P3 |

**Fuente más débil del lote:** estadísticas como imágenes, no dato crudo. Alternativa fuerte
para producción por municipio = **MapaRegalías / SICODIS** (ver 2.8).

**Casos de uso por fuente**
- **Pozos comercialidad (Excel)** — inventario geolocalizado de pozos con descubrimiento comercial y su operador.
- **Producción PNG** — tendencia nacional de producción petróleo/gas (solo visual; baja utilidad de dato crudo).
- **Mapa de Tierras (ArcGIS)** — qué bloque E&P opera cada compañía por área.
- **SECOP-2 ANH `jpvn-r535`** — contratación y gasto de la propia ANH.

**Historia de usuario (core ⭐ Pozos Excel)**
> *Como analista energético, quiero un inventario geolocalizado de pozos con declaración de
> comercialidad, para ubicar la actividad petrolera por región.*

**Flujo**
1. **C3** descarga el Excel de pozos (tarea programada, refresco periódico).
2. Parser lee filas (pozo, operador, cuenca, coordenadas) → modelo unificado.
3. Geocodifica coordenadas a punto WGS84.
4. Panel **Hidrocarburos**: puntos de pozos sobre el mapa, color por operador.
5. Cruce con **MapaRegalías** (2.8) para producción/regalía por municipio.
6. Trazabilidad: `fuente = ANH Excel` + fecha de descarga (el dato no es API, se marca su origen).

### 2.4 Producción por departamento (macro)
| Fuente | ID / endpoint | Conector | Granularidad | Prioridad |
|--------|---------------|----------|--------------|-----------|
| ⭐ PIB Departamental con proyección | `kgyi-qc7j` | C1 | departamento × año | **P1** |
| DANE — Cuentas nacionales departamentales | `dane.gov.co` (archivos/microdatos) | C3 | departamento | P3 |

**Casos de uso por fuente**
- **PIB Departamental `kgyi-qc7j`** — comparar tamaño y estructura económica por departamento y año.
- **Cuentas departamentales DANE** — detalle sectorial (12 actividades CIIU) para desagregar el PIB.

**Historia de usuario (core ⭐ `kgyi-qc7j`)**
> *Como planeador regional, quiero comparar el PIB por departamento a lo largo del tiempo,
> para ver qué regiones crecen o se rezagan.*

**Flujo**
1. **C1** baja `kgyi-qc7j` (departamento, año, valor, proyección).
2. Normaliza + une con **DIVIPOLA** (código de departamento).
3. Panel **Producción**: coropleta (color = PIB) + serie temporal por departamento.
4. Usuario selecciona 3 departamentos → gráfico de líneas comparativo.
5. KPI: participación % en el PIB nacional, crecimiento interanual.
6. Habilita cruce: PIB vs contratación (2.1) vs regalías (2.8) por departamento.

### 2.5 Agro
| Fuente | ID / endpoint | Conector | Granularidad | Prioridad |
|--------|---------------|----------|--------------|-----------|
| ⭐ EVA 2019–2024 Base Agrícola | `uejq-wxrr` | C1 | municipio × cultivo × año | **P1** |
| EVA — Evaluaciones Agropecuarias Municipales | `2pnw-mmge` | C1 | municipio × cultivo | **P1** |
| Agronet — estadísticas | `agronet.gov.co` (descarga) | C3 | municipio | P3 |

Cubre área sembrada, producción (t), rendimiento e inventario pecuario. Líder: MinAgricultura/UPRA.

**Casos de uso por fuente**
- **EVA Base Agrícola `uejq-wxrr`** — serie histórica de área/producción/rendimiento por cultivo y municipio.
- **EVA Municipales `2pnw-mmge`** — oferta agropecuaria por municipio (corte más reciente).
- **Agronet** — estadísticas y precios complementarios del sector.

**Historia de usuario (core ⭐ `uejq-wxrr`)**
> *Como analista agro, quiero ver la producción y el rendimiento de un cultivo por municipio a
> lo largo de los años, para detectar zonas en expansión o en caída.*

**Flujo**
1. **C1** baja `uejq-wxrr` (municipio, cultivo, año, área, producción, rendimiento).
2. Normaliza + une **DIVIPOLA**.
3. Panel **Agro**: coropleta por producción del cultivo elegido; slider de año.
4. Usuario elige "café" + año → ve los municipios líderes en producción.
5. Serie temporal de rendimiento → detecta una caída sostenida → alerta.
6. Exporta CSV; cada fila enlaza a la ficha EVA de la fuente.

### 2.6 Concesiones e infraestructura de transporte
| Fuente | ID / endpoint | Conector | Granularidad | Prioridad |
|--------|---------------|----------|--------------|-----------|
| ⭐ Concesiones / Listado ANI | `b9m8-fgtx` | C1 | concesión | **P1** |
| Peajes Geográficos ANI | `v8jt-uu2u` | C1/C2 | peaje (punto) | P1 |
| Tráfico Vehicular ANI | `8yi9-t44c` | C1 | peaje × periodo | P2 |
| Carreteras Geográficas ANI | `crav-mnib` | C1/C2 | tramo (línea) | P2 |
| INVIAS — Red Vial (ArcGIS) | `hermes2.invias.gov.co/.../RedVial/MapServer/1` | C2 | tramo | **P0 (hecho)** |

**Casos de uso por fuente**
- **Concesiones `b9m8-fgtx`** — qué concesión opera qué corredor, con qué plazo y concesionario.
- **Peajes Geográficos `v8jt-uu2u`** — ubicación y tarifa de cada peaje.
- **Tráfico Vehicular `8yi9-t44c`** — flujo por peaje/periodo → estimar ingresos.
- **Carreteras Geográficas `crav-mnib`** — trazado geográfico de los corredores concesionados.
- **INVIAS Red Vial (hecho)** — red vial pública base para contrastar con lo concesionado.

**Historia de usuario (core ⭐ `b9m8-fgtx`)**
> *Como periodista de infraestructura, quiero ver las concesiones viales con sus peajes y
> tráfico, para estimar cuánto recauda cada corredor.*

**Flujo**
1. **C1** baja `b9m8-fgtx` (concesión, concesionario, corredor, plazo).
2. **C1/C2** baja peajes `v8jt-uu2u` + tráfico `8yi9-t44c`.
3. Une por concesión/corredor; lleva peajes y corredores al mapa.
4. Panel **Concesiones**: corredores (línea) + peajes (punto) con popup de tarifa/tráfico.
5. Usuario clic en corredor → concesionario + `tráfico × tarifa ≈ recaudo` estimado.
6. Cruza con INVIAS para distinguir red concesionada vs pública.

### 2.7 Conflicto / seguridad / zonas
| Fuente | ID / endpoint | Conector | Granularidad | Prioridad |
|--------|---------------|----------|--------------|-----------|
| ⭐ Cifras de Víctimas por Hechos (Nacional) | `wy34-4u9y` | C1 | hecho × territorio | **P1** |
| DatosPaz — RUV / visor geográfico | `datospaz.unidadvictimas.gov.co` | C4/C3 | municipio | P2 |
| Observatorio de Memoria y Conflicto (CNMH) | `micrositios.centrodememoriahistorica.gov.co/observatorio` | C3/C4 | hecho | P2 |
| Indepaz — líderes/masacres | `indepaz.org.co` | C4 (scrape) | evento | P3 |

⚠️ **Datos sensibles.** Víctimas = información delicada. Usar solo **agregados públicos**;
ver gobernanza en Tareas fuera de scope (PII).

**Casos de uso por fuente**
- **Cifras Víctimas `wy34-4u9y`** — magnitud de victimización por tipo de hecho y territorio (agregado).
- **DatosPaz RUV** — visor oficial de víctimas por municipio (Unidad de Víctimas).
- **Observatorio CNMH** — hechos históricos del conflicto para contexto de memoria.
- **Indepaz** — líderes sociales/masacres (verificar licencia **antes** de scrape).

**Historia de usuario (core ⭐ `wy34-4u9y`, solo agregados)**
> *Como analista de riesgo territorial, quiero ver la intensidad del conflicto por municipio y
> tipo de hecho, para priorizar zonas de atención — usando solo cifras agregadas.*

**Flujo**
1. **C1** baja `wy34-4u9y` (tipo de hecho, territorio, conteo agregado, periodo).
2. **Filtro de gobernanza:** descarta cualquier campo individualizable; solo se conserva el agregado.
3. Une **DIVIPOLA**.
4. Panel **Conflicto**: coropleta por nº de hechos; selector de tipo de hecho + año.
5. Ve municipios de alta victimización → cruza con títulos mineros (2.2) / regalías (2.8) para hipótesis.
6. Cada dato enlaza a la fuente oficial + disclaimer de sensibilidad.

### 2.8 Regalías minero-energéticas (producción por territorio)
| Fuente | ID / endpoint | Conector | Granularidad | Prioridad |
|--------|---------------|----------|--------------|-----------|
| ⭐ MapaRegalías (SGR) | `maparegalias.sgr.gov.co` | C4 (API interna) | municipio × recurso | P2 |
| SICODIS (DNP) | `sicodis.dnp.gov.co` | C4 | distribución territorial | P3 |
| MapaInversiones (DNP) | `mapainversiones.dnp.gov.co` | C4 | proyecto | P3 |

Mejor fuente para "qué mineral/hidrocarburo aporta cada municipio". Requiere cazar el
endpoint interno del front (XHR/JSON) — ver Tareas fuera de scope.

**Casos de uso por fuente**
- **MapaRegalías** — producción y regalías por municipio y recurso, y proyectos financiados.
- **SICODIS** — cómo se distribuyen los recursos del SGR/SGP por territorio.
- **MapaInversiones** — proyectos de inversión pública financiados (georreferenciados).

**Historia de usuario (core ⭐ MapaRegalías)**
> *Como veedor ciudadano, quiero saber cuántas regalías genera y recibe mi municipio y en qué
> proyectos se invierten, para vigilar el uso de esos recursos.*

**Flujo**
1. **C4:** inspeccionar el XHR del front de MapaRegalías → hallar su API JSON interna (tarea fuera de scope #9).
2. El conector consume ese JSON (producción, regalía, proyecto por municipio).
3. Normaliza + une **DIVIPOLA**.
4. Panel **Regalías**: coropleta de regalía recibida; clic municipio → recurso (petróleo/carbón/oro) + proyectos.
5. Cruza con producción ANH/ANM para verificar coherencia producción ↔ regalía.
6. Enlace a MapaRegalías/SICODIS oficial en cada registro.

### 2.9 Movimiento económico
| Fuente | ID / endpoint | Conector | Granularidad | Prioridad |
|--------|---------------|----------|--------------|-----------|
| ⭐ Banco de la República — series económicas | `suameca.banrep.gov.co/estadisticas-economicas` | C3/C4 | serie temporal | P2 |
| DIAN — comercio exterior (impo/expo) | `dian.gov.co/dian/cifras` | C3 | declaración/agregado | P2 |
| MINCIT — BACEX | `mincit.gov.co/.../bacex` | C3 | comex | P3 |
| DANE — comercio internacional | `dane.gov.co` / microdatos | C3 | agregado | P3 |

TRM, inflación, tasas, balanza. Banrep publica descarga; API programática limitada.

**Casos de uso por fuente**
- **Banrep series** — TRM, inflación, tasas: contexto macro para todos los dominios.
- **DIAN comex** — importaciones/exportaciones por producto y país.
- **MINCIT BACEX** — comercio exterior procesado y agregado.
- **DANE comercio internacional** — cifras oficiales certificadas de comex.

**Historia de usuario (core ⭐ Banrep series)**
> *Como analista económico, quiero superponer indicadores macro (TRM, inflación) sobre los demás
> dominios, para contextualizar la actividad de recursos en el tiempo.*

**Flujo**
1. **C3/C4** descarga las series de Banrep (fecha, indicador, valor).
2. Normaliza a formato de serie temporal estándar.
3. Panel **Economía**: gráfico multi-serie con selector de indicador.
4. Usuario superpone TRM sobre las exportaciones mineras (cruce con 2.2/2.8).
5. Detecta correlación (ej. alza del dólar ↔ alza de exportación de carbón).
6. Trazabilidad: `fuente = Banrep` + fecha de corte de la serie.

### 2.10 Territorio / catastro (capa de soporte / llaves de cruce)
| Fuente | ID / endpoint | Conector | Granularidad | Prioridad |
|--------|---------------|----------|--------------|-----------|
| ⭐ DANE — División político-administrativa (DIVIPOLA) | `dane.gov.co` / `datos.gov.co` | C1/C3 | municipio/depto | **P1** |
| IGAC — geoservicios (WFS/WMS) | `geoportal.igac.gov.co/contenido/geoservicios` | C2 | predio/límite | P2 |
| Colombia en Mapas | `colombiaenmapas.gov.co` | C2 | multi-capa | P3 |

**DIVIPOLA es prioritaria como llave de cruce** (código DANE municipio/depto une todos los dominios).

**Casos de uso por fuente**
- **DIVIPOLA DANE** — tabla maestra de código municipio/depto: la llave que une TODOS los dominios.
- **IGAC geoservicios** — límites, predios y cartografía base para el mapa.
- **Colombia en Mapas** — capas multitemáticas nacionales de soporte.

**Historia de usuario (core ⭐ DIVIPOLA)**
> *Como arquitecto de datos, quiero una tabla maestra DIVIPOLA para unir todos los dominios por
> código de municipio, para que cualquier dato se pueda cruzar geográficamente.*

**Flujo**
1. **C1/C3** baja DIVIPOLA (código depto, código municipio, nombres oficiales).
2. Se carga como tabla de referencia central del sistema.
3. Cada ingesta de dominio (contratación, agro, minería…) mapea su municipio/depto → código DIVIPOLA.
4. Panel: un **selector único de territorio** filtra TODOS los dominios a la vez.
5. Usuario elige un municipio → ve contratos + cultivos + títulos + regalías + conflicto juntos.
6. Sin DIVIPOLA no hay cruce inter-dominio: es el pegamento de la plataforma.

---

## 3. Estrategia de ingesta (orden recomendado)

1. **Conector C1 (SODA) genérico y parametrizable.** Desbloquea de un golpe: SECOP, ANM,
   ANI, EVA, PIB, Víctimas. Máximo valor / mínimo esfuerzo.
2. **Tabla maestra DIVIPOLA** (código DANE municipio/depto) como llave de cruce.
3. **Reusar conector C2 (ArcGIS)** ya probado en INVIAS → ANI geo, ANM WFS, IGAC.
4. **C3 (archivos)** para ANH, DIAN, Banrep, DANE: descarga programada + parser.
5. **C4 (scrape/endpoint interno)** al final: MapaRegalías, Indepaz. Mayor fragilidad.

### 3.1 Modelo unificado — campos de trazabilidad obligatorios
Todo registro, sin importar dominio, carga:
`fuente` · `fuente_url` (enlace oficial) · `fecha_ingesta` · `fecha_actualizacion_fuente` ·
`id_fuente` (id original) · `dominio` · `extra` (JSON con atributos propios sin descartar).

---

## 4. Resumen de cobertura

| Dominio pedido | ¿Cubierto? | Mejor acceso | Prioridad |
|----------------|-----------|--------------|-----------|
| Contrataciones | ✅ | C1 SODA | P1 |
| Yacimientos petróleo | ⚠️ parcial | C3/C4 (débil) → usar MapaRegalías | P2 |
| Minería | ✅ | C1 + C2 WFS | P1 |
| Producción por departamentos | ✅ | C1 SODA | P1 |
| Agro | ✅ | C1 SODA | P1 |
| Movimiento economía | ⚠️ | C3 descarga | P2 |
| Concesiones | ✅ | C1 SODA | P1 |
| Conflicto por zonas | ✅ | C1 + C3/C4 | P1/P2 |

---

## 5. Tareas FUERA DE SCOPE (backlog previo a la fase de ingesta masiva)

No forman parte de "escribir el conector", pero **bloquean o condicionan** la fase siguiente.
Priorizadas.

### Bloqueantes (resolver antes de ingesta masiva)
1. **Registrar `app_token` en datos.gov.co.** Sin él, el rate limit de SODA frena la ingesta
   masiva (SECOP es enorme). Gratis. → *habilita todo C1.*
2. **Auditoría legal / licencia por fuente.** Verificar términos de uso y licencia de datos
   abiertos de cada portal. **Crítico para C4 (scrape):** Indepaz y portales privados pueden
   prohibir scraping. No ingerir sin luz verde.
3. **Gobernanza de datos sensibles (PII).** Víctimas del conflicto = información delicada.
   Definir política: solo agregados, nada individualizable. Documentar antes de tocar `wy34-4u9y`
   y DatosPaz.
4. **Decisión de almacenamiento.** SECOP + comex = millones de filas. Validar si SQLite del
   piloto aguanta o si el dominio pesado va a Postgres/columnar. Dimensionar antes de bajar todo.

### Habilitadores de cruce (calidad del dato)
5. **Tabla maestra DIVIPOLA** (código DANE municipio/depto) + tabla de departamentos. Llave
   canónica para unir todos los dominios geográficamente.
6. **Resolución de entidades (entity resolution).** Unir por NIT (entidades/proveedores),
   por código vial, por nombre normalizado (ANI↔INVIAS). Diseñar reglas de match aproximado.
7. **Normalización de sistema de referencia geográfico.** INVIAS nativo en wkid 9377 (metros);
   resto en 4326. Unificar a WGS84 en ingesta.
8. **Deduplicación SECOP I vs II vs Integrado.** Los tres datasets se solapan. Definir fuente
   canónica y regla de dedupe para no triplicar contratos.

### Operación / sostenibilidad
9. **Cazar endpoints internos** de MapaRegalías / SICODIS / DatosPaz (inspeccionar XHR del
   front) para pasar de C4 (scrape frágil) a C3/C1 (JSON estable). Investigación técnica dedicada.
10. **Confirmar ArcGIS de ANH "Mapa de Tierras"** (bloques E&P) — buscar el MapServer REST real.
11. **Programación de refresco (scheduling)** por fuente según su periodicidad (SECOP diario,
    EVA semestral, PIB anual). Infra de cron + detección de cambios.
12. **Detección de drift de esquema.** Las fuentes cambian columnas sin avisar; validación
    automática de esquema en cada corrida de ingesta.
13. **Framework de calidad del dato.** Reglas de validación (rangos, nulos, geometrías válidas)
    + reporte de linaje por corrida.

---

*Documento vivo. Ver [README.md](README.md) (visión, OKRs), `srs.md` (detalle técnico piloto vial).*
