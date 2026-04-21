#!/usr/bin/env bash
# Create a VLESS+WS inbound on Aeza port 2083 matching the Hetzner one,
# then mirror all existing VLESS+REALITY clients into it (same UUIDs, flow="" for WS).
# Run on Aeza (localhost 127.0.0.1:39182).

set -euo pipefail

AEZA_URL="http://127.0.0.1:39182/x7kQ9m"
AEZA_USER="ikamba"
AEZA_PASS="Ts7vAOl921zLOMCWfJVIKySm"

COOKIE=$(mktemp)
trap 'rm -f "$COOKIE"' EXIT

echo "==> Login..."
curl -sS -c "$COOKIE" -d "username=$AEZA_USER&password=$AEZA_PASS" "$AEZA_URL/login" >/dev/null

echo "==> Fetching inbound 1 (REALITY) clients..."
INB1=$(curl -sS -b "$COOKIE" "$AEZA_URL/panel/api/inbounds/get/1")
CLIENTS=$(echo "$INB1" | jq -c '.obj.settings | fromjson | .clients')
COUNT=$(echo "$CLIENTS" | jq 'length')
echo "   Found $COUNT clients"

# Build WS client list — same UUIDs, empty flow, suffix email with "-ws" (3X-UI requires unique emails)
WS_CLIENTS=$(echo "$CLIENTS" | jq -c 'map({id, email:(.email+"-ws"), enable, flow:"", totalGB, expiryTime, limitIp, tgId:(.tgId//""), subId, reset:(.reset//0)})')

# Check if port 2083 already exists
EXISTING=$(curl -sS -b "$COOKIE" "$AEZA_URL/panel/api/inbounds/list" | jq '.obj[] | select(.port==2083) | .id')
if [ -n "$EXISTING" ]; then
  echo "==> Inbound on 2083 already exists (id=$EXISTING) — skipping create."
  INBOUND_ID=$EXISTING
else
  echo "==> Creating VLESS+WS inbound on :2083..."
  SETTINGS=$(jq -nc --argjson clients "$WS_CLIENTS" \
    '{clients:$clients, decryption:"none", fallbacks:[]}')
  STREAM='{"network":"ws","security":"none","wsSettings":{"acceptProxyProtocol":false,"path":"/ws-tunnel","host":"","headers":{"Host":"dl.google.com"}},"sockopt":{"tcpFastOpen":true,"tcpKeepAliveIdle":300,"tcpKeepAliveInterval":30}}'
  SNIFF='{"enabled":true,"destOverride":["http","tls"],"metadataOnly":false,"routeOnly":false}'

  BODY=$(jq -nc \
    --arg rem "IKAMBAVPN-WS" \
    --argjson port 2083 \
    --arg proto "vless" \
    --arg settings "$SETTINGS" \
    --arg stream "$STREAM" \
    --arg sniff "$SNIFF" \
    --arg tag "inbound-2083" \
    '{up:0,down:0,total:0,enable:true,expiryTime:0,listen:"",remark:$rem,port:$port,protocol:$proto,settings:$settings,streamSettings:$stream,sniffing:$sniff,tag:$tag}')

  RES=$(curl -sS -b "$COOKIE" -H 'Content-Type: application/json' -d "$BODY" "$AEZA_URL/panel/api/inbounds/add")
  OK=$(echo "$RES" | jq -r '.success')
  MSG=$(echo "$RES" | jq -r '.msg // ""')
  echo "   success=$OK msg=$MSG"
  INBOUND_ID=$(echo "$RES" | jq -r '.obj.id')
fi

echo ""
echo "==> Final check — listening ports:"
ss -tlnp 2>/dev/null | grep -E ':(443|2083|8443|39182)' || true
echo ""
echo "==> DONE. WS inbound id=$INBOUND_ID on :2083 with clients mirrored."
