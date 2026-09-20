#!/usr/bin/env bash
# Normaliza el resumen de `node --test`: Node 22 usa TAP (`# fail N`) y
# Node 24 usa el reporter spec (`ℹ fail N`). Lee el reporte por stdin.
set -euo pipefail

sed -n -E \
  -e 's/^# fail ([0-9]+)$/\1/p' \
  -e 's/^[^[:digit:]]*fail ([0-9]+)$/\1/p' \
  | tail -1
