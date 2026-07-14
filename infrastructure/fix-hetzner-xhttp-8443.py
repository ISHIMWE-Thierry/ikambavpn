#!/usr/bin/env python3
"""Fix inbound 6: REALITY SNI must match client (www.cloudflare.com)."""

import json
import os
import ssl
import sys
import urllib.parse
import urllib.request

PANEL = os.environ.get("PANEL_URL", "https://100.66.221.4:2053/x7kQ9m").rstrip("/")
USER = os.environ.get("PANEL_USER", "ikamba")
PASS = os.environ["PANEL_PASS"]
INBOUND_ID = int(os.environ.get("FIX_INBOUND_ID", "6"))

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
cookies: dict[str, str] = {}


def api(method: str, path: str, form=None, body=None):
    url = f"{PANEL}{path}"
    data = None
    hdrs = {"User-Agent": "ikamba-fix-xhttp"}
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

    ib = api("GET", f"/panel/api/inbounds/get/{INBOUND_ID}")["obj"]
    stream = json.loads(ib["streamSettings"])
    rs = stream["realitySettings"]

    # Match working WIFI-XHTTP (id=4) + Brazil test30
    rs["target"] = "www.cloudflare.com:443"
    rs["serverNames"] = ["www.cloudflare.com"]
    rs["dest"] = "www.cloudflare.com:443"
    stream["realitySettings"] = rs

    xhttp = stream.get("xhttpSettings") or {}
    xhttp["host"] = "194.76.217.4"
    xhttp["path"] = "/assets/fceebc8ad5ca/events"
    xhttp["mode"] = "auto"
    stream["xhttpSettings"] = xhttp

    sniffing = {
        "enabled": True,
        "destOverride": ["http", "tls"],
        "metadataOnly": False,
        "routeOnly": True,
    }

    body = {
        "up": ib.get("up", 0),
        "down": ib.get("down", 0),
        "total": ib.get("total", 0),
        "remark": ib["remark"],
        "enable": True,
        "expiryTime": 0,
        "listen": "",
        "port": ib["port"],
        "protocol": "vless",
        "settings": ib["settings"],
        "streamSettings": json.dumps(stream),
        "sniffing": json.dumps(sniffing),
        "tag": ib.get("tag") or "inbound-8443",
    }

    res = api("POST", f"/panel/api/inbounds/update/{INBOUND_ID}", body=body)
    print("update:", res.get("success"), res.get("msg", ""))
    if not res.get("success"):
        sys.exit(1)

    api("POST", "/panel/api/server/restartXrayService")
    print("Xray restarted.")
    print("serverNames now:", rs["serverNames"])
    print("Client SNI must be: www.cloudflare.com (your link is already correct)")


if __name__ == "__main__":
    main()
