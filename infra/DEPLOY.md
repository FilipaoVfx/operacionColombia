# Despliegue en producción (ADR-001: Node + nginx)

## Topología
```
:80 nginx (micro-cache 60s API, 300s estáticos, single-flight)
      │ proxy_pass
:8080 node src/server.js  (systemd: sivu.service, restart on-failure)
      │
data/sivu.db   (piloto vial, poblada por npm run ingest)
data/osint.db  (registro unificado multi-dominio, poblada por npm run etl)
```

## Unidades systemd
| Unidad | Rol |
|--------|-----|
| `sivu.service` | API + panel en :8080 (enabled, arranca al boot) |
| `osint-etl.service` | corrida `connectors run --all` (oneshot) |
| `osint-etl.timer` | dispara el ETL a diario; el skip por etag/hash evita re-ingestas inútiles |

## Config nginx
`/etc/nginx/sites-available/operacion-colombia` (symlink en sites-enabled; default eliminado).
Cache en `/var/cache/nginx/sivu`. Header `X-Cache-Status` expone HIT/MISS.

## Operación
```bash
systemctl status sivu nginx osint-etl.timer
journalctl -u sivu -n 50               # logs de la app
node services/connectors/cli.js status  # metadatos + corridas ETL
node services/connectors/cli.js run --source gdxc-w37w --force  # re-ingesta forzada
curl -s localhost/api/health             # smoke test
```

## Verificado 2026-07-06
- `GET /api/health` → 200, 660 tramos.
- Panel `GET /` → 200 vía nginx.
- `GET /api/kpi` MISS 4.8ms → HIT 0.6ms (micro-cache).
- ETL 3 fuentes: divipola 1122, PIB 16302, INVIAS 661; segunda corrida = skip total.
