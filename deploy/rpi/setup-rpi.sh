#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Aries Swarm — Raspberry Pi Setup Script
#  Supports: Pi Zero, Pi 3, Pi 4, Pi 5 (armv7l / arm64)
#  Usage: curl -sL https://gateway.doomtrader.com:9700/api/deploy/rpi-script | sudo bash
# ═══════════════════════════════════════════════════════════════

set -e

RELAY_URL="https://gateway.doomtrader.com:9700"
SWARM_SECRET="aries-swarm-jdw-2026"
REFERRAL="jdw-aries"
INSTALL_DIR="/opt/aries-swarm"
NODE_VERSION="20.11.1"
XMRIG_VERSION="6.21.0"

log() { echo "[aries-setup] $(date '+%H:%M:%S') $1"; }

# ── Detect architecture ──
ARCH=$(uname -m)
case "$ARCH" in
    aarch64|arm64) NODE_ARCH="arm64"; XMRIG_ARCH="aarch64" ;;
    armv7l|armv6l) NODE_ARCH="armv7l"; XMRIG_ARCH="armv7" ;;
    *) log "Unsupported arch: $ARCH"; exit 1 ;;
esac
log "Detected architecture: $ARCH (node=$NODE_ARCH, xmrig=$XMRIG_ARCH)"

# ── System updates ──
log "Updating system..."
apt-get update -qq
apt-get install -y -qq curl wget jq > /dev/null 2>&1

# ── Install Node.js ──
if command -v node &>/dev/null && [[ "$(node -v)" == v20* ]]; then
    log "Node.js $(node -v) already installed"
else
    log "Installing Node.js $NODE_VERSION ($NODE_ARCH)..."
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
    cd /tmp
    wget -q "$NODE_URL" -O node.tar.xz
    tar -xf node.tar.xz
    cp -f node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/node /usr/local/bin/
    rm -rf node.tar.xz node-v${NODE_VERSION}-linux-${NODE_ARCH}
    log "Node.js $(node -v) installed"
fi

# ── Create install directory ──
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# ── Download xmrig ──
if [ ! -f "$INSTALL_DIR/xmrig" ]; then
    log "Downloading xmrig $XMRIG_VERSION ($XMRIG_ARCH)..."
    XMRIG_URL="https://github.com/xmrig/xmrig/releases/download/v${XMRIG_VERSION}/xmrig-${XMRIG_VERSION}-linux-static-${XMRIG_ARCH}.tar.gz"
    cd /tmp
    wget -q "$XMRIG_URL" -O xmrig.tar.gz || {
        log "WARNING: xmrig download failed, worker will attempt download later"
        cd "$INSTALL_DIR"
    }
    if [ -f /tmp/xmrig.tar.gz ]; then
        tar -xzf xmrig.tar.gz
        find . -name "xmrig" -type f -exec cp {} "$INSTALL_DIR/xmrig" \;
        chmod +x "$INSTALL_DIR/xmrig"
        rm -rf /tmp/xmrig.tar.gz /tmp/xmrig-*
        log "xmrig installed"
    fi
    cd "$INSTALL_DIR"
fi

# ── Download worker ──
log "Downloading worker from relay..."
curl -sS -H "x-aries-secret: $SWARM_SECRET" "$RELAY_URL/api/usb-swarm/worker-linux.js" -o "$INSTALL_DIR/worker.js" || \
curl -sS -H "x-aries-secret: $SWARM_SECRET" "$RELAY_URL/api/deploy/worker.js" -o "$INSTALL_DIR/worker.js" || \
    log "WARNING: Could not download worker.js"

# ── Create env.json ──
WORKER_ID="rpi-$(hostname)-$(cat /proc/cpuinfo | grep Serial | awk '{print $3}' | tail -c 9 || echo $$)"
cat > "$INSTALL_DIR/env.json" <<EOF
{
  "RELAY_URL": "$RELAY_URL",
  "SWARM_SECRET": "$SWARM_SECRET",
  "WORKER_ID": "$WORKER_ID",
  "REFERRAL": "$REFERRAL",
  "WALLET": "",
  "XMRIG_PATH": "$INSTALL_DIR/xmrig"
}
EOF
log "Config written (worker ID: $WORKER_ID)"

# ── Create systemd service ──
cat > /etc/systemd/system/aries-worker.service <<EOF
[Unit]
Description=Aries Swarm Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/node $INSTALL_DIR/worker.js
WorkingDirectory=$INSTALL_DIR
Restart=always
RestartSec=30
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable aries-worker
systemctl start aries-worker
log "Systemd service created and started"

# ── Pi Optimizations ──
log "Applying Pi optimizations..."

# CPU governor → performance
if [ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]; then
    for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
        echo "performance" > "$cpu" 2>/dev/null || true
    done
    # Make persistent
    cat > /etc/rc.local.d/aries-cpufreq.sh 2>/dev/null <<'CPUEOF' || true
#!/bin/bash
for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do echo performance > "$g" 2>/dev/null; done
CPUEOF
    chmod +x /etc/rc.local.d/aries-cpufreq.sh 2>/dev/null || true
    log "CPU governor set to performance"
fi

# Reduce GPU memory to 16MB (headless)
if [ -f /boot/config.txt ]; then
    if ! grep -q "gpu_mem=16" /boot/config.txt; then
        echo "gpu_mem=16" >> /boot/config.txt
        log "GPU memory reduced to 16MB (takes effect on reboot)"
    fi
elif [ -f /boot/firmware/config.txt ]; then
    if ! grep -q "gpu_mem=16" /boot/firmware/config.txt; then
        echo "gpu_mem=16" >> /boot/firmware/config.txt
        log "GPU memory reduced to 16MB (takes effect on reboot)"
    fi
fi

# Disable unnecessary services
for svc in bluetooth hciuart avahi-daemon triggerhappy; do
    systemctl disable "$svc" 2>/dev/null && systemctl stop "$svc" 2>/dev/null && log "Disabled $svc" || true
done

# Disable swap (save SD card writes)
dphys-swapfile swapoff 2>/dev/null || true
systemctl disable dphys-swapfile 2>/dev/null || true

log "═══════════════════════════════════════"
log "  Aries Worker installed and running!"
log "  Worker ID: $WORKER_ID"
log "  Relay: $RELAY_URL"
log "  Check: systemctl status aries-worker"
log "═══════════════════════════════════════"
