# IkambaVPN — Working Configuration & Field Guide

A battle-tested setup for a **free VLESS + REALITY VPN that survives Russian DPI (TSPU)**,
served from a single server, with a permanent auto-updating subscription link and a
one-tap Happ onboarding page.

> This document is **publishable**. It contains only public client-side metadata
> (public keys, short IDs, SNIs, ports). **No private keys, passwords, tokens, or
> API keys are included** — those live in `docs/AI-HANDOFF.md` (private) and server
> `.env` files only.

---

## 1. Architecture (single server)

Everything runs on **one VPS** (Frankfurt / Hostinger KVM). Other regional servers
were decommissioned to cut cost — the subscription points only at this node.

```
                       ┌─────────────────────────────────────────┐
  user (Happ/V2RayTun) │  Frankfurt VPS  (187.77.71.106)          │
        │  subscription │                                         │
        ▼  poll (https) │  Caddy :8443/:4443  ──► backend :4000   │
  ikambavpn.duckdns.org │     (Node/Express, Firebase admin)      │
        │  vless :443   │                                         │
        ▼  REALITY      │  xray (codex)  :443 VLESS+REALITY+Vision │
   internet ◄───────────│  x-ui panel    :2053 (mgmt + stats)     │
                        └─────────────────────────────────────────┘
```

- **xray (codex)** — `/usr/local/etc/xray-codex/config.json`, systemd `xray-codex-xhttp`.
  Owns the public inbounds (443 TCP+Vision, 8444 XHTTP, 9443 gRPC, …).
- **x-ui** — management panel + client DB + traffic stats (`api` inbound).
- **backend** — serves the subscription, admin API, Firebase as source of truth.
- **Caddy** — TLS termination for the subscription URL (Let's Encrypt).
- **DuckDNS** — `ikambavpn.duckdns.org` → server IP, refreshed by a 5-min cron, so the
  domain (and therefore every user's link) survives an IP change.

---

## 2. The working inbound (port 443)

**VLESS + TCP + REALITY + Vision** is the fastest stealth profile. This is the live config shape:

```jsonc
{
  "tag": "ikamba-443",
  "port": 443,
  "protocol": "vless",
  "settings": {
    "clients": [
      { "id": "<SHARED-UUID>", "flow": "xtls-rprx-vision", "email": "shared" }
    ],
    "decryption": "none"
  },
  "streamSettings": {
    "network": "tcp",
    "security": "reality",
    "realitySettings": {
      "show": false,
      "target": "www.yandex.com:443",          // a real TLS 1.3 site, reachable from the server
      "serverNames": ["www.yandex.com", "www.microsoft.com"],
      "privateKey": "<SERVER-PRIVATE-KEY>",     // keep secret; pubkey goes in the client link
      "shortIds": ["<SHORT-ID>"]
    },
    "sockopt": { "tcpFastOpen": true, "tcpcongestion": "bbr" }  // BBR = throughput
  },
  "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
}
```

### Client link (what the subscription serves)

```
vless://<SHARED-UUID>@ikambavpn.duckdns.org:443
  ?type=tcp&security=reality
  &pbk=<SERVER-PUBLIC-KEY>      # derived from the server private key: `xray x25519 -i <priv>`
  &fp=safari
  &flow=xtls-rprx-vision
  &sni=www.yandex.com
  &sid=<SHORT-ID>
  &spx=
#IkambaVPN-Frankfurt
```

**Shared-UUID model:** one UUID for everyone. There is no per-user key/auth — *anyone with
the link connects*. The "key" is the REALITY `pbk` embedded in the link. Simpler ops, no
per-device provisioning, no subscription gate.

---

## 3. Permanent subscription link (never changes)

Give users a **subscription URL**, not a raw config. The URL is constant forever; when the
server config/keys/transport/IP change, the subscription serves the new config and every
client auto-updates on its next poll.

```
https://ikambavpn.duckdns.org:8443/xui-public/sub/free#IkambaVPN
```

| | Raw `vless://` config | Subscription URL |
|---|---|---|
| Changes when server changes? | yes — everyone re-imports | **never** |
| Auto-updates? | no | **yes** |

---

## 4. One-tap onboarding page (`/xui-public/happ`)

A device-aware HTML page (black & white, no inline-CSP issues) that:
- Detects iOS / Android / Desktop and shows the right Happ download buttons
  (iOS has **two** App Store links — Global + Russia).
- Offers **Copy link** (always reliable) and **Auto-connect**.

### Happ deep link (`happ://crypt3/…`)

Happ's one-tap import uses an **RSA-encrypted** deep link, *not* `happ://import/`:

1. RSA-encrypt the subscription URL with Happ's public key (v2/v3/v4) using PKCS1 padding.
2. Base64 the result.
3. Prefix `happ://crypt3/`.

Library: [`kastov/cryptohapp`](https://github.com/kastov/cryptohapp) →
`createHappCryptoLink(url, 'v3', true)`. Web tool: crypto.happ.su.

**Mobile gotcha:** percent-encode the base64 payload in the redirect `href`, or mobile
browsers turn `+` into a space and corrupt it (works on desktop, fails on phone).

**Telegram gotcha:** Telegram buttons only allow `http(s)`/`tg://` — never custom schemes.
Wrap the `happ://` link in an **https redirect page** and link the button to that.

---

## 5. Field lessons (the hard-won part)

These are the real reasons "it connects but no internet" — none are obvious from server tests
(localhost always works; the failures are network/DPI/client specific).

1. **TSPU "freeze".** Russian DPI lets a TCP+REALITY handshake complete, then freezes the
   session after ~15–20 KB → *connects, no web*. Mitigations: enable **Fragment** in the
   client (splits the handshake), or use **XHTTP** transport (HTTP-framed, not frozen).

2. **SNI tampering.** Some camouflage SNIs are interfered with on RU networks
   (`www.cloudflare.com`, sometimes `www.microsoft.com`). **`www.yandex.com` is reliable**
   (a Russian site DPI won't touch). REALITY `serverNames` can list several; the link picks one.

3. **Vision mismatch.** If the client link has `flow=xtls-rprx-vision` but the inbound client
   has `flow:""` (or vice-versa) → connects, DNS only, no web. **Both sides must match.**

4. **A sync job silently stripping flow.** `sync-xhttp-clients.sh` rewrote every inbound's
   clients with `flow:""`, wiping Vision minutes after it was set. Fixed to set flow
   **per transport** — Vision for TCP inbounds, empty for XHTTP/gRPC (see
   `infrastructure/sync-xhttp-clients.sh`).

5. **`domainStrategy: UseIPv4` on the freedom outbound with no `dns` block** → no traffic.
   Use `AsIs` on the outbound, and put `"dns": { "queryStrategy": "UseIPv4" }` at top level
   if you want IPv4-only resolution.

6. **IP reputation.** Identical config (TCP+Vision) can work on one server and freeze on
   another — datacenter IPs get flagged by TSPU. If a clean config still freezes *with
   Fragment on*, the cure is a fresh/clean IP, not more config tuning.

7. **XHTTP vs TCP+Vision trade-off:** TCP+Vision = fastest, but freezable. XHTTP = survives
   DPI, slightly more overhead. Keep both inbounds; switch the subscription's transport by
   editing one builder (`buildFrankfurtTcpVisionLink` in `backend/src/services/xui.ts`).

---

## 6. Operational cheat-sheet

```bash
# Restart the public xray (codex)
systemctl restart xray-codex-xhttp

# Re-sync clients from x-ui DB into codex inbounds (Vision-aware now)
/usr/local/bin/sync-xhttp-clients.sh

# Derive the public key from a REALITY private key (for the client link)
xray x25519 -i <PRIVATE_KEY>

# Verify an inbound actually passes traffic (server-side self-test)
#   run a local socks->vless client, then:  curl --socks5-hostname 127.0.0.1:108xx https://api.ipify.org

# Subscription (served by backend, cached ~5 min; backend restart clears cache)
curl -s https://ikambavpn.duckdns.org:8443/xui-public/sub/free | base64 -d
```

---

*Stack: Xray-core (VLESS/REALITY/Vision/XHTTP) · 3X-UI · Caddy · Node/Express · Firebase ·
DuckDNS · Happ client. Single Frankfurt node. Shared-UUID free tier.*
