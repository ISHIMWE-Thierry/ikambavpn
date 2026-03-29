#!/usr/bin/env bash
#
# IkambaVPN — Resume VPS Setup (Steps 3b through 8)
# The initial run completed Steps 1-3a but failed on SSH restart.
# This script finishes the setup.

set -euo pipefail

# Same config as original
SSH_PORT="${SSH_PORT:-29418}"
VPN_ADMIN_USER="${VPN_ADMIN_USER:-vpnadmin}"
PANEL_PORT="${PANEL_PORT:-39182}"
PANEL_WEB_PATH="${PANEL_WEB_PATH:-/x7kQ9m/}"
PANEL_USER="${PANEL_USER:-ikamba}"
PANEL_PASS="${PANEL_PASS:-}"
SUB_PORT="${SUB_PORT:-8443}"
SUB_PATH="${SUB_PATH:-/sub/}"
PANEL_DOMAIN="${PANEL_DOMAIN:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
info() { echo -e "${CYAN}[i]${NC} $*"; }

gen_pass() { openssl rand -base64 18 | tr -d '/+='; }
if [[ -z "$PANEL_PASS" ]]; then PANEL_PASS=$(gen_pass); fi

MY_IP=$(curl -s4 ifconfig.me || hostname -I | awk '{print $1}')

# Read the vpnadmin password from the first run if possible
VPN_ADMIN_PASS=""
if [[ -f /root/.ikambavpn-setup.txt ]]; then
  VPN_ADMIN_PASS=$(grep "SSH Password:" /root/.ikambavpn-setup.txt 2>/dev/null | awk '{print $NF}' || true)
fi
if [[ -z "$VPN_ADMIN_PASS" ]]; then
  VPN_ADMIN_PASS=$(gen_pass)
  echo "$VPN_ADMIN_USER:$VPN_ADMIN_PASS" | chpasswd
fi

# ═══════════════════════════════════════════════
# STEP 3b — Properly restart SSH
# ═══════════════════════════════════════════════

log "Restarting SSH service on port $SSH_PORT..."
# Verify config is valid first
sshd -t 2>/dev/null || /usr/sbin/sshd -t
# Ubuntu 24.04 uses ssh.service
if systemctl list-unit-files | grep -q '^ssh\.service'; then
  systemctl restart ssh
elif systemctl list-unit-files | grep -q '^sshd\.service'; then
  systemctl restart sshd
fi
log "SSH restarted on port $SSH_PORT."

# ═══════════════════════════════════════════════
# STEP 4 — Firewall (UFW)
# ═══════════════════════════════════════════════

log "Configuring UFW firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing

ufw allow "$SSH_PORT/tcp"   comment 'SSH'
ufw allow 80/tcp            comment 'HTTP (cert validation)'
ufw allow 443/tcp           comment 'VLESS+REALITY'
ufw allow "$PANEL_PORT/tcp" comment '3X-UI panel'
ufw allow "$SUB_PORT/tcp"   comment 'Subscription port'

ufw --force enable
log "Firewall configured and enabled."

# ═══════════════════════════════════════════════
# STEP 5 — Install 3X-UI
# ═══════════════════════════════════════════════

log "Installing 3X-UI..."
bash <(curl -Ls https://raw.githubusercontent.com/MHSanaei/3x-ui/master/install.sh) <<EOF
y
EOF

sleep 3

log "Configuring 3X-UI panel settings..."
x-ui setting -username "$PANEL_USER" -password "$PANEL_PASS" 2>/dev/null || true
x-ui setting -port "$PANEL_PORT" 2>/dev/null || true
x-ui setting -webBasePath "$PANEL_WEB_PATH" 2>/dev/null || true
x-ui setting -subPort "$SUB_PORT" 2>/dev/null || true
x-ui setting -subPath "$SUB_PATH" 2>/dev/null || true
x-ui setting -subEnable true 2>/dev/null || true

x-ui restart
sleep 2
log "3X-UI installed and configured."

# ═══════════════════════════════════════════════
# STEP 6 — Enable BBR
# ═══════════════════════════════════════════════

log "Enabling BBR congestion control..."
if ! sysctl net.ipv4.tcp_congestion_control | grep -q bbr; then
  cat >> /etc/sysctl.conf <<SYSCTL
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
SYSCTL
  sysctl -p
  log "BBR enabled."
else
  info "BBR already active."
fi

# ═══════════════════════════════════════════════
# STEP 7 — Automatic security updates
# ═══════════════════════════════════════════════

log "Setting up unattended security updates..."
export DEBIAN_FRONTEND=noninteractive
apt install -y -qq unattended-upgrades
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | debconf-set-selections
dpkg-reconfigure -f noninteractive unattended-upgrades

# ═══════════════════════════════════════════════
# STEP 8 — Fail2Ban
# ═══════════════════════════════════════════════

log "Installing fail2ban..."
apt install -y -qq fail2ban
cat > /etc/fail2ban/jail.local <<F2B
[sshd]
enabled  = true
port     = $SSH_PORT
maxretry = 5
bantime  = 3600
F2B
systemctl enable fail2ban
systemctl restart fail2ban

# ═══════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════

echo ""
echo "════════════════════════════════════════════════════════════"
echo -e "${GREEN}  ✅ VPS SETUP COMPLETE${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""
echo -e "${CYAN}Server IP:${NC}          $MY_IP"
echo ""
echo -e "${CYAN}SSH:${NC}"
echo "  Port:             $SSH_PORT"
echo "  User:             $VPN_ADMIN_USER"
echo "  Password:         $VPN_ADMIN_PASS"
echo "  Command:          ssh -p $SSH_PORT $VPN_ADMIN_USER@$MY_IP"
echo ""
echo -e "${CYAN}3X-UI Panel:${NC}"
echo "  URL:              http://$MY_IP:$PANEL_PORT$PANEL_WEB_PATH"
echo "  Username:         $PANEL_USER"
echo "  Password:         $PANEL_PASS"
echo ""
echo -e "${CYAN}Subscription:${NC}"
echo "  Port:             $SUB_PORT"
echo "  Path:             $SUB_PATH"
echo "  Base URL:         http://$MY_IP:$SUB_PORT$SUB_PATH"
echo ""
echo -e "${YELLOW}NEXT STEPS:${NC}"
echo "  1. Log into the 3X-UI panel at the URL above"
echo "  2. Go to Inbounds → Add Inbound → create VLESS+REALITY on port 443"
echo "     - Protocol: VLESS"
echo "     - Port: 443"
echo "     - Transmission: TCP"
echo "     - Security: REALITY"
echo "     - uTLS: chrome"
echo "     - Dest: www.microsoft.com:443"
echo "     - ServerNames: www.microsoft.com"
echo "     - Click 'Get New Cert' for REALITY keys"
echo "  3. Add clients (users) in that inbound"
echo ""
echo -e "${RED}⚠️  SAVE THESE CREDENTIALS — they won't be shown again!${NC}"
echo "════════════════════════════════════════════════════════════"

# Save credentials
cat > /root/.ikambavpn-setup.txt <<CREDS
IkambaVPN 3X-UI Setup — $(date)
================================
Server IP:       $MY_IP
SSH Port:        $SSH_PORT
SSH User:        $VPN_ADMIN_USER
SSH Password:    $VPN_ADMIN_PASS
Panel URL:       http://$MY_IP:$PANEL_PORT$PANEL_WEB_PATH
Panel User:      $PANEL_USER
Panel Password:  $PANEL_PASS
Sub Port:        $SUB_PORT
Sub Path:        $SUB_PATH
CREDS
chmod 600 /root/.ikambavpn-setup.txt
log "Credentials saved to /root/.ikambavpn-setup.txt"
