#!/usr/bin/env bash
#
# IkambaVPN — 3X-UI VPS Setup Script (v2 — fixed)
# ==================================================
# Run this on a fresh Ubuntu 22.04 / 24.04 VPS.
#
# Usage:
#   scp infrastructure/vps-setup.sh root@194.76.217.4:/root/
#   ssh root@194.76.217.4 'bash /root/vps-setup.sh'

set -euo pipefail

# ╔══════════════════════════════════════════════════════════════════╗
# ║  CONFIGURATION                                                 ║
# ╚══════════════════════════════════════════════════════════════════╝

SSH_PORT="${SSH_PORT:-29418}"
VPN_ADMIN_USER="${VPN_ADMIN_USER:-vpnadmin}"
VPN_ADMIN_PASS="${VPN_ADMIN_PASS:-}"

PANEL_PORT="${PANEL_PORT:-39182}"
PANEL_WEB_PATH="${PANEL_WEB_PATH:-/x7kQ9m/}"
PANEL_USER="${PANEL_USER:-ikamba}"
PANEL_PASS="${PANEL_PASS:-}"

SUB_PORT="${SUB_PORT:-8443}"
SUB_PATH="${SUB_PATH:-/sub/}"
PANEL_DOMAIN="${PANEL_DOMAIN:-}"

# ╔══════════════════════════════════════════════════════════════════╗
# ║  HELPERS                                                       ║
# ╚══════════════════════════════════════════════════════════════════╝

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }
info() { echo -e "${CYAN}[i]${NC} $*"; }
gen_pass() { openssl rand -base64 18 | tr -d '/+='; }

if [[ -z "$VPN_ADMIN_PASS" ]]; then VPN_ADMIN_PASS=$(gen_pass); fi
if [[ -z "$PANEL_PASS" ]]; then PANEL_PASS=$(gen_pass); fi

MY_IP=$(curl -s4 ifconfig.me || hostname -I | awk '{print $1}')

# Detect SSH service name (Ubuntu 24.04 = ssh, older = sshd)
if systemctl list-unit-files ssh.service &>/dev/null; then
  SSH_SVC="ssh"
else
  SSH_SVC="sshd"
fi

export DEBIAN_FRONTEND=noninteractive

# ╔══════════════════════════════════════════════════════════════════╗
# ║  STEP 1 — System update                                       ║
# ╚══════════════════════════════════════════════════════════════════╝

log "Step 1/8: Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
apt-get install -y -qq curl wget unzip socat cron
log "System updated."

# ╔══════════════════════════════════════════════════════════════════╗
# ║  STEP 2 — Create non-root user                                ║
# ╚══════════════════════════════════════════════════════════════════╝

log "Step 2/8: Creating user $VPN_ADMIN_USER..."
if ! id "$VPN_ADMIN_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$VPN_ADMIN_USER"
  echo "$VPN_ADMIN_USER:$VPN_ADMIN_PASS" | chpasswd
  usermod -aG sudo "$VPN_ADMIN_USER"
  if [[ -f /root/.ssh/authorized_keys ]]; then
    mkdir -p "/home/$VPN_ADMIN_USER/.ssh"
    cp /root/.ssh/authorized_keys "/home/$VPN_ADMIN_USER/.ssh/"
    chown -R "$VPN_ADMIN_USER:$VPN_ADMIN_USER" "/home/$VPN_ADMIN_USER/.ssh"
    chmod 700 "/home/$VPN_ADMIN_USER/.ssh"
    chmod 600 "/home/$VPN_ADMIN_USER/.ssh/authorized_keys"
  fi
  log "User $VPN_ADMIN_USER created."
else
  warn "User $VPN_ADMIN_USER already exists, updating password."
  echo "$VPN_ADMIN_USER:$VPN_ADMIN_PASS" | chpasswd
fi

# ╔══════════════════════════════════════════════════════════════════╗
# ║  STEP 3 — Firewall (UFW)                                      ║
# ╚══════════════════════════════════════════════════════════════════╝

log "Step 3/8: Configuring UFW firewall..."
apt-get install -y -qq ufw
ufw --force reset
ufw default deny incoming
ufw default allow outgoing

# Allow BOTH old port 22 and new port so we don't lock ourselves out
ufw allow 22/tcp            comment 'SSH-old'
ufw allow "$SSH_PORT/tcp"   comment 'SSH'
ufw allow 80/tcp            comment 'HTTP (cert validation)'
ufw allow 443/tcp           comment 'VLESS+REALITY'
ufw allow "$PANEL_PORT/tcp" comment '3X-UI panel'
ufw allow "$SUB_PORT/tcp"   comment 'Subscription port'

ufw --force enable
log "Firewall configured."

# ╔══════════════════════════════════════════════════════════════════╗
# ║  STEP 4 — Install 3X-UI                                       ║
# ╚══════════════════════════════════════════════════════════════════╝

log "Step 4/8: Installing 3X-UI..."
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

# ╔══════════════════════════════════════════════════════════════════╗
# ║  STEP 5 — Enable BBR                                          ║
# ╚══════════════════════════════════════════════════════════════════╝

log "Step 5/8: Enabling BBR congestion control..."
if ! sysctl net.ipv4.tcp_congestion_control 2>/dev/null | grep -q bbr; then
  cat >> /etc/sysctl.conf <<SYSCTL
# BBR congestion control
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
SYSCTL
  sysctl -p
  log "BBR enabled."
else
  info "BBR already active."
fi

# ╔══════════════════════════════════════════════════════════════════╗
# ║  STEP 6 — Unattended upgrades                                 ║
# ╚══════════════════════════════════════════════════════════════════╝

log "Step 6/8: Setting up unattended security updates..."
apt-get install -y -qq unattended-upgrades
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | debconf-set-selections
dpkg-reconfigure -f noninteractive unattended-upgrades

# ╔══════════════════════════════════════════════════════════════════╗
# ║  STEP 7 — Fail2Ban                                            ║
# ╚══════════════════════════════════════════════════════════════════╝

log "Step 7/8: Installing fail2ban..."
apt-get install -y -qq fail2ban
cat > /etc/fail2ban/jail.local <<F2B
[sshd]
enabled  = true
port     = $SSH_PORT
maxretry = 5
bantime  = 3600
F2B
systemctl enable fail2ban
systemctl restart fail2ban
log "Fail2ban configured."

# ╔══════════════════════════════════════════════════════════════════╗
# ║  SAVE CREDENTIALS BEFORE TOUCHING SSH                         ║
# ╚══════════════════════════════════════════════════════════════════╝

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

# ╔══════════════════════════════════════════════════════════════════╗
# ║  STEP 8 — Harden SSH (LAST — so we never lose connection)     ║
# ╚══════════════════════════════════════════════════════════════════╝

log "Step 8/8: Hardening SSH (port $SSH_PORT)..."
SSHD_CFG="/etc/ssh/sshd_config"

sed -i "s/^#\?Port .*/Port $SSH_PORT/" "$SSHD_CFG"
sed -i "s/^#\?PermitRootLogin .*/PermitRootLogin no/" "$SSHD_CFG"
if ! grep -q "^PasswordAuthentication" "$SSHD_CFG"; then
  echo "PasswordAuthentication yes" >> "$SSHD_CFG"
fi

systemctl restart "$SSH_SVC"
log "SSH hardened on port $SSH_PORT."

# Remove port 22 from UFW
ufw delete allow 22/tcp 2>/dev/null || true

# ╔══════════════════════════════════════════════════════════════════╗
# ║  SUMMARY                                                       ║
# ╚══════════════════════════════════════════════════════════════════╝

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
echo "     - Protocol: VLESS  |  Port: 443  |  Transmission: TCP"
echo "     - Security: REALITY  |  uTLS: chrome"
echo "     - Dest: www.microsoft.com:443"
echo "     - ServerNames: www.microsoft.com"
echo "     - Click 'Get New Cert' for REALITY keys"
echo "  3. Add clients (users) in that inbound"
echo ""
echo -e "${RED}⚠️  SAVE THESE CREDENTIALS — they won't be shown again!${NC}"
echo "════════════════════════════════════════════════════════════"
