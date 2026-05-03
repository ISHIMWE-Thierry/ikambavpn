#!/usr/bin/env bash
# Deploy the smart-subscription update to the Hetzner backend.
# Builds locally, uploads dist + new files via rsync, then restarts ONLY the
# api service. x-ui / Xray / inbounds are NEVER touched.
#
# Usage:  ./deploy-smart-subscriptions.sh
#
# Prereqs:
#   - Tailscale up + ikamba-hetzner reachable, OR direct SSH to root@ikambavpn.duckdns.org
#   - You're at the repo root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT/backend"

echo "→ Building backend locally…"
npm run build >/dev/null

# Pick a working SSH host: tailscale name first, then direct DNS.
HOST=""
for candidate in root@ikamba-hetzner root@ikambavpn.duckdns.org; do
  if ssh -o ConnectTimeout=6 -o BatchMode=yes "$candidate" 'echo ok' >/dev/null 2>&1; then
    HOST="$candidate"
    break
  fi
done

if [[ -z "$HOST" ]]; then
  echo "❌ Cannot reach Hetzner via Tailscale or public SSH."
  echo "   Try: tailscale up; tailscale ssh root@ikamba-hetzner"
  exit 1
fi

echo "→ Using $HOST"

REMOTE=/opt/ikambavpn-backend

echo "→ Syncing dist/ and package.json …"
rsync -az --delete dist/ "$HOST:$REMOTE/dist/"
rsync -az package.json package-lock.json "$HOST:$REMOTE/" 2>/dev/null || true

echo "→ Installing prod deps (no-op if unchanged) and restarting api…"
ssh "$HOST" "cd $REMOTE && npm ci --omit=dev --silent && systemctl restart ikambavpn-api && sleep 2 && systemctl is-active ikambavpn-api"

echo "→ Smoke testing /health …"
curl -fsS https://ikambavpn.duckdns.org:8443/health && echo

echo "✅ Done. x-ui / Xray were NOT touched."
