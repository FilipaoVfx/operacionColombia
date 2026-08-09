#!/usr/bin/env bash
# Instalación inicial en Ubuntu. Idempotente: se puede re-correr sin romper nada.
# Requiere root (sudo). No pide ni almacena credenciales.
#
#   sudo bash infra/deploy/bootstrap.sh
#
# Qué hace: usuario de servicio → dirs → env → systemd → nginx → primer arranque.
# Qué NO hace: clonar el repo (ver AGENTE.md §2) ni correr el ETL (§7).
set -euo pipefail

APP_DIR="${OC_APP_DIR:-/opt/operacion-colombia}"
SVC_USER="${OC_USER:-ocolombia}"
ENV_FILE="/etc/operacion-colombia.env"
NGINX_SITE="/etc/nginx/sites-available/operacion-colombia"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
info() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "corré con sudo"
[ -d "$APP_DIR/.git" ] || die "$APP_DIR no es un clon git — cloná el repo primero (AGENTE.md §2)"

info "1. Node"
command -v node >/dev/null || die "node no está instalado"
NODE_V="$(node -p 'process.versions.node')"
NODE_MAJ="${NODE_V%%.*}"; NODE_MIN="$(printf '%s' "$NODE_V" | cut -d. -f2)"
if [ "$NODE_MAJ" -lt 22 ] || { [ "$NODE_MAJ" -eq 22 ] && [ "$NODE_MIN" -lt 5 ]; }; then
  die "Node $NODE_V < 22.5 — node:sqlite no existe. Instalá Node 22 LTS o superior."
fi
ok "Node $NODE_V"
node -e 'require("node:sqlite")' 2>/dev/null \
  || node --experimental-sqlite -e 'require("node:sqlite")' 2>/dev/null \
  || die "este Node no expone node:sqlite"
ok "node:sqlite disponible"

info "2. Usuario de servicio"
if id "$SVC_USER" >/dev/null 2>&1; then ok "$SVC_USER ya existe"
else useradd --system --create-home --shell /usr/sbin/nologin "$SVC_USER"; ok "$SVC_USER creado"; fi

info "3. Permisos y directorios"
mkdir -p "$APP_DIR/data" /var/cache/nginx/operacion-colombia
chown -R "$SVC_USER:$SVC_USER" "$APP_DIR"
chown -R www-data:www-data /var/cache/nginx/operacion-colombia
chmod +x "$APP_DIR"/infra/deploy/*.sh
ok "$APP_DIR y caché de nginx listos"

info "4. Archivo de entorno"
if [ -f "$ENV_FILE" ]; then ok "$ENV_FILE ya existe (no se sobrescribe)"
else
  cp "$APP_DIR/infra/deploy/operacion-colombia.env.example" "$ENV_FILE"
  chown root:"$SVC_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
  ok "$ENV_FILE creado desde el ejemplo — revisalo antes de ingerir"
fi

info "5. Permiso acotado para reiniciar el servicio"
# El deploy corre como $SVC_USER y necesita reiniciar la unidad; se le da SOLO eso.
cat > /etc/sudoers.d/operacion-colombia <<EOF
$SVC_USER ALL=(root) NOPASSWD: /bin/systemctl restart operacion-colombia, /usr/bin/systemctl restart operacion-colombia
EOF
chmod 440 /etc/sudoers.d/operacion-colombia
visudo -c >/dev/null || die "sudoers inválido"
ok "sudoers: solo 'systemctl restart operacion-colombia'"

info "6. Unidades systemd"
for u in operacion-colombia.service oc-deploy.service oc-deploy.timer oc-etl.service oc-etl.timer; do
  install -m 644 "$APP_DIR/infra/deploy/systemd/$u" "/etc/systemd/system/$u"
done
systemctl daemon-reload
ok "5 unidades instaladas"

info "7. Migración desde el piloto vial"
if systemctl list-unit-files 2>/dev/null | grep -q '^sivu\.service'; then
  systemctl disable --now sivu.service 2>/dev/null || true
  ok "sivu.service (piloto en :8080) detenido y deshabilitado"
else
  ok "no hay sivu.service — instalación limpia"
fi

info "8. nginx"
if command -v nginx >/dev/null; then
  install -m 644 "$APP_DIR/infra/deploy/nginx/operacion-colombia.conf" "$NGINX_SITE"
  ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/operacion-colombia
  rm -f /etc/nginx/sites-enabled/default
  nginx -t >/dev/null 2>&1 || die "config de nginx inválida (nginx -t para ver el detalle)"
  systemctl reload nginx
  ok "nginx configurado y recargado"
else
  ok "nginx no instalado — la API queda expuesta solo en \$PORT (saltando)"
fi

info "9. Arranque"
systemctl enable --now operacion-colombia.service
systemctl enable --now oc-deploy.timer oc-etl.timer
sleep 3
PORT_N="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]')"; PORT_N="${PORT_N:-8081}"
if curl -fsS --max-time 5 "http://127.0.0.1:${PORT_N}/api/health" >/dev/null; then
  ok "API responde en :$PORT_N"
  curl -fsS "http://127.0.0.1:${PORT_N}/api/health"; echo
else
  die "la API no respondió — journalctl -u operacion-colombia -n 50"
fi

cat <<EOF

Listo. La base está vacía: hasta correr el ETL el panel muestra ceros.

  sudo -u $SVC_USER node $APP_DIR/services/connectors/cli.js run --all
  sudo -u $SVC_USER node $APP_DIR/services/connectors/cli.js status

Después:  curl -s localhost/api/status   (o el panel → Logs & Alertas)
EOF
