# Ikamba VPN — Developer Handoff

**Project:** Ikamba VPN  
**Stack:** React 18 · TypeScript · Vite · TailwindCSS v3 · Firebase · framer-motion  
**Backend:** Node.js/Express on VPS 194.76.217.4:4443 (auto-deploy via Railway for frontend, manual deploy for backend)  
**Repo:** https://github.com/ISHIMWE-Thierry/ikambavpn  

---

## 1. Architecture Overview

```
Browser (React SPA)
  ├── Firebase Auth       — email/password login
  ├── Firestore           — users, orders, trials, OTPs
  └── VPS API (4443)      — 3X-UI panel proxy, subscription links
        └── Xray-core (VLESS+REALITY + XHTTP)
```

### Key Firebase collections

| Collection | Purpose |
|---|---|
| `users/{uid}` | Profile: firstname, lastname, role, emailVerified, needsOtpVerification |
| `orders/{id}` | VPN subscriptions: status, planName, expiresAt, userId |
| `vpn_trials/{id}` | Free trial records: status, credentials, userId |
| `email_otps/{uid}` | OTP verification codes (TTL 10 min) |
| `mail/{id}` | Email queue → Cloud Function `sendMailOnCreate` sends via SMTP |

---

## 2. Authentication Flow

```
Sign up
  → Firebase Auth createUserWithEmailAndPassword
  → Create Firestore user doc (needsOtpVerification: true)
  → generateAndSendOtp(uid, email)         ← src/lib/otp-service.ts
  → navigate('/verify-email')

Email verification (/verify-email)         ← src/pages/EmailVerificationPage.tsx
  → 6-digit OTP input
  → verifyOtp(uid, code) → sets emailVerified: 1, needsOtpVerification: false
  → navigate('/dashboard')

Sign in
  → If profile.needsOtpVerification && emailVerified !== 1 → redirect /verify-email
  → Else → redirect /dashboard

Protected routes                           ← src/components/ProtectedRoute.tsx
  → needsOtpVerification guard → /verify-email
  → admin guard → /
```

---

## 3. Dashboard State Machine

**File:** `src/pages/DashboardPage.tsx`  
**Background:** `bg-gray-50` (light theme — do NOT change back to dark)

### Entitlement logic

```typescript
const activeOrder = orders.find(o => o.status === 'active');
const expired     = isExpired(activeOrder?.expiresAt);
const activeTrial = trial?.status === 'active';

// User must have active paid plan OR active trial to activate/copy link
const canActivate = (!expired && !!activeOrder) || activeTrial;
const canCopyLink = activated && canActivate;
```

### Hero card states

| State | Orb appearance | Bottom area |
|---|---|---|
| Loading entitlement | Grey, disabled | Spinner |
| No plan, no trial | Grey muted, non-clickable | Nothing — plan card handles CTAs |
| Has plan or trial, not activated | Dark/clickable | "Activate VPN" button |
| Activated, has entitlement | Black (online) / dark gray (offline) | "Copy VPN Link" (green flash 2s, then reverts) |
| Activated, no entitlement | Black / dark gray | "Plan required to connect" (disabled) |

### Post-copy hint (stays permanently)

```typescript
const [hasEverCopied, setHasEverCopied] = useState(false);
// Set to true on first copy, never reset
// Shows instruction card: "Link copied — open V2RayTun, tap + → Import..."
```

Do NOT make this disappear. The hint stays so the user always knows what to do next.

### Plan card states

| State | Content |
|---|---|
| Active paid plan | Plan name, features, expiry countdown; "Renew plan" if ≤7 days |
| Active trial | "Free Trial / 1-hour access" + "View plans" |
| No plan, trial unused | "Get 1-hour free trial" (primary) + "View plans" |
| No plan, trial expired | "Your trial has ended. Pick a plan to continue." |

### Pending orders section

Pending label, "Under review" badge, and info text all use `text-green-600` / `variant: 'success'` — signals payment received and in review, not stuck.

---

## 4. VPN Provisioning Flow

```
handleActivate()
  → provisionXuiAccount({ email, trafficLimitGB: 0, expiryDays: 0, maxConnections: 2 })
      ↳ POST /xui/provision  (VPS API — requires Firebase auth token)
      ↳ 3X-UI panel creates VLESS+REALITY client
  → setActivated(true)
  → getXuiStats(email)  — fetches usage data from panel
  → checkVpnServerHealth() every 60s

copyLink()
  → navigator.clipboard.writeText(subUrl)
  → subUrl = {API_URL}/xui-public/sub/{email}  — subscription URL (base64 VLESS links)
  → Sets hasEverCopied = true (permanent hint shown)

copyBackup()  (Advanced settings)
  → GET /xui-public/xhttp-link/{email}
  → Returns the XHTTP VLESS link (index [0] of vlessLink — XHTTP is first)
```

### VPS API endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /xui/provision` | Firebase token | Create/update 3X-UI client |
| `GET /xui-public/stats/:email` | None | Usage stats (total bytes, expiry) |
| `GET /xui-public/sub/:email` | None | Full subscription URL (base64) |
| `GET /xui-public/xhttp-link/:email` | None | Single XHTTP link (index 0) |
| `GET /xui-public/health` | None | Server health check |
| `GET /xui-public/diagnose` | None | Full connection diagnostics |

### Subscription format

`vlessLink` stored in cache is `xhttpLink\ntcpLink` — **XHTTP is always index [0], TCP is [1]**.  
The `/sub/:email` endpoint returns `Buffer.from(vlessLink).toString('base64')` — both links encoded, apps pick the best one.  
The `/xhttp-link/:email` endpoint returns `split('\n')[0]` — XHTTP only, for ISP bypass.

---

## 5. Free Trial Flow

**File:** `src/pages/TrialPage.tsx`  
**Duration:** 1 hour (display only — no hard server expiry; admin must manually disable if needed)

> **CRITICAL — do NOT reconnect VPNresellers.** The trial was previously wired to VPNresellers.net (WireGuard credentials from a completely different VPN provider). That was wrong and caused the dashboard flow to break entirely — users got WireGuard credentials that had nothing to do with the VLESS subscription link. Trial MUST use `provisionXuiAccount`. Do not change this.

```
/trial
  → Check Firestore vpn_trials
  → active   → redirect /dashboard
  → expired  → "Trial already used" screen
  → none     → confirm screen

Confirm → handleStart()
  → createTrial(uid, { status: 'provisioning' })
  → provisionXuiAccount({ email, trafficLimitGB: 0, expiryDays: 0, maxConnections: 2 })
  → updateTrial(trialId, { status: 'active' })
  → auto-redirect /dashboard after 2s
  → User copies their VLESS link on the dashboard
```

**Do not show WireGuard/OpenVPN/username/password credentials on any trial screen.** There are no credentials — the link is the subscription URL on the dashboard.

---

## 6. Admin Order Activation

**File:** `src/pages/admin/AdminOrdersPage.tsx`

> **CRITICAL — do NOT use VPNresellers here.** Admin activation was previously wired to `findOrCreateAccount` + `setExpiry` from VPNresellers, which created WireGuard accounts that had nothing to do with the dashboard's VLESS system. It has been replaced with `provisionXuiAccount`. Do not revert.

```
Admin clicks Activate
  → provisionXuiAccount({ email: order.userEmail, trafficLimitGB: 0, expiryDays, maxConnections: 2 })
  → updateOrderStatus(order.id, 'active', { activatedAt, expiresAt })
  → notifyUserServiceActivated({ userEmail, userName, planName, planDuration })
      ← No credentials in email — user told to go to dashboard to copy their link

Expiry options: 30 / 90 / 180 / 365 days (admin selects, passed as expiryDays to 3X-UI panel)
```

---

## 7. Plans & Pricing

**File:** `src/pages/PlansPage.tsx`  
Plans loaded from Firestore; fallback to hardcoded defaults.

| Plan | Price | Devices |
|---|---|---|
| Basic | 49 ₽ / month | 1 |
| Popular | 79 ₽ / month | 3 |
| Premium | 99 ₽ / month | 5 + priority support |

Payment is admin-activated — no payment gateway. Admin reviews payment proof and manually activates the order.

---

## 8. OTP Service

**File:** `src/lib/otp-service.ts`

```typescript
generateAndSendOtp(userId, email, userName?)
  → 6-digit crypto random code
  → Stored in email_otps/{userId} with 10-min TTL
  → Queued in mail/{id} → Cloud Function sends via SMTP

verifyOtp(userId, code)
  → Validates code + expiry
  → On success: user doc emailVerified = 1, needsOtpVerification = false

canResendOtp(userId)
  → Returns true if > 60s since last send
```

---

## 9. How to Connect — Per-Device Config

**File:** `src/pages/DashboardPage.tsx` — `DEVICE_CONFIG`

Each device has 4 fields: `steps`, `routingTip`, `disconnectTip`, `persistTip`.

| Device | App | Store badge | Auto-reconnect (persistTip) |
|---|---|---|---|
| iOS | V2RayTun | App Store (Apple SVG) | iPhone Settings → VPN → V2RayTun → Connect On Demand |
| Android | V2RayNG | Google Play (Play SVG) | Android Settings → VPN → V2RayNG → Always-on VPN + disable battery optimization |
| Mac | V2RayTun | App Store (Apple SVG) | V2RayTun Preferences → Launch at Login + Auto-connect on startup |
| Windows | Hiddify | Download (lucide icon) | Hiddify Settings → Auto-connect + Start on boot |
| Linux | Hiddify | Download (lucide icon) | Hiddify Settings → Auto-connect + add to session autostart |

Step 2 in "How to connect" shows a **black store badge button** with SVG logo (Apple / Play / Download icon) — not a plain text link.  
Step 4 is "Enable auto-reconnect" — shown in blue, device-specific.

---

## 10. Watchdog Service

**File:** `backend/src/services/watchdog.ts`  
Runs every 2 minutes. Handles all anti-disconnect enforcement server-side.

| Check | Action |
|---|---|
| Xray not running | Triggers restart via 3X-UI panel API |
| Client `enable: false` | Re-enables (3X-UI auto-disables clients on traffic/IP limit) |
| Client `limitIp > 0` | Resets to 0 (concurrent IP limit causes disconnects) |
| Policy enforcement | Writes `connIdle=0, uplinkOnly=0, downlinkOnly=0, bufferSize=0` to Xray config |
| TCP keepalive | `tcpKeepAliveIdle: 30, interval: 10, probes: 9` |
| Congestion control | BBR enforced on all inbounds/outbounds |

**VPN disconnection during streaming is almost always a client-side issue** (iOS background kill, wrong routing mode). Server config is solid. Tell users to:
1. Enable "Always-on VPN" / "Connect On Demand" (step 4 in dashboard)
2. Set routing to Global in the app
3. Try the backup link (TCP) from Advanced settings if XHTTP has issues

---

## 11. Design Tokens

```
Background:        bg-gray-50    (#f9fafb)  — light theme, NOT dark
Card:              bg-white + rounded-3xl + shadow-sm or border border-gray-100
Primary text:      text-gray-900
Secondary:         text-gray-500 / text-gray-400
Accent:            bg-black text-white  (buttons, active orb, store badges)
Pending/review:    text-green-600 / badge variant 'success'  (signals active processing)
Trial badge:       bg-blue-100 text-blue-700
Auto-reconnect:    text-blue-600  (step 4 in How to connect)
Copy flash:        bg-green-500 text-white, 2s then reverts
Font:              system font-sans (Tailwind default)
Border radius:     rounded-3xl (cards), rounded-full (buttons, orb), rounded-2xl (inner cards)
```

### Animation library
**framer-motion** — `motion`, `AnimatePresence`, `Variants`

```typescript
const container: Variants = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};
const card: Variants = {
  hidden: { opacity: 0, y: 24 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};
```

Concentric rings (server online): 3 `motion.div`, `scale: [1, 2.6]`, `opacity: [0.18, 0]`, staggered 0.5s.

---

## 12. File Map (key files)

```
src/
├── pages/
│   ├── DashboardPage.tsx          Main user screen
│   ├── HomePage.tsx               Marketing landing
│   ├── PlansPage.tsx              Plan selection
│   ├── TrialPage.tsx              Free trial → 3X-UI provisioning
│   ├── CheckoutPage.tsx           Order submission
│   ├── SignUpPage.tsx             Registration + OTP trigger
│   ├── SignInPage.tsx             Login + OTP redirect guard
│   ├── EmailVerificationPage.tsx  6-digit OTP entry
│   └── admin/
│       ├── AdminOrdersPage.tsx    Order management + activation (3X-UI)
│       ├── AdminVpnPanelPage.tsx  VPN panel overview
│       └── AdminUsersPage.tsx     User management
├── components/
│   ├── ProtectedRoute.tsx         Auth + OTP gate
│   ├── ui/button.tsx              Button primitive
│   └── ui/badge.tsx               Status badge (success/warning/danger/muted)
├── lib/
│   ├── xui-api.ts                 3X-UI panel wrapper + health check
│   ├── db-service.ts              Firestore CRUD
│   ├── otp-service.ts             OTP generate/verify/resend
│   ├── vpnresellers-api.ts        UNUSED in main flows — do not reintroduce
│   └── utils.ts                   formatDate, formatCurrency, daysUntilExpiry, isExpired
├── contexts/AuthContext.tsx       Firebase Auth + profile listener
├── types/index.ts                 VpnOrder, VpnPlan, VpnTrial, VpnCredentials, etc.
├── App.tsx                        Routes
└── index.css                      Tailwind + animation keyframes

backend/src/
├── routes/xui.ts                  VPS API routes (provision, stats, sub, health, diagnose)
├── services/xui.ts                3X-UI panel client + link builders
├── services/watchdog.ts           Anti-disconnect watchdog (runs every 2 min)
└── index.ts                       Express app entry
```

---

## 13. Environment Variables

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_API_URL                    # VPS API base (https://194.76.217.4:4443)
```

---

## 14. Deployment

| Layer | Platform | Deploy command |
|---|---|---|
| Frontend | Railway | Auto-deploy on push to `main` |
| Backend API | VPS (194.76.217.4) | `cd /tmp && git clone https://github.com/ISHIMWE-Thierry/ikambavpn.git vbuild && cd /tmp/vbuild/backend && npm install --silent && npm run build && cp -r dist/* /opt/ikambavpn-backend/dist/ && rm -rf /tmp/vbuild && systemctl restart ikambavpn-api.service` |
| Firebase | Google Cloud | Auth + Firestore always live |

Backend working directory on VPS: `/opt/ikambavpn-backend`  
Systemd service: `ikambavpn-api.service`

---

## 15. Known Issues / TODO

1. **Trial expiry not enforced server-side** — 1-hour trial is display only. No Cloud Function or cron disables the 3X-UI client after 1 hour. Needs a scheduled backend job or Firebase scheduled function.
2. **Payment gateway** — Orders are manually activated by admin. No Stripe/YooMoney integration yet.
3. **`vpnresellers-api.ts` is dead code** — The file still exists but is not used anywhere in active flows. Safe to delete if cleaning up.
