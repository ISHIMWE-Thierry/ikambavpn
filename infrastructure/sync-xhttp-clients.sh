#!/usr/bin/env bash
set -euo pipefail

DB=/etc/x-ui/x-ui.db
CONFIG=/usr/local/etc/xray-codex/config.json
MOSCOW_HOST=5.42.119.72
MOSCOW_KEY=/root/.ssh/moscow_sync_ed25519
MOSCOW_CONFIG=/usr/local/etc/xray-moscow/config.json
TMP=$(mktemp)

sqlite3 "$DB" "select settings from inbounds where id=1;" \
  | jq '[.clients[] | select((.enable // true) != false) | {id, flow: ""}]' \
  > "$TMP.clients"

# Per-inbound flow: TCP+REALITY inbounds use Vision; XHTTP/others use no flow.
jq --slurpfile clients "$TMP.clients" '
  .inbounds |= map(
    if .protocol == "vless" then
      (.streamSettings.network) as $net
      | .settings.clients = ($clients[0] | map(.flow = (if $net == "tcp" then "xtls-rprx-vision" else "" end)))
    else
      .
    end
  )
' "$CONFIG" > "$TMP"

install -m 600 "$TMP" "$CONFIG"
systemctl restart xray-codex-xhttp

if [ -f "$MOSCOW_KEY" ]; then
  timeout 20s ssh -i "$MOSCOW_KEY" -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new \
    "root@$MOSCOW_HOST" "cat > /tmp/ikamba-xray-clients.json" < "$TMP.clients" \
  && timeout 20s ssh -i "$MOSCOW_KEY" -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new \
    "root@$MOSCOW_HOST" \
    "node -e 'const fs=require(\"fs\"); const configPath=process.argv[1]; const clients=JSON.parse(fs.readFileSync(\"/tmp/ikamba-xray-clients.json\",\"utf8\")); const config=JSON.parse(fs.readFileSync(configPath,\"utf8\")); config.inbounds=config.inbounds.map((inbound)=>inbound.protocol===\"vless\"?{...inbound,settings:{...inbound.settings,clients}}:inbound); fs.writeFileSync(configPath,JSON.stringify(config,null,2)+\"\\n\");' '$MOSCOW_CONFIG' && rm -f /tmp/ikamba-xray-clients.json && systemctl restart xray-moscow" \
  || echo "[sync-xhttp-clients] Moscow sync failed" >&2
fi

rm -f "$TMP" "$TMP.clients"
