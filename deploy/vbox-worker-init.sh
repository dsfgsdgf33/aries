#!/bin/bash
# ═══════════════════════════════════════════════════
# ARIES VBox Worker Bootstrap Script
# Runs on first boot inside Alpine Linux VM
# Auto-enrolls into the Aries swarm
# ═══════════════════════════════════════════════════

set -e

RELAY_URL="${ARIES_RELAY_URL:-gateway.doomtrader.com:9700}"
RELAY_SECRET="${ARIES_RELAY_SECRET:-aries-swarm-jdw-2026}"
MASTER_URL="${ARIES_MASTER_URL:-http://10.0.2.2:3333}"
MASTER_KEY="${ARIES_MASTER_KEY:-aries-api-2026}"
WORKER_DIR="/opt/aries"
LOG_FILE="/var/log/aries-worker.log"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

log "=== Aries Worker Init Starting ==="
log "Hostname: $(hostname)"
log "Relay: $RELAY_URL"
log "Master: $MASTER_URL"

# ── Install dependencies ──
if ! command -v node &>/dev/null; then
  log "Installing Node.js..."
  apk update
  apk add nodejs npm curl bash
fi

log "Node.js version: $(node --version 2>/dev/null || echo 'not found')"

# ── Create worker directory ──
mkdir -p "$WORKER_DIR"

# ── Copy from shared folder if available ──
if [ -d /mnt/aries ]; then
  log "Copying from shared folder /mnt/aries..."
  cp -r /mnt/aries/* "$WORKER_DIR/" 2>/dev/null || true
fi

# ── Generate worker ID ──
WORKER_ID="vbox-$(hostname)-$(cat /proc/sys/kernel/random/uuid | head -c 8)"
log "Worker ID: $WORKER_ID"

# ── Create minimal worker script ──
cat > "$WORKER_DIR/worker.js" << 'WORKEREOF'
var http = require('http');
var https = require('https');
var os = require('os');
var crypto = require('crypto');

var RELAY_URL = process.env.ARIES_RELAY_URL || 'gateway.doomtrader.com:9700';
var RELAY_SECRET = process.env.ARIES_RELAY_SECRET || 'aries-swarm-jdw-2026';
var MASTER_URL = process.env.ARIES_MASTER_URL || 'http://10.0.2.2:3333';
var WORKER_ID = process.env.ARIES_WORKER_ID || 'vbox-' + os.hostname() + '-' + crypto.randomBytes(4).toString('hex');

var registered = false;

function getSystemInfo() {
  var cpus = os.cpus();
  return {
    workerId: WORKER_ID,
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: cpus[0] ? cpus[0].model : 'unknown',
    cpuCores: cpus.length,
    totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMb: Math.round(os.freemem() / 1024 / 1024),
    uptime: os.uptime(),
    type: 'vbox-worker'
  };
}

function registerWithRelay() {
  var info = getSystemInfo();
  var payload = JSON.stringify({
    type: 'register',
    workerId: WORKER_ID,
    hostname: os.hostname(),
    capabilities: ['compute', 'mining', 'proxy'],
    system: info,
    relaySecret: RELAY_SECRET
  });

  var proto = RELAY_URL.startsWith('https') ? 'https' : 'http';
  var url = proto + '://' + RELAY_URL + '/api/swarm/register';
  
  try {
    var urlObj = new (require('url').URL)(url);
    var mod = urlObj.protocol === 'https:' ? https : http;
    var req = mod.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Aries-Secret': RELAY_SECRET,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000,
      rejectUnauthorized: false
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        console.log('[worker] Relay registration response: ' + res.statusCode + ' ' + data);
        if (res.statusCode < 300) registered = true;
      });
    });
    req.on('error', function(e) {
      console.log('[worker] Relay registration error: ' + e.message);
    });
    req.write(payload);
    req.end();
  } catch(e) {
    console.log('[worker] Registration failed: ' + e.message);
  }
}

function heartbeat() {
  var info = getSystemInfo();
  var payload = JSON.stringify({
    type: 'heartbeat',
    workerId: WORKER_ID,
    system: info
  });

  try {
    var url = (RELAY_URL.startsWith('http') ? '' : 'http://') + RELAY_URL + '/api/swarm/heartbeat';
    var urlObj = new (require('url').URL)(url);
    var mod = urlObj.protocol === 'https:' ? https : http;
    var req = mod.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Aries-Secret': RELAY_SECRET,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000,
      rejectUnauthorized: false
    });
    req.on('error', function() {});
    req.write(payload);
    req.end();
  } catch(e) {}
}

// ── Start ──
console.log('[worker] Aries VBox Worker starting - ID: ' + WORKER_ID);
console.log('[worker] Relay: ' + RELAY_URL);

// Register immediately and retry every 30s
registerWithRelay();
setInterval(function() {
  if (!registered) registerWithRelay();
  else heartbeat();
}, 30000);

// Simple HTTP server for health checks
var server = http.createServer(function(req, res) {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getSystemInfo()));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(8080, function() {
  console.log('[worker] Health server on :8080');
});

process.on('uncaughtException', function(e) {
  console.error('[worker] Uncaught:', e.message);
});
WORKEREOF

# ── Create environment config ──
cat > "$WORKER_DIR/.env" << EOF
ARIES_RELAY_URL=$RELAY_URL
ARIES_RELAY_SECRET=$RELAY_SECRET
ARIES_MASTER_URL=$MASTER_URL
ARIES_MASTER_KEY=$MASTER_KEY
ARIES_WORKER_ID=$WORKER_ID
EOF

# ── Create systemd/OpenRC service ──
if command -v rc-service &>/dev/null; then
  # Alpine uses OpenRC
  cat > /etc/init.d/aries-worker << 'SVCEOF'
#!/sbin/openrc-run

name="aries-worker"
description="Aries Swarm Worker"
command="/usr/bin/node"
command_args="/opt/aries/worker.js"
command_background="yes"
pidfile="/run/aries-worker.pid"
output_log="/var/log/aries-worker.log"
error_log="/var/log/aries-worker.log"

depend() {
    need net
    after firewall
}

start_pre() {
    # Load env
    if [ -f /opt/aries/.env ]; then
        export $(cat /opt/aries/.env | xargs)
    fi
}
SVCEOF
  chmod +x /etc/init.d/aries-worker
  rc-update add aries-worker default
  log "OpenRC service created and enabled"
elif command -v systemctl &>/dev/null; then
  # Debian/Ubuntu uses systemd
  cat > /etc/systemd/system/aries-worker.service << SVCEOF
[Unit]
Description=Aries Swarm Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/opt/aries/.env
ExecStart=/usr/bin/node /opt/aries/worker.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/aries-worker.log
StandardError=append:/var/log/aries-worker.log

[Install]
WantedBy=multi-user.target
SVCEOF
  systemctl daemon-reload
  systemctl enable aries-worker
  log "Systemd service created and enabled"
fi

# ── Start the worker now ──
log "Starting worker..."
if command -v rc-service &>/dev/null; then
  rc-service aries-worker start || node "$WORKER_DIR/worker.js" &
else
  systemctl start aries-worker || node "$WORKER_DIR/worker.js" &
fi

log "=== Aries Worker Init Complete ==="
log "Worker ID: $WORKER_ID"
log "Relay: $RELAY_URL"
