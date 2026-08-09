# Despliegue en producción (ADR-001: Node + nginx)

> **Instrucciones paso a paso:** [`deploy/AGENTE.md`](deploy/AGENTE.md) — runbook
> ejecutable (Ubuntu), pensado para que lo siga un operador o un agente. Este archivo
> describe la topología; el runbook, el procedimiento.

## Topología
```
cloudflared (túnel público, systemd: cloudflared-opcol.service)
      │ --url http://localhost:80
:80 nginx (micro-cache, single-flight)
      │ proxy_pass
:8081 run-node.sh apps/api/server.js   (systemd: operacion-colombia.service, HOST=127.0.0.1)
      │
data/osint.db  (registro unificado + read models, poblada por el ETL)
```

El túnel entra por nginx, no por el proceso Node: el edge es la única puerta de
entrada y el tráfico público aprovecha el micro-caché. Con `HOST=127.0.0.1` el
proceso no acepta conexiones externas ni siquiera si se abre el puerto.

> El túnel rápido (`--url`) genera una URL nueva en cada reinicio. Para una URL
> estable hace falta un túnel con nombre y credencial.

La API sirve `/api/*` y el panel (`apps/web/`) desde el mismo proceso, como usuario
`ocolombia` sin shell. `PORT`/`HOST` y las variables de fuentes salen de
`/etc/operacion-colombia.env`, que **no está versionado**.

> **Piloto vial (SIVU).** `src/server.js` + `public/` + `data/sivu.db` son el piloto
> original, superado por la plataforma (PLANNING §1). Se conserva como referencia y se
> arranca con `npm run start:piloto` (puerto 8080). El bootstrap deshabilita
> `sivu.service` si lo encuentra: **no debe ser el servicio desplegado.**

## Unidades systemd

| Unidad | Rol |
|--------|-----|
| `operacion-colombia.service` | API + panel en :8081 (enabled, arranca al boot) |
| `oc-deploy.service` + `.timer` | deploy por pull cada 5 min: fetch → tests → restart → healthcheck → rollback si falla |
| `oc-etl.service` + `.timer` | ingesta diaria 04:30; el skip por etag/hash evita re-ingerir lo que no cambió |

Los archivos viven en [`deploy/systemd/`](deploy/systemd/) y los instala el bootstrap.

> **El ETL corre por el orquestador, no por el conector.** `connectors run --all` solo
> ingiere: se salta la cola M5 y con ella el fan-out que reconstruye vistas (M8),
> entidades (M6), grafo (M12), search (M7) y bbox. Con esa unidad mal puesta el panel
> sirve datos frescos sobre agregados viejos y el grafo queda vacío — ya pasó en el
> servidor. `orchestrator/cli.js tick` corre el scheduler y drena la cola.

## Modelo de despliegue: pull

El VPS trae los cambios desde GitHub por su cuenta. **Nada necesita acceso entrante al
servidor** y no hay credenciales en el repositorio ni en un CI. La única credencial es
una deploy key de solo lectura que vive en el VPS.

Si el healthcheck falla después de reiniciar, `deploy.sh` vuelve al commit anterior y
reinicia: un commit malo deja el servicio andando con la versión previa.

## Instalación

```bash
git clone <repo> /opt/operacion-colombia && cd /opt/operacion-colombia
sudo bash infra/deploy/bootstrap.sh
sudo nano /etc/operacion-colombia.env      # OC_BRANCH, ANM_CAPAS, tokens
sudo -u ocolombia node services/orchestrator/cli.js tick
```

Detalle, verificaciones y solución de problemas: [`deploy/AGENTE.md`](deploy/AGENTE.md).

## Operación

```bash
systemctl status operacion-colombia nginx oc-deploy.timer oc-etl.timer
journalctl -u operacion-colombia -n 50      # logs de la app
journalctl -u oc-deploy -n 30               # historial de deploys
node services/connectors/cli.js status      # metadatos + corridas ETL
curl -s localhost/api/health                # smoke test
curl -s localhost/api/status                # budget §2.3 vs medido
```

El panel expone lo mismo en **Logs & Alertas** (budget contra medido, latencia por
ruta, corridas ETL) y **Datasets** (filas y frescura por fuente).

## Verificado

- **2026-07-06 (piloto vial, `src/server.js`):** `/api/health` 200 con 660 tramos;
  panel 200 vía nginx; `/api/kpi` MISS 4.8 ms → HIT 0.6 ms; ETL 3 fuentes
  (divipola 1122, PIB 16302, INVIAS 661), segunda corrida = skip total.
- **2026-08-09 (plataforma en el servidor):** panel y API 200 vía nginx; `/api/status`
  MISS → HIT tras declarar TTL por endpoint; ETL migrado al orquestador y backfill del
  fan-out ejecutado (grafo 0 → **49 886 aristas**, search 47 121 → 49 456, vistas
  reconstruidas); SSRF del explorer cerrado (`?domain=169.254.169.254` → 400) y
  `register` exigiendo `X-Admin-Token` (401 sin él, 201 con él).
- **Pendiente:** rate-limit y CORS en la Read API.
