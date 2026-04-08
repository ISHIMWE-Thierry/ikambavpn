# IkambaVPN VPS Session Memory

## VPS Access
- **IP:** 194.76.217.4
- **SSH Port:** 29418
- **User:** vpnadmin
- **Password:** ikamba2026
- **OS:** Ubuntu 24.04 (Hetzner Helsinki)
- **Panel:** 3X-UI on port 2053, path `/x7kQ9m/`, user: ikamba
- **Subscription:** port 2096, path `/sub/`, TLS with certs at `/root/cert/ip/`
- **Protocol:** VLESS+REALITY on port 443

## Problem
Users are getting auto-disconnected from the VPN.

## Root Causes Found (from diagnostics)
1. ❌ **No Xray watchdog cron** — if Xray crashes, stays down until manual restart
2. ✅ **LimitNOFILE now 1048576** — Xray process shows `Max open files 1048576`
3. ✅ **tcp_keepalive runtime = 120/30/4** — matches VLESS tuning config
4. Kernel tuning otherwise applied (conntrack_max=262144 ✅, fs.file-max=1048576 ✅)

## Fixes Status
| # | Fix | Status |
|---|-----|--------|
| 1 | Increase LimitNOFILE to 1048576 | ✅ Done |
| 2 | Tune kernel tcp_keepalive (60/15/4) | ✅ Done |
| 3 | Disable broken inbound-8443 (XHTTP, empty flow) | ✅ Done |
| 4 | Fix Xray sockopt (keepalive, bbr, mptcp, fastopen) | ✅ Done |
| 5 | Fix TCP Window Clamp (was 600) → 0 | ✅ Done |
| 6 | Renew TLS cert → Let's Encrypt via DuckDNS+Caddy | ✅ Done |
| 7 | Fix backend watchdog overwriting config | ✅ Done |
| 8 | Start ikambavpn-api (was dead ~2 days) | ✅ Done |
| 9 | **QUIC block (UDP:443 → blackhole)** | ✅ Done — #1 fix for YouTube disconnects |
| 10| tcpKeepAliveIdle 75→60 | ✅ Done — below all mobile NAT timeouts |
| 11| tcpMaxSeg 1440→1400 | ✅ Done — avoids fragmentation on LTE |
| 12| connIdle 300→900 (15 min) | ✅ Done — survives YouTube pauses |
| 13| tcpMptcp=true | ✅ Done — WiFi↔cellular handoff |
| 14| Error logging enabled | ✅ Done — /var/log/xray/error.log |
| 15| **x-ui database template updated** | ✅ Done — all values survive panel restarts natively |
| 16| Watchdog enforces routing rules + logging | ✅ Done — safety net for panel resets |

## Key Config Values (FINAL — April 6, 2025)
### Kernel (sysctl)
- `net.ipv4.tcp_keepalive_time = 60`
- `net.ipv4.tcp_keepalive_intvl = 15`
- `net.ipv4.tcp_keepalive_probes = 4`
- `net.netfilter.nf_conntrack_max = 262144`
- `fs.file-max = 1048576`

### Xray sockopt (inbound-443 + outbound-direct)
- `tcpKeepAliveIdle = 60`
- `tcpKeepAliveInterval = 15`
- `tcpKeepAliveProbes = 4`
- `tcpUserTimeout = 60000`
- `tcpMaxSeg = 1400`
- `tcpFastOpen = true`
- `tcpMptcp = true`
- `tcpWindowClamp = 0`
- `tcpcongestion = bbr`

### Xray policy (levels.0)
- `handshake = 10`
- `connIdle = 900` (15 min — survives YouTube pauses on mobile)
- `uplinkOnly = 0`
- `downlinkOnly = 0`
- `bufferSize = 0`

### Xray routing
- Rule 0: API inbound → api outbound
- **Rule 1: UDP port 443 → blocked (QUIC block — forces YouTube to TCP)**
- Rule 2: geoip:private → blocked
- Rule 3: bittorrent → blocked

### Xray logging
- `loglevel = error`
- `error = /var/log/xray/error.log`

### Systemd (x-ui service)
- `LimitNOFILE = 1048576`
- `LimitNPROC = 512000`

## Session Log
- Connected via `ssh -p 29418 vpnadmin@194.76.217.4`
- x-ui is running, Xray is running (PID 48368)
- Updated `/etc/systemd/system/x-ui.service.d/limits.conf` and restarted x-ui
- Verified Xray `Max open files` is `1048576`
- Updated `/etc/sysctl.d/99-ikambavpn.conf` and applied `sysctl --system`; runtime keepalive is now 120/30/4
- Disabled inbound-8443 (XHTTP) — was causing "VLESS with no Flow" warnings
- Patched config.json sockopt: tcpKeepAliveIdle 30→300, tcpKeepAliveInterval 10→30, tcpFastOpen true, tcpWindowClamp 0
- Restarted x-ui — running clean, no warnings
- Renewed expired TLS cert on port 4443 (Caddy reverse proxy to backend) — new cert valid until Apr 5, 2027
- **CRITICAL FIND: Backend watchdog (`/opt/ikambavpn-backend/dist/services/watchdog.js`) was overwriting Xray config every 2 min:**
  - Forced `connIdle=0` (zombie connections accumulated until FD exhaustion/crash)
  - Forced `tcpKeepAliveIdle=30` (too aggressive, flagged by ISPs/middleboxes as tunneling)
  - Forced `tcpKeepAliveInterval=10`, `tcpKeepAliveProbes=9`, `tcpUserTimeout=30000`
- **FIX:** Patched watchdog.js on VPS + watchdog.ts in local repo:
  - `connIdle: 0 → 300` (5 min idle timeout, prevents zombie FD accumulation)
  - `tcpKeepAliveIdle: 30 → 300` (avoids ISP DPI flagging)
  - `tcpKeepAliveInterval: 10 → 30` (less aggressive probing)
  - `tcpKeepAliveProbes: 9 → 4` (4 × 30s = 2 min to detect dead)
  - `tcpUserTimeout: 30000 → 60000` (60s total TCP timeout)
- Backend service (`ikambavpn-api`) was dead for ~2 days — started it with patched watchdog
- Restarted x-ui with final verified config — all values confirmed correct

### Backend Service
- **Service name:** `ikambavpn-api` (not `ikambavpn-backend`)
- **Location:** `/opt/ikambavpn-backend/`
- **Env:** `/opt/ikambavpn-backend/.env` (XPANEL_URL, XPANEL_INBOUND_ID=1, PORT=4000)
- **Caddy proxy:** `ikambavpn.duckdns.org:4443` → localhost:4000 (Let's Encrypt auto-TLS)
- **Watchdog:** Runs every 2 min, enforces policy + sockopt on config.json

### TLS Certificate (port 4443)
- **Domain:** `ikambavpn.duckdns.org` (DuckDNS free, points to 194.76.217.4)
- **Cert:** Let's Encrypt, auto-provisioned and auto-renewed by Caddy
- **Old setup:** Self-signed cert on IP → caused `ERR_CERT_AUTHORITY_INVALID` in browsers
- **Frontend API URL:** Updated from `https://194.76.217.4:4443` → `https://ikambavpn.duckdns.org:4443`
- **Files updated:** `DashboardPage.tsx`, `xui-api.ts`, `ai-service.ts`, `vite.config.ts`
- **Deploy:** Railway auto-deploys frontend on push to `main`

## Feature: Dashboard Payment Proof Upload (Commit db99e68)
- **Problem:** Users who left the CheckoutPage mid-flow had `pending_payment` orders but NO way to upload proof from the dashboard — they were stuck.
- **Solution:** Added inline payment proof upload UI directly on DashboardPage for orders with status `pending_payment`.
- **File changed:** `src/pages/DashboardPage.tsx` (+161 lines)
- **UI includes:**
  - Payment details card (bank name, account number with copy button, amount)
  - File picker with drag/drop area, image preview, 10MB limit
  - Accepted types: jpg, png, webp, heic, pdf
  - Upload button with loading spinner
  - `payment_submitted` orders show confirmation message instead
- **Functions used:** `uploadPaymentProof()`, `updateOrderStatus()`, `getAppSettings()`, `notifyAdminsPaymentProof()`
- **Firestore rules fix (Blink-1 repo, commit 3eb1ceb):** `vpn_orders` update rule was blocking status changes — only allowed `paymentProofUrl` + `updatedAt`. Updated to also allow `status` field, restricted to `pending_payment` → `payment_submitted` transition only.

## Feature: Premium Animations & Verified Badge (Commit 215d7ca)
- **PageTransition.tsx:** Wraps pages with framer-motion fade+slide animation
- **PremiumBadge.tsx:** Animated gradient "PREMIUM" badge for premium users
- Added to all user-facing pages (Dashboard, Account, etc.)

## Auth Flows (Audited — All Correct)
- **Email signup:** Creates Firebase Auth user → redirects to `/verify-email` → OTP sent via `sendOTPEmail()` → verified → Firestore user doc created → dashboard
- **Google signup:** Firebase popup → `getAdditionalUserInfo(result).isNewUser` check → Firestore doc created → dashboard (skips OTP — Google already verified)
- **Race condition protection:** `hasRedirectedRef` prevents double redirects from `onAuthStateChanged` listener
- **No issues found** — all flows working correctly

## Shared Firebase Project Architecture
- **Project:** `ikamba-1c669`
- **Shared by:** IkambaVPN, Blink-1, Hpersona
- **Firestore rules:** Deployed ONLY from Blink-1 repo (`/Users/ishimwethierry/Downloads/Ikamba Remit./blink-1/firestore.rules`)
- **Storage rules:** Fully open (`allow read, write: if true`) — also in Blink-1 repo
- **Important:** When VPN Firestore collections need rule changes, edit & deploy from Blink-1 repo

## Deployment
- **Frontend:** Firebase Hosting (`ikamba-1c669.web.app`) + Railway (auto-deploys on push to `main`)
- **Backend:** VPS at `/opt/ikambavpn-backend/`, service `ikambavpn-api`
- **Firestore rules:** `cd blink-1 && firebase deploy --only firestore:rules`

## ⚠️ Lessons Learned — Do NOT Repeat These Mistakes
1. **Always check Firestore security rules when adding write operations.** If `updateOrderStatus()` writes a `status` field, the Firestore rules MUST allow that field in `affectedKeys()`. Missed this initially — would have caused silent failures in production.
2. **Firestore rules are in Blink-1 repo, not VPN repo.** Shared Firebase project means rules deploy from one place only.
3. **CheckoutPage already had proof upload.** Always audit existing code before building new features — DashboardPage was the actual gap, not the entire proof upload flow.
4. **Google signup users skip OTP correctly.** Don't "fix" what isn't broken — the `isNewUser` check + `hasRedirectedRef` pattern is intentional and correct.
5. **`affectedKeys().hasOnly()` is strict.** Every field written by `updateDoc()` must be in the allowed list, including server timestamps and status transitions.
6. **Test Firestore rules changes by tracing the exact fields written.** Read the function source (`updateOrderStatus`) → list every field it writes → verify each is in `affectedKeys().hasOnly([...])` in the rules.
7. **`isExpired()` returns false for undefined `expiresAt`.** This means any order with `status:'active'` but no `expiresAt` will appear as non-expired. Always require BOTH `status === 'active'` AND `!!expiresAt && !isExpired(expiresAt)` when gating premium features.
8. **Block duplicate orders at checkout.** Users can accidentally create multiple pending orders. CheckoutPage must check for existing pending orders before allowing a new one.

## Feature: Premium Badge Fix + Activate VPN Tier Picker (Commit 23f2c3a)
- **Bug fixed:** PremiumBadge was showing for users without valid paid subscriptions because `isExpired(undefined)` returns `false`. Now requires `!!o.expiresAt && !isExpired(o.expiresAt)` on both DashboardPage and AccountPage.
- **UX overhaul:** Replaced gray power orb "No active plan" with animated "Activate VPN" button
- **Inline tier picker:** Tapping "Activate VPN" reveals horizontal scrollable plan cards (animated with framer-motion stagger). Each card shows name, price, features, and navigates to checkout on tap.
- **Trial button:** Shown below tiers when user hasn't used their trial yet.
- **Pending order guard (Dashboard):** If user has a pending order, "Activate VPN" button changes to "View your pending order" and scrolls to the pending section.
- **Pending order guard (Checkout):** CheckoutPage now checks for existing pending/submitted orders and redirects to dashboard with toast if one exists.
- **Files changed:** `DashboardPage.tsx`, `AccountPage.tsx`, `CheckoutPage.tsx`
