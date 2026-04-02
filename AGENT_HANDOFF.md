# Ikamba VPN — Agent Handoff Report
**Date:** 2026-03-31 (updated)
**Prepared by:** Claude Sonnet 4.6 (multiple sessions)

---

## Project Overview

Ikamba VPN is a VLESS+REALITY VPN service targeting users in Russia and other restricted-internet countries. It uses:
- **3X-UI panel** (Xray core) on VPS `194.76.217.4` for VPN server
- **Node.js backend** (Express) deployed at `https://194.76.217.4:4443` via Caddy reverse proxy
- **React/Vite frontend** deployed on Firebase Hosting (`https://ikamba-1c669.web.app`)
- **Firebase Auth** (project `ikamba-1c669`, shared with Blink-1 / ikambaremit.com)

---

## VPS Access

| Item | Value |
|------|-------|
| IP | `194.76.217.4` |
| SSH user | `vpnadmin` |
| SSH password | `f2qnKOIxKNkPzFojyvLDTpE` |
| Backend service | `ikambavpn-api.service` |
| Backend path | `/opt/ikambavpn-backend/` |
| Backend env file | `/opt/ikambavpn-backend/.env` |
| x-ui service | `x-ui.service` |
| x-ui DB | `/etc/x-ui/x-ui.db` |
| Xray config | `/usr/local/x-ui/bin/config.json` |
| Xray binary | `/usr/local/x-ui/bin/xray-linux-amd64` |
| Caddy | port 4443 → port 4000 (Node backend) |

**Restart commands (from vpnadmin):**
```bash
echo PASSWORD | sudo -S -p "" systemctl restart ikambavpn-api.service
echo PASSWORD | sudo -S -p "" systemctl restart x-ui
```

**Backend env vars (key ones):**
```
XPANEL_URL=https://194.76.217.4:2053/x7kQ9m
XPANEL_USER=ikamba
XPANEL_PASS=VJjW4NCly3ban1t4noFOywH
XPANEL_INBOUND_ID=1
XPANEL_VPS_IP=194.76.217.4
XPANEL_REALITY_PUBLIC_KEY=yMO3nD0R94-dZW8-Cxc9LkepHyzjQIPXyXHKB56Ge1A
XPANEL_REALITY_SHORT_ID=90045cc2da31f646
NODE_TLS_REJECT_UNAUTHORIZED=0   # panel has self-signed cert
ALLOW_INSECURE_FIREBASE=true      # WARNING: disables real Firebase token verification
```

---

## Codebase Structure

```
ikambavpn-1/
├── src/
│   ├── pages/
│   │   ├── DashboardPage.tsx     ← main user page (most work done here)
│   │   ├── SignInPage.tsx
│   │   ├── SignUpPage.tsx
│   │   └── ForgotPasswordPage.tsx
│   ├── lib/
│   │   ├── xui-api.ts            ← frontend API client for backend /xui routes
│   │   ├── firebase.ts
│   │   └── db-service.ts
│   └── contexts/AuthContext.tsx
├── backend/
│   └── src/
│       ├── index.ts              ← Express entry, mounts routers
│       ├── routes/xui.ts         ← all /xui and /xui-public routes
│       ├── services/xui.ts       ← 3X-UI panel API client
│       └── middleware/auth.ts
├── .env                          ← frontend Firebase credentials (gitignored)
├── backend/.env                  ← backend VPS + Firebase credentials (gitignored)
└── AGENT_HANDOFF.md              ← this file
```

---

## Deploy Pipeline

### Frontend
Deployed via **Railway** (NOT Firebase Hosting).
- **Domain:** `https://ikambavpn.com`
- Railway auto-deploys from GitHub `main` branch, or push manually via Railway CLI.
- Firebase Auth authorized domains must include `ikambavpn.com`.

### Backend
```bash
cd /Users/ishimwethierry/Downloads/ikambavpn-1/backend
npm run build
rsync -az --delete -e "ssh -o StrictHostKeyChecking=no" dist/ vpnadmin@194.76.217.4:/opt/ikambavpn-backend/dist/
# then restart service (see above)
```

---

## What Was Done This Session (completed, deployed, live)

### 1. Dashboard rewrite — VPNresellers removed
`src/pages/DashboardPage.tsx` was fully rewritten. VPNresellers/WireGuard was removed entirely. The dashboard now shows:
- **Pre-activation:** device-specific app download link (V2RayTun/V2RayNG/Hiddify) + Activate button
- **Post-activation:** Copy VPN link button + numbered steps for the user's device + usage stats + troubleshoot section

Key logic:
- `detectDevice()` → returns `ios|android|mac|windows|linux|unknown`
- `DEVICE_CONFIG` maps device → app name, store URL, steps
- `getSubUrl(email)` → deterministic subscription URL (never stored in DB)
- `activated` state flag flips immediately on provision success — no waiting for stats
- Health polling only starts after account is confirmed to exist
- `getXuiStats` → hits public endpoint (no auth required)

### 2. Public stats endpoint — no more 404 spam
**File:** `backend/src/routes/xui.ts`
Added `GET /xui-public/stats/:email` — returns HTTP 200 with `{ ok: false }` for unknown users (not 404, which causes browser console red errors).

### 3. ForgotPasswordPage
Replaced a broken 234-line OTP Cloud Function flow with simple Firebase `sendPasswordResetEmail`. The Cloud Function (`us-central1-ikamba-1c669.cloudfunctions.net/api/auth/request-otp`) never existed.

### 4. Xray server-side fixes for VPN disconnects
**All applied directly to SQLite DB — survive x-ui restarts.**

The user was restarting VPN 4+ times in 15 minutes on YouTube/Twitter. Root causes found and fixed:

| Fix | Problem | Applied to |
|-----|---------|------------|
| Removed `fakedns` from `destOverride` | `"dns": null` + fakedns = DNS resolution failures, connection drops | SQLite `inbounds` table |
| Removed `quic` from `destOverride` | YouTube uses QUIC/HTTP3 (UDP). Sniffing QUIC over TCP-tunneled VLESS caused protocol conflict → drops | SQLite `inbounds` table |
| Set `routeOnly: true` | `routeOnly: false` was modifying active connections, not just routing | SQLite `inbounds` table |
| Added `sockopt` TCP keepalive | No keepalive → long streams (YouTube video) silently dropped by NAT/middleboxes | SQLite + stream_settings |

**Current live Xray sniffing config:**
```json
{
  "enabled": true,
  "destOverride": ["http", "tls"],
  "metadataOnly": false,
  "routeOnly": true
}
```

**Current sockopt:**
```json
{
  "tcpKeepAliveIdle": 60,
  "tcpKeepAliveInterval": 15,
  "tcpKeepAliveProbes": 5
}
```

**Kernel tuning already applied (from previous session):**
```
net.ipv4.tcp_keepalive_time = 120
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 4
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
```

---

## Session 2 — Xray Crash-Loop Fix (2026-03-31 ~01:00 UTC)

### Root Cause: Duplicate VLESS inbound in xrayTemplateConfig
The `xrayTemplateConfig` stored in `/etc/x-ui/x-ui.db` → `settings` table had the full VLESS inbound hardcoded inside it. 3X-UI also generates a VLESS inbound from the `inbounds` table automatically. This created **two inbounds with the same tag `inbound-443`** in the generated `config.json`, causing Xray to refuse to start:

```
ERROR - XRAY: Failed to start: main: failed to create server > app/proxyman/inbound: existing tag found: inbound-443
```

### Timeline
| Time (UTC) | Event |
|------------|-------|
| Mar 30 19:40 | x-ui restarted — Xray worked (crash loop began intermittently) |
| Mar 30 19:43 | Recovered after brief crash loop |
| Mar 30 19:43 → 00:51 | Running fine (~5 hours) |
| **Mar 31 00:55** | **Permanent crash loop started** — Xray never recovered. 510+ failed start attempts every 2 seconds. |
| Mar 31 01:13 | **Fixed** — removed duplicate VLESS inbound from template, restarted x-ui |

### Fixes Applied
1. **Removed VLESS inbound from `xrayTemplateConfig`** in SQLite DB — the template now only contains the API tunnel inbound. 3X-UI generates the VLESS inbound from the `inbounds` table on its own.
2. **Added DNS resolver** to Xray config: Cloudflare DOH (`https+local://1.1.1.1/dns-query`), Google DOH (`https+local://8.8.8.8/dns-query`), and `localhost` fallback. `queryStrategy: "UseIP"`. Previously `"dns": null`.
3. **Set up logrotate** at `/etc/logrotate.d/xray` — daily rotation, 7 days retention, restart x-ui on rotate.

### Post-Fix Verification
- ✅ Xray 26.2.6 started successfully — no errors
- ✅ Port 443 listening (VLESS+REALITY)
- ✅ 8 clients loaded in config
- ✅ REALITY handshake test passed (TLSv1.3 + `www.microsoft.com`)
- ✅ Backend API (`/xui-public/diagnose`) returns "fully operational"
- ✅ Access log writing to `/var/log/xray/access.log`

### Why Users Were Being "Kicked Off"
**Answer: Xray was not running.** The VPN server was in a crash loop and never started. All user connections would fail immediately. Client apps would show "connected" briefly (TCP SYN to port 443 would eventually timeout or be rejected) then drop — appearing as if users were being "kicked."

### Multi-User Capability
The system **does** support multiple simultaneous users. Each user has a unique UUID in the VLESS inbound. LimitIP per user (found in DB): `default@ikamba` = 0 (unlimited), most users = 2 devices, `thierry.rw.net@gmail.com` = 3 devices. With access log now enabled, LimitIP enforcement works.

---

## Session 3 — Failed Anti-Disconnect Attempt (2026-04-01)

### Goal
Users reported VPN disconnections when watching YouTube or during idle periods. The task was to fix this by tuning Xray policy timeouts and adding a watchdog to auto-heal the VPN.

### What Was Attempted (and rolled back)

#### 1. Watchdog deployment (`backend/src/services/watchdog.ts`)
- Deployed a watchdog that runs every 2 minutes via `setInterval`
- Re-enables disabled clients, fixes limitIp, was supposed to enforce anti-disconnect policy
- **PROBLEM:** The watchdog read `/usr/local/x-ui/bin/config.json`, patched it, wrote it back, then restarted Xray. But 3X-UI regenerates config from its SQLite DB on every Xray restart, so the watchdog's changes were overwritten immediately — creating an **infinite restart loop** (Xray restarted every 2 minutes for ~16 minutes, disconnecting all users each time)
- The restart loop was fixed by removing the Xray restart call from the watchdog
- **BUT** the watchdog then set `sniffing.routeOnly = true` in the config file every 2 minutes. While `routeOnly: true` was the original setting and is documented as correct for VLESS+REALITY, any config file writes by the watchdog are pointless because 3X-UI regenerates the file on restart anyway.

#### 2. Xray policy tuning (all reverted)
Attempted to set aggressive anti-timeout values:
```json
{
  "connIdle": 0,        // was 600
  "uplinkOnly": 0,      // was 30  
  "downlinkOnly": 0,    // was 30
  "bufferSize": 0,      // was 10240
  "handshake": 10       // was 8
}
```
These were written to both the config file and the SQLite DB. **All reverted** — original values restored.

#### 3. Kernel tuning (reverted)
Added `/etc/sysctl.d/99-vpn-antidisconnect.conf` with BBR congestion control, tcp_keepalive_time=60, etc. **Removed during rollback.**

#### 4. sockopt additions to inbound/outbound (reverted)
Added TCP keepalive and BBR settings to both inbound and outbound streamSettings in config and DB. **Reverted** — original DB restored.

#### 5. `sniffing.routeOnly` investigation
- Spent significant time investigating whether `routeOnly: true` vs `false` was causing traffic to not flow
- With `routeOnly: true`: DNS queries logged, HTTPS traffic also flows (confirmed working in final state)
- With `routeOnly: false`: same behavior observed
- **Conclusion:** `routeOnly` was NOT the problem. The original `routeOnly: true` is correct.

### What Actually Fixed the "VPN connects but doesn't work" Issue
**The duplicate `inbound-443` in the xrayTemplateConfig** — the same bug from Session 2 had **come back** because we restored the original backup DB which still had the duplicate. After removing the duplicate inbound from the template (keeping only the `api` inbound), traffic immediately started flowing:
- Gmail IMAP ✅
- Apple services ✅  
- Google Push notifications ✅
- YouTube video streaming ✅
- Snapchat ✅

### Final State After Rollback
| Item | Value |
|------|-------|
| DB | Restored from `/etc/x-ui/x-ui.db.bak.20260401_143830` (pre-session backup) |
| Template | Fixed — only `api` inbound (duplicate `inbound-443` removed again) |
| Config | Regenerated by 3X-UI from restored DB |
| Policy | Original: `connIdle=600, uplinkOnly=30, downlinkOnly=30, bufferSize=10240` |
| Sniffing | Original: `destOverride=["http","tls"], routeOnly=true` |
| Kernel tuning | Removed (`/etc/sysctl.d/99-vpn-antidisconnect.conf` deleted) |
| Watchdog | **Disabled** — `setInterval` call commented out in compiled JS at `/opt/ikambavpn-backend/dist/services/watchdog.js`. Source code in `backend/src/services/watchdog.ts` still has the logic but the compiled version won't run it. |
| Backend | Running, watchdog disabled, all other routes functional |

### What Still Needs To Be Done (the original disconnection problem is UNSOLVED)

**The core complaint — users getting disconnected on YouTube or when idle — was NOT fixed.** The session got derailed fixing self-inflicted breakage from the watchdog restart loop and config corruption.

#### Root Causes Still Present
1. **`connIdle: 600` (10 minutes)** — Xray drops connections idle for 10 minutes. Users watching a long YouTube video where the TCP connection goes quiet (buffered) will get dropped after 10 min.
2. **`uplinkOnly: 30` and `downlinkOnly: 30`** — When traffic flows in only one direction for 30 seconds (e.g., downloading a video = downlink only), Xray starts a 30-second countdown to close the connection. This is the most likely cause of YouTube disconnections.
3. **`bufferSize: 10240` (10 MB)** — Per-connection buffer limit. Large video streams may hit this.
4. **No TCP keepalive on sockopt** — NAT middleboxes (common in Russia) drop idle TCP connections. Without keepalive, long-lived connections silently die.

#### Recommended Approach for Next Session
**Do NOT use the watchdog to modify Xray config files.** 3X-UI owns the config file and regenerates it from the SQLite DB. Instead:

1. **Fix values directly in the 3X-UI web panel** (`https://194.76.217.4:2053/x7kQ9m`, user: `ikamba`, pass: `VJjW4NCly3ban1t4noFOywH`):
   - Go to Panel Settings → Xray Configuration → Policy
   - Set `connIdle: 300` (5 min, not 0 — 0 means infinite which may leak connections)
   - Set `uplinkOnly: 2` (Xray default, gives 2 sec grace after one-way traffic stops)
   - Set `downlinkOnly: 5` (5 sec grace)
   - Set `bufferSize: 0` (0 = unlimited, let OS manage it)

2. **Add sockopt via the panel** (Xray Configuration → Inbound → Stream Settings):
   ```json
   {
     "tcpKeepAliveIdle": 60,
     "tcpKeepAliveInterval": 15,
     "tcpKeepAliveProbes": 5,
     "tcpcongestion": "bbr"
   }
   ```

3. **Apply kernel tuning manually on VPS** (not via watchdog):
   ```bash
   cat > /etc/sysctl.d/99-vpn.conf << 'EOF'
   net.ipv4.tcp_keepalive_time = 120
   net.ipv4.tcp_keepalive_intvl = 30
   net.ipv4.tcp_keepalive_probes = 4
   net.core.rmem_max = 16777216
   net.core.wmem_max = 16777216
   net.ipv4.tcp_congestion_control = bbr
   EOF
   sysctl -p /etc/sysctl.d/99-vpn.conf
   ```

4. **Re-enable the watchdog** only for client management (re-enable disabled accounts, fix limitIp) — **remove all config file modification code** from `enforceAntiDisconnectPolicy()`.

#### Key Lesson Learned
**Never modify `/usr/local/x-ui/bin/config.json` programmatically.** 3X-UI owns that file and regenerates it from its SQLite DB (`/etc/x-ui/x-ui.db`) every time Xray restarts. To persist Xray config changes:
- Use the 3X-UI web panel, OR
- Modify the SQLite DB directly (`inbounds` table for inbound settings, `settings` table key `xrayTemplateConfig` for template/policy/routing), OR
- Use the 3X-UI API (but note: the API at `/x7kQ9m/panel/api/xray` returned empty responses in testing — may be a panel version bug)

#### Backup Files on VPS
| File | Description |
|------|-------------|
| `/etc/x-ui/x-ui.db.bak.20260401_143830` | DB before Session 3 (currently restored) |
| `/etc/x-ui/x-ui.db.bak.broken` | DB after all failed changes |
| `/usr/local/x-ui/bin/config.json.bak.1775053999` | Config before Session 3 |
| `/usr/local/x-ui/bin/config.json.bak.broken` | Config after all failed changes |

---

## Session 4 — Policy & Sockopt Fix via API (2026-04-02)

### What Was Done

The core disconnect fixes from Session 3 (never applied) were successfully applied programmatically via the 3X-UI web API — no VNC terminal paste required.

#### How the API works (discovered this session)
- **Login:** `POST /x7kQ9m/login` with JSON `{"username":"ikamba","password":"..."}`
- **Get xray config:** `POST /x7kQ9m/panel/xray/` → returns `obj` (JSON string) containing `xraySetting` dict
- **Save xray config:** `POST /x7kQ9m/panel/xray/update` — **must be form-encoded** (`Content-Type: application/x-www-form-urlencoded`), NOT JSON. Fields: `xraySetting` (JSON string), `outboundTestUrl`
- **Get inbounds:** `GET /x7kQ9m/panel/api/inbounds/list`
- **Update inbound:** `POST /x7kQ9m/panel/api/inbounds/update/{id}` with JSON body of full inbound object

#### 1. Policy fixed ✅
Updated via `POST /panel/xray/update` (form-encoded):

| Field | Was | Now |
|---|---|---|
| `connIdle` | 600 | 300 |
| `uplinkOnly` | 30 | 2 |
| `downlinkOnly` | 30 | 5 |
| `bufferSize` | 10240 | 0 |

#### 2. Inbound sockopt — BBR added ✅
TCP keepalive was already present in the inbound (survived the Session 3 restore). Added `tcpcongestion: "bbr"`:
```json
{
  "tcpKeepAliveIdle": 60,
  "tcpKeepAliveInterval": 15,
  "tcpKeepAliveProbes": 5,
  "tcpcongestion": "bbr"
}
```

### Completed in Session 4
- ✅ Xray restarted via API (`POST /panel/api/server/restartXrayService`)
- ✅ Kernel tuning applied via VNC terminal (user ran echo commands line by line)
- ✅ XHTTP inbound added (see Session 5 below)

---

## Session 5 — VLESS+XHTTP+REALITY Anti-Blocking Inbound (2026-04-02)

### Why
Russia's DPI (as of Feb 2026) actively freezes VLESS+TCP+REALITY connections after detecting one-directional traffic or specific fingerprints. XHTTP transport makes the VPN traffic look like regular chunked HTTP web requests — much harder to fingerprint.

### What Was Done

#### 1. XHTTP inbound added via API ✅
**Inbound ID: 2**, port **8443**, network **xhttp**, security **reality**
- Same REALITY keys as inbound 1 (same private key, same shortIds, same SNI)
- Same user UUIDs (clients copied from inbound 1, emails suffixed with `.x@` to avoid 3X-UI duplicate restriction)
- Path: `/ikamba`, mode: `auto`
- sockopt: TCP keepalive + BBR (same as inbound 1)

#### 2. Xray restarted via API ✅
`POST /panel/api/server/restartXrayService` — both inbounds confirmed running.

#### 3. Port 8443 firewall rule ⚠️ USER MUST DO
From VNC terminal:
```bash
ufw allow 8443/tcp
```

### API Knowledge Gained (important for future sessions)
All 3X-UI config changes can be done via the panel API — no VNC needed:
- Login: `POST /x7kQ9m/login` (JSON)
- Get inbounds: `GET /panel/api/inbounds/list`
- Add inbound: `POST /panel/api/inbounds/add` (JSON)
- Update inbound: `POST /panel/api/inbounds/update/{id}` (JSON)
- Get xray template: `POST /panel/xray/` 
- Save xray template: `POST /panel/xray/update` (**form-encoded**, NOT JSON)
- Restart Xray: `POST /panel/api/server/restartXrayService`

### XHTTP VLESS Links Per User
Users should add these **in addition to** their existing TCP links. When TCP gets blocked, they switch to XHTTP.

```
vless://{uuid}@194.76.217.4:8443?type=xhttp&security=reality&pbk=yMO3nD0R94-dZW8-Cxc9LkepHyzjQIPXyXHKB56Ge1A&sni=www.microsoft.com&fp=chrome&sid=90045cc2da31f646&path=/ikamba&mode=auto#IKAMBAVPN-XHTTP
```

Replace `{uuid}` with the user's UUID (same UUID as their TCP connection).

| User | UUID |
|---|---|
| admin@ikambaremit.com | 9ee97fdf-aff6-4696-8417-456e296f1cb5 |
| japhetonziza@gmail.com | 4f686508-f245-486e-9a63-0c6fc0011f80 |
| gatetelewis@gmail.com | 0c7c068e-ba1e-43f6-8bed-e2500c2a3901 |
| joselynemuhoza11@gmail.com | d9cdb50f-516e-40bf-90a2-c15172eb81d8 |
| k.l.paisible@gmail.com | f298ad4d-d6e4-4fc2-9ae3-3e263caad92b |

### Next Steps
1. **Frontend:** Add "Copy XHTTP Backup Link" button to DashboardPage.tsx — generates same URL format above using user's UUID
2. **Backend:** Update `/xui-public/sub/{email}` to return BOTH links (TCP + XHTTP) in the subscription
3. **Auto-provisioning:** When a new user activates, add them to BOTH inbounds (ID=1 and ID=2)
4. **Test:** Have a real Russian-ISP user test the XHTTP link specifically

---

## Known Issues / Outstanding Items

### 1. `ALLOW_INSECURE_FIREBASE=true` in backend .env — **SECURITY RISK**
Backend currently does not verify Firebase tokens. Any request passes auth. This was set during early development. Before launch, set real Firebase service account credentials:
```
FIREBASE_CLIENT_EMAIL=<service account email>
FIREBASE_PRIVATE_KEY=<private key>
```
Then remove `ALLOW_INSECURE_FIREBASE=true`.

### 2. ~~Xray access log not persisted~~ — **FIXED**
Access log is now set to `/var/log/xray/access.log` in the xrayTemplateConfig. LimitIP can now function. Logrotate configured at `/etc/logrotate.d/xray` (daily, 7 days retention).

### 3. 8 users provisioned — mostly test accounts
Current clients in Xray: `default@ikamba`, `admin@ikambaremit.com`, `thierry.rw.net@gmail.com`, `umulasta@gmail.com`, `1032215738@pfur.ru`, `test@ikambaremit.com`, `gatetelewis@gmail.com`, `thierry.rw.hnet@gmail.com`.

### 4. "Browse plans" page exists but no payment flow
`/plans` route exists in frontend. No payment integration yet (Stripe, MTN Mobile Money, etc.). The `VpnOrder` type and `getUserOrders` DB service exist in Firestore but no UI to create orders.

### 5. No email notifications
No welcome email, no expiry warning, no payment confirmation. Firebase email is available via Auth but no transactional email service integrated.

### 6. `sniffing: quic` removed — note for future
If you ever re-enable QUIC sniffing, it must only be done with `routeOnly: true` AND a proper DNS server configured in Xray (`"dns"` section). DNS is now configured (Cloudflare DOH + Google DOH + localhost), but quic is still intentionally excluded from destOverride.

---

## Subscription URL Pattern
The VLESS subscription URL is **deterministic** — never stored in Firestore:
```
https://194.76.217.4:4443/xui-public/sub/{encodeURIComponent(email)}
```
Frontend derives it at render time via `getSubUrl(email)` in `DashboardPage.tsx`.

---

## Git Repo
```
https://github.com/ISHIMWE-Thierry/ikambavpn.git
branch: main
```
Last commit: `fix: return 200 (not 404) when stats client not found`

**Uncommitted source changes (Session 3):**
- `backend/src/services/watchdog.ts` — has `enforceAntiDisconnectPolicy()` with config file modification code (SHOULD BE REMOVED — see Session 3 notes). Also has `routeOnly = false` which should be `true`.
- The compiled JS on VPS (`/opt/ikambavpn-backend/dist/services/watchdog.js`) has the `setInterval` call commented out so the watchdog loop does not run.

---

## Firebase Project
- **Project ID:** `ikamba-1c669`
- **Auth domain:** `ikamba-1c669.firebaseapp.com`
- **Frontend URL:** `https://ikambavpn.com` (Railway)
- **Legacy Hosting URL:** `https://ikamba-1c669.web.app` (Firebase Hosting — no longer primary)
- Shared with Blink-1 (Ikamba Remit) — same Firebase project, separate apps
- **Authorized domains for Google sign-in:** `ikambavpn.com`, `ikamba-1c669.web.app`, `ikamba-1c669.firebaseapp.com`, `localhost`
