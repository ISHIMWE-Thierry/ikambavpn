#!/usr/bin/env bash
# Ikamba VPN daily auto-refresh — restarts the xray engine and verifies 8448 is
# back and passing traffic. Cron: 0 6 * * *  (server TZ is Europe/Moscow => 6 AM MSK).
# On failure, emails via the Firestore `mail` collection (Brevo) using ikamba-mail.js.
XRAY=/usr/local/x-ui/bin/xray-linux-amd64
TO="thierry.ru.net@gmail.com"
TS=$(date "+%Y-%m-%d %H:%M:%S %Z")

systemctl restart xray-codex-xhttp
sleep 5

cat > /tmp/ikamba-refresh-test.json << J2
{"inbounds":[{"port":10866,"listen":"127.0.0.1","protocol":"socks","settings":{"udp":true}}],
"outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"127.0.0.1","port":8448,"users":[{"id":"38285504-1bba-4511-b5fe-ecfc72e1285b","encryption":"none","flow":"xtls-rprx-vision"}]}]},"streamSettings":{"network":"tcp","security":"reality","realitySettings":{"serverName":"ikambavpn.duckdns.org","fingerprint":"safari","publicKey":"YO0t4VfnP9GAEcjASNtLtwJ9bicDIWwtqwfxixZAaDY","shortId":"7d91698c18edfd43","spiderX":""}}}]}
J2
"$XRAY" run -config /tmp/ikamba-refresh-test.json >/dev/null 2>&1 & P=$!
sleep 2
CODE=$(curl -s --max-time 10 --socks5-hostname 127.0.0.1:10866 -o /dev/null -w '%{http_code}' https://www.google.com/generate_204 2>/dev/null)
kill $P 2>/dev/null; rm -f /tmp/ikamba-refresh-test.json

if [ "$CODE" = "204" ]; then
  echo "$TS  refresh OK (8448 healthy)"
else
  echo "$TS  refresh FAILED (HTTP $CODE) — emailing"
  node /usr/local/bin/ikamba-mail.js "$TO" "IkambaVPN auto-refresh FAILED" "The 6AM refresh restarted the VPN but 8448 did not come back healthy (HTTP $CODE). Check the server. Time: $TS" || true
fi
