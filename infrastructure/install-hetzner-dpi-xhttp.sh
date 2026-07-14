#!/usr/bin/env bash
# Install test30-style VLESS+XHTTP+REALITY on Hetzner (Russia-DPI profile).
# Mirrors all clients from inbound 1 (TCP REALITY) into the new/updated XHTTP inbound.
#
# Usage:
#   PANEL_PASS='…' ./infrastructure/install-hetzner-dpi-xhttp.sh
#
# Env:
#   PANEL_URL     default https://100.66.221.4:2053/x7kQ9m
#   PANEL_USER    default ikamba
#   PUBLIC_HOST   default 194.76.217.4
#   XHTTP_PORT    default 8443
#   XHTTP_PATH    default /assets/fceebc8ad5ca/events
#   SOURCE_INBOUND_ID  default 1

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PANEL_URL="${PANEL_URL:-https://100.66.221.4:2053/x7kQ9m}"
export PANEL_USER="${PANEL_USER:-ikamba}"
export PANEL_PASS="${PANEL_PASS:-}"
export PUBLIC_HOST="${PUBLIC_HOST:-194.76.217.4}"
export XHTTP_PORT="${XHTTP_PORT:-8443}"
export XHTTP_PATH="${XHTTP_PATH:-/assets/fceebc8ad5ca/events}"
export SOURCE_INBOUND_ID="${SOURCE_INBOUND_ID:-1}"

if [[ -z "$PANEL_PASS" ]]; then
  echo "Usage: PANEL_PASS='your-panel-password' $0"
  exit 1
fi

exec python3 "$REPO_ROOT/infrastructure/install-hetzner-dpi-xhttp.py"
