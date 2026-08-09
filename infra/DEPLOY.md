# Despliegue en producción (ADR-001: Node + nginx)

## Topología
```
:80 nginx (micro-cache 60s API, 300s estáticos, single-flight)
      │ proxy_pass
:8081 node apps/api/server.js  (systemd: operacion-colombia.service, restart on-failure)
      │
data/osint.db  (registro unificado multi-dominio + read models, poblada por npm run etl)
```

El servicio sirve la Read API (`/api/*`) y el panel (`apps/web/`) desde el mismo proceso.
`PORT` y `HOST` se pueden sobreescribir por entorno (por defecto `8081` y `0.0.0.0`).

> **Piloto vial (SIVU).** `src/server.js` + `public/` + `data/sivu.db` son el piloto original,
> ya superado por la plataforma (PLANNING §1). Se conserva como referencia y se arranca con
> `npm run start:piloto` (puerto 8080). **No debe ser el servicio desplegado.**

## Unidades systemd
| Unidad | Rol |
|--------|-----|
| `operacion-colombia.service` | API + panel en :8081 (enabled, arranca al boot) |
| `osint-etl.service` | corrida `connectors run --all` (oneshot) |
| `osint-etl.timer` | dispara el ETL a diario; el skip por etag/hash evita re-ingestas inútiles |

`ExecStart` del servicio: `node --experimental-sqlite apps/api/server.js` (equivale a `npm start`).

## Config nginx
`/etc/nginx/sites-available/operacion-colombia` (symlink en sites-enabled; default eliminado).
Cache en `/var/cache/nginx/sivu`. Header `X-Cache-Status` expone HIT/MISS.
El `proxy_pass` debe apuntar a `:8081`.

## Operación
```bash
systemctl status operacion-colombia nginx osint-etl.timer
journalctl -u operacion-colombia -n 50    # logs de la app
node services/connectors/cli.js status     # metadatos + corridas ETL
node services/connectors/cli.js run --source gdxc-w37w --force  # re-ingesta forzada
curl -s localhost/api/health               # smoke test
curl -s localhost/api/status               # budget §2.3 vs medido (también en el panel: Logs & Alertas)
```

## Migración desde el despliegue del piloto
Si el servidor todavía corre `sivu.service` con `src/server.js` en :8080:
1. Actualizar `ExecStart` a `apps/api/server.js` (o crear `operacion-colombia.service` y deshabilitar `sivu.service`).
2. Apuntar el `proxy_pass` de nginx a `:8081`.
3. Poblar `data/osint.db` con `npm run etl` (el panel nuevo no lee `sivu.db`).
4. `systemctl daemon-reload && systemctl restart operacion-colombia nginx`.

## Verificado
- **2026-07-06 (piloto vial, `src/server.js`):** `/api/health` 200 con 660 tramos; panel 200 vía
  nginx; `/api/kpi` MISS 4.8 ms → HIT 0.6 ms; ETL 3 fuentes (divipola 1122, PIB 16302,
  INVIAS 661), segunda corrida = skip total.
- **Plataforma (`apps/api/server.js`):** pendiente de verificación en el servidor. En local
  responde `/api/health`, `/api/status` y sirve el panel desde `apps/web/`.
