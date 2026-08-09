# Despliegue en producción (ADR-001: Node + nginx)

> **Instrucciones paso a paso:** [`deploy/AGENTE.md`](deploy/AGENTE.md) — runbook
> ejecutable (Ubuntu), pensado para que lo siga un operador o un agente. Este archivo
> describe la topología; el runbook, el procedimiento.

## Topología
```
:80 nginx (micro-cache 60s API, 300s estáticos, single-flight)
      │ proxy_pass
:8081 run-node.sh apps/api/server.js   (systemd: operacion-colombia.service)
      │
data/osint.db  (registro unificado + read models, poblada por el ETL)
```

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
sudo -u ocolombia node services/connectors/cli.js run --all
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
- **Plataforma (`apps/api/server.js`):** pendiente de verificación en el servidor.
  En local responde `/api/health` y `/api/status` y sirve el panel desde `apps/web/`.
  Los scripts de `deploy/` se probaron en sintaxis y en su lógica de decisión
  (detección de node:sqlite, parseo del resultado de tests, caso "sin cambios"),
  no contra un Ubuntu real.
