#!/usr/bin/env bash
# Create a "social-optimized" VLESS+WS inbound on Stockholm port 2087.
# Path: /yt-stream, Host header: i.ytimg.com (camouflages as YouTube image CDN).
# Mirrors all existing VLESS+REALITY clients into it (same UUIDs, email +"-yt", flow="").
# Run on the Stockholm VPS — talks to the local 3X-UI panel.
#
# Companion: paste the routing-rules snippet (printed at the end) into
#            3X-UI panel → Xray Settings → routing rules to enable ad blocking
#            on this inbound's tag.

set -euo pipefail

PANEL_URL="${PANEL_URL:-http://127.0.0.1:39182/x7kQ9m}"
PANEL_USER="${PANEL_USER:-ikamba}"
PANEL_PASS="${PANEL_PASS:-Ts7vAOl921zLOMCWfJVIKySm}"

PORT=2087
PATH_VAL="/yt-stream"
HOST_HDR="i.ytimg.com"
TAG="social-inbound-2087"
REMARK="IKAMBAVPN-SOCIAL"

COOKIE=$(mktemp)
trap 'rm -f "$COOKIE"' EXIT

echo "==> Login to 3X-UI panel..."
curl -sS -c "$COOKIE" -d "username=$PANEL_USER&password=$PANEL_PASS" "$PANEL_URL/login" >/dev/null

echo "==> Fetching inbound 1 (REALITY) clients to mirror..."
INB1=$(curl -sS -b "$COOKIE" "$PANEL_URL/panel/api/inbounds/get/1")
CLIENTS=$(echo "$INB1" | jq -c '.obj.settings | fromjson | .clients')
COUNT=$(echo "$CLIENTS" | jq 'length')
echo "   Found $COUNT clients to mirror"

# Build social client list — same UUIDs, empty flow (WS doesn't use Vision), email +"-yt" suffix
SOCIAL_CLIENTS=$(echo "$CLIENTS" | jq -c 'map({id, email:(.email+"-yt"), enable, flow:"", totalGB, expiryTime, limitIp, tgId:(.tgId//""), subId, reset:(.reset//0)})')

echo "==> Checking if port $PORT already has an inbound..."
EXISTING=$(curl -sS -b "$COOKIE" "$PANEL_URL/panel/api/inbounds/list" | jq ".obj[] | select(.port==$PORT) | .id")
if [ -n "$EXISTING" ]; then
  echo "==> Inbound on $PORT already exists (id=$EXISTING) — skipping create."
  INBOUND_ID=$EXISTING
else
  echo "==> Creating VLESS+WS social inbound on :$PORT..."
  SETTINGS=$(jq -nc --argjson clients "$SOCIAL_CLIENTS" \
    '{clients:$clients, decryption:"none", fallbacks:[]}')

  STREAM=$(jq -nc --arg path "$PATH_VAL" --arg host "$HOST_HDR" \
    '{network:"ws", security:"none",
      wsSettings:{acceptProxyProtocol:false, path:$path, host:"", headers:{Host:$host}},
      sockopt:{tcpFastOpen:true, tcpKeepAliveIdle:300, tcpKeepAliveInterval:30}}')

  SNIFF='{"enabled":true,"destOverride":["http","tls"],"metadataOnly":false,"routeOnly":false}'

  BODY=$(jq -nc \
    --arg rem "$REMARK" \
    --argjson port "$PORT" \
    --arg proto "vless" \
    --arg settings "$SETTINGS" \
    --arg stream "$STREAM" \
    --arg sniff "$SNIFF" \
    --arg tag "$TAG" \
    '{up:0,down:0,total:0,enable:true,expiryTime:0,listen:"",remark:$rem,port:$port,protocol:$proto,settings:$settings,streamSettings:$stream,sniffing:$sniff,tag:$tag}')

  RES=$(curl -sS -b "$COOKIE" -H 'Content-Type: application/json' -d "$BODY" "$PANEL_URL/panel/api/inbounds/add")
  OK=$(echo "$RES" | jq -r '.success')
  MSG=$(echo "$RES" | jq -r '.msg // ""')
  echo "   success=$OK msg=$MSG"
  INBOUND_ID=$(echo "$RES" | jq -r '.obj.id')
fi

echo ""
echo "==> Opening UFW port $PORT/tcp..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow "$PORT/tcp" || true
  ufw status | grep -E "^$PORT" || true
else
  echo "   (ufw not installed — skipping)"
fi

echo ""
echo "==> Final check — listening ports:"
ss -tlnp 2>/dev/null | grep -E ":(443|2083|2087|8443|39182)" || true

echo ""
echo "==> DONE. Social-optimized WS inbound id=$INBOUND_ID on :$PORT (tag=$TAG)"
echo ""
echo "================================================================"
echo "NEXT: paste this routing rules snippet into 3X-UI panel UI"
echo "      → Xray Settings → routing rules (or merge into existing)"
echo "================================================================"
cat <<EOF
{
  "rules": [
    {
      "type": "field",
      "inboundTag": ["$TAG"],
      "domain": ["geosite:category-ads-all"],
      "outboundTag": "blocked"
    },
    {
      "type": "field",
      "inboundTag": ["$TAG"],
      "domain": [
        "domain:doubleclick.net",
        "domain:googlesyndication.com",
        "domain:googletagmanager.com",
        "domain:googletagservices.com",
        "domain:google-analytics.com",
        "domain:adservice.google.com",
        "domain:scorecardresearch.com",
        "domain:moatads.com",
        "domain:facebook.com/tr",
        "domain:graph.facebook.com/logging",
        "domain:connect.facebook.net",
        "domain:analytics.tiktok.com",
        "domain:business-api.tiktok.com",
        "domain:graph.instagram.com/logging_client_events"
      ],
      "outboundTag": "blocked"
    }
  ]
}
EOF
echo ""
echo "Also ensure the 'blocked' outbound exists in panel → Xray Settings → outbounds:"
echo '  { "tag": "blocked", "protocol": "blackhole" }'
echo ""
echo "After saving, restart Xray from the panel (or it auto-restarts on save)."
