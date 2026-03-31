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
```bash
cd /Users/ishimwethierry/Downloads/ikambavpn-1
npm run build
firebase deploy --only hosting
```
Firebase project: `ikamba-1c669`

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

---

## Firebase Project
- **Project ID:** `ikamba-1c669`
- **Auth domain:** `ikamba-1c669.firebaseapp.com`
- **Hosting URL:** `https://ikamba-1c669.web.app`
- Shared with Blink-1 (Ikamba Remit) — same Firebase project, separate hosting sites
