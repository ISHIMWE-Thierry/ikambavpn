#!/usr/bin/env bash
#
# IkambaVPN — Xray Watchdog
# ==========================
# Monitors the Xray process and auto-restarts it if it crashes.
# This is the #1 fix for "VPN randomly goes off for all users at once".
#
# Install:
#   scp infrastructure/xray-watchdog.sh root@194.76.217.4:/root/
#   ssh -p 29418 vpnadmin@194.76.217.4
#   sudo chmod +x /root/xray-watchdog.sh
#   sudo crontab -e
#   # Add this line:
#   */2 * * * * /root/xray-watchdog.sh >> /var/log/xray-watchdog.log 2>&1
#
# This runs every 2 minutes. If Xray is down, it restarts 3X-UI (which manages Xray).
# If it still can't connect after restart, it sends a webhook alert.

set -euo pipefail

LOG_PREFIX="[xray-watchdog $(date '+%Y-%m-%d %H:%M:%S')]"
XRAY_CHECK_PORT=443
VPS_IP="194.76.217.4"
MAX_RESTARTS_PER_HOUR=5
RESTART_COUNT_FILE="/tmp/xray-restart-count"
# Optional: Telegram bot alert (set these to get notified)
TG_BOT_TOKEN="${TG_BOT_TOKEN:-}"
TG_CHAT_ID="${TG_CHAT_ID:-}"

send_alert() {
  local msg="$1"
  echo "$LOG_PREFIX ALERT: $msg"
  if [[ -n "$TG_BOT_TOKEN" && -n "$TG_CHAT_ID" ]]; then
    curl -s -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TG_CHAT_ID}" \
      -d "text=🚨 IkambaVPN: ${msg}" \
      -d "parse_mode=Markdown" >/dev/null 2>&1 || true
  fi
}

# ── Check if Xray process is running ──────────────────────────────────────────
check_xray_process() {
  if pgrep -x "xray" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# ── Check if port 443 is actually accepting connections ───────────────────────
# This catches the case where Xray is running but stuck/zombied
check_port_open() {
  if timeout 5 bash -c "echo >/dev/tcp/${VPS_IP}/${XRAY_CHECK_PORT}" 2>/dev/null; then
    return 0
  fi
  # Fallback: try with nc
  if command -v nc &>/dev/null; then
    if nc -z -w5 "$VPS_IP" "$XRAY_CHECK_PORT" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

# ── Check for excessive restarts (prevent restart loops) ──────────────────────
check_restart_limit() {
  local count=0
  local now
  now=$(date +%s)

  if [[ -f "$RESTART_COUNT_FILE" ]]; then
    # Read timestamp:count pairs, keep only last hour
    while IFS=: read -r ts cnt; do
      if (( now - ts < 3600 )); then
        count=$((count + cnt))
      fi
    done < "$RESTART_COUNT_FILE"
  fi

  if (( count >= MAX_RESTARTS_PER_HOUR )); then
    return 1  # Too many restarts
  fi
  return 0
}

record_restart() {
  echo "$(date +%s):1" >> "$RESTART_COUNT_FILE"
  # Trim old entries (keep last 24 hours)
  local now
  now=$(date +%s)
  if [[ -f "$RESTART_COUNT_FILE" ]]; then
    local tmp
    tmp=$(mktemp)
    while IFS=: read -r ts cnt; do
      if (( now - ts < 86400 )); then
        echo "${ts}:${cnt}"
      fi
    done < "$RESTART_COUNT_FILE" > "$tmp"
    mv "$tmp" "$RESTART_COUNT_FILE"
  fi
}

# ── Main check logic ─────────────────────────────────────────────────────────

# Step 1: Is Xray process alive?
if ! check_xray_process; then
  echo "$LOG_PREFIX Xray process NOT running!"

  if ! check_restart_limit; then
    send_alert "Xray crashed and hit restart limit ($MAX_RESTARTS_PER_HOUR/hour). Manual intervention needed!"
    exit 1
  fi

  echo "$LOG_PREFIX Restarting 3X-UI (which manages Xray)..."
  x-ui restart 2>/dev/null || systemctl restart x-ui 2>/dev/null || true
  sleep 5

  if check_xray_process; then
    echo "$LOG_PREFIX ✅ Xray restarted successfully"
    record_restart
    send_alert "Xray was down — auto-restarted successfully ✅"
  else
    echo "$LOG_PREFIX ❌ Xray failed to restart!"
    record_restart
    send_alert "Xray FAILED to restart after crash! Server $(hostname) needs manual fix."
  fi
  exit 0
fi

# Step 2: Xray is running — but is port 443 actually responding?
# (catches zombie processes, TLS cert issues, config errors)
if ! check_port_open; then
  echo "$LOG_PREFIX Xray process running but port $XRAY_CHECK_PORT not responding!"

  if ! check_restart_limit; then
    send_alert "Port 443 unresponsive, hit restart limit. Manual fix needed!"
    exit 1
  fi

  echo "$LOG_PREFIX Restarting Xray..."
  x-ui restart 2>/dev/null || systemctl restart x-ui 2>/dev/null || true
  sleep 5

  if check_port_open; then
    echo "$LOG_PREFIX ✅ Port $XRAY_CHECK_PORT responding after restart"
    record_restart
    send_alert "Port 443 was stuck — auto-restarted Xray ✅"
  else
    echo "$LOG_PREFIX ❌ Port $XRAY_CHECK_PORT still not responding after restart"
    record_restart
    send_alert "Port 443 STILL unresponsive after restart! Manual investigation needed."
  fi
  exit 0
fi

# Step 3: Check system resources (prevent OOM kills)
MEM_USED_PCT=$(free | awk '/^Mem:/ {printf "%.0f", $3/$2*100}')
if (( MEM_USED_PCT > 90 )); then
  echo "$LOG_PREFIX ⚠️ Memory usage at ${MEM_USED_PCT}% — Xray may get OOM-killed soon"
  send_alert "⚠️ Memory at ${MEM_USED_PCT}%! Xray may crash from OOM. Consider upgrading VPS."
fi

# All good
echo "$LOG_PREFIX ✅ Xray healthy — process running, port $XRAY_CHECK_PORT open, mem ${MEM_USED_PCT}%"
