#!/usr/bin/env bash
# Envoltorio único para invocar node en el VPS.
#
# node:sqlite exige --experimental-sqlite entre Node 22.5 y 22.x; en versiones más
# nuevas la bandera puede no existir y pasarla sería un error de arranque. Se prueba
# si el runtime la acepta en vez de asumir una u otra forma.
#
#   run-node.sh apps/api/server.js
#   run-node.sh services/connectors/cli.js run --all
set -euo pipefail
cd "$(dirname "$0")/../.."

if node --experimental-sqlite -e '' >/dev/null 2>&1; then
  exec node --experimental-sqlite "$@"
else
  exec node "$@"
fi
