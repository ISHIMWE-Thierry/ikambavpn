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

### Entitlement logic

```typescript
const activeOrder = orders.find(o => o.status === 'active');
const expired     = isExpired(activeOrder?.expiresAt);
const activeTrial = trial?.status === 'active';

const canActivate = (!expired && !!activeOrder) || activeTrial;
const canCopyLink = activated && canActivate;
```

### Hero card states

| State | Orb appearance | Bottom button |
|---|---|---|
| Loading entitlement | Grey, disabled | Spinner |
| No plan, no trial | Grey muted, non-clickable | None — plan card handles CTA |
| Has plan or trial, not activated | Dark/clickable | "Activate VPN" |
| Activated, has entitlement | Black (online) / dark gray (offline) | "Copy VPN Link" |
| Activated, no entitlement | Black / dark gray | "Plan required to connect" (disabled) |

### Plan card states

| State | Content |
|---|---|
| Active paid plan | Plan name, features, expiry countdown; "Renew plan" if ≤7 days |
| Active trial | "Free Trial / 1-hour access" + "View plans" |
| No plan, trial unused | "Get 1-hour free trial" (primary) + "View plans" |
| No plan, trial expired | "Your trial has ended. Pick a plan to continue." |

---

## 4. VPN Provisioning Flow

```
handleActivate()
  → provisionXuiAccount({ email, trafficLimitGB: 0, expiryDays: 0, maxConnections: 2 })
      ↳ POST /xui-public/provision  (VPS API)
      ↳ 3X-UI panel creates VLESS+REALITY client
  → setActivated(true)
  → getXuiStats(email)  — fetches usage data from panel
  → checkVpnServerHealth() every 60s

copyLink()
  → navigator.clipboard.writeText(subUrl)
  → subUrl = {API_URL}/xui-public/sub/{email}  — subscription URL

copyBackup()  (Advanced settings)
  → GET /xui-public/xhttp-link/{email}
  → Returns single XHTTP VLESS link for ISP bypass
```

### VPS API endpoints used

| Endpoint | Purpose |
|---|---|
| `POST /xui-public/provision` | Create/update 3X-UI client |
| `GET /xui-public/stats/:email` | Usage stats (total bytes, expiry) |
| `GET /xui-public/sub/:email` | Full subscription URL |
| `GET /xui-public/xhttp-link/:email` | Single XHTTP link |
| `GET /xui-public/health` | Server health check |

**Known bug:** `/xui-public/xhttp-link/:email` in `backend/src/routes/xui.ts` uses `split('\n')[1]` — should be `[0]` since XHTTP is now first in the subscription. Fix before production.

---

## 5. Free Trial Flow

**File:** `src/pages/TrialPage.tsx`  
**Duration:** 1 hour (display only — server has no hard expiry; manual admin action required to expire)

> **IMPORTANT — do NOT reconnect VPNresellers here.** The trial was previously wired to VPNresellers.net (WireGuard credentials). That was wrong — the dashboard runs on 3X-UI VLESS+REALITY, which is a completely different system. Reconnecting VPNresellers would break the dashboard flow again and waste everyone's time. Trial MUST use `provisionXuiAccount`.

```
/trial
  → Check Firestore vpn_trials for active/expired record
  → active   → redirect /dashboard
  → expired  → show "Trial already used"
  → none     → show confirm screen

Confirm
  → createTrial(uid, { status: 'provisioning' })
  → provisionXuiAccount({ email, trafficLimitGB: 0, expiryDays: 0, maxConnections: 2 })
      ← SAME 3X-UI backend as the dashboard "Activate VPN" button
  → updateTrial(trialId, { status: 'active' })
  → auto-redirect /dashboard after 2s
  → User taps "Copy VPN Link" on dashboard to get their VLESS subscription URL
```

**Do not show WireGuard/OpenVPN credentials on the trial success screen.** There are no credentials to show — the user's link is their subscription URL, available on the dashboard.

---

## 6. Plans & Pricing

**File:** `src/pages/PlansPage.tsx`  
Plans are loaded from Firestore; fallback to hardcoded defaults.

| Plan | Price | Devices |
|---|---|---|
| Basic | 49 ₽ / month | 1 |
| Popular | 79 ₽ / month | 3 |
| Premium | 99 ₽ / month | 5 + priority support |

Payment is admin-activated (no payment gateway integrated — admin reviews proof and manually sets `orders/{id}.status = 'active'`).

---

## 7. OTP Service

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

## 8. Design Tokens

```
Background:   bg-gray-50    (#f9fafb)
Card:         bg-white + rounded-3xl + border border-gray-100 (sometimes shadow-sm)
Primary text: text-gray-900
Secondary:    text-gray-500 / text-gray-400
Accent:       bg-black text-white (buttons, active orb)
Danger:       text-red-500 / bg-red-50
Trial badge:  bg-blue-100 text-blue-700
Success:      bg-green-500 text-white (copy flash)
Font:         system font-sans (Tailwind default)
Border-r:     rounded-3xl (cards), rounded-full (buttons, orb)
```

### Animation library
**framer-motion** — `motion`, `AnimatePresence`, `Variants`

```typescript
// Container stagger
const container: Variants = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};
// Card entry
const card: Variants = {
  hidden: { opacity: 0, y: 24 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};
```

Concentric rings (server online): 3 `motion.div` with `scale: [1, 2.6]` + `opacity: [0.18, 0]`, staggered 0.5s delay each.

---

## 9. File Map (key files)

```
src/
├── pages/
│   ├── DashboardPage.tsx       Main user screen
│   ├── HomePage.tsx            Marketing landing
│   ├── PlansPage.tsx           Plan selection
│   ├── TrialPage.tsx           Free trial provisioning
│   ├── CheckoutPage.tsx        Order submission
│   ├── SignUpPage.tsx          Registration + OTP trigger
│   ├── SignInPage.tsx          Login + OTP redirect guard
│   └── EmailVerificationPage.tsx  6-digit OTP entry
├── components/
│   ├── ProtectedRoute.tsx      Auth + OTP gate
│   ├── ui/button.tsx           Button primitive (primary/secondary variants)
│   └── ui/badge.tsx            Status badge (success/warning/danger/muted)
├── lib/
│   ├── xui-api.ts              3X-UI panel wrapper + health check
│   ├── db-service.ts           Firestore CRUD (orders, trials, plans, users)
│   ├── otp-service.ts          OTP generate/verify/resend
│   ├── vpnresellers-api.ts     VPNresellers.net account management (trials)
│   └── utils.ts                formatDate, formatCurrency, daysUntilExpiry, isExpired
├── contexts/AuthContext.tsx    Firebase Auth + profile listener
├── types/index.ts              VpnOrder, VpnPlan, VpnTrial, VpnCredentials, etc.
├── App.tsx                     Routes
└── index.css                   Tailwind + animation keyframes
```

---

## 10. Environment Variables

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

## 11. Deployment

| Layer | Platform | Deploy |
|---|---|---|
| Frontend | Railway | Auto-deploy on push to `main` |
| Backend API | VPS (194.76.217.4) | Manual: SSH/VNC → `git pull && npm run build && systemctl restart ikambavpn-api.service` |
| Firebase | Google Cloud | Auth + Firestore always live |

---

## 12. Known Issues / TODO

1. **`/xui-public/xhttp-link/:email` returns wrong link** — `backend/src/routes/xui.ts` does `split('\n')[1]` but XHTTP is index `[0]`. Change to `split('\n')[0]`.
2. **Trial expiry not enforced** — 1-hour trial is display-only. No Cloud Function or cron disables the 3X-UI client after 1 hour. Needs a scheduled function or backend job.
3. **Payment gateway** — Orders are manually activated by admin. No Stripe/YooMoney integration yet.
4. **Admin dashboard** — Admin panel is in the `blink-1` project (Ikamba Remit), not this repo.
