# Runbook de despliegue — Operación Colombia

Instrucciones para un agente que opera el VPS (Ubuntu). Ejecutá los pasos **en orden**
y verificá la salida esperada antes de seguir. Todo es idempotente: si algo falla a
mitad, corregí y volvé a correr el paso.

**Modelo de despliegue: pull.** El VPS trae los cambios desde GitHub por su cuenta.
Nada ni nadie necesita acceso entrante al servidor. No hay credenciales en el repo.

| | |
|---|---|
| Directorio | `/opt/operacion-colombia` |
| Usuario de servicio | `ocolombia` (sin shell) |
| Puerto interno | `8081` (nginx publica en `:80`) |
| Configuración | `/etc/operacion-colombia.env` — **fuera del repo** |
| Base de datos | `/opt/operacion-colombia/data/osint.db` — se puebla con el ETL |

---

## 0. Antes de empezar: la rama desplegada

`main` es la rama desplegada (`OC_BRANCH=main` en el env). El trabajo se integra ahí
por PR desde `feat/ola1-connector-engine`, y el timer de deploy lo recoge en 5 minutos.

Antes de instalar, confirmá que `main` trae la plataforma y no solo el piloto vial:

```bash
git ls-tree --name-only origin/main | grep -q '^apps$' && echo "plataforma ok"
```

Si querés desplegar la rama de trabajo sin pasar por PR, poné
`OC_BRANCH=feat/ola1-connector-engine` en `/etc/operacion-colombia.env`.

---

## 1. Requisitos

```bash
node --version          # debe ser >= 22.5 (node:sqlite)
git --version
command -v nginx || echo "nginx no instalado (opcional, ver paso 6)"
```

Si Node es menor a 22.5:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Verificación:** `node -e 'require("node:sqlite"); console.log("ok")'` imprime `ok`.
Si falla, probá `node --experimental-sqlite -e 'require("node:sqlite")'`; el lanzador
del servicio detecta automáticamente cuál de las dos formas aplica.

---

## 2. Clonar el repositorio

```bash
sudo mkdir -p /opt/operacion-colombia
sudo chown "$USER" /opt/operacion-colombia
git clone https://github.com/FilipaoVfx/operacionColombia.git /opt/operacion-colombia
cd /opt/operacion-colombia
git checkout <rama-del-paso-0>
```

**Si el repositorio es privado**, el clon por HTTPS va a pedir credenciales. Usá una
**deploy key de solo lectura** (no una clave personal, no un token en la URL):

```bash
sudo -u ocolombia ssh-keygen -t ed25519 -N "" -f /home/ocolombia/.ssh/id_ed25519
sudo cat /home/ocolombia/.ssh/id_ed25519.pub
```

→ **Este paso lo hace un humano:** copiar esa clave pública en GitHub →
*Settings → Deploy keys → Add deploy key*, **sin** marcar "Allow write access".
Luego clonar con `git@github.com:FilipaoVfx/operacionColombia.git`.

Nunca pegues la clave **privada** en un chat, un issue ni un archivo del repo.

**Verificación:** `git -C /opt/operacion-colombia log --oneline -1` muestra un commit.

---

## 3. Instalación

```bash
cd /opt/operacion-colombia
sudo bash infra/deploy/bootstrap.sh
```

El script verifica Node, crea el usuario de servicio, prepara directorios y permisos,
copia el archivo de entorno, instala 5 unidades systemd, **deshabilita el
`sivu.service` del piloto si existe**, configura nginx y arranca la API.

**Verificación:** termina imprimiendo `{"ok":true,...}`. Si aborta, el mensaje dice
exactamente qué falló; corregí eso y volvé a correrlo.

### Panel nuevo (`/next`) — build manual

El rediseño vive en `apps/web-next` y se sirve bajo `/next`, conviviendo con el panel
actual en `/`. Su `dist/` **no se versiona** y el deploy automático **no lo construye**:
`npm ci` traería más de cien paquetes al servidor que atiende el túnel público, y eso
es una decisión aparte de desplegar la API.

Mientras esa decisión no se tome, se construye a mano cuando cambie:

```bash
cd /opt/operacion-colombia
sudo -u ocolombia npm --prefix apps/web-next ci
sudo -u ocolombia npm --prefix apps/web-next run build
```

**Verificación:** `curl -s localhost/next/ | head -c 40` devuelve HTML. Sin build,
`/next` responde **503 con el comando exacto** en el cuerpo — nunca un 404 mudo.
La API y el panel actual funcionan igual con o sin este paso.

---

## 4. Configurar el entorno

Editá `/etc/operacion-colombia.env` (lo creó el bootstrap desde el ejemplo):

```bash
sudo nano /etc/operacion-colombia.env
```

Lo que hay que revisar sí o sí:

- **`OC_BRANCH`** — la rama del paso 0. Si desplegás la rama de trabajo en vez de
  `main`, cambialo acá o el deploy automático te va a bajar `main`.
- **`OC_ALLOWED_TEST_FAILURES`** — `0`: cualquier test rojo revierte el deploy. Subilo
  solo para deuda declarada y con el rojo identificado, nunca como atajo.
- **`OC_BUILD_HEAP`** — límite de heap para el build del panel (por defecto
  `--max-old-space-size=384`). En un VPS chico, un build sin techo compite con la RAM
  del servicio.
- **`EXPLORER_ADMIN_TOKEN`** — sin él, `POST /api/explorer/register` responde 503. La
  escritura falla cerrada a propósito: ese endpoint alimenta el scheduler del ETL.
- **`ANM_CAPAS`** — vacío por defecto. Sin esto, el dominio minería no se ingiere
  (ver paso 7).

```bash
sudo systemctl restart operacion-colombia
```

**Verificación:** `curl -s localhost:8081/api/health` responde `{"ok":true,...}`.

---

## 5. Deploy automático

Ya quedó activo en el bootstrap. Cada 5 minutos el timer revisa la rama; si hay
commits nuevos: `fetch → tests → restart → healthcheck`. **Si el healthcheck falla,
revierte solo al commit anterior y reinicia.**

```bash
systemctl status oc-deploy.timer
sudo -u ocolombia bash infra/deploy/deploy.sh    # forzar una pasada ahora
journalctl -u oc-deploy -n 30                    # ver la última corrida
```

**Verificación:** sin cambios pendientes, imprime `sin cambios (<sha>) — nada que hacer`
y sale con código 0.

---

## 6. nginx

El bootstrap lo configura si está instalado. Si lo instalás después:

```bash
sudo apt-get install -y nginx
cd /opt/operacion-colombia && sudo bash infra/deploy/bootstrap.sh   # re-correr es seguro
```

**Verificación:** `curl -sI localhost | grep -i x-cache-status` devuelve el header.
Dos peticiones seguidas a `/api/kpi` deben dar `MISS` y después `HIT`.

Para HTTPS, `sudo certbot --nginx -d tu-dominio.com` (requiere el dominio apuntando
al VPS). No lo hagas antes de tener el DNS resuelto.

---

## 7. Poblar los datos

**La base arranca vacía: hasta este paso el panel muestra ceros en todo.**

```bash
cd /opt/operacion-colombia
sudo -u ocolombia node services/connectors/cli.js list        # fuentes registradas
sudo -u ocolombia node services/orchestrator/cli.js tick      # primera ingesta + fan-out
sudo -u ocolombia node services/connectors/cli.js status      # filas por fuente
```

La primera corrida tarda: baja DIVIPOLA, PIB, EVA agro, red vial INVIAS, SECOP II y
CHIP. Las siguientes son rápidas — el skip por etag/hash evita re-ingerir lo que no
cambió. A partir de acá corre sola todos los días a las 04:30 (`oc-etl.timer`).

### Minería (ANM) — requiere un paso previo

El MapServer de la ANM publica varias capas y su numeración no está documentada.
**Descubrila antes de ingerir**, no la adivines:

```bash
cd /opt/operacion-colombia
node services/arcgis-explorer/cli.js "https://geo.anm.gov.co/webgis/rest/services/ANM/ServiciosANM/MapServer"
```

Eso lista las capas con su id. Perfilá la que te interese antes de decidir:

```bash
node services/arcgis-explorer/cli.js "<url>/<id>" --profile --dict mineria --sample 500
```

Mirá tres cosas en la salida:

1. **`resuelve_municipio_pct`** — cuánto cruza contra DIVIPOLA. Por debajo de ~70%
   el dominio sirve a nivel departamento, no municipal.
2. **`nulos %`** por columna — si el área o las fechas vienen muy vacías, los
   agregados que dependan de ellas no van a significar nada.
3. **`colapsadas`** en la sección de geometría — si es > 0, bajá `ANM_OFFSET` a `0`.

Con el id verificado, agregalo al env y corré solo esa fuente:

```bash
sudo sed -i 's|^# *ANM_CAPAS=.*|ANM_CAPAS=<id>:titulos-vigentes|' /etc/operacion-colombia.env
sudo -u ocolombia node services/connectors/cli.js run --source anm-titulos-vigentes
```

**Guardá la salida del perfilado y compartila** — decide qué visualizaciones tienen
sentido para este dominio.

---

## 8. Verificación final

```bash
systemctl is-active operacion-colombia nginx     # active, active
systemctl list-timers | grep -E 'oc-(deploy|etl)'
curl -s localhost/api/health
curl -s localhost/api/status | head -c 400        # budget vs medido
curl -s "localhost/api/meta" | head -c 300        # fuentes y última corrida
```

En el navegador: `http://<ip-del-vps>/` — el panel. Revisá **Logs & Alertas** (budget
contra lo medido, latencia por ruta, corridas ETL) y **Datasets** (filas por fuente).

---

## Operación diaria

```bash
journalctl -u operacion-colombia -n 50 -f    # logs de la app
journalctl -u oc-deploy -n 50                # historial de deploys
journalctl -u oc-etl -n 100                  # última ingesta
sudo systemctl start oc-etl                  # forzar ETL ahora
node services/connectors/cli.js run --source <id> --force   # re-ingesta forzada
```

## Si algo se rompe

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `/api/health` no responde | el servicio no arrancó | `journalctl -u operacion-colombia -n 50` |
| `no such table: vias` | está corriendo el piloto viejo | `systemctl disable --now sivu.service` y re-correr el bootstrap |
| Deploy revierte solo | tests rojos o healthcheck fallido | `journalctl -u oc-deploy -n 40`; el commit anterior quedó activo, el servicio sigue vivo |
| Panel sin estilos | no debería pasar | las librerías están vendorizadas en `apps/web/vendor/`; revisá 404 en la consola del navegador |
| Panel en ceros | falta el ETL | paso 7 |
| ETL 403 / timeouts | rate limit de Socrata | cargá `SOCRATA_APP_TOKEN` en el env |

**Rollback manual:**

```bash
cd /opt/operacion-colombia
sudo -u ocolombia git reset --hard <sha-bueno>
sudo systemctl restart operacion-colombia
```

## Qué NO hacer

- No corras el servicio como root: el bootstrap crea `ocolombia` a propósito.
- No pongas secretos en el repo. Todo va a `/etc/operacion-colombia.env` (modo 640).
- No edites archivos dentro de `/opt/operacion-colombia`: el deploy hace
  `git reset --hard` y los pisa. Los cambios se hacen por PR.
- No uses una deploy key con permiso de escritura. Solo lectura.
