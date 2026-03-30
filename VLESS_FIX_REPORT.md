# Ikamba VPN — VLESS Fix Report

**Date:** March 30, 2026
**Prepared for:** Developer handoff
**Protocol focus:** VLESS+REALITY only (no VPNresellers / OpenVPN / IKEv2 / L2TP / Stealth / WireGuard)
**Client apps:** V2RayTun (iOS), V2RayNG (Android), Hiddify (desktop) — no native iOS app

---

## Problem Statement

Users report:
1. VPN auto-disconnects randomly
2. VPN shows "connected" but YouTube / WhatsApp don't work
3. Users can't tell if it's their internet or our VPN

---

## Root Causes Found

| # | Bug | File | Impact |
|---|-----|------|--------|
| 1 | `buildVlessLink()` uses `URLSearchParams` which encodes `/` and `-` in the VLESS URI — V2RayTun and V2RayNG silently fail to parse it | `backend/src/services/xui.ts` | **Connections drop or never establish** |
| 2 | Deeplink route calls `buildVlessLink("", "")` with empty strings instead of using subscription URL | `backend/src/routes/xui.ts` | **Broken deeplinks** |
| 3 | Subscription endpoint `/xui-public/sub/:email` fetches from panel on every request — if panel restarts, all clients lose config | `backend/src/routes/xui.ts` | **Mass disconnection during panel maintenance** |
| 4 | No Xray process monitoring — if Xray crashes, it stays down until manual restart | Infrastructure (no script existed) | **Silent outages** |
| 5 | Default kernel settings: conntrack_max too low, TCP keepalive 7200s, fd limit 1024 | `infrastructure/vps-setup.sh` | **Drops at ~30 concurrent users, slow reconnects** |
| 6 | No way for users to diagnose their own connection vs VPN server | No endpoint existed | **Support overload** |
| 7 | Dashboard shows 6 protocol tabs (OpenVPN, IKEv2, L2TP, Stealth, WireGuard, VLESS) — confusing, we only use VLESS | `src/pages/DashboardPage.tsx` | **User confusion** |

---

## Fixes Already Applied (committed)

### Fix 1 — VLESS link generation (CRITICAL)
**File:** `backend/src/services/xui.ts` — `buildVlessLink()` function

**What was done:** Replaced `URLSearchParams` with manual query string construction so `/` and `-` characters in REALITY parameters are NOT percent-encoded.

**Before (broken):**
```ts
const params = new URLSearchParams({ security: 'reality', ... });
return `vless://${uuid}@${host}:${port}?${params.toString()}#${tag}`;
```

**After (fixed):**
```ts
const params = [
  `security=reality`,
  `encryption=none`,
  `type=tcp`,
  `flow=xtls-rprx-vision`,
  `fp=chrome`,
  `pbk=${REALITY_PUBLIC_KEY}`,
  `sid=${REALITY_SHORT_ID}`,
  `sni=www.microsoft.com`,
].join('&');
return `vless://${uuid}@${host}:${port}?${params}#${encodeURIComponent(tag)}`;
```

Also added env var validation — throws at startup if `REALITY_PUBLIC_KEY` or `REALITY_SHORT_ID` are missing.

---

### Fix 2 — Broken deeplink route
**File:** `backend/src/routes/xui.ts` — `/xui-public/deeplink/:email` route

**What was done:** Changed from calling `buildVlessLink("", "")` (which produced an invalid URI) to redirecting to the subscription URL instead.

---

### Fix 3 — Subscription caching
**File:** `backend/src/services/xui.ts` + `backend/src/routes/xui.ts`

**What was done:** Added in-memory cache with 5-minute TTL and stale-while-revalidate pattern for `/xui-public/sub/:email`. If the 3X-UI panel is temporarily down, users still get their last-known config instead of a blank response that causes V2RayTun/V2RayNG to disconnect.

**New code in `services/xui.ts`:**
```ts
interface SubCacheEntry { body: string; contentType: string; ts: number; }
const subCache = new Map<string, SubCacheEntry>();
const SUB_TTL = 5 * 60 * 1000; // 5 min

export async function getCachedSubscription(email: string): Promise<SubCacheEntry> {
  // Returns cached if fresh, fetches fresh in background if stale, 
  // returns stale on panel error
}
```

**Updated route returns 503 on total failure** with `Retry-After: 30` header.

---

### Fix 4 — Xray watchdog (NEW FILE)
**File:** `infrastructure/xray-watchdog.sh`

**What it does:**
- Runs every 2 minutes via cron
- Checks if Xray process is alive AND port 443 is responding
- Auto-restarts via `x-ui restart` if either check fails
- Sends Telegram alerts on restart
- Prevents restart loops (max 5 restarts/hour)
- Warns if memory usage >90%

**To install on VPS:**
```bash
scp infrastructure/xray-watchdog.sh root@194.76.217.4:/usr/local/bin/
ssh root@194.76.217.4
chmod +x /usr/local/bin/xray-watchdog.sh
# Edit the TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID inside the script
crontab -e
# Add: */2 * * * * /usr/local/bin/xray-watchdog.sh >> /var/log/xray-watchdog.log 2>&1
```

---

### Fix 5 — VPS kernel tuning
**File:** `infrastructure/vps-setup.sh` — Step 5

**What was done:** Replaced BBR-only config with full kernel tuning:

```
net.netfilter.nf_conntrack_max = 262144    # was default ~32768
net.ipv4.tcp_keepalive_time = 120          # was 7200
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 4
net.core.rmem_max = 16777216               # 16MB buffers
net.core.wmem_max = 16777216
net.core.somaxconn = 8192
net.ipv4.tcp_tw_reuse = 1
fs.file-max = 1048576
```

Also added systemd override for x-ui service:
```
[Service]
LimitNOFILE=1048576
```

**To apply on VPS:**
```bash
scp infrastructure/vps-setup.sh root@194.76.217.4:/root/
ssh root@194.76.217.4
# Run Step 5 section, then:
sysctl -p
systemctl daemon-reload
systemctl restart x-ui
```

---

### Fix 6 — Diagnostics endpoint (NEW)
**File:** `backend/src/routes/xui.ts` — `/xui-public/diagnose`

Returns JSON with:
- `xrayRunning`: bool — is Xray process alive
- `panelReachable`: bool — can backend reach 3X-UI panel
- `cpuPercent`, `memPercent`: server load
- `verdict`: `"healthy"` | `"degraded"` | `"down"`
- `suggestion`: human-readable text for the user

---

### Fix 7 — Client-side diagnostics function
**File:** `src/lib/xui-api.ts` — `runDiagnostics()`

```ts
export interface DiagnosticResult {
  internetOk: boolean;
  vpnServerOk: boolean;
  verdict: 'all-good' | 'your-internet' | 'vpn-server' | 'unknown';
  suggestion: string;
}

export async function runDiagnostics(): Promise<DiagnosticResult> {
  // 1. Check navigator.onLine
  // 2. Fetch /xui-public/diagnose
  // 3. Fallback: fetch google.com/generate_204
  // 4. Return structured verdict
}
```

---

### Fix 8 — Startup health check
**File:** `backend/src/index.ts`

Added a panel reachability check on server boot — logs a clear error with fix instructions if the 3X-UI panel is unreachable.

---

### Fix 9 — .env documentation
**File:** `backend/.env.example`

Added comments explaining that `XPANEL_URL` must include the correct port and `webBasePath`.

---

## Remaining Work (NOT done yet)

### Task A — Simplify `CredentialsBox` to VLESS-only (Dashboard cleanup)

**File:** `src/pages/DashboardPage.tsx`
**Lines:** 103–588 (function `CredentialsBox`)

**Current state:** `CredentialsBox` renders 6 protocol tabs (openvpn, ikev2, l2tp, stealth, wireguard, vless). Since we only use VLESS, this entire function should be simplified.

**What to do:**

Replace the entire `CredentialsBox` function (lines 103–588) with:

```tsx
function CredentialsBox({
  username, password, wgIp, wgPrivateKey, wgPublicKey,
}: {
  username?: string; password?: string;
  wgIp?: string; wgPrivateKey?: string; wgPublicKey?: string;
}) {
  // Old protocol props kept for backward compatibility but ignored — VLESS only now
  return <VlessTab />;
}
```

This keeps the function signature so all 4 call sites (lines ~1230, ~1283, ~1322, ~1333) still compile, but renders only the VlessTab content.

---

### Task B — Add periodic health polling + diagnostics UI to `VlessTab`

**File:** `src/pages/DashboardPage.tsx`
**Lines:** 592–896 (function `VlessTab`)

**What to do:**

1. **Add imports** (already done in the file):
   - `useRef, useCallback` from React
   - `Activity, Wifi, WifiOff` from lucide-react
   - `runDiagnostics` + `DiagnosticResult` from `../lib/xui-api`

2. **Add periodic 60s health polling** inside VlessTab:
```tsx
// Inside VlessTab, after existing state declarations:
const healthInterval = useRef<ReturnType<typeof setInterval> | null>(null);

const pollHealth = useCallback(async () => {
  const { online } = await checkVpnServerHealth();
  setServerOnline(online);
}, []);

useEffect(() => {
  healthInterval.current = setInterval(pollHealth, 60_000);
  return () => { if (healthInterval.current) clearInterval(healthInterval.current); };
}, [pollHealth]);
```

3. **Add diagnostic state + handler:**
```tsx
const [diagResult, setDiagResult] = useState<DiagnosticResult | null>(null);
const [diagRunning, setDiagRunning] = useState(false);

async function handleRunDiagnostics() {
  setDiagRunning(true);
  try {
    const result = await runDiagnostics();
    setDiagResult(result);
  } catch {
    setDiagResult(null);
  } finally {
    setDiagRunning(false);
  }
}
```

4. **Add diagnostic UI** inside the Troubleshoot `<details>` section (after the existing "Is it your internet or our VPN?" block):
```tsx
{/* Quick diagnosis button */}
<div className="border border-gray-100 rounded-xl p-3 text-xs text-gray-600">
  <p className="font-semibold text-gray-700 mb-2">Run connection test</p>
  <Button
    onClick={handleRunDiagnostics}
    disabled={diagRunning}
    variant="secondary"
    size="sm"
  >
    {diagRunning ? (
      <><RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Testing…</>
    ) : (
      <><Activity className="w-3 h-3 mr-1" /> Diagnose now</>
    )}
  </Button>
  {diagResult && (
    <div className={`mt-2 rounded-lg p-2 border ${
      diagResult.verdict === 'all-good'
        ? 'bg-green-50 border-green-200 text-green-800'
        : diagResult.verdict === 'your-internet'
        ? 'bg-amber-50 border-amber-200 text-amber-800'
        : 'bg-red-50 border-red-200 text-red-800'
    }`}>
      <div className="flex items-center gap-1.5 font-medium">
        {diagResult.verdict === 'all-good' ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
        {diagResult.verdict === 'all-good' && 'Everything looks good'}
        {diagResult.verdict === 'your-internet' && 'Your internet is the problem'}
        {diagResult.verdict === 'vpn-server' && 'Our VPN server has an issue'}
        {diagResult.verdict === 'unknown' && 'Could not determine the issue'}
      </div>
      <p className="mt-1">{diagResult.suggestion}</p>
    </div>
  )}
</div>
```

---

### Task C — Deploy to VPS

After code changes:

```bash
# 1. Deploy backend
cd backend
npm run build
# Push to Railway or: 
scp -r dist/ root@194.76.217.4:/opt/ikamba-backend/
ssh root@194.76.217.4 "cd /opt/ikamba-backend && pm2 restart all"

# 2. Deploy watchdog
scp infrastructure/xray-watchdog.sh root@194.76.217.4:/usr/local/bin/
ssh root@194.76.217.4 "chmod +x /usr/local/bin/xray-watchdog.sh"
# Add cron (see Fix 4 above)

# 3. Apply kernel tuning
ssh root@194.76.217.4
# Paste the sysctl values from Fix 5, then:
sysctl -p
systemctl daemon-reload
systemctl restart x-ui

# 4. Deploy frontend
npm run build
# Deploy to hosting (Vercel/Netlify/Firebase Hosting)
```

---

### Task D — Verify after deployment

1. **Test VLESS link generation:** Hit `/xui-public/sub/test@example.com` — the returned VLESS URI should NOT have `%2F` or `%2D` in it
2. **Test subscription caching:** Restart 3X-UI panel, immediately hit the sub endpoint — should return cached config, not 500
3. **Test watchdog:** `ssh root@194.76.217.4 "systemctl stop x-ui && sleep 130 && systemctl status x-ui"` — should auto-restart within 2 min
4. **Test diagnostics:** Open dashboard → Troubleshoot → "Diagnose now" — should return verdict
5. **Test on V2RayTun (iOS):** Copy subscription link → import → connect → open YouTube
6. **Test on V2RayNG (Android):** Same flow, verify routing is set to Global

---

## VPS Details

| | |
|---|---|
| IP | 194.76.217.4 |
| Provider | Hetzner Helsinki |
| OS | Ubuntu 24.04 |
| Panel | 3X-UI on port 2053, webBasePath `/x7kQ9m/` |
| Panel user | ikamba |
| Protocol | VLESS+REALITY, port 443 |
| Flow | xtls-rprx-vision |
| Fingerprint | chrome |
| SNI | www.microsoft.com |

---

## Files Changed Summary

| File | Status | Description |
|------|--------|-------------|
| `backend/src/services/xui.ts` | ✅ Done | Fixed buildVlessLink, added sub cache |
| `backend/src/routes/xui.ts` | ✅ Done | Fixed deeplink, cached sub endpoint, added /diagnose |
| `backend/src/index.ts` | ✅ Done | Startup panel health check |
| `backend/.env.example` | ✅ Done | Documentation |
| `infrastructure/vps-setup.sh` | ✅ Done | Kernel tuning + fd limits |
| `infrastructure/xray-watchdog.sh` | ✅ Done | NEW — Xray auto-restart cron |
| `src/lib/xui-api.ts` | ✅ Done | Added runDiagnostics + DiagnosticResult |
| `src/pages/DashboardPage.tsx` imports | ✅ Done | Added useRef, useCallback, Activity, Wifi, WifiOff, runDiagnostics, DiagnosticResult |
| `src/pages/DashboardPage.tsx` CredentialsBox | ❌ TODO | Replace lines 103-588 with simple VlessTab wrapper (Task A) |
| `src/pages/DashboardPage.tsx` VlessTab | ❌ TODO | Add health polling + diagnostics UI (Task B) |
