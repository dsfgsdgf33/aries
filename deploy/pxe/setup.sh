#!/bin/sh
# ARIES Swarm Worker — Post-Boot Setup Script
# Runs on Alpine Linux after PXE boot
# Installs Node.js, XMRig, downloads worker, starts mining

set -e

# ── Parse kernel cmdline args ──
RELAY_URL=""
RELAY_SECRET=""
WORKER_MAC=""

for arg in $(cat /proc/cmdline); do
  case "$arg" in
    aries_relay=*) RELAY_URL="${arg#aries_relay=}" ;;
    aries_secret=*) RELAY_SECRET="${arg#aries_secret=}" ;;
    aries_mac=*) WORKER_MAC="${arg#aries_mac=}" ;;
  esac
done

# Fallback defaults
[ -z "$RELAY_URL" ] && RELAY_URL="http://45.76.232.5:9700"
[ -z "$RELAY_SECRET" ] && RELAY_SECRET="aries-swarm-jdw-2026"
[ -z "$WORKER_MAC" ] && WORKER_MAC=$(cat /sys/class/net/eth0/address 2>/dev/null || echo "unknown")

# Worker ID from MAC (strip colons)
WORKER_ID="pxe-$(echo "$WORKER_MAC" | tr -d ':')"

echo "==============================="
echo " ARIES Worker Setup"
echo " Relay:  $RELAY_URL"
echo " Worker: $WORKER_ID"
echo "==============================="

# ── Setup Alpine repos ──
setup-apkrepos -1 2>/dev/null || true
echo "http://dl-cdn.alpinelinux.org/alpine/latest-stable/main" > /etc/apk/repositories
echo "http://dl-cdn.alpinelinux.org/alpine/latest-stable/community" >> /etc/apk/repositories
apk update

# ── Install dependencies ──
echo "[+] Installing Node.js and build tools..."
apk add --no-cache nodejs npm curl wget build-base cmake git libuv-dev hwloc-dev openssl-dev

# ── Install XMRig ──
echo "[+] Installing XMRig..."
if ! command -v xmrig >/dev/null 2>&1; then
  cd /tmp
  wget -q https://github.com/xmrig/xmrig/releases/download/v6.21.0/xmrig-6.21.0-linux-static-x64.tar.gz -O xmrig.tar.gz || {
    echo "[!] XMRig download failed, building from source..."
    git clone --depth 1 https://github.com/xmrig/xmrig.git
    cd xmrig && mkdir build && cd build
    cmake .. -DWITH_HWLOC=OFF
    make -j$(nproc)
    cp xmrig /usr/local/bin/
    cd /tmp && rm -rf xmrig
  }
  if [ -f xmrig.tar.gz ]; then
    tar xzf xmrig.tar.gz
    cp xmrig-*/xmrig /usr/local/bin/
    rm -rf xmrig*
  fi
fi

# ── Create worker directory ──
mkdir -p /opt/aries
cd /opt/aries

# ── Download worker script from relay ──
echo "[+] Downloading worker from $RELAY_URL..."
HTTP_BASE=$(echo "$RELAY_URL" | sed 's|:[0-9]*$||'):8888
curl -sf "$HTTP_BASE/worker-linux.js" -o worker.js || {
  # Fallback: try relay API
  curl -sf "$RELAY_URL/api/deploy/worker" -o worker.js || {
    echo "[!] Worker download failed, creating minimal worker..."
    cat > worker.js << 'WORKER_EOF'
const http = require('http');
const { execSync, spawn } = require('child_process');
const os = require('os');

const RELAY = process.env.RELAY_URL || 'http://45.76.232.5:9700';
const SECRET = process.env.RELAY_SECRET || 'aries-swarm-jdw-2026';
const WORKER_ID = process.env.WORKER_ID || 'pxe-' + os.hostname();

console.log('[ARIES] Worker ' + WORKER_ID + ' connecting to ' + RELAY);

function heartbeat() {
  const data = JSON.stringify({
    workerId: WORKER_ID, secret: SECRET,
    hostname: os.hostname(), cpu: os.cpus().length,
    ram_gb: Math.round(os.totalmem() / 1073741824),
    status: 'idle'
  });
  const url = new URL(RELAY + '/api/worker/heartbeat');
  const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
  }, () => {});
  req.on('error', () => {});
  req.write(data); req.end();
}

setInterval(heartbeat, 10000);
heartbeat();
console.log('[ARIES] Worker running');
WORKER_EOF
  }
}

# ── Create startup script ──
cat > /opt/aries/start.sh << EOF
#!/bin/sh
export RELAY_URL="$RELAY_URL"
export RELAY_SECRET="$RELAY_SECRET"
export WORKER_ID="$WORKER_ID"
cd /opt/aries
node worker.js >> /var/log/aries-worker.log 2>&1 &
echo "[ARIES] Worker started as PID \$!"
EOF
chmod +x /opt/aries/start.sh

# ── Start worker now ──
echo "[+] Starting Aries worker..."
export RELAY_URL RELAY_SECRET WORKER_ID
node /opt/aries/worker.js >> /var/log/aries-worker.log 2>&1 &
WORKER_PID=$!
echo "[+] Worker PID: $WORKER_PID"

# ── Persist across reboots via rc.local ──
echo "[+] Setting up persistence..."
cat > /etc/local.d/aries-worker.start << 'RCEOF'
#!/bin/sh
/opt/aries/start.sh
RCEOF
chmod +x /etc/local.d/aries-worker.start
rc-update add local default 2>/dev/null || true

echo "==============================="
echo " ARIES Worker Setup Complete"
echo " Worker: $WORKER_ID"
echo " PID:    $WORKER_PID"
echo "==============================="
