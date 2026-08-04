#!/usr/bin/env bash
# IkambaVPN — full node provisioning. Runs ON the VPS (fresh Ubuntu 22/24).
#
# Secret-free by design: every key/token arrives as an env var, nothing is baked in.
# Re-running is safe (idempotent). Reusing the SAME keys is what keeps every
# previously-shared link working after an IP rotation.
#
# Required env: IKAMBA_UUID IKAMBA_REALITY_PRIV IKAMBA_REALITY_PUB IKAMBA_VISION_SID
#               IKAMBA_GRPC_PRIV IKAMBA_GRPC_PUB IKAMBA_GRPC_SID IKAMBA_GRPC_SVC
#               IKAMBA_DECOY IKAMBA_HOST IKAMBA_DUCKDNS_TOKEN IKAMBA_EMAIL
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
say(){ echo "[provision] $*"; }

for v in IKAMBA_UUID IKAMBA_REALITY_PRIV IKAMBA_GRPC_PRIV IKAMBA_GRPC_PUB IKAMBA_GRPC_SID \
         IKAMBA_DECOY IKAMBA_HOST IKAMBA_DUCKDNS_TOKEN; do
  [ -n "${!v:-}" ] || { echo "MISSING env $v"; exit 1; }
done

# ── 1. prereqs (fresh Ubuntu lacks unzip → the xray installer fails silently without it)
say "installing prerequisites"
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq curl unzip socat ca-certificates >/dev/null 2>&1

# ── 2. xray
if ! command -v xray >/dev/null; then
  say "installing xray-core"
  bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install >/dev/null 2>&1
fi
command -v xray >/dev/null || { echo "xray install FAILED"; exit 1; }
say "xray: $(xray version | head -1)"

# ── 3. speed tuning (BBR + fq). TCP Fast Open intentionally OFF: it corrupts the
#      first bytes of some REALITY handshakes on real networks.
cat > /etc/sysctl.d/99-ikamba-speed.conf <<'SYS'
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
net.ipv4.tcp_mtu_probing=1
net.ipv4.tcp_slow_start_after_idle=0
net.core.rmem_max=67108864
net.core.wmem_max=67108864
net.ipv4.tcp_rmem=4096 87380 67108864
net.ipv4.tcp_wmem=4096 65536 67108864
SYS
modprobe tcp_bbr 2>/dev/null || true
sysctl -p /etc/sysctl.d/99-ikamba-speed.conf >/dev/null 2>&1
say "congestion: $(sysctl -n net.ipv4.tcp_congestion_control)"

# ── 4. xray config — 3 legs. gRPC(9443) + WS(8448) are the RU-proven pair (framed
#      transports survive the TSPU stream-freeze); Vision(443) is kept for speed on
#      clean networks. 8443 stays free for the subscription (Caddy).
mkdir -p /usr/local/etc/xray
python3 - "$IKAMBA_REALITY_PRIV" "$IKAMBA_GRPC_PRIV" "$IKAMBA_GRPC_SID" "$IKAMBA_UUID" \
         "$IKAMBA_VISION_SID" "$IKAMBA_GRPC_SVC" "$IKAMBA_DECOY" > /usr/local/etc/xray/config.json <<'PY'
import json,sys
priv,gpriv,gsid,uuid,vsid,gsvc,decoy = sys.argv[1:8]
S={"tcpcongestion":"bbr"}
def R(pk,sid): return {"show":False,"target":f"{decoy}:443","xver":0,
                       "serverNames":[decoy],"privateKey":pk,"shortIds":[sid]}
print(json.dumps({"log":{"loglevel":"warning"},"inbounds":[
 {"tag":"reality-443","listen":"0.0.0.0","port":443,"protocol":"vless",
  "settings":{"clients":[{"id":uuid,"flow":"xtls-rprx-vision"}],"decryption":"none"},
  "streamSettings":{"network":"tcp","security":"reality","realitySettings":R(priv,vsid),"sockopt":S}},
 {"tag":"reality-grpc","listen":"0.0.0.0","port":9443,"protocol":"vless",
  "settings":{"clients":[{"id":uuid}],"decryption":"none"},
  "streamSettings":{"network":"grpc","security":"reality",
   "grpcSettings":{"serviceName":gsvc,"multiMode":False},
   "realitySettings":R(gpriv,gsid),"sockopt":S}},
 {"tag":"ws-8448","listen":"0.0.0.0","port":8448,"protocol":"vless",
  "settings":{"clients":[{"id":uuid}],"decryption":"none"},
  "streamSettings":{"network":"ws","security":"none","wsSettings":{"path":"/upload/session"}}}
],"outbounds":[{"protocol":"freedom"},{"protocol":"blackhole","tag":"blackhole"}]},indent=2))
PY
xray -test -config /usr/local/etc/xray/config.json >/dev/null 2>&1 || { echo "BAD xray config"; exit 1; }
systemctl enable xray >/dev/null 2>&1; systemctl restart xray; sleep 3
say "xray: $(systemctl is-active xray)"

# ── 5. firewall (only if ufw is active)
if ufw status 2>/dev/null | grep -q "Status: active"; then
  for p in 22 443 8443 9443 8448; do ufw allow $p/tcp >/dev/null 2>&1; done
fi

# ── 6. TLS cert for the subscription host (DNS-01 via DuckDNS — no port conflicts)
if [ ! -f ~/.acme.sh/acme.sh ]; then
  curl -s https://get.acme.sh | sh -s email="${IKAMBA_EMAIL:-admin@example.com}" >/dev/null 2>&1
fi
export DuckDNS_Token="$IKAMBA_DUCKDNS_TOKEN"
~/.acme.sh/acme.sh --set-default-ca --server letsencrypt >/dev/null 2>&1
mkdir -p /etc/ikamba
if [ ! -s /etc/ikamba/sub.cer ]; then
  say "issuing Let's Encrypt cert for $IKAMBA_HOST"
  ~/.acme.sh/acme.sh --issue --dns dns_duckdns -d "$IKAMBA_HOST" --dnssleep 40 >/dev/null 2>&1
fi
~/.acme.sh/acme.sh --install-cert -d "$IKAMBA_HOST" \
  --key-file /etc/ikamba/sub.key --fullchain-file /etc/ikamba/sub.cer \
  --reloadcmd "chown caddy:caddy /etc/ikamba/*; chmod 640 /etc/ikamba/sub.key; systemctl reload caddy" >/dev/null 2>&1

# ── 7. Caddy serves the subscription on :8443 (static file — no backend to break)
if ! command -v caddy >/dev/null; then
  say "installing caddy"
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg >/dev/null 2>&1
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list 2>/dev/null
  apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq caddy >/dev/null 2>&1
fi
# auto_https disable_redirects → Caddy must never touch :443 (that is the VPN).
cat > /etc/caddy/Caddyfile <<C
{
  auto_https disable_redirects
}
${IKAMBA_HOST}:8443 {
  tls /etc/ikamba/sub.cer /etc/ikamba/sub.key
  header Content-Type "text/plain; charset=utf-8"
  header Profile-Update-Interval "12"
  root * /var/www
  file_server
}
C

# ── 8. the subscription payload. HOSTNAME-first: a DNS repoint alone reconnects every
#      existing link holder after an IP change. Raw-IP copies are kept as a fallback
#      for networks with broken/poisoned DNS.
IP4=$(curl -s --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')
mkdir -p /var/www/xui-public/sub
GQ="type=grpc&security=reality&pbk=${IKAMBA_GRPC_PUB}&fp=chrome&sni=${IKAMBA_DECOY}&sid=${IKAMBA_GRPC_SID}&spx=%2F&serviceName=${IKAMBA_GRPC_SVC}&mode=gun"
WQ="type=ws&security=none&path=%2Fupload%2Fsession"
{
  echo "vless://${IKAMBA_UUID}@${IKAMBA_HOST}:9443?${GQ}#Ikamba-Fast"
  echo "vless://${IKAMBA_UUID}@${IKAMBA_HOST}:8448?${WQ}&host=${IKAMBA_HOST}#Ikamba-Backup"
  echo "vless://${IKAMBA_UUID}@${IP4}:9443?${GQ}#Ikamba-Fast-IP"
  echo "vless://${IKAMBA_UUID}@${IP4}:8448?${WQ}#Ikamba-Backup-IP"
} | base64 -w0 > /var/www/xui-public/sub/free
chown -R caddy:caddy /etc/ikamba 2>/dev/null; chmod 640 /etc/ikamba/sub.key 2>/dev/null
systemctl enable caddy >/dev/null 2>&1; systemctl restart caddy; sleep 2
say "caddy: $(systemctl is-active caddy)"

# ── 9. watchdog — restarts xray if the service dies or any leg stops listening
cat > /usr/local/bin/ikamba-watchdog.sh <<'WD'
#!/usr/bin/env bash
PORTS="443 9443 8448"; CNT=/tmp/ikamba-wd; MAX=5; now=$(date +%s); need=0
systemctl is-active --quiet xray || need=1
for p in $PORTS; do ss -tlnH "sport = :$p" 2>/dev/null | grep -q . || need=1; done
systemctl is-active --quiet caddy || systemctl restart caddy
[ "$need" = 0 ] && exit 0
c=0; [ -f "$CNT" ] && c=$(awk -v n=$now '($1>n-3600){x++}END{print x+0}' "$CNT")
[ "$c" -ge "$MAX" ] && exit 1
echo "$now" >> "$CNT"; systemctl restart xray
WD
chmod +x /usr/local/bin/ikamba-watchdog.sh
cat > /etc/systemd/system/ikamba-watchdog.service <<'U'
[Unit]
Description=Ikamba xray watchdog
[Service]
Type=oneshot
ExecStart=/usr/local/bin/ikamba-watchdog.sh
U
cat > /etc/systemd/system/ikamba-watchdog.timer <<'U'
[Unit]
Description=Ikamba watchdog every 2 minutes
[Timer]
OnBootSec=60
OnUnitActiveSec=120
[Install]
WantedBy=timers.target
U
systemctl daemon-reload
systemctl enable --now ikamba-watchdog.timer >/dev/null 2>&1

# ── 10. self-test every leg through the real public IP
selftest(){ # $1 label  $2 json
  xray -config "$2" >/dev/null 2>&1 & local p=$!; sleep 2
  local c; c=$(curl -s --max-time 12 --socks5-hostname 127.0.0.1:$3 -o /dev/null -w '%{http_code}' https://www.gstatic.com/generate_204 2>/dev/null)
  kill $p 2>/dev/null; echo "  $1 -> HTTP ${c:-TIMEOUT}"
}
cat > /tmp/st_grpc.json <<J
{"log":{"loglevel":"warning"},"inbounds":[{"port":17001,"listen":"127.0.0.1","protocol":"socks","settings":{}}],"outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"$IP4","port":9443,"users":[{"id":"$IKAMBA_UUID","encryption":"none"}]}]},"streamSettings":{"network":"grpc","security":"reality","grpcSettings":{"serviceName":"$IKAMBA_GRPC_SVC","multiMode":false},"realitySettings":{"serverName":"$IKAMBA_DECOY","fingerprint":"chrome","publicKey":"$IKAMBA_GRPC_PUB","shortId":"$IKAMBA_GRPC_SID","spiderX":"/"}}}]}
J
cat > /tmp/st_ws.json <<J
{"log":{"loglevel":"warning"},"inbounds":[{"port":17002,"listen":"127.0.0.1","protocol":"socks","settings":{}}],"outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"$IP4","port":8448,"users":[{"id":"$IKAMBA_UUID","encryption":"none"}]}]},"streamSettings":{"network":"ws","security":"none","wsSettings":{"path":"/upload/session"}}}]}
J
say "self-test:"
selftest "gRPC 9443" /tmp/st_grpc.json 17001
selftest "WS   8448" /tmp/st_ws.json   17002
rm -f /tmp/st_*.json
say "public IP: $IP4"
say "DONE"
