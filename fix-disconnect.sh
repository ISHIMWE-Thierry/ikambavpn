#!/bin/bash
# Fix VPN auto-disconnect issues on IkambaVPN VPS
# Run as: sudo bash /tmp/fix-disconnect.sh

set -e

echo "========================================="
echo " IkambaVPN Auto-Disconnect Fix"
echo "========================================="

# 1. Fix LimitNOFILE (65535 -> 1048576)
echo "[1/5] Updating x-ui service file limits..."
mkdir -p /etc/systemd/system/x-ui.service.d
cat > /etc/systemd/system/x-ui.service.d/limits.conf << 'EOF'
[Service]
LimitNOFILE=1048576
LimitNPROC=unlimited
EOF
echo "  ✅ LimitNOFILE set to 1048576"

# 2. Tune kernel parameters for VPN stability
echo "[2/5] Tuning kernel parameters..."
cat > /etc/sysctl.d/99-ikambavpn.conf << 'EOF'
# Conntrack
net.netfilter.nf_conntrack_max = 262144

# TCP keepalive - balanced (not too aggressive, not too slow)
net.ipv4.tcp_keepalive_time = 120
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 4

# Buffer sizes
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.ipv4.tcp_rmem = 4096 1048576 16777216
net.ipv4.tcp_wmem = 4096 1048576 16777216

# Connection handling
net.core.somaxconn = 8192
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_max_tw_buckets = 65536

# File descriptors
fs.file-max = 1048576

# BBR congestion control
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# Conntrack timeouts - prevent stale entries from eating table
net.netfilter.nf_conntrack_tcp_timeout_established = 7200
net.netfilter.nf_conntrack_tcp_timeout_time_wait = 30
EOF
sysctl -p /etc/sysctl.d/99-ikambavpn.conf
echo "  ✅ Kernel parameters tuned (keepalive 120s, conntrack 262144, BBR)"

# 3. Install Xray watchdog
echo "[3/5] Installing Xray watchdog..."
cat > /usr/local/bin/xray-watchdog.sh << 'WATCHDOG'
#!/bin/bash
# Xray watchdog - checks every 2 minutes via cron
LOG="/var/log/xray-watchdog.log"
MAX_RESTARTS=5
RESTART_COUNT_FILE="/tmp/xray-restart-count"
RESTART_HOUR_FILE="/tmp/xray-restart-hour"

current_hour=$(date +%H)
saved_hour=$(cat "$RESTART_HOUR_FILE" 2>/dev/null || echo "")

if [ "$current_hour" != "$saved_hour" ]; then
    echo 0 > "$RESTART_COUNT_FILE"
    echo "$current_hour" > "$RESTART_HOUR_FILE"
fi

restart_count=$(cat "$RESTART_COUNT_FILE" 2>/dev/null || echo 0)

# Check if xray process is running
if ! pgrep -f "xray-linux" > /dev/null 2>&1; then
    echo "$(date): Xray process NOT running!" >> "$LOG"
    
    if [ "$restart_count" -ge "$MAX_RESTARTS" ]; then
        echo "$(date): Max restarts ($MAX_RESTARTS) reached this hour. Skipping." >> "$LOG"
        exit 1
    fi
    
    echo "$(date): Restarting x-ui..." >> "$LOG"
    systemctl restart x-ui
    sleep 5
    
    if pgrep -f "xray-linux" > /dev/null 2>&1; then
        echo "$(date): ✅ Xray restarted successfully" >> "$LOG"
    else
        echo "$(date): ❌ Xray FAILED to restart!" >> "$LOG"
    fi
    
    echo $((restart_count + 1)) > "$RESTART_COUNT_FILE"
    exit 0
fi

# Check if port 443 is responding
if ! ss -tlnp | grep -q ":443 " 2>/dev/null; then
    echo "$(date): Port 443 not listening! Restarting..." >> "$LOG"
    
    if [ "$restart_count" -ge "$MAX_RESTARTS" ]; then
        echo "$(date): Max restarts reached. Skipping." >> "$LOG"
        exit 1
    fi
    
    systemctl restart x-ui
    echo $((restart_count + 1)) > "$RESTART_COUNT_FILE"
fi

# Check memory usage
mem_percent=$(free | awk '/Mem:/ {printf "%.0f", $3/$2*100}')
if [ "$mem_percent" -gt 90 ]; then
    echo "$(date): ⚠️ Memory usage at ${mem_percent}%!" >> "$LOG"
fi
WATCHDOG
chmod +x /usr/local/bin/xray-watchdog.sh

# Add cron if not exists
(crontab -l 2>/dev/null | grep -v "xray-watchdog"; echo "*/2 * * * * /usr/local/bin/xray-watchdog.sh >> /var/log/xray-watchdog.log 2>&1") | crontab -
echo "  ✅ Watchdog installed (runs every 2 minutes)"

# 4. Reload and restart
echo "[4/5] Reloading systemd and restarting x-ui..."
systemctl daemon-reload
systemctl restart x-ui
sleep 3
echo "  ✅ x-ui restarted"

# 5. Verify
echo "[5/5] Verifying..."
echo "  x-ui status: $(systemctl is-active x-ui)"
echo "  Xray running: $(pgrep -f xray-linux > /dev/null && echo YES || echo NO)"
echo "  Port 443: $(ss -tlnp | grep -q ':443 ' && echo LISTENING || echo DOWN)"
echo "  LimitNOFILE: $(cat /proc/$(pgrep -f x-ui | head -1)/limits 2>/dev/null | grep 'open files' | awk '{print $4}')"
echo "  tcp_keepalive_time: $(sysctl -n net.ipv4.tcp_keepalive_time)"
echo "  conntrack_max: $(sysctl -n net.netfilter.nf_conntrack_max)"
echo "  Watchdog cron: $(crontab -l 2>/dev/null | grep -c watchdog) entry"
echo ""
echo "========================================="
echo " ✅ ALL FIXES APPLIED SUCCESSFULLY"
echo "========================================="
