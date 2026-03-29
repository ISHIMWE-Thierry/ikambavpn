# 3X-UI Deployment & Operations Guide

## Overview

This document covers deploying and operating the **3X-UI panel** with **VLESS+REALITY** on the IkambaVPN Hetzner VPS. This is an **additional** protocol option alongside the existing VPNresellers (WireGuard/OpenVPN) infrastructure — it does NOT replace anything.

**Target audience:** Russian users and anyone in countries with deep packet inspection (DPI) that blocks traditional VPN protocols.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    USER DEVICES                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ V2RayTun │  │ V2RayNG  │  │ Hiddify/Nekoray   │ │
│  │  (iOS)   │  │(Android) │  │ (Win/Mac/Linux)   │ │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘ │
│       │              │                  │            │
│       └──────────────┼──────────────────┘            │
│                      │ subscription URL              │
└──────────────────────┼───────────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │   VPS: 194.76.217.4    │
          │   Ubuntu 24.04         │
          │   HELs-2 (Finland)     │
          │                        │
          │  ┌──────────────────┐  │
          │  │    3X-UI Panel   │  │  ← Admin panel (port 39182)
          │  │  (port 39182)    │  │
          │  └──────────────────┘  │
          │  ┌──────────────────┐  │
          │  │  VLESS+REALITY   │  │  ← User traffic (port 443)
          │  │   (port 443)     │  │     Looks like microsoft.com
          │  └──────────────────┘  │
          │  ┌──────────────────┐  │
          │  │  Subscription    │  │  ← Auto-config delivery (port 8443)
          │  │  (port 8443)     │  │
          │  └──────────────────┘  │
          └────────────────────────┘

          ┌────────────────────────┐
          │   IkambaVPN Backend    │
          │  (Railway / Firebase)  │
          │                        │
          │  backend/src/           │
          │  ├── services/xui.ts   │  ← Talks to 3X-UI API
          │  └── routes/xui.ts     │  ← REST endpoints for frontend
          └────────────────────────┘
```

---

## Server Details

| Field          | Value                    |
|----------------|--------------------------|
| **IP**         | 194.76.217.4             |
| **Provider**   | Hetzner (HELs-2)        |
| **Location**   | Helsinki, Finland 🇫🇮    |
| **OS**         | Ubuntu 24.04             |
| **CPU**        | 2 cores                  |
| **RAM**        | 4 GB                     |
| **Storage**    | 60 GB SSD                |
| **Network**    | Up to 1 Gbps             |
| **Cost**       | €9.89/month              |
| **Expires**    | 28 April 2026            |

---

## Initial Setup

### Step 1 — Run the Setup Script

```bash
# Option A: Run directly from the repo
ssh root@194.76.217.4
curl -sL https://raw.githubusercontent.com/ISHIMWE-Thierry/ikambavpn/main/infrastructure/vps-setup.sh | bash

# Option B: Copy and run
scp infrastructure/vps-setup.sh root@194.76.217.4:/root/
ssh root@194.76.217.4 'bash /root/vps-setup.sh'
```

The script will:
- Update the system
- Create a `vpnadmin` user
- Harden SSH (port 29418, root login disabled)
- Configure UFW firewall
- Install 3X-UI
- Configure panel port, credentials, web path
- Enable BBR congestion control
- Install fail2ban
- Print all credentials

**⚠️ After the script finishes, save the credentials! They won't be shown again.**

### Step 2 — Log into 3X-UI Panel

Open: `http://194.76.217.4:39182/x7kQ9m/`

Log in with the credentials printed by the setup script.

### Step 3 — Create the VLESS+REALITY Inbound

1. Go to **Inbounds** → **Add Inbound**
2. Configure:

   | Setting         | Value                    |
   |-----------------|--------------------------|
   | **Remark**      | `Russia-VLESS`           |
   | **Protocol**    | VLESS                    |
   | **Listen IP**   | _(leave empty)_          |
   | **Port**        | 443                      |
   | **Transmission**| TCP                      |
   | **Security**    | REALITY                  |
   | **uTLS**        | chrome                   |
   | **Dest**        | www.microsoft.com:443    |
   | **Server Names**| www.microsoft.com        |
   | **Short IDs**   | _(auto, keep default)_   |

3. Click **Get New Cert** to generate REALITY keys
4. Click **Save**

### Step 4 — Enable Subscriptions

1. Go to **Panel Settings** → **Subscription**
2. Enable **Subscription Service**
3. Set **Subscription Port** to `8443`
4. Set **Subscription Path** to `/sub/`
5. Enable **HTTPS for subscriptions** (if you have a domain with SSL)

### Step 5 — (Optional) Set Up a Domain

If you have a domain (e.g., `panel.ikambavpn.com`):

1. Add an A record: `panel.ikambavpn.com → 194.76.217.4`
2. In 3X-UI: **Panel Settings** → enter your domain
3. Click **Get SSL Certificate** (uses Let's Encrypt)
4. Panel restarts with HTTPS

---

## Backend Integration

### Environment Variables

Add to `backend/.env`:

```env
# 3X-UI Panel
XPANEL_URL=http://194.76.217.4:39182/x7kQ9m
XPANEL_USER=ikamba
XPANEL_PASS=<your-panel-password>
XPANEL_INBOUND_ID=1
XPANEL_SUB_URL=http://194.76.217.4:8443/sub
```

### API Endpoints

The backend exposes these routes (all require auth):

| Method   | Path                          | Description                        |
|----------|-------------------------------|------------------------------------|
| `POST`   | `/xui/provision`              | Create a VLESS account for user    |
| `GET`    | `/xui/links/:subId`          | Get all connection links           |
| `GET`    | `/xui/subscription/:subId`   | Redirect to raw subscription URL   |
| `GET`    | `/xui/deeplink/:subId`       | Redirect to V2RayTun deep link     |
| `GET`    | `/xui/stats/:email`          | Get user traffic stats             |
| `GET`    | `/xui/admin/clients`         | List all clients (admin)           |
| `POST`   | `/xui/admin/add`             | Add client manually (admin)        |
| `POST`   | `/xui/admin/disable/:id`     | Disable client (admin)             |
| `POST`   | `/xui/admin/enable/:id`      | Enable client (admin)              |
| `DELETE` | `/xui/admin/delete/:id`      | Delete client (admin)              |
| `POST`   | `/xui/admin/reset-traffic/:e`| Reset traffic counter (admin)      |
| `GET`    | `/xui/admin/inbounds`        | List all inbounds (admin)          |
| `GET`    | `/xui/admin/status`          | Server system status (admin)       |

### Provisioning Flow

```
User subscribes → Backend calls POST /xui/provision →
  → 3X-UI creates VLESS client →
  → Returns subscription URL + deep links →
  → Frontend shows links to user →
  → User imports into V2RayTun/V2RayNG →
  → Connected!
```

---

## Frontend Changes

### Dashboard — New "🇷🇺 VLESS" Tab

A new protocol tab has been added to the `CredentialsBox` component in `DashboardPage.tsx`. It sits alongside OpenVPN, IKEv2, L2TP, Stealth, and WireGuard:

- Shows recommended apps for iOS/Android/Desktop
- Provides setup instructions
- Links to the full Russia Guide page

### Russia Guide Page

New page at `/russia-guide` (`src/pages/RussiaGuidePage.tsx`):

- Explains why standard VPN is blocked in Russia
- Lists all recommended apps with download links
- Step-by-step instructions for each platform
- Troubleshooting FAQ
- **Russian-language section** with quick instructions

### New Files

```
src/
├── lib/xui-api.ts              # Frontend API client for /xui routes
├── pages/RussiaGuidePage.tsx    # Full Russia setup guide page
backend/src/
├── services/xui.ts             # 3X-UI panel API service
├── routes/xui.ts               # Express routes for 3X-UI
infrastructure/
├── vps-setup.sh                # Automated VPS setup script
```

### Modified Files

```
src/App.tsx                     # Added /russia-guide route
src/types/index.ts              # Added VLESS credential fields to VpnCredentials
src/pages/DashboardPage.tsx     # Added VLESS tab + Russia recommendation card
backend/src/index.ts            # Registered /xui router
backend/.env.example            # Added XPANEL_* variables
```

---

## Ongoing Operations

### Adding a User Manually (via Panel)

1. Open 3X-UI panel → go to the VLESS+REALITY inbound
2. Click **+ Add Client**
3. Set email/remark (e.g., `user_john@gmail.com`)
4. Set traffic limit, expiry, IP limit
5. Save
6. Copy the user's subscription URL: `https://panel.yourdomain.com:8443/sub/UNIQUE_TOKEN`

### Adding a User via API

```bash
curl -X POST https://api.ikambavpn.com/xui/admin/add \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "trafficLimitGB": 100, "expiryDays": 30}'
```

### When a Server IP Gets Blocked

1. Option A: Add a new VPS, install 3X-UI, add as second inbound
2. Option B: Change the VPS IP (contact Hetzner)
3. The subscription auto-updates — users reconnect automatically

### Monitoring

- **3X-UI Panel**: Shows per-user traffic, connection status, system load
- **Telegram Notifications**: Set up in Panel Settings → Telegram Bot
- **UFW Logs**: `sudo ufw status verbose`
- **System Load**: `htop` or `GET /xui/admin/status`

### Scaling Beyond 50 Users

- Add a second VPS in a different datacenter (e.g., Netherlands, Germany)
- Use 3X-UI's multi-server support
- Or migrate to **Marzban** for better multi-node management
- At 50 users on VLESS+REALITY, CPU is typically the bottleneck

### Backup

```bash
# Backup 3X-UI database and config
ssh -p 29418 vpnadmin@194.76.217.4 'sudo cp /etc/x-ui/x-ui.db /root/x-ui-backup-$(date +%F).db'
scp -P 29418 vpnadmin@194.76.217.4:/root/x-ui-backup-*.db ./backups/
```

---

## Cost Summary

| Item                        | Monthly Cost |
|-----------------------------|-------------|
| VPS (Hetzner HELs-2)       | €9.89       |
| Domain (optional)           | ~$1         |
| Cloudflare CDN (for site)   | Free        |
| **Total overhead**          | **~€11**    |

At $3–5/month per user with 30 paying Russian customers:
- Revenue: $90–150/month
- Costs: ~€11/month
- **Margin: ~90%+**

---

## Security Checklist

- [x] Root SSH login disabled
- [x] SSH on non-standard port (29418)
- [x] UFW firewall configured
- [x] Fail2ban active
- [x] 3X-UI panel on non-standard port with random web path
- [x] BBR congestion control enabled
- [x] Unattended security updates enabled
- [ ] Domain + HTTPS (set up after DNS is configured)
- [ ] Telegram bot notifications
- [ ] Regular backups scheduled
