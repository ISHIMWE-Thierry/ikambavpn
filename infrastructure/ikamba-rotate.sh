#!/usr/bin/env bash
# IkambaVPN — rotate to a new IP after a Hostinger "change location" (free, no new VPS).
#
#   bash infrastructure/ikamba-rotate.sh <NEW_IP>
#
# What it does, in order:
#   1. repoints the DuckDNS hostname at the new IP
#   2. waits for DNS to actually move
#   3. re-provisions the box with the SAME REALITY keys  → every previously shared
#      link keeps working (that is the whole point)
#   4. verifies the tunnel + the subscription URL
#   5. checks the new IP really is reachable from inside Russia
#
# Identity/keys come from ~/.ikamba/secrets.env (local, chmod 600, never committed).
set -uo pipefail
NEW_IP="${1:-}"
[ -n "$NEW_IP" ] || { echo "usage: bash infrastructure/ikamba-rotate.sh <NEW_IP>"; exit 1; }

SECRETS="${IKAMBA_SECRETS:-$HOME/.ikamba/secrets.env}"
[ -f "$SECRETS" ] || { echo "missing $SECRETS"; exit 1; }
set -a; . "$SECRETS"; set +a
KEY="${IKAMBA_SSH_KEY/#\~/$HOME}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step(){ echo; echo "═══ $* ═══"; }

step "1/5  point $IKAMBA_HOST → $NEW_IP"
curl -s "https://www.duckdns.org/update?domains=${IKAMBA_HOST%%.*}&token=${IKAMBA_DUCKDNS_TOKEN}&ip=${NEW_IP}"; echo

step "2/5  wait for DNS"
for i in $(seq 1 30); do
  got=$(dig +short "$IKAMBA_HOST" A 2>/dev/null | tail -1)
  [ "$got" = "$NEW_IP" ] && { echo "DNS ok → $got"; break; }
  sleep 4
done

step "3/5  provision $NEW_IP (same keys → old links keep working)"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 "root@$NEW_IP" \
  "IKAMBA_UUID='$IKAMBA_UUID' IKAMBA_REALITY_PRIV='$IKAMBA_REALITY_PRIV' \
   IKAMBA_REALITY_PUB='$IKAMBA_REALITY_PUB' IKAMBA_VISION_SID='$IKAMBA_VISION_SID' \
   IKAMBA_GRPC_PRIV='$IKAMBA_GRPC_PRIV' IKAMBA_GRPC_PUB='$IKAMBA_GRPC_PUB' \
   IKAMBA_GRPC_SID='$IKAMBA_GRPC_SID' IKAMBA_GRPC_SVC='$IKAMBA_GRPC_SVC' \
   IKAMBA_DECOY='$IKAMBA_DECOY' IKAMBA_HOST='$IKAMBA_HOST' \
   IKAMBA_DUCKDNS_TOKEN='$IKAMBA_DUCKDNS_TOKEN' IKAMBA_EMAIL='$IKAMBA_EMAIL' \
   bash -s" < "$HERE/ikamba-provision.sh"

step "4/5  verify subscription URL"
code=$(curl -s -o /tmp/ikamba-sub.b64 -w '%{http_code}' --max-time 25 \
       "https://$IKAMBA_HOST:8443/xui-public/sub/free")
echo "HTTP $code"
[ "$code" = "200" ] && base64 --decode < /tmp/ikamba-sub.b64 | sed -E 's/\?[^#]*#/   #/'

step "5/5  is the new IP reachable from Russia?"
bash "$HERE/ikamba-ru-check.sh" "$NEW_IP" 2>/dev/null || echo "(ru-check skipped)"

echo
echo "ROTATION COMPLETE — existing link holders reconnect automatically (hostname-based)."
