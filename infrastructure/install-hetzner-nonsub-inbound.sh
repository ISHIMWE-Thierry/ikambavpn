#!/usr/bin/env bash
# Dedicated NONSUB inbound (TCP+REALITY, no Cloudflare). Run when panel is reachable.
# Usage: PANEL_PASS='…' ./infrastructure/install-hetzner-nonsub-inbound.sh

set -euo pipefail
export PANEL_URL="${PANEL_URL:-https://100.66.221.4:2053/x7kQ9m}"
export PANEL_USER="${PANEL_USER:-ikamba}"
export NONSUB_PORT="${NONSUB_PORT:-43235}"
exec python3 "$(dirname "$0")/install-hetzner-nonsub-inbound.py"
