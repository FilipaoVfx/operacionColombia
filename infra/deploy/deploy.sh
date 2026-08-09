#!/usr/bin/env bash
# Deploy por pull: el VPS trae los cambios, verifica y reinicia. Nadie necesita
# acceso entrante al servidor.
#
# Flujo: fetch → ¿hay cambios? → tests → reinicio → healthcheck → (si falla) rollback.
# Idempotente: si no hay commits nuevos, no toca nada y sale 0.
set -euo pipefail

APP_DIR="${OC_APP_DIR:-/opt/operacion-colombia}"
BRANCH="${OC_BRANCH:-main}"
SERVICE="${OC_SERVICE:-operacion-colombia}"
HEALTH_URL="${OC_HEALTH_URL:-http://127.0.0.1:8081/api/health}"
# La rama arrastra 1 test rojo preexistente (test/ai.test.js, retrieval del RAG).
# Se declara explícitamente en vez de desactivar la verificación entera; bajar a 0
# en cuanto ese bug se corrija.
ALLOWED_FAILURES="${OC_ALLOWED_TEST_FAILURES:-0}"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

cd "$APP_DIR" || die "no existe $APP_DIR (¿corriste bootstrap.sh?)"

PREV="$(git rev-parse HEAD)"
git fetch --quiet origin "$BRANCH" || die "git fetch falló"
NEXT="$(git rev-parse "origin/$BRANCH")"

if [ "$PREV" = "$NEXT" ]; then
  log "sin cambios ($(git rev-parse --short HEAD)) — nada que hacer"
  exit 0
fi

log "actualizando ${PREV:0:8} → ${NEXT:0:8}"
git reset --hard --quiet "origin/$BRANCH"

# Sin dependencias de runtime, pero si algún día aparecen, esto las instala.
if [ -f package-lock.json ]; then
  npm ci --omit=dev --silent || die "npm ci falló"
fi

log "corriendo tests"
TEST_OUT="$(npm test 2>&1 || true)"
FAILED="$(printf '%s' "$TEST_OUT" | sed -n 's/^# fail \([0-9]*\)$/\1/p' | tail -1)"
FAILED="${FAILED:-desconocido}"
if [ "$FAILED" = "desconocido" ]; then
  printf '%s\n' "$TEST_OUT" | tail -20
  git reset --hard --quiet "$PREV"; die "no pude leer el resultado de los tests; revertido a ${PREV:0:8}"
fi
if [ "$FAILED" -gt "$ALLOWED_FAILURES" ]; then
  printf '%s\n' "$TEST_OUT" | grep -E "^not ok" || true
  git reset --hard --quiet "$PREV"
  die "$FAILED tests fallaron (permitidos: $ALLOWED_FAILURES); revertido a ${PREV:0:8}"
fi
log "tests ok ($FAILED fallas, permitidas $ALLOWED_FAILURES)"

log "reiniciando $SERVICE"
sudo -n systemctl restart "$SERVICE" || die "no pude reiniciar $SERVICE"

# El healthcheck es la red de seguridad: si el servicio no responde, se vuelve atrás.
for i in $(seq 1 15); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    log "healthcheck ok — desplegado ${NEXT:0:8}"
    curl -fsS "$HEALTH_URL"; echo
    exit 0
  fi
  sleep 2
done

log "healthcheck falló tras 30s — revirtiendo a ${PREV:0:8}"
git reset --hard --quiet "$PREV"
sudo -n systemctl restart "$SERVICE" || true
die "deploy revertido; revisá: journalctl -u $SERVICE -n 50"
