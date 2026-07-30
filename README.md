# Operación Colombia — Panel OSINT de Recursos

> **Working title.** Plataforma de inteligencia de fuentes abiertas (OSINT) para la
> **gestión y visualización de los recursos públicos de Colombia**: infraestructura,
> contratación, recursos naturales, presupuesto y territorio — agregados desde portales
> oficiales, normalizados en un modelo único y trazable, y expuestos en un panel de
> control tipo mapa + dashboard.

**Estado:** definición de problema · piloto vial (SIVU) funcional como módulo 1.
**Documento:** visión, objetivos, OKRs y catálogo de datos. *No* especifica tecnología
(ver `prd.md` / `srs.md` para el detalle técnico del piloto).

---

## 1. Contexto y problema

Colombia publica miles de conjuntos de datos abiertos (datos.gov.co, INVIAS, ANI, ICDE,
DANE, SECOP, ANM, ANH, catastro…), pero:

- **Están fragmentados.** Cada entidad tiene su portal, su formato (CSV, Shapefile,
  ArcGIS REST, SODA/Socrata, Excel) y su taxonomía. No hay una vista única.
- **Son difíciles de cruzar.** Un mismo recurso (una vía, un municipio, una concesión)
  aparece en varias fuentes sin llave común.
- **No son operativos.** Descargar un Shapefile de 200 MB no es "consultar en
  milisegundos". Falta una capa de servicio rápida sobre el dato crudo.
- **Se pierde la trazabilidad.** Al agregar datos, se olvida de *dónde* vino cada cifra.

**Necesidad:** una capa que **recolecte, normalice y unifique** fuentes abiertas
oficiales, y las entregue en un **panel visual, rápido y con la fuente siempre citada**
para análisis, gestión y toma de decisiones.

---

## 2. Visión

> Ser el **punto único de consulta visual** de los recursos públicos de Colombia a
> partir de datos abiertos oficiales — de "32 portales dispersos" a "un panel, una
> búsqueda, una fuente citada".

Principio rector **OSINT**: *solo fuentes públicas y legales, siempre con procedencia
verificable.* Cada dato mostrado enlaza a su origen oficial.

---

## 3. Objetivo general

Construir un **panel de control OSINT** que permita **consultar, filtrar, cruzar y
visualizar** (mapa interactivo + tablas + KPIs) la mayor cantidad posible de recursos
públicos de Colombia, con **baja latencia (pocos ms)** y **trazabilidad total de la
fuente**, escalando de forma incremental **dominio por dominio** (empezando por
infraestructura vial).

---

## 4. Objetivos específicos

1. **Unificar el dato.** Definir un modelo canónico que absorba fuentes heterogéneas
   (geoespaciales y tabulares) preservando los atributos originales.
2. **Servir rápido.** Exponer una API propia que responda consultas comunes por debajo
   del umbral de UX (< 500 ms), sin obligar al cliente a hablar con los portales.
3. **Visualizar para decidir.** Ofrecer mapa + tabla paginada + tarjetas KPI + gráficos,
   con filtros combinables y exportación (CSV/GeoJSON).
4. **Garantizar procedencia.** Cada registro carga su `fuente`, `fecha_actualizacion` y
   enlace oficial. Cero datos sin linaje.
5. **Escalar por verticales.** Convertir el piloto vial en un *framework* replicable para
   añadir nuevos dominios (contratación, minero-energético, presupuesto…) con esfuerzo
   marginal decreciente.
6. **Habilitar el cruce.** Permitir análisis inter-dominio (ej. vía × concesión × peaje ×
   municipio) mediante llaves geográficas y de código.

---

## 5. OKRs

Horizonte inicial: **Q3 2026 → Q1 2027**. Objetivos cualitativos; Key Results medibles.

### O1 — Consolidar una capa de datos abiertos unificada y trazable
| KR | Meta |
|----|------|
| KR1.1 | Integrar **≥ 5 fuentes oficiales** (datos.gov.co, INVIAS, ANI, ICDE, DANE) bajo esquema único. |
| KR1.2 | **100 %** de registros con `fuente` + `fecha_actualizacion` + enlace oficial. |
| KR1.3 | Cobertura **≥ 90 %** de los 32 departamentos en al menos un dominio. |
| KR1.4 | Pipeline de ingesta **reproducible** y refresco **≤ mensual** por fuente. |

### O2 — Entregar un panel usable tipo mapa + dashboard
| KR | Meta |
|----|------|
| KR2.1 | 3 vistas operativas: **mapa · tabla · KPIs** (logrado en dominio vial). |
| KR2.2 | Latencia de consulta **p95 < 500 ms**. |
| KR2.3 | Carga inicial del mapa **< 1.5 s** en red móvil buena. |
| KR2.4 | Exportación **CSV/GeoJSON** en el 100 % de las vistas de datos. |

### O3 — Escalar de 1 a N dominios OSINT (de vías a recursos)
| KR | Meta |
|----|------|
| KR3.1 | **2 dominios nuevos** con datos en panel (contratación pública + minero-energético) para Q1 2027. |
| KR3.2 | *Framework* de vertical documentado: añadir un dominio nuevo en **< 1 semana**. |
| KR3.3 | **≥ 3 cruces inter-dominio** demostrados (ej. vía × concesión × peaje). |

### O4 — Gobernanza y confianza del dato
| KR | Meta |
|----|------|
| KR4.1 | **100 %** de fuentes con licencia de datos abiertos verificada. |
| KR4.2 | Registro de **linaje** (origen → transformación → servicio) por dataset. |
| KR4.3 | **0** datos personales sensibles; solo información pública/agregada. |

---

## 6. Alcance

**Dentro (in-scope)**
- Agregación de **datos abiertos oficiales** (nacionales, territoriales, geoespaciales).
- Normalización a un modelo unificado + capa API de consulta.
- Panel de visualización: mapa, tabla, KPIs, búsqueda, exportación.
- Trazabilidad de fuente y refresco periódico.

**Fuera (out-of-scope, por ahora)**
- Datos personales, reservados o no públicos.
- Scraping de fuentes que prohíban su uso o sin licencia abierta.
- Edición/alteración del dato oficial (el panel *lee*, no es fuente de verdad).
- Predicción/ML avanzado (posible fase futura, no núcleo).

---

## 7. Catálogo de datos

> **Catálogo formal detallado** (fuentes, IDs de dataset, endpoints, tipo de conector y
> prioridad de ingesta) en **[CATALOGO-DATOS.md](CATALOGO-DATOS.md)**. Resumen abajo.

### 7.1 Dominios OSINT objetivo (recursos de Colombia)

| # | Dominio | Ejemplos de recurso | Fuentes candidatas | Prioridad |
|---|---------|---------------------|--------------------|-----------|
| 1 | **Infraestructura vial** ✅ piloto | Tramos, estado, pavimentación, longitud | INVIAS, datos.gov.co, ANI, ICDE, POT Bogotá | **P0 (hecho)** |
| 2 | **Contratación pública** | Contratos, entidades, montos, proveedores | SECOP I/II, datos.gov.co | P1 |
| 3 | **Minero-energético** | Títulos mineros, bloques de hidrocarburos, regalías | ANM, ANH, SGR | P1 |
| 4 | **Presupuesto y gasto** | Presupuesto General, regalías, ejecución | MinHacienda, SGR, datos.gov.co | P2 |
| 5 | **Territorio y catastro** | Límites, uso del suelo, predios | IGAC, DANE, ICDE | P2 |
| 6 | **Movilidad y transporte** | Peajes, tráfico, concesiones, parque automotor | ANI, RUNT, MinTransporte | P2 |
| 7 | **Ambiente y riesgo** | Áreas protegidas, hidrología, amenaza | IDEAM, SIAC, UNGRD | P3 |
| 8 | **Social (salud/educación)** | Infraestructura de salud/educación | MinSalud, MinEducación (DANE) | P3 |

*P0 = piloto entregado · P1 = próximas verticales · P2/P3 = backlog.*

### 7.2 Fuentes viales ya integradas (módulo 1 — SIVU)

| Fuente | Tipo | Endpoint / referencia | Estado |
|--------|------|-----------------------|--------|
| **INVIAS – Red Vial (ArcGIS REST)** | GeoJSON geoespacial | `hermes2.invias.gov.co/.../MapaCarreteras/RedVial/MapServer/1` | **Integrada** (ETL en piloto) |
| datos.gov.co – Red Vial INVIAS (SODA) | CSV/JSON tabular | dataset `cn9e-d2hx` | Identificada |
| ANI – Concesiones y tráfico | CSV/Excel | Datos abiertos ANI (índices de transparencia) | Identificada |
| ICDE – Transporte | Shapefile/GeoJSON (WMS/WFS) | `datos.icde.gov.co` (`tags=transporte`) | Identificada |
| POT Bogotá – Infraestructura vial | Shapefile/GeoJSON/CSV | `datosabiertos.bogota.gov.co` | Identificada |
| MinTransporte | Redirige a datos.gov.co | catálogo nacional | Referencia |

### 7.3 Atributos canónicos (recurso vial — referencia del modelo)

Campos que el modelo unificado ya normaliza en el piloto (extensibles por dominio):

`codigo_vial` · `nombre_tramo` · `ruta` · `sector` · `tipo_vial`
(Nacional/Departamental/Terciaria) · `categoria` · `superficie` · `pavimentada` ·
`calzada` · `administrador` · `grupo_admin` · `region` (territorial) · `longitud_km` ·
`geom` (GeoJSON WGS84) · `fuente` · `fecha_actualizacion` · `extra` (JSON con atributos
propios de cada fuente).

**Regla de oro del modelo:** columnas canónicas comunes + bolsa `extra` (JSON) que
**nunca descarta** el atributo original de la fuente. Así cada vertical hereda la misma
forma (código, nombre, geometría, fuente, fecha) sin perder su especificidad.

### 7.4 Llaves de cruce inter-dominio

Para pasar de "datos apilados" a "datos cruzados":

- **Geográfica** — bbox / intersección espacial (vía ↔ municipio ↔ área protegida).
- **Código canónico** — código vial, código DANE de municipio (DIVIPOLA), NIT de entidad.
- **Nominal normalizada** — nombre sin acentos/normalizado (match aproximado ANI ↔ INVIAS).

---

## 8. Módulos del panel

1. **Mapa interactivo** — capas por dominio, color por atributo, carga por bbox, popup con
   detalle + enlace a fuente oficial.
2. **Tabla** — paginada, ordenable, con exportación CSV/GeoJSON de la vista actual.
3. **KPIs / dashboard** — tarjetas (totales, % por categoría) + gráficos (barras, pastel)
   recalculados según filtros activos.
4. **Búsqueda** — autocompletado por nombre/código, "zoom al recurso".
5. **Filtros combinables** — por región, tipo, estado, administrador, etc.

*(Todos operativos hoy para el dominio vial; se replican por vertical.)*

---

## 9. Roadmap por fases

| Fase | Ventana | Foco | Entregable |
|------|---------|------|------------|
| **F0 — Piloto vial (SIVU)** ✅ | — | Validar el patrón end-to-end en un dominio | Panel vial: ingesta INVIAS + mapa + tabla + KPIs |
| **F1 — Endurecer y multi-fuente vial** | Q3 2026 | Sumar datos.gov.co/ANI/ICDE al dominio vial; trazabilidad; refresco | Vial multi-fuente + linaje |
| **F2 — Framework de verticales** | Q3–Q4 2026 | Abstraer el patrón (ingesta→modelo→API→panel) reutilizable | Guía + plantilla de "nuevo dominio" |
| **F3 — Contratación pública** | Q4 2026 | Dominio 2: SECOP/contratos | Vertical de contratación en panel |
| **F4 — Minero-energético** | Q1 2027 | Dominio 3: ANM/ANH/regalías | Vertical minero-energético + primer cruce inter-dominio |
| **F5 — Cruces y analítica** | 2027+ | Análisis inter-dominio, alertas, exportables | Vistas cruzadas + reportes |

---

## 10. Métricas de éxito (KPIs de producto)

- **Latencia** p95 de consultas principales < 500 ms.
- **Disponibilidad de datos**: % de consultas resueltas sin error 5xx.
- **Cobertura**: nº de dominios activos · nº de fuentes integradas · % de departamentos.
- **Trazabilidad**: % de registros con fuente + fecha + enlace (meta 100 %).
- **Carga inicial** del mapa < 1.5 s.
- **Velocidad de escalado**: días para incorporar un nuevo dominio (meta < 7).

---

## 11. Principios OSINT y gobernanza

1. **Solo fuentes públicas y legales.** Nada reservado, nada personal sensible.
2. **Procedencia siempre visible.** Cada dato enlaza a su portal oficial.
3. **El panel lee, no reemplaza la fuente.** No es sistema de registro; es capa de consulta.
4. **Reproducibilidad.** La ingesta se puede re-ejecutar y auditar (linaje versionado).
5. **Datos abiertos, licencias verificadas.** Se documenta la licencia de cada fuente.

---

## 12. Estado actual

*(actualizado 2026-07-14 — detalle por módulo en [PLANNING.md](PLANNING.md) §7)*

- ✅ **Plataforma multi-dominio operativa**: motor de conectores (Socrata + ArcGIS),
  metadata/linaje/freshness, DIVIPOLA + normalización, storage CQRS, orquestador con
  colas/scheduler/streaming, entity resolution con dedupe SECOP, vistas materializadas,
  search FTS5, Read API con caché por versión, panel unificado, Socrata Explorer
  (alta de fuentes autoservicio), knowledge graph y capa RAG con citas.
- ✅ **Dominios con datos**: territorio (DIVIPOLA), economía (PIB), agro (EVA), vial
  (INVIAS), contratación (SECOP II, corte >500M COP 2026), entidades (CHIP).
- ✅ Observabilidad: `/api/status` compara budget §2.3 del PLANNING contra lo medido.
- 🟡 Agentes de investigación multi-paso (M13) pendientes de casos de uso reales.
- ⚪ Ampliaciones en backlog: más fuentes por dominio, vector search (ADR-006),
  dominios P2/P3 del catálogo.

---

## 13. Documentos del proyecto

- **[CATALOGO-DATOS.md](CATALOGO-DATOS.md)** — catálogo formal de fuentes, endpoints,
  conectores y tareas fuera de scope (resultado del relevamiento OSINT).
- `prd.md` — requisitos de producto (piloto vial).
- `srs.md` — requisitos técnicos + fuentes y URLs (piloto vial).
- `estructura.md` — estructura del proyecto.

---

## 14. Glosario

- **OSINT** — Open Source Intelligence: inteligencia a partir de fuentes públicas.
- **Dominio / vertical** — un tipo de recurso (vías, contratación, minería…).
- **Modelo unificado** — esquema canónico común a todas las fuentes de un dominio.
- **Linaje / trazabilidad** — registro de origen y transformaciones de cada dato.
- **bbox** — bounding box: recuadro geográfico para acotar consultas de mapa.
- **SIVU** — Sistema de Información Vial Unificada; módulo 1 (piloto).
- **SODA / Socrata** — API REST de datos.gov.co.
- **DIVIPOLA** — división político-administrativa DANE (código municipio/depto).
- **KR** — Key Result: resultado clave medible de un objetivo (OKR).

---

*Documento vivo. Fuentes técnicas de referencia: `prd.md`, `srs.md`, `estructura.md`.*
