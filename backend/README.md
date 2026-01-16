# IkambaVPN Backend

Node.js (TypeScript) Express API that powers the AI smart-connect VPN selection for USA ↔ Rwanda, using Firebase for auth, Firestore for state/metrics/logs, and mock WireGuard configs for MVP.

## Features
- Rule-based AI decision engine (USA/Rwanda) with scoring
- Firebase Auth verification middleware
- Mock metrics provider + admin override
- WireGuard config generator (mock mode; pluggable real mode)
- Provider router stub (provider A/B per region) with normalized WG config
- Heartbeat tracking and session logging to Firestore
- Dockerfile for containerized deploy

## Requirements
- Node.js 18+
- Firebase project with service account JSON
- Firestore + Auth enabled

## Setup
```bash
cd backend
npm install
cp .env.example .env  # fill in FIREBASE credentials paths/values
npm run dev
```

## Env
- `PORT` (default 3000)
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (escape newlines or load from file)
- `REAL_METRICS` ("true" to accept /admin/metrics writes as source of truth)
- `MOCK_WG_ENDPOINT_USA`, `MOCK_WG_ENDPOINT_RWANDA` (host:port)
- `MOCK_WG_PUBLIC_KEY_USA`, `MOCK_WG_PUBLIC_KEY_RWANDA`
- Provider endpoints/keys (examples):
	- `PROVIDER_A_USA_ENDPOINT`, `PROVIDER_A_USA_PUBKEY`, `PROVIDER_A_RW_ENDPOINT`, `PROVIDER_A_RW_PUBKEY`
	- `PROVIDER_B_USA_ENDPOINT`, `PROVIDER_B_USA_PUBKEY`, `PROVIDER_B_RW_ENDPOINT`, `PROVIDER_B_RW_PUBKEY`
	- `PROVIDER_A_DNS`, `PROVIDER_B_DNS`

## Scripts
- `npm run dev` – TS dev with reload
- `npm run build && npm start` – production

## API quick reference
- `POST /ai/smart-connect`
- `GET /servers/metrics`
- `POST /connection/heartbeat`
- `POST /admin/metrics`

See `docs/requests.http` for examples.
