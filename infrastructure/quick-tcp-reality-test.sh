#!/usr/bin/env bash
# Quick anti-DPI test: VLESS + REALITY + TCP only (xtls-rprx-vision).
# Adds test client dpi-tcp-test@ikamba on the TCP REALITY inbound and prints the link.
#
# Usage:
#   PANEL_PASS='your-panel-pass' ./infrastructure/quick-tcp-reality-test.sh
#
# Env:
#   PANEL_URL   (default https://100.66.221.4:2053/x7kQ9m — use Tailscale IP if needed)
#   PANEL_USER  (default ikamba)
#   PUBLIC_HOST (default 194.76.217.4 — address clients connect to)

set -euo pipefail

PANEL_URL="${PANEL_URL:-https://100.66.221.4:2053/x7kQ9m}"
PANEL_USER="${PANEL_USER:-ikamba}"
PANEL_PASS="${PANEL_PASS:-}"
PUBLIC_HOST="${PUBLIC_HOST:-194.76.217.4}"

if [[ -z "$PANEL_PASS" ]]; then
  echo "Usage: PANEL_PASS='…' $0"
  exit 1
fi

export PANEL_URL PANEL_USER PANEL_PASS PUBLIC_HOST

python3 << 'PY'
import json, os, ssl, uuid, urllib.parse, urllib.request

panel = os.environ["PANEL_URL"].rstrip("/")
user = os.environ["PANEL_USER"]
passwd = os.environ["PANEL_PASS"]
public_host = os.environ["PUBLIC_HOST"]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
cookies = {}

def req(url, data=None, method="GET"):
    body = None
    hdrs = {"User-Agent": "ikamba-tcp-test"}
    if data is not None:
        body = urllib.parse.urlencode(data).encode() if isinstance(data, dict) else data
        hdrs["Content-Type"] = (
            "application/x-www-form-urlencoded"
            if isinstance(data, dict)
            else "application/json"
        )
    r = urllib.request.Request(url, data=body, headers=hdrs, method=method if data else "GET")
    if cookies:
        r.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in cookies.items()))
    resp = urllib.request.urlopen(r, context=ctx, timeout=90)
    for part in (resp.headers.get_all("Set-Cookie") or []):
        kv = part.split(";")[0]
        if "=" in kv:
            k, v = kv.split("=", 1)
            cookies[k.strip()] = v.strip()
    return json.loads(resp.read().decode())

login = req(f"{panel}/login", {"username": user, "password": passwd}, "POST")
if not login.get("success"):
    raise SystemExit(f"Login failed: {login}")

lst = req(f"{panel}/panel/api/inbounds/list")
tcp = None
for ib in lst.get("obj") or []:
    stream = json.loads(ib.get("streamSettings") or "{}")
    if (
        ib.get("protocol") == "vless"
        and stream.get("network") == "tcp"
        and stream.get("security") == "reality"
    ):
        tcp = ib
        break
if not tcp:
    raise SystemExit("No VLESS+REALITY+TCP inbound on this panel")

stream = json.loads(tcp["streamSettings"])
rs = stream["realitySettings"]
pbk = (rs.get("settings") or {}).get("publicKey") or rs.get("publicKey")
sids = rs.get("shortIds") or []
sid = sids[0] if sids else ""
snis = rs.get("serverNames") or ["tradingview.com"]
sni = snis[0]
port = tcp["port"]
inbound_id = tcp["id"]

test_uuid = str(uuid.uuid4())
test_email = "dpi-tcp-test@ikamba"
client = {
    "id": test_uuid,
    "email": test_email,
    "enable": True,
    "expiryTime": 0,
    "totalGB": 0,
    "limitIp": 2,
    "flow": "xtls-rprx-vision",
    "tgId": "",
    "subId": "",
    "reset": 0,
}
payload = json.dumps(
    {"id": inbound_id, "settings": json.dumps({"clients": [client]})}
).encode()
add = req(f"{panel}/panel/api/inbounds/addClient", payload, "POST")
print("addClient:", add.get("success"), add.get("msg", ""))
if not add.get("success"):
    raise SystemExit("addClient failed — client may already exist; check panel")

q = "&".join(
    [
        "type=tcp",
        "security=reality",
        "encryption=none",
        "flow=xtls-rprx-vision",
        f"pbk={pbk}",
        "fp=chrome",
        f"sni={sni}",
        f"sid={sid}",
        "spx=%2F",
    ]
)
link = f"vless://{test_uuid}@{public_host}:{port}?{q}#AntiDPI-TCP-TEST"
print()
print("=== VLESS REALITY TCP ONLY (quick test) ===")
print(f"Inbound: {tcp['remark']} (id={inbound_id}, port={port})")
print(f"SNI:     {sni}")
print(f"UUID:    {test_uuid}")
print(f"Email:   {test_email}")
print()
print(link)
print()
print("Import in V2RayTun / V2RayNG / Hiddify — disable other profiles.")
print("After backend deploy: GET .../xui-public/tcp-link/YOUR_EMAIL for your real UUID")
PY

chmod +x infrastructure/quick-tcp-reality-test.sh
