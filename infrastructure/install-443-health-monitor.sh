set -e
mkdir -p /usr/local/etc/ikamba-monitor /var/lib/ikamba-monitor

# 1. Test client config (connects through 443 own-domain Vision)
cat > /usr/local/etc/ikamba-monitor/client.json << 'J'
{"inbounds":[{"port":10899,"listen":"127.0.0.1","protocol":"socks","settings":{"udp":true}}],
"outbounds":[{"protocol":"vless","settings":{"vnext":[{"address":"127.0.0.1","port":443,"users":[{"id":"38285504-1bba-4511-b5fe-ecfc72e1285b","encryption":"none","flow":"xtls-rprx-vision"}]}]},"streamSettings":{"network":"tcp","security":"reality","realitySettings":{"serverName":"ikambavpn.duckdns.org","fingerprint":"safari","publicKey":"YO0t4VfnP9GAEcjASNtLtwJ9bicDIWwtqwfxixZAaDY","shortId":"7d91698c18edfd43","spiderX":""}}}]}
J

# 2. Mailer (writes to Firestore `mail` -> Brevo pipeline; reuses backend creds)
cat > /usr/local/bin/ikamba-mail.js << 'J'
const admin=require('/opt/ikambavpn-backend/node_modules/firebase-admin');
const fs=require('fs');
const env=fs.readFileSync('/opt/ikambavpn-backend/.env','utf8');
const get=k=>{const m=env.match(new RegExp('^'+k+'=(.+)','m'));return m?m[1].replace(/^"|"$/g,''):null;};
admin.initializeApp({credential:admin.credential.cert({projectId:get('FIREBASE_PROJECT_ID'),clientEmail:get('FIREBASE_CLIENT_EMAIL'),privateKey:get('FIREBASE_PRIVATE_KEY').replace(/\\n/g,'\n')})});
const [to,subject,text]=process.argv.slice(2);
admin.firestore().collection('mail').add({to:[to],message:{subject,html:'<pre style="font-family:monospace;font-size:14px">'+text.replace(/</g,'&lt;')+'</pre>',text},createdAt:new Date().toISOString(),source:'ikamba-443-monitor',tag:'vpn-health'}).then(()=>{console.log('mailed');process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)});
J

# 3. The monitor (2-strike, state-tracked, emails on transition only)
cat > /usr/local/bin/ikamba-443-monitor.sh << 'J'
#!/usr/bin/env bash
XRAY=/usr/local/x-ui/bin/xray-linux-amd64
CLIENT=/usr/local/etc/ikamba-monitor/client.json
DIR=/var/lib/ikamba-monitor
TO="thierry.ru.net@gmail.com"
mkdir -p "$DIR"
STATE=$(cat "$DIR/state" 2>/dev/null || echo up); FAILS=$(cat "$DIR/fails" 2>/dev/null || echo 0)

"$XRAY" run -config "$CLIENT" >/dev/null 2>&1 & PID=$!
sleep 2
CODE=$(curl -s --max-time 10 --socks5-hostname 127.0.0.1:10899 -o /dev/null -w '%{http_code}' https://www.google.com/generate_204 2>/dev/null)
kill $PID 2>/dev/null

TS=$(date -u +%FT%TZ)
if [ "$CODE" = "204" ]; then
  echo 0 > "$DIR/fails"
  if [ "$STATE" = "down" ]; then
    node /usr/local/bin/ikamba-mail.js "$TO" "IkambaVPN 443 RECOVERED" "443 is passing traffic again. Time: $TS"
    echo up > "$DIR/state"
  fi
else
  FAILS=$((FAILS+1)); echo $FAILS > "$DIR/fails"
  if [ "$FAILS" -ge 2 ] && [ "$STATE" = "up" ]; then
    node /usr/local/bin/ikamba-mail.js "$TO" "IkambaVPN 443 DOWN" "Health check FAILED (HTTP $CODE) twice in a row. 443 own-domain Vision is not passing traffic. Server 187.77.71.106. Time: $TS"
    echo down > "$DIR/state"
  fi
fi
echo "$TS code=$CODE state=$(cat $DIR/state) fails=$(cat $DIR/fails)"
J
chmod +x /usr/local/bin/ikamba-443-monitor.sh

# 4. Cron every minute
(crontab -l 2>/dev/null | grep -v ikamba-443-monitor; echo "* * * * * /usr/local/bin/ikamba-443-monitor.sh >> /var/log/ikamba-443-monitor.log 2>&1") | crontab -

echo "=== first run (should be up) ==="
/usr/local/bin/ikamba-443-monitor.sh
echo "=== send install confirmation email ==="
node /usr/local/bin/ikamba-mail.js "thierry.ru.net@gmail.com" "IkambaVPN health robot installed" "The per-minute 443 health robot is now active. You will get an email only if 443 goes DOWN (2 consecutive failed checks) and again when it RECOVERS. Installed: $(date -u +%FT%TZ)" && echo "install email queued"
