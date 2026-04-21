#!/usr/bin/env bash
# Migrate all clients from Hetzner (194.76.217.4) inbound 1 to Aeza (local) inbound 1.
# Preserves UUIDs so existing VLESS links keep working.
# Run ON the Aeza server (or anywhere that can reach both panels).

set -euo pipefail

HETZ_URL="https://194.76.217.4:2053/x7kQ9m"
HETZ_USER="ikamba"
HETZ_PASS="VJjW4NCly3ban1t4noFOywH"
HETZ_INBOUND=1

AEZA_URL="http://127.0.0.1:39182/x7kQ9m"
AEZA_USER="ikamba"
AEZA_PASS="Ts7vAOl921zLOMCWfJVIKySm"
AEZA_INBOUND=1

HETZ_COOKIE=$(mktemp)
AEZA_COOKIE=$(mktemp)
trap 'rm -f "$HETZ_COOKIE" "$AEZA_COOKIE"' EXIT

echo "==> Logging into Hetzner panel..."
curl -ksS -c "$HETZ_COOKIE" -d "username=$HETZ_USER&password=$HETZ_PASS" "$HETZ_URL/login" >/dev/null

echo "==> Logging into Aeza panel..."
curl -sS -c "$AEZA_COOKIE" -d "username=$AEZA_USER&password=$AEZA_PASS" "$AEZA_URL/login" >/dev/null

echo "==> Fetching Hetzner inbound $HETZ_INBOUND..."
HETZ_JSON=$(curl -ksS -b "$HETZ_COOKIE" "$HETZ_URL/panel/api/inbounds/get/$HETZ_INBOUND")

echo "==> Fetching Aeza inbound $AEZA_INBOUND..."
AEZA_JSON=$(curl -sS -b "$AEZA_COOKIE" "$AEZA_URL/panel/api/inbounds/get/$AEZA_INBOUND")

# Existing Aeza UUIDs (skip these)
EXISTING=$(echo "$AEZA_JSON" | jq -r '.obj.settings | fromjson | .clients[].id' | sort -u)
echo "==> Aeza already has $(echo "$EXISTING" | grep -cv '^$') clients"

# All Hetzner clients
HETZ_CLIENTS=$(echo "$HETZ_JSON" | jq -c '.obj.settings | fromjson | .clients[]')
TOTAL=$(echo "$HETZ_CLIENTS" | wc -l | tr -d ' ')
echo "==> Hetzner has $TOTAL clients — migrating..."

ADDED=0
SKIPPED=0
FAILED=0

while IFS= read -r CLIENT; do
  UUID=$(echo "$CLIENT" | jq -r '.id')
  EMAIL=$(echo "$CLIENT" | jq -r '.email')

  if echo "$EXISTING" | grep -qx "$UUID"; then
    SKIPPED=$((SKIPPED+1))
    continue
  fi

  # Force flow xtls-rprx-vision (REALITY), keep rest as-is
  PATCHED=$(echo "$CLIENT" | jq -c '.flow="xtls-rprx-vision" | .enable=true')
  PAYLOAD=$(jq -nc --argjson client "$PATCHED" --arg id "$AEZA_INBOUND" \
    '{id: ($id|tonumber), settings: ({clients:[$client]}|tostring)}')

  RES=$(curl -sS -b "$AEZA_COOKIE" -H 'Content-Type: application/json' \
    -d "$PAYLOAD" "$AEZA_URL/panel/api/inbounds/addClient")

  OK=$(echo "$RES" | jq -r '.success')
  if [ "$OK" = "true" ]; then
    ADDED=$((ADDED+1))
    printf "  + %s (%s)\n" "$EMAIL" "${UUID:0:8}"
  else
    FAILED=$((FAILED+1))
    MSG=$(echo "$RES" | jq -r '.msg // "?"')
    printf "  ! %s FAILED: %s\n" "$EMAIL" "$MSG"
  fi
done <<< "$HETZ_CLIENTS"

echo ""
echo "==> DONE: added=$ADDED  skipped=$SKIPPED  failed=$FAILED  total=$TOTAL"
