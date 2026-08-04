#!/usr/bin/env bash
# Is the node still reachable from inside Russia? Uses Globalping's RU probes.
#
#   bash infrastructure/ikamba-ru-check.sh [IP]     (defaults to the DuckDNS host's IP)
#
# Exit code 0 = healthy, 1 = BURNED (time to rotate). A German probe is used as a
# control so "node is down" is never mistaken for "Russia blocked it".
set -uo pipefail
SECRETS="${IKAMBA_SECRETS:-$HOME/.ikamba/secrets.env}"
[ -f "$SECRETS" ] && { set -a; . "$SECRETS"; set +a; }
TARGET="${1:-$(dig +short "${IKAMBA_HOST:-ikambavpn.duckdns.org}" A 2>/dev/null | tail -1)}"
[ -n "$TARGET" ] || { echo "no target"; exit 2; }

python3 - "$TARGET" <<'PY'
import json,sys,time,urllib.request
target=sys.argv[1]; PORT=9443
def api(url,data=None):
    req=urllib.request.Request(url,data=data,headers={"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(req,timeout=30))
body=json.dumps({"type":"http","target":target,
  "locations":[{"country":"RU","limit":6},{"country":"DE","limit":1}],
  "measurementOptions":{"port":PORT,"protocol":"HTTPS",
                        "request":{"host":"gateway.icloud.com","path":"/"}}}).encode()
try:
    mid=api("https://api.globalping.io/v1/measurements",body)["id"]
except Exception as e:
    print("globalping error:",e); sys.exit(2)
for _ in range(45):
    time.sleep(2)
    s=api("https://api.globalping.io/v1/measurements/"+mid)
    if s["status"]=="finished": break
ru_ok=ru_tot=de_ok=0
for r in s["results"]:
    c=r["probe"]["country"]; net=r["probe"].get("network","")[:22]; res=r["result"]
    ok = res.get("status")=="finished" and res.get("statusCode") is not None
    if c=="RU": ru_tot+=1; ru_ok+=ok
    if c=="DE": de_ok+=ok
    print(f"  {c} {net:22} {'OK' if ok else 'BLOCKED'}")
pct = (100*ru_ok//ru_tot) if ru_tot else 0
print(f"\n  Russia: {ru_ok}/{ru_tot} probes reachable ({pct}%)   control(DE): {'up' if de_ok else 'DOWN'}")
if not de_ok:
    print("  VERDICT: node itself looks DOWN (not a Russia block) — check the server."); sys.exit(2)
if ru_ok==0:
    print("  VERDICT: 🔴 BURNED — Russia blocks this IP. Rotate: Hostinger → change location."); sys.exit(1)
if pct<60:
    print("  VERDICT: 🟠 DEGRADING — some RU networks blocked. Plan a rotation soon."); sys.exit(1)
print("  VERDICT: 🟢 HEALTHY"); sys.exit(0)
PY
