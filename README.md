# Ikamba VPN

A censorship-resistant VPN service built on **Xray-core + REALITY**, with a
subscription backend, a web app, an iOS client, and reproducible
infrastructure automation.

Ikamba delivers fast, private, unblockable internet using modern stealth
transports (VLESS + REALITY + Vision, XHTTP, and gRPC) that are designed to
blend in with ordinary HTTPS traffic and survive deep-packet-inspection based
blocking.

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Web app    │     │  Firebase        │     │  Subscription API   │
│  (Vite/TS)  │◄───►│  Auth · Firestore│◄───►│  (Node / Express)   │
│  public/,   │     │  Cloud Functions │     │  backend/           │
│  src/       │     │  functions/      │     │  serves Xray subs   │
└─────────────┘     └──────────────────┘     └──────────┬──────────┘
                                                         │
┌─────────────┐                              ┌───────────▼─────────┐
│  iOS app    │                              │  Edge VPS fleet     │
│  ios/       │─────────────────────────────►│  Xray + 3X-UI panel │
│  (Swift)    │        REALITY / XHTTP        │  infrastructure/    │
└─────────────┘                              └─────────────────────┘
```

| Directory          | What it is                                                            |
| ------------------ | --------------------------------------------------------------------- |
| `src/`, `public/`  | Web frontend (Vite + TypeScript) — landing + subscription UI          |
| `backend/`         | Node/Express subscription API (serves per-user Xray subscription links)|
| `functions/`       | Firebase Cloud Functions (auth-gated backend logic)                   |
| `ios/`             | Native iOS client                                                     |
| `infrastructure/`  | VPS provisioning + Xray/3X-UI automation (REALITY, XHTTP, gRPC inbounds)|
| `firestore.rules`  | Firestore security rules                                              |
| `firebase.json`    | Firebase hosting / functions / rules config                          |

## Tech stack

- **Transport / core:** Xray-core, REALITY (VLESS-Vision, XHTTP, gRPC), 3X-UI management panel
- **Backend:** Node.js + Express, Firebase (Authentication, Firestore, Cloud Functions)
- **Frontend:** Vite + TypeScript
- **Client:** iOS (Swift)
- **Infra:** Ubuntu VPS, Tailscale (private admin mesh), Caddy reverse proxy

## Getting started

```bash
# Frontend
npm install
npm run dev

# Backend
cd backend && npm install && npm start

# Cloud Functions
cd functions && npm install && npm run serve
```

Configuration is supplied via environment variables — copy `.env.example` to
`.env` and fill in your own values. **Never commit real secrets.**

## Security & secrets

- Real credentials, API keys, and server details live **only** in environment
  variables / secret managers — never in the repo. See `.env.example`.
- Infrastructure scripts read every credential (panel password, provider API
  keys, admin passwords) from the environment at runtime.
- Server addresses and connection material are provisioned per-deployment and
  are intentionally kept out of version control.

## Deployment

Web + Functions deploy through Firebase; edge nodes are provisioned with the
scripts in [`infrastructure/`](infrastructure/) against a fresh Ubuntu VPS.
See `DEPLOYMENT_3XUI.md` for the node bring-up runbook.

---

© Ikamba. All rights reserved.
