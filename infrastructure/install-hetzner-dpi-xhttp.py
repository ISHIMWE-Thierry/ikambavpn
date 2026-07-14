#!/usr/bin/env python3
"""Install test30-style XHTTP+REALITY inbound on Hetzner via 3X-UI API."""

import json
import os
import ssl
import sys
import urllib.parse
import urllib.request

PANEL = os.environ.get("PANEL_URL", "https://100.66.221.4:2053/x7kQ9m").rstrip("/")
USER = os.environ.get("PANEL_USER", "ikamba")
PASS = os.environ["PANEL_PASS"]
HOST = os.environ.get("PUBLIC_HOST", "194.76.217.4")
PORT = int(os.environ.get("XHTTP_PORT", "8443"))
PATH = os.environ.get("XHTTP_PATH", "/assets/fceebc8ad5ca/events")
SOURCE_ID = int(os.environ.get("SOURCE_INBOUND_ID", "1"))
REMARK = os.environ.get("XHTTP_REMARK", "Russia-DPI-XHTTP-Reality")

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
cookies: dict[str, str] = {}


def api(method: str, path: str, form=None, body=None):
    url = f"{PANEL}{path}"
    data = None
    hdrs = {"User-Agent": "ikamba-hetzner-xhttp-install"}
    if form is not None:
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
    raw = resp.read().decode()
    return json.loads(raw) if raw else {}


def main():
    r = api("POST", "/login", form={"username": USER, "password": PASS})
    if not r.get("success"):
        sys.exit(f"Login failed: {r}")

    lst = api("GET", "/panel/api/inbounds/list")
    inbounds = lst.get("obj") or []

    source = next((ib for ib in inbounds if ib["id"] == SOURCE_ID), None)
    if not source:
        sys.exit(f"Source inbound id={SOURCE_ID} not found")

    src_stream = json.loads(source["streamSettings"])
    src_rs = src_stream.get("realitySettings") or {}
    src_settings = json.loads(source["settings"])
    clients = src_settings.get("clients") or []
    print(f"Source inbound {SOURCE_ID}: {len(clients)} clients")

    # XHTTP clients: same UUID, empty flow, unique email suffix for 3X-UI
    xhttp_clients = []
    for c in clients:
        email = c.get("email") or ""
        suffix = "-xhttp" if not email.endswith("-xhttp") else ""
        xhttp_clients.append({
            "id": c["id"],
            "email": f"{email}{suffix}",
            "enable": c.get("enable", True),
            "expiryTime": c.get("expiryTime", 0),
            "totalGB": c.get("totalGB", 0),
            "limitIp": c.get("limitIp", 0),
            "flow": "",
            "tgId": c.get("tgId") or "",
            "subId": c.get("subId") or "",
            "reset": c.get("reset", 0),
        })

    stream_settings = {
        "network": "xhttp",
        "security": "reality",
        "externalProxy": [],
        "realitySettings": {
            "show": False,
            "xver": 0,
            "target": "www.cloudflare.com:443",
            "dest": "www.cloudflare.com:443",
            "serverNames": ["www.cloudflare.com"],
            "privateKey": src_rs.get("privateKey")
            or (src_rs.get("settings") or {}).get("privateKey"),
            "minClientVer": "",
            "maxClientVer": "",
            "maxTimediff": 0,
            "shortIds": src_rs.get("shortIds") or ["509db650956762e8"],
            "settings": {
                "publicKey": (src_rs.get("settings") or {}).get("publicKey")
                or src_rs.get("publicKey"),
                "fingerprint": "chrome",
                "serverName": "",
                "spiderX": "/",
            },
        },
        "xhttpSettings": {
            "path": PATH,
            "host": HOST,
            "mode": "auto",
            "headers": {},
        },
        "sockopt": {
            "tcpFastOpen": True,
            "tcpKeepAliveIdle": 300,
            "tcpKeepAliveInterval": 30,
        },
    }

    sniffing = {
        "enabled": True,
        "destOverride": ["http", "tls"],
        "metadataOnly": False,
        "routeOnly": True,
    }

    existing = next(
        (ib for ib in inbounds if ib["port"] == PORT
         and json.loads(ib.get("streamSettings") or "{}").get("network") == "xhttp"),
        None,
    )

    settings_json = json.dumps({
        "clients": xhttp_clients,
        "decryption": "none",
        "fallbacks": [],
    })

    if existing:
        inbound_id = existing["id"]
        print(f"Updating existing XHTTP inbound id={inbound_id} on port {PORT}…")
        body = {
            "up": existing.get("up", 0),
            "down": existing.get("down", 0),
            "total": existing.get("total", 0),
            "remark": REMARK,
            "enable": True,
            "expiryTime": 0,
            "listen": "",
            "port": PORT,
            "protocol": "vless",
            "settings": settings_json,
            "streamSettings": json.dumps(stream_settings),
            "sniffing": json.dumps(sniffing),
            "tag": existing.get("tag") or f"inbound-{PORT}",
        }
        res = api("POST", f"/panel/api/inbounds/update/{inbound_id}", body=body)
    else:
        print(f"Creating XHTTP+REALITY inbound on port {PORT}…")
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
            "tag": f"inbound-{PORT}",
        }
        res = api("POST", "/panel/api/inbounds/add", body=body)
        inbound_id = res.get("obj", {}).get("id") if isinstance(res.get("obj"), dict) else None

    print("API:", res.get("success"), res.get("msg", ""))
    if not res.get("success"):
        sys.exit(1)

    if not inbound_id and existing:
        inbound_id = existing["id"]

    print("Restarting Xray…")
    api("POST", "/panel/api/server/restartXrayService")
    print(f"Done. Inbound id={inbound_id} port={PORT} path={PATH} host={HOST}")
    print(f"Clients mirrored: {len(xhttp_clients)}")
    print()
    print("Example link (replace UUID with a client from inbound 1):")
    rs = stream_settings["realitySettings"]
    pbk = rs["settings"]["publicKey"]
    sid = rs["shortIds"][0]
    q = "&".join([
        "type=xhttp", "security=reality", f"pbk={pbk}", "fp=chrome",
        f"sni=www.cloudflare.com", f"sid={sid}", "spx=/",
        f"path={urllib.parse.quote(PATH)}", f"host={HOST}", "mode=auto",
    ])
    sample = next((c["id"] for c in xhttp_clients if "thierry" in c["email"]), xhttp_clients[0]["id"])
    print(f"vless://{sample}@{HOST}:{PORT}?{q}#IkambaVPN-Hetzner-DPI-XHTTP")


if __name__ == "__main__":
    main()
