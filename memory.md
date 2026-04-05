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
| 1 | Increase LimitNOFILE to 1048576 | ✅ Done (confirmed via `/proc/.../limits`) |
| 2 | Install xray-watchdog.sh cron | ❌ Pending / optional for now |
| 3 | Tune kernel tcp_keepalive (120/30/4) | ✅ Done (confirmed via `sysctl`) |
| 4 | Disable broken inbound-8443 (XHTTP, empty flow) | ✅ Done — removed from panel |
| 5 | Fix Xray sockopt keepalive (both inbound + outbound) | ✅ Done — tcpKeepAliveIdle=300, Interval=30, FastOpen=true |
| 6 | Fix TCP Window Clamp (was 600, choked throughput) | ✅ Done — set to 0 |
| 7 | Restart x-ui after all changes | ✅ Done — Xray running, no warnings |
| 8 | Renew expired TLS cert on port 4443 (Caddy) | ✅ Done — new self-signed cert valid until Apr 5, 2027 |
| 9 | **Backend watchdog overwriting Xray config** | ✅ Fixed — patched REQUIRED_SOCKOPT + REQUIRED_POLICY in watchdog.js |
| 10| Start ikambavpn-api (was dead for ~2 days) | ✅ Done — service running with patched watchdog |

## Key Config Values (after fixes)
### Kernel (sysctl)
- `net.ipv4.tcp_keepalive_time = 120`
- `net.ipv4.tcp_keepalive_intvl = 30`
- `net.ipv4.tcp_keepalive_probes = 4`
- `net.netfilter.nf_conntrack_max = 262144`
- `fs.file-max = 1048576`

### Xray sockopt (inbound-443 + outbound-direct)
- `tcpKeepAliveIdle = 300`
- `tcpKeepAliveInterval = 30`
- `tcpKeepAliveProbes = 4`
- `tcpUserTimeout = 60000`
- `tcpFastOpen = true`
- `tcpWindowClamp = 0`
- `tcpcongestion = bbr`

### Xray policy (levels.0)
- `handshake = 10`
- `connIdle = 300` (was 0 — caused zombie FD accumulation)
- `uplinkOnly = 0`
- `downlinkOnly = 0`
- `bufferSize = 0`

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
