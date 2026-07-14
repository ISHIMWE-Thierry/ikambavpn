#!/usr/bin/env python3
"""
Create NONSUB inbound on Hetzner: VLESS+TCP+REALITY only.
No Cloudflare SNI, no subscription — permanent vless:// links.

Default port 43235, SNI tradingview.com (same REALITY keys as inbound 1).
"""

import json
import os
import ssl
import sys
import urllib.parse
import urllib.request

PANEL = os.environ.get("PANEL_URL", "https://100.66.221.4:2053/x7kQ9m").rstrip("/")
# Fallback: PANEL_URL=https://194.76.217.4:2053/x7kQ9m if Tailscale is down
USER = os.environ.get("PANEL_USER", "ikamba")
PASS = os.environ["PANEL_PASS"]
HOST = os.environ.get("PUBLIC_HOST", "194.76.217.4")
PORT = int(os.environ.get("NONSUB_PORT", "43235"))
SNI = os.environ.get("NONSUB_SNI", "tradingview.com")
SOURCE_ID = int(os.environ.get("SOURCE_INBOUND_ID", "1"))
REMARK = os.environ.get("NONSUB_REMARK", "NONSUB-TCP-REALITY")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
cookies: dict[str, str] = {}


def api(method: str, path: str, form=None, body=None):
    url = f"{PANEL}{path}"
    data = None
    hdrs = {"User-Agent": "ikamba-nonsub-install"}
    if form:
        data = urllib.parse.urlencode(form).encode()
        hdrs["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    if cookies:
        req.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in cookies.items()))
    resp = urllib.request.urlopen(req, context=ctx, timeout=120)
    for part in resp.headers.get_all("Set-Cookie") or []:
        kv = part.split(";")[0]
        if "=" in kv:
            k, v = kv.split("=", 1)
            cookies[k.strip()] = v.strip()
    return json.loads(resp.read().decode())


def main():
    r = api("POST", "/login", form={"username": USER, "password": PASS})
    if not r.get("success"):
        sys.exit(f"Login failed: {r}")

    lst = api("GET", "/panel/api/inbounds/list")
    inbounds = lst.get("obj") or []

    source = next((ib for ib in inbounds if ib["id"] == SOURCE_ID), None)
    if not source:
        sys.exit(f"Source inbound {SOURCE_ID} not found")

    src_stream = json.loads(source["streamSettings"])
    src_rs = src_stream.get("realitySettings") or {}
    src_settings = json.loads(source["settings"])
    clients = src_settings.get("clients") or []

    nonsub_clients = []
    for c in clients:
        email = c.get("email") or ""
        if email.endswith("-nonsub"):
            suff = ""
        else:
            suff = "-nonsub"
        nonsub_clients.append({
            "id": c["id"],
            "email": f"{email}{suff}",
            "enable": c.get("enable", True),
            "expiryTime": 0,
            "totalGB": 0,
            "limitIp": c.get("limitIp", 2),
            "flow": "xtls-rprx-vision",
            "tgId": c.get("tgId") or "",
            "subId": "",
            "reset": 0,
        })

    stream_settings = {
        "network": "tcp",
        "security": "reality",
        "externalProxy": [],
        "realitySettings": {
            "show": False,
            "xver": 0,
            "target": f"{SNI}:443",
            "dest": f"{SNI}:443",
            "serverNames": [SNI, "www.yahoo.com", "yahoo.com"],
            "privateKey": src_rs.get("privateKey")
            or (src_rs.get("settings") or {}).get("privateKey"),
            "minClientVer": "",
            "maxClientVer": "",
            "maxTimediff": 0,
            "shortIds": src_rs.get("shortIds") or ["d24c784291c548ee"],
            "settings": {
                "publicKey": (src_rs.get("settings") or {}).get("publicKey")
                or src_rs.get("publicKey"),
                "fingerprint": "chrome",
                "serverName": "",
                "spiderX": "/",
            },
        },
        "tcpSettings": {
            "acceptProxyProtocol": False,
            "header": {"type": "none"},
        },
        "sockopt": {
            "tcpFastOpen": True,
            "tcpKeepAliveIdle": 60,
            "tcpKeepAliveInterval": 15,
            "tcpKeepAliveProbes": 4,
            "tcpUserTimeout": 60000,
            "tcpMaxSeg": 1400,
            "tcpcongestion": "bbr",
            "tcpMptcp": True,
        },
    }

    sniffing = {
        "enabled": True,
        "destOverride": ["http", "tls"],
        "metadataOnly": False,
        "routeOnly": True,
    }

    existing = next(
        (ib for ib in inbounds if ib.get("remark") == REMARK or ib["port"] == PORT),
        None,
    )

    settings_json = json.dumps({
        "clients": nonsub_clients,
        "decryption": "none",
        "fallbacks": [],
    })

    body = {
        "up": 0,
        "down": 0,
        "total": 0,
        "remark": REMARK,
        "enable": True,
        "expiryTime": 0,
        "listen": "",
        "port": PORT,
        "protocol": "vless",
        "settings": settings_json,
        "streamSettings": json.dumps(stream_settings),
        "sniffing": json.dumps(sniffing),
        "tag": f"inbound-nonsub-{PORT}",
    }

    if existing:
        inbound_id = existing["id"]
        body["up"] = existing.get("up", 0)
        body["down"] = existing.get("down", 0)
        body["total"] = existing.get("total", 0)
        print(f"Updating inbound id={inbound_id}…")
        res = api("POST", f"/panel/api/inbounds/update/{inbound_id}", body=body)
    else:
        print(f"Creating NONSUB inbound on port {PORT}…")
        res = api("POST", "/panel/api/inbounds/add", body=body)
        inbound_id = res.get("obj", {}).get("id") if isinstance(res.get("obj"), dict) else None

    print("API:", res.get("success"), res.get("msg", ""))
    if not res.get("success"):
        sys.exit(1)

    api("POST", "/panel/api/server/restartXrayService")

    rs = stream_settings["realitySettings"]
    pbk = rs["settings"]["publicKey"]
    sid = rs["shortIds"][0]
    duck = os.environ.get("NONSUB_HOST", HOST if HOST != "194.76.217.4" else "ikambavpn.duckdns.org")

    print(f"\nDone. inbound id={inbound_id} port={PORT} SNI={SNI} clients={len(nonsub_clients)}")
    print("No subscription. Import vless:// directly.\n")

    for email_hint in ["thierry.rw.net@gmail.com"]:
        c = next((x for x in nonsub_clients if email_hint in x["email"]), None)
        if not c:
            continue
        q = "&".join([
            "type=tcp", "security=reality", "encryption=none",
            "flow=xtls-rprx-vision", f"pbk={pbk}", "fp=chrome",
            f"sni={SNI}", f"sid={sid}", "spx=%2F",
        ])
        print(f"User {email_hint}:")
        print(f"  vless://{c['id']}@{duck}:{PORT}?{q}#IkambaVPN-NONSUB")
        print(f"  vless://{c['id']}@{HOST}:{PORT}?{q}#IkambaVPN-NONSUB-IP")


if __name__ == "__main__":
    main()
