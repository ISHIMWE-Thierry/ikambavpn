#!/usr/bin/env bash
# Aeza API helper — requires AEZA_API_KEY in env (from my.aeza.net → Settings → API keys).
# Never commit the key. Usage:
#   export AEZA_API_KEY='6966_…'
#   ./infrastructure/aeza-api.sh list
#   ./infrastructure/aeza-api.sh resume SERVICE_ID

set -euo pipefail

BASE="${AEZA_API_BASE:-https://my.aeza.net/api}"
KEY="${AEZA_API_KEY:-}"

if [[ -z "$KEY" ]]; then
  echo "Set AEZA_API_KEY (from https://my.aeza.net/settings/apikeys)"
  exit 1
fi

aeza() {
  /usr/bin/curl -sk -m 30 -H "X-API-Key: $KEY" -H "Accept: application/json" "$@"
}

case "${1:-list}" in
  list)
    aeza "$BASE/services" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for s in d.get('data',{}).get('items',[]):
    print(f\"{s['id']:>8}  {s.get('status','?'):8}  {s.get('ip','?'):16}  {s.get('name','')}\")
"
    ;;
  resume)
    SID="${2:-}"
    [[ -n "$SID" ]] || { echo "Usage: $0 resume SERVICE_ID"; exit 1; }
    aeza -X POST -H "Content-Type: application/json" \
      -d '{"action":"resume"}' "$BASE/services/$SID/ctl"
    echo
    ;;
  *)
    echo "Usage: $0 list | resume SERVICE_ID"
    exit 1
    ;;
esac
