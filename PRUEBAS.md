# Plan de Pruebas — SIVU (Sistema de Información Vial Unificada)

Documento de diseño de pruebas (unitarias, integración, validación de datos, E2E y no
funcionales) para el dashboard de la Red Vial Nacional de Colombia.

- **Backend:** Node sin dependencias (`node:http` + `fetch` + `node:sqlite`).
- **Frontend:** HTML + Tailwind (CDN) + Leaflet + Chart.js, JS vanilla.
- **Fuente de datos:** INVIAS ArcGIS — `MapaCarreteras/RedVial/MapServer/1` (capa polilíneas,
  wkid 9377 → se solicita `outSR=4326`).

> **Convención de toda la suite:** las pruebas se ejecutan con el runner integrado de Node:
> `node --experimental-sqlite --test`. No se introducen dependencias de testing pesadas, en línea
> con la filosofía del proyecto. Playwright es **opcional** y solo para el E2E del navegador.

---

## 1. Objetivo y alcance

Validar que el sistema:

1. **Ingiere correctamente** los datos viales (decodificación de dominios, geometría, longitud,
   bounding box) — *prioridad del proyecto*.
2. **Expone consultas rápidas y correctas** vía API (filtros, KPIs, búsqueda, exportación).
3. **Visualiza de forma fiel** los datos para tres perfiles de usuario.
4. **No engaña en la toma de decisiones** (especialmente con métricas de cobertura parcial,
   como `% pavimentada`).

Fuera de alcance: pruebas de carga distribuida, pruebas de penetración formales, pruebas del
servicio remoto de INVIAS (es un tercero; solo se prueba **nuestra** tolerancia a sus cambios).

---

## 2. Personas y qué valida cada una

| Persona | Quién es | Qué necesita que sea verdadero | Riesgo si falla |
|---|---|---|---|
| **Gobierno / Decisor** | Analista de INVIAS, planeación, ente de control | KPIs exactos, filtros consistentes, export reproducible para informes, advertencias de cobertura | Decisiones de inversión sobre cifras erróneas o malinterpretadas |
| **Usuario común** | Ciudadano, periodista, estudiante | Buscar, navegar el mapa, entender la leyenda, sin conocimiento técnico | Frustración, abandono, lectura equivocada del color |
| **Ciencia de datos** | Analista/científico de datos | Integridad, completitud, distribuciones, nulos explícitos, reproducibilidad, geometría válida | Modelos/estudios sobre datos sucios o sesgados sin saberlo |

Cada caso de prueba se etiqueta con `[GOB]`, `[COM]`, `[DS]` según la(s) persona(s) que protege.

---

## 3. Estrategia y pirámide de pruebas

```
        ▲  E2E navegador (Playwright, opcional)      ~10 casos
       ╱ ╲  Integración API (HTTP contra BD de test) ~40 casos
      ╱   ╲  Validación de datos (sobre la BD real)   ~25 asserts
     ╱     ╲ Unitarias puras (lógica determinista)    ~60 casos
    ╱───────╲
```

- **Unitarias puras:** funciones sin E/S (decodificación, geometría, normalización, armado de
  WHERE). Deterministas y rápidas (mock de `fetch`).
- **Validación de datos:** se ejecutan sobre `data/sivu.db` *después* de una ingesta. Son
  *aserciones de calidad*, no lógica. Tolerantes a cambios de la fuente (usan rangos).
- **Integración API:** levantan el servidor contra una **BD de fixture** y consultan por HTTP.
- **E2E:** flujo real en navegador headless.

---

## 4. Herramientas

| Capa | Herramienta | Por qué |
|---|---|---|
| Unit / Integración | `node:test` + `node:assert/strict` | Cero dependencias, ya disponible en Node 22 |
| Mock de red | `mock` de `node:test` o stub manual de `globalThis.fetch` | Ingesta determinista sin tocar INVIAS |
| BD de prueba | `node:sqlite` en `:memory:` o archivo temporal | Aislada del `data/sivu.db` real |
| E2E (opcional) | Playwright (`@playwright/test`) | Único caso donde se acepta dependencia de dev |
| Cobertura | `node --experimental-test-coverage` | Integrado |

### Scripts sugeridos (`package.json`)

```json
{
  "scripts": {
    "test": "node --experimental-sqlite --test test/unit test/integration",
    "test:data": "node --experimental-sqlite --test test/data",
    "test:cov": "node --experimental-sqlite --experimental-test-coverage --test test/**/*.test.js",
    "test:e2e": "playwright test"
  }
}
```

---

## 5. Estructura de carpetas propuesta

```
test/
├── fixtures/
│   ├── arcgis_page.json        # respuesta GeoJSON simulada de INVIAS (3-5 features)
│   ├── arcgis_count.json       # {"count": N}
│   └── build_test_db.js        # crea una BD en memoria/temp con datos conocidos
├── unit/
│   ├── domains.test.js
│   ├── ingest_geom.test.js     # bbox, haversine, eachLine
│   ├── ingest_map.test.js      # mapFeature, pavimentadaCode, stripAccents
│   └── server_where.test.js    # buildWhere, norm, toCsv
├── integration/
│   ├── api_meta.test.js
│   ├── api_vias.test.js
│   ├── api_kpi.test.js
│   ├── api_search.test.js
│   └── api_static_security.test.js
├── data/
│   └── data_quality.test.js    # corre sobre data/sivu.db
└── e2e/
    └── dashboard.spec.js
```

### Refactor mínimo necesario para testability

Hoy varias funciones puras están **encapsuladas** en `ingest.js` y `server.js`. Para poder
probarlas de forma unitaria sin levantar todo, se recomienda exportarlas:

- `src/ingest.js`: exportar `eachLine`, `bboxOf`, `haversineKm`, `stripAccents`,
  `pavimentadaCode`, `mapFeature` (mantener `main()` como `import.meta.main`-guard).
- `src/server.js`: extraer y exportar `buildWhere`, `norm`, `toCsv`, `rowProps`, y los
  `handleX(db, qp)` recibiendo la conexión por parámetro (inyección de dependencia) para poder
  pasarles una BD de fixture.

> Este refactor es de bajo riesgo y habilita ~60 pruebas unitarias deterministas. Es el primer
> ítem recomendado del backlog de calidad.

---

## 6. Datos de prueba (fixtures)

**Fixture GeoJSON de ArcGIS** (`test/fixtures/arcgis_page.json`) con casos límite deliberados:

```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature",
      "properties": { "objectid": 1, "categoria": "1", "superficie": "1", "territorial": "1",
        "administrador": "1", "calzada": "2", "nombretramo": "Autopista Norte",
        "nombreruta": "Ruta 45", "codigotramo": "4501", "revisionestado": "1",
        "st_length(shape)": 13016.0 },
      "geometry": { "type": "LineString", "coordinates": [[-74.0,4.6],[-74.0,4.7]] } },

    { "type": "Feature",
      "properties": { "objectid": 2, "categoria": "4", "superficie": " ", "territorial": "28",
        "administrador": "2", "codigotramo": "70CS03", "nombretramo": "", "nombreruta": "" },
      "geometry": { "type": "MultiLineString", "coordinates": [[[-73.0,8.3],[-73.1,8.4]]] } },

    { "type": "Feature",
      "properties": { "objectid": 3, "categoria": "2", "superficie": "2", "territorial": "17",
        "administrador": "3", "nombretramo": "Vía Pasto", "st_length(shape)": null },
      "geometry": null }
  ]
}
```

- Feature 1: caso “feliz”, todos los códigos válidos, `st_length` presente.
- Feature 2: `superficie=" "` (basura), `territorial=28` (ANI, no geográfica), nombres vacíos →
  debe caer a `"Sin nombre"`.
- Feature 3: **sin geometría** → debe **omitirse** y contarse como `skipped`.

**Stub de `fetch`** para `ingest.js`:

```js
import { fixtureCount, fixturePage } from "../fixtures/arcgis.js";
globalThis.fetch = async (url) =>
  ({ ok: true, json: async () => (url.includes("returnCountOnly") ? fixtureCount : fixturePage) });
```

---

## 7. Pruebas unitarias por módulo

### 7.1 `domains.js` — decodificación de dominios `[DS][GOB]`

| ID | Caso | Entrada | Esperado |
|---|---|---|---|
| DOM-01 | Código numérico válido | `decode(CATEGORIA, "1")` | `"Primer Orden"` |
| DOM-02 | Código como número | `decode(SUPERFICIE, 2)` | `"Sin Pavimentar"` |
| DOM-03 | Etiqueta ya textual | `decode(REVISION, "No Revisado")` | `"No Revisado"` |
| DOM-04 | **Basura en blanco** | `decode(SUPERFICIE, " ")` | `null` *(regresión)* |
| DOM-05 | Vacío / nulo | `decode(TERRITORIAL, "")` / `null` | `null` |
| DOM-06 | Código fuera de dominio | `decode(CATEGORIA, "99")` | `"99"` (se conserva, no se inventa) |
| DOM-07 | Mapeo tipo normalizado | `decode(CATEGORIA_TIPO, "1")` | `"Nacional"` |
| DOM-08 | `esDepartamento` positivo | `esDepartamento("Antioquia")` | `true` |
| DOM-09 | `esDepartamento` negativo | `esDepartamento("ANI")` | `false` |
| DOM-10 | `esDepartamento` no-depto geográfico | `esDepartamento("Ocana")` | `false` *(decisión de diseño documentada)* |
| DOM-11 | Cardinalidad del set | `DEPARTAMENTOS.size` | `25` |

```js
import test from "node:test";
import assert from "node:assert/strict";
import { decode, SUPERFICIE, esDepartamento } from "../../src/domains.js";

test("DOM-04: superficie en blanco se normaliza a null", () => {
  assert.equal(decode(SUPERFICIE, " "), null);
});
test("DOM-09: ANI no es departamento", () => {
  assert.equal(esDepartamento("ANI"), false);
});
```

### 7.2 `ingest.js` — geometría y mapeo `[DS]`

| ID | Caso | Entrada | Esperado |
|---|---|---|---|
| GEO-01 | bbox de LineString | línea simple | `{minx,miny,maxx,maxy}` correcto |
| GEO-02 | bbox de MultiLineString | varias partes | envuelve todas las partes |
| GEO-03 | bbox de geometría nula | `null` | `null` |
| GEO-04 | Haversine tramo conocido | 1° de latitud ≈ 111 km | dentro de ±1 km |
| GEO-05 | Haversine geometría vacía | sin vértices | `0` |
| MAP-01 | mapFeature feliz | feature 1 fixture | `tipo_vial="Nacional"`, `pavimentada=1`, `region="Antioquia"` |
| MAP-02 | Longitud desde `st_length` | feature 1 | `longitud_km ≈ 13.016` (no recalcula por haversine) |
| MAP-03 | Longitud fallback a haversine | `st_length=null` | usa cálculo geodésico > 0 |
| MAP-04 | Nombre vacío | feature 2 | `nombre_tramo="Sin nombre"` |
| MAP-05 | `pavimentadaCode` | `1→1`, `2→0`, `3→null`, `" "→null` | según tabla |
| MAP-06 | `search_blob` sin acentos | `"Nariño"` en campos | contiene `"narino"` en minúsculas |
| MAP-07 | Geometría nula se omite | feature 3 | `mapFeature` retorna `null` |

```js
test("MAP-02: longitud usa st_length(shape) nativo", () => {
  const r = mapFeature(fixturePage.features[0]);
  assert.ok(Math.abs(r.longitud_km - 13.016) < 0.01);
});
test("GEO-04: haversine ~111km por grado de latitud", () => {
  const km = haversineKm({ type: "LineString", coordinates: [[-74, 4],[-74, 5]] });
  assert.ok(km > 110 && km < 112);
});
```

### 7.3 Lógica de ingesta (con mock de `fetch`) `[DS][GOB]`

| ID | Caso | Esperado |
|---|---|---|
| ING-01 | Ingesta completa de fixture | inserta N-1 (omite el sin-geometría) |
| ING-02 | Conteo `skipped` | `skipped === 1` (feature 3) |
| ING-03 | **Idempotencia** | correr 2 veces deja el mismo conteo (no duplica) |
| ING-04 | `resetData` limpia | tras reset, `COUNT(*) === 0` y secuencia reiniciada |
| ING-05 | Metadatos calculados | `meta.bbox`, `meta.count`, `meta.ingested_at` poblados |
| ING-06 | Reintento ante fallo | `fetch` que falla 2 veces y luego responde → ingesta exitosa |
| ING-07 | Paginación | con fixture > PAGE, recorre todas las páginas |

### 7.4 `db.js` `[DS]`

| ID | Caso | Esperado |
|---|---|---|
| DB-01 | `createSchema` idempotente | doble llamada no lanza error |
| DB-02 | Índices creados | `idx_vias_bbox`, `idx_vias_region`, etc. existen (`PRAGMA index_list`) |
| DB-03 | `setMeta`/`getMeta` ida y vuelta | objeto se serializa/recupera |
| DB-04 | `setMeta` upsert | reescribir misma clave actualiza, no duplica |

### 7.5 `server.js` — armado de consultas `[GOB][DS]`

| ID | Caso | Entrada (`qp`) | Esperado (`clause` / `args`) |
|---|---|---|---|
| WHE-01 | Sin filtros | vacío | `clause === ""` |
| WHE-02 | Región simple | `region=Antioquia` | `region IN (?)`, args `["Antioquia"]` |
| WHE-03 | **Multi-región OR** | `region=Antioquia,ANI` | `region IN (?,?)`, 2 args |
| WHE-04 | Tipo + superficie | `tipo=Nacional&superficie=Pavimentada` | dos cláusulas `AND` |
| WHE-05 | Pavimentada=1 | `pavimentada=1` | `pavimentada = ?`, arg `[1]` |
| WHE-06 | Pavimentada inválida | `pavimentada=foo` | se ignora (sin cláusula) |
| WHE-07 | Búsqueda normalizada | `q=Nariño` | `search_blob LIKE ?`, arg `%narino%` |
| WHE-08 | bbox válido | `bbox=-76,3,-75,4` | cláusula de intersección de envolvente, 4 args |
| WHE-09 | bbox malformado | `bbox=a,b` | se ignora |
| WHE-10 | **Inyección SQL** | `region=' OR '1'='1` | tratado como valor (parametrizado), 0 resultados |
| CSV-01 | `toCsv` con comas | nombre con `,` | campo entre comillas dobles |
| CSV-02 | `toCsv` con comillas | nombre con `"` | comillas escapadas (`""`) |
| CSV-03 | `toCsv` excluye `fuente_oficial` | — | columna ausente |

```js
test("WHE-10: filtro de región es a prueba de inyección", () => {
  const { clause, args } = buildWhere(new URLSearchParams("region=' OR '1'='1"));
  assert.match(clause, /region IN \(\?\)/);
  assert.deepEqual(args, ["' OR '1'='1"]);
});
```

---

## 8. Pruebas de integración de la API (HTTP contra BD de fixture)

Se levanta el servidor con `PORT` aleatorio apuntando a una BD con datos conocidos y se consulta
con `fetch`.

| ID | Endpoint | Caso | Esperado | Persona |
|---|---|---|---|---|
| API-01 | `/api/health` | salud | `{ok:true, count:N}` | — |
| API-02 | `/api/meta` | estructura | tiene `departamentos`, `territoriales_otras`, `bbox`, `tipos` | GOB |
| API-03 | `/api/meta` | **split correcto** | `departamentos` no contiene `"ANI"`; `territoriales_otras` sí | GOB |
| API-04 | `/api/vias` | GeoJSON por defecto | `type:"FeatureCollection"`, features con `geometry` | COM |
| API-05 | `/api/vias?format=table` | tabla paginada | `{total, limit, offset, items}` sin geometría | GOB |
| API-06 | `/api/vias?format=csv` | export | `Content-Type: text/csv`, `Content-Disposition: attachment` | GOB |
| API-07 | `/api/vias?limit=999999` | tope | `returned ≤ 10000` | DS |
| API-08 | `/api/vias?tipo=Nacional` | filtro | `properties.total` = #Nacional; todas las props `tipo_vial="Nacional"` | DS |
| API-09 | `/api/vias/:id` | detalle | `Feature` con `properties.extra` poblado | COM |
| API-10 | `/api/vias/999999` | inexistente | HTTP 404 + `{error}` | COM |
| API-11 | `/api/search?q=mag` | autocompletado | lista con `{id,label,sublabel,bbox}` | COM |
| API-12 | `/api/search?q=a` | query corta | (frontend no llama; API responde lista válida) | COM |
| API-13 | `/api/search?q=narino` | sin acentos | encuentra "Nariño" | COM/DS |
| API-14 | `/kpi/vias/region?region=X` | **alias del PRD** | igual que `/api/kpi?region=X` | GOB |
| API-15 | `/vias/filter?...` | alias del PRD | igual que `/api/vias` | COM |
| API-16 | `/api/loquesea` | ruta API inexistente | HTTP 404 JSON | — |
| API-17 | Header `Accept-Encoding: gzip` | respuesta grande | `Content-Encoding: gzip` | RNF |
| API-18 | Respuesta pequeña (<1KB) | health | **sin** gzip | RNF |

```js
test("API-03: ANI no aparece como departamento", async () => {
  const m = await (await fetch(`${base}/api/meta`)).json();
  assert.ok(!m.departamentos.some((d) => d.v === "ANI"));
  assert.ok(m.territoriales_otras.some((d) => d.v === "ANI"));
});
```

---

## 9. Escenarios por persona (casos de uso)

### 9.1 Gobierno / Toma de decisiones `[GOB]`

> Foco: **exactitud, consistencia y no-engaño**. Una cifra mal calculada puede orientar inversión
> pública. Estas pruebas “congelan” las definiciones de los indicadores.

| ID | Escenario | Pasos / Entrada | Resultado esperado |
|---|---|---|---|
| GOB-01 | KPI por departamento | `GET /api/kpi?region=Antioquia` | `total_segmentos` y `total_km` coinciden con la suma de tramos de Antioquia en la tabla |
| GOB-02 | **Definición de % pavimentada** | KPI global | `pct_pavimentada = km_pavimentada / km_clasificado * 100` (NO sobre el total). Test bloquea la fórmula |
| GOB-03 | **Advertencia de cobertura** | KPI global | `pct_clasificado` presente y bajo (~12%); el frontend debe mostrar la nota. Evita leer “99.7%” como “casi toda la red pavimentada” |
| GOB-04 | Suma de partes = total | KPI: `Σ por_tipo.km` | ≈ `total_km` (±0.1 por redondeo) |
| GOB-05 | Consistencia export ↔ pantalla | tabla filtrada vs CSV con mismos filtros | mismas filas y mismos valores |
| GOB-06 | Filtro combinado OR | `region=Antioquia,ANI` | `total_segmentos` = Antioquia + ANI (145 en snapshot) |
| GOB-07 | Identificar red concesionada | filtro `administrador=ANI` | retorna solo tramos de concesión nacional |
| GOB-08 | Comparación entre regiones | KPI de dos departamentos | cifras estables y reproducibles entre llamadas (caché no altera valores) |
| GOB-09 | Trazabilidad a la fuente | popup / `properties.fuente_oficial` | enlace al servicio oficial de INVIAS |
| GOB-10 | Filtro sin resultados | `region=Atlantico&tipo=Terciaria` (si vacío) | KPIs en 0/`null`, FeatureCollection vacío, **sin crash** |

### 9.2 Usuario común `[COM]`

> Foco: **usabilidad y lectura correcta sin conocimiento técnico**.

| ID | Escenario | Pasos | Resultado esperado |
|---|---|---|---|
| COM-01 | Buscar una vía | escribir “panamericana” | dropdown con sugerencias en < 300 ms |
| COM-02 | Zoom a resultado | clic en sugerencia | mapa hace `fitBounds` y abre popup del tramo |
| COM-03 | Entender el color | leyenda visible | la leyenda refleja la dimensión de “Colorear por” |
| COM-04 | Cambiar dimensión de color | seleccionar “Superficie” | líneas y leyenda se recolorean sin recargar datos |
| COM-05 | Limpiar filtros | botón “Limpiar” | todos los controles vuelven a su estado inicial y el mapa muestra todo |
| COM-06 | Ver tabla | botón “Ver tabla” | panel inferior se despliega y el mapa se reajusta (`invalidateSize`) |
| COM-07 | Spinner solo si lento | respuesta > 500 ms | aparece spinner; en respuestas rápidas, no parpadea |
| COM-08 | Popup legible | clic en tramo | muestra nombre, código, tipo, longitud, “Sin dato” cuando aplica |
| COM-09 | Responsive | viewport móvil | paneles laterales se ocultan (`lg:`/`xl:`), el mapa ocupa el ancho |

### 9.3 Ciencia de datos / Calidad de datos `[DS]`

> Foco: **integridad, completitud, distribuciones y reproducibilidad**. Se ejecutan sobre la BD
> cargada (`test:data`). Usan **rangos**, no igualdades exactas, para tolerar cambios de la fuente,
> salvo donde el valor es estructural.

| ID | Aserción | Regla | Por qué importa |
|---|---|---|---|
| DS-01 | Conteo plausible | `400 ≤ COUNT(*) ≤ 2000` | detecta ingesta parcial o explosión de filas |
| DS-02 | Sin longitudes negativas o cero | `MIN(longitud_km) > 0` | geometría/medida corrupta |
| DS-03 | Longitud máxima plausible | `MAX(longitud_km) < 500` | un tramo > 500 km sugiere geometría unida por error |
| DS-04 | Suma total coherente | `15000 ≤ SUM(longitud_km) ≤ 30000` | la red nacional INVIAS ronda ~20 mil km |
| DS-05 | **CRS correcto (lon/lat)** | todo vértice: `-82 ≤ lon ≤ -66`, `-5 ≤ lat ≤ 14` | si quedó en wkid 9377 (metros), los valores serían enormes → regresión |
| DS-06 | bbox dentro de Colombia | `meta.bbox` dentro del rango anterior | sanity del envelope global |
| DS-07 | Geometría parseable | todo `geom` es GeoJSON `LineString`/`MultiLineString` válido | evita features que el mapa no puede dibujar |
| DS-08 | Sin duplicados de `objectid` | `COUNT(DISTINCT objectid) == COUNT(*)` (donde no nulo) | ingesta sin doble inserción |
| DS-09 | Dominios cerrados | `tipo_vial ∈ {Nacional, Departamental, Terciaria, Por Definir, NULL}` | decodificación no dejó códigos crudos |
| DS-10 | Sin basura textual | no existe `superficie = ' '` | regresión del bug de blancos |
| DS-11 | Nulos explícitos y medidos | reportar `% pavimentada IS NULL` | el analista debe saber que ~85% no tiene dato de superficie |
| DS-12 | Cobertura de superficie | `pct_clasificado` calculado = `km_clasificado / total_km` | métrica de completitud para estudios |
| DS-13 | Distribución por tipo | `Σ segmentos por tipo == COUNT(*)` | partición exhaustiva y disjunta |
| DS-14 | `search_blob` normalizado | no contiene mayúsculas ni acentos | búsqueda insensible reproducible |
| DS-15 | **Reproducibilidad de ingesta** | con `fetch` mockeado a un fixture fijo, dos corridas → BD idéntica (hash de filas) | pipeline determinista dado el input |
| DS-16 | Consistencia longitud | `|longitud_km - haversine(geom)| / longitud_km < 0.25` por tramo | detecta desalineación entre `st_length` y geometría simplificada |
| DS-17 | Outliers geográficos | listar tramos cuyo bbox esté fuera del continente (p. ej. San Andrés -81.7) | confirmar que son legítimos, no errores |

```js
// test/data/data_quality.test.js  (corre sobre data/sivu.db)
test("DS-05: todas las coordenadas están en rango WGS84 de Colombia", () => {
  for (const { geom } of db.prepare("SELECT geom FROM vias").all()) {
    for (const line of asLines(JSON.parse(geom))) {
      for (const [lon, lat] of line) {
        assert.ok(lon >= -82 && lon <= -66, `lon fuera de rango: ${lon}`);
        assert.ok(lat >= -5 && lat <= 14, `lat fuera de rango: ${lat}`);
      }
    }
  }
});

test("DS-13: la partición por tipo es exhaustiva", () => {
  const total = db.prepare("SELECT COUNT(*) c FROM vias").get().c;
  const suma = db.prepare("SELECT SUM(c) s FROM (SELECT COUNT(*) c FROM vias GROUP BY tipo_vial)").get().s;
  assert.equal(total, suma);
});
```

---

## 10. Pruebas de regresión (bugs y decisiones ya resueltas)

Cada bug encontrado durante el desarrollo se convierte en una prueba para que no reaparezca.

| ID | Regresión | Prueba que la fija |
|---|---|---|
| REG-01 | Dataset equivocado: `cn9e-d2hx` es contratación (SECOP), no red vial | Doc/contract test: la URL de la fuente apunta a `MapaCarreteras/RedVial/.../1` |
| REG-02 | La capa RedVial es **id 1**, no 0 | ING: el fixture/endpoint usa `/MapServer/1` |
| REG-03 | Geometría llegaba en wkid 9377 (metros) | DS-05 (rango lon/lat) |
| REG-04 | `superficie = ' '` (blanco) se colaba | DOM-04, DS-10 |
| REG-05 | Páginas grandes (`rc=2000`) → HTTP 500 | ING-07 con `PAGE=250`; assert de que `PAGE ≤ 500` |
| REG-06 | “ANI” aparecía como región geográfica | API-03, DOM-09 |
| REG-07 | `% pavimentada` se leía como % del total | GOB-02, GOB-03 |

---

## 11. Pruebas no funcionales

### 11.1 Rendimiento `[GOB][COM]` (RNF1 del PRD: ≤ 500 ms)

| ID | Caso | Umbral |
|---|---|---|
| PERF-01 | `/api/vias?tipo=Nacional` (GeoJSON) | p95 < 500 ms en local |
| PERF-02 | `/api/kpi?region=X` | < 200 ms |
| PERF-03 | `/api/search?q=...` | < 100 ms |
| PERF-04 | Caché de `meta` | 2.ª llamada reusa objeto cacheado (mismo resultado) |
| PERF-05 | Caché de KPI por clave de filtro | misma clave no recomputa |
| PERF-06 | Tamaño de payload GeoJSON gzip | < 500 KB para la red completa |

### 11.2 Seguridad `[todas]`

| ID | Caso | Esperado |
|---|---|---|
| SEC-01 | Path traversal en estáticos | `GET /../db.js` o `/..%2f..` → 403/404, nunca sirve fuera de `public/` |
| SEC-02 | Inyección SQL en filtros | parametrizado (WHE-10) |
| SEC-03 | MIME correcto | `.js`→`text/javascript`, `.html`→`text/html` |
| SEC-04 | Sin secretos | el repo no expone credenciales (no hay BD remota) |

### 11.3 Resiliencia de ingesta `[DS]`

| ID | Caso | Esperado |
|---|---|---|
| RES-01 | INVIAS responde 500 intermitente | reintentos con backoff; éxito eventual |
| RES-02 | INVIAS responde 500 persistente | proceso termina con código ≠ 0 y mensaje claro (no deja BD a medias sin avisar) |
| RES-03 | Timeout de red | `AbortSignal.timeout` corta y reintenta |

---

## 12. Pruebas E2E de frontend (Playwright, opcional) `[COM][GOB]`

| ID | Flujo | Aserción |
|---|---|---|
| E2E-01 | Carga inicial | el `#map` se renderiza y el badge muestra “N tramos en mapa” |
| E2E-02 | Filtrar por departamento | seleccionar “Antioquia” → KPI `tramos` cambia y mapa se actualiza |
| E2E-03 | Marcar “Otras territoriales: ANI” | se suma a la selección (OR), no reemplaza al departamento |
| E2E-04 | Colorear por superficie | la leyenda cambia a Pavimentada/Sin Pavimentar |
| E2E-05 | Buscar y hacer zoom | escribir, clic en sugerencia → el mapa centra el tramo |
| E2E-06 | Abrir tabla, ordenar por longitud | filas se reordenan desc/asc |
| E2E-07 | Exportar CSV | la descarga inicia con `vias_sivu.csv` |
| E2E-08 | Limpiar filtros | vuelve al estado completo |
| E2E-09 | Sin errores de consola | `page.on('console')` no registra errores |

> Si no se adopta Playwright, estos casos se cubren como **checklist manual** antes de cada
> release (mismos pasos, verificación visual).

---

## 13. Matriz de trazabilidad a requisitos (PRD)

| Requisito PRD | Cubierto por |
|---|---|
| RF1 Consulta por región | API-02/03, GOB-01, E2E-02 |
| RF2 Filtros por atributos | WHE-02..09, API-08, COM-05 |
| RF3 Mapa interactivo | E2E-01/04/05, COM-03/08 |
| RF4 Tabla + export | API-05/06, GOB-05, E2E-06/07 |
| RF5 Búsqueda / autocompletado | API-11/13, COM-01/02, E2E-05 |
| RF6 KPIs y dashboard | API-14, GOB-02/04, DS-12 |
| RF7 Rendimiento / carga | PERF-01..06, COM-07 |
| RNF1 Latencia ≤ 500 ms | PERF-01..03 |
| RNF3 Compatibilidad/responsive | COM-09, E2E |
| RNF4 Integración con portales oficiales | GOB-09 |

---

## 14. Integración continua (sugerida)

```yaml
# .github/workflows/test.yml (esquema)
jobs:
  test:
    steps:
      - uses: actions/setup-node@v4   # node >= 22.5
      - run: npm run test             # unit + integración (BD de fixture, sin red)
      # data-quality NO corre en CI por defecto (depende de ingesta con red);
      # se ejecuta en un job nightly opcional:
  nightly-data:
    schedule: [{ cron: "0 6 * * *" }]
    steps:
      - run: npm run ingest && npm run test:data
```

> **Regla de oro:** las pruebas de CI **no deben depender de la red** ni del servicio de INVIAS.
> Toda la lógica se prueba con fixtures/mocks. La calidad de los datos reales se valida en un job
> programado aparte, cuyo fallo es una **alerta de fuente**, no un fallo de build.

---

### Prioridad de implementación sugerida

1. **Refactor de testability** (§5) — exportar funciones puras.
2. **Unitarias** §7 + **regresión** §10 (rápidas, alto valor, protegen los bugs ya corregidos).
3. **Integración API** §8 con BD de fixture.
4. **Validación de datos** §9.3 (job nightly).
5. **E2E** §12 (opcional, al final).
