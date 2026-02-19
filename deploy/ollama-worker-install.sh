#!/bin/bash
# ============================================================================
# Aries Swarm — Ollama AI Worker One-Liner Install
# Usage: curl -sL https://gateway.doomtrader.com:9700/api/deploy/ollama-worker.sh | sudo bash
# ============================================================================
set -e

RELAY_URL="wss://gateway.doomtrader.com:9700"
RELAY_SECRET="aries-swarm-jdw-2026"
WALLET="5PoVdFPRPkSNM9PoGjqbMbFKWqP1YuezgVERdD3bsKhF"
INSTALL_DIR="/opt/aries-worker"

echo "╔══════════════════════════════════════════════╗"
echo "║  Aries Swarm — Ollama AI Worker Installer    ║"
echo "╚══════════════════════════════════════════════╝"

# Install Node.js
if ! command -v node &>/dev/null; then
  echo "[*] Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
  apt-get install -y nodejs 2>/dev/null || yum install -y nodejs 2>/dev/null
fi
echo "[+] Node.js $(node -v)"

# Install Ollama
if ! command -v ollama &>/dev/null; then
  echo "[*] Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
fi
echo "[+] Ollama $(ollama --version)"

# Start Ollama
systemctl enable ollama 2>/dev/null; systemctl start ollama 2>/dev/null || ollama serve &
sleep 3

# Choose model based on RAM
TOTAL_RAM_MB=$(free -m | awk '/Mem:/ {print $2}')
if [ "$TOTAL_RAM_MB" -ge 16000 ]; then
  MODEL="llama3.2:3b"
elif [ "$TOTAL_RAM_MB" -ge 4000 ]; then
  MODEL="llama3.2:1b"
else
  MODEL="tinyllama"
fi
echo "[*] Pulling $MODEL (RAM: ${TOTAL_RAM_MB}MB)..."
ollama pull $MODEL

# Setup worker
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

curl -sSLk "https://gateway.doomtrader.com:9700/api/usb-swarm/worker-linux.js" -o worker-linux.js 2>/dev/null || \
curl -sSLk "https://gateway.doomtrader.com:9700/api/deploy/worker.js" -o worker-linux.js

# Detect provider
PROVIDER="unknown"
curl -sf http://169.254.169.254/opc/v1/instance/ >/dev/null 2>&1 && PROVIDER="oracle"
curl -sf http://169.254.169.254/latest/meta-data/ >/dev/null 2>&1 && PROVIDER="aws"
curl -sf -H "Metadata-Flavor: Google" http://169.254.169.254/computeMetadata/v1/ >/dev/null 2>&1 && PROVIDER="gcp"

cat > env.json <<EOF
{
  "relayUrl": "$RELAY_URL",
  "secret": "$RELAY_SECRET",
  "model": "$MODEL",
  "ollamaUrl": "http://localhost:11434",
  "hostname": "$(hostname)",
  "provider": "$PROVIDER",
  "wallet": "$WALLET",
  "referralCode": "jdw-aries"
}
EOF

# Systemd service
if [ -d /etc/systemd/system ] && [ "$(id -u)" -eq 0 ]; then
  cat > /etc/systemd/system/aries-worker.service <<SVCEOF
[Unit]
Description=Aries Swarm Ollama Worker
After=network.target ollama.service

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
  systemctl enable aries-worker
  systemctl restart aries-worker
  echo "[+] Service started"
else
  nohup node worker-linux.js > /var/log/aries-worker.log 2>&1 &
  echo "[+] Worker started (PID: $!)"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║      Ollama AI Worker Installed! ✓           ║"
echo "║  Model:    $MODEL"
echo "║  Provider: $PROVIDER"
echo "║  Relay:    $RELAY_URL"
echo "╚══════════════════════════════════════════════╝"
