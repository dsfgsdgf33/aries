/**
 * ARIES SwarmManager — VM Provisioning & Management
 * Manages remote VMs in the swarm: add, remove, deploy relay, scale workers.
 * Uses ONLY Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const EventEmitter = require('events');

class SwarmManager extends EventEmitter {
  constructor(config) {
    super();
    try {
      this._config = config || {};
      this._enabled = config.enabled !== false;
      this._defaultRelayPort = config.defaultRelayPort || 9700;
      this._defaultSecret = config.defaultSecret || 'aries-relay-2026';
      this._sshTimeout = config.sshTimeout || 30000;
      this._dataDir = config.dataDir || path.join(__dirname, '..', 'data');
      this._vmFile = path.join(this._dataDir, 'swarm-vms.json');
      this._vms = {};
      this._healthResults = {};
      this._healthInterval = null;
      this._loadVMs();
    } catch (e) {
      this._vms = {};
    }
  }

  _loadVMs() {
    try {
      if (fs.existsSync(this._vmFile)) {
        this._vms = JSON.parse(fs.readFileSync(this._vmFile, 'utf8'));
      }
    } catch (e) {
      this._vms = {};
    }
  }

  _saveVMs() {
    try {
      if (!fs.existsSync(this._dataDir)) fs.mkdirSync(this._dataDir, { recursive: true });
      fs.writeFileSync(this._vmFile, JSON.stringify(this._vms, null, 2));
    } catch (e) {}
  }

  addVM(provider, config) {
    try {
      var id = config.id || (config.name || 'vm').toLowerCase().replace(/[^a-z0-9-]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
      var vm = {
        id: id,
        provider: provider || 'manual',
        name: config.name || id,
        ip: config.ip || 'localhost',
        port: config.port || this._defaultRelayPort,
        secret: config.secret || this._defaultSecret,
        workers: config.workers || 4,
        region: config.region || 'unknown',
        status: 'pending',
        addedAt: new Date().toISOString(),
        lastHealthCheck: null,
        healthy: false,
        responseTimeMs: null
      };
      this._vms[id] = vm;
      this._saveVMs();
      this.emit('vm-added', vm);
      return vm;
    } catch (e) {
      return { error: e.message };
    }
  }

  removeVM(nodeId) {
    try {
      if (!this._vms[nodeId]) return { error: 'VM not found' };
      var vm = this._vms[nodeId];
      delete this._vms[nodeId];
      this._saveVMs();
      this.emit('vm-removed', { id: nodeId });
      return { removed: nodeId, name: vm.name };
    } catch (e) {
      return { error: e.message };
    }
  }

  listVMs() {
    try {
      var list = [];
      var keys = Object.keys(this._vms);
      for (var i = 0; i < keys.length; i++) {
        var vm = this._vms[keys[i]];
        var health = this._healthResults[vm.id] || {};
        list.push({
          id: vm.id,
          name: vm.name,
          provider: vm.provider,
          ip: vm.ip,
          port: vm.port,
          workers: vm.workers,
          region: vm.region,
          status: vm.status,
          healthy: health.healthy || false,
          responseTimeMs: health.responseTimeMs || null,
          lastHealthCheck: health.checkedAt || vm.lastHealthCheck,
          addedAt: vm.addedAt
        });
      }
      return list;
    } catch (e) {
      return [];
    }
  }

  scaleWorkers(nodeId, count) {
    try {
      if (!this._vms[nodeId]) return { error: 'VM not found' };
      count = Math.max(1, Math.min(100, parseInt(count) || 4));
      this._vms[nodeId].workers = count;
      this._saveVMs();
      this.emit('vm-scaled', { id: nodeId, workers: count });
      return { id: nodeId, workers: count };
    } catch (e) {
      return { error: e.message };
    }
  }

  getCapacity() {
    try {
      var total = 0;
      var online = 0;
      var offline = 0;
      var keys = Object.keys(this._vms);
      for (var i = 0; i < keys.length; i++) {
        var vm = this._vms[keys[i]];
        var health = this._healthResults[vm.id] || {};
        total += vm.workers;
        if (health.healthy) online += vm.workers;
        else offline += vm.workers;
      }
      return { totalWorkers: total, onlineWorkers: online, offlineWorkers: offline, nodeCount: keys.length };
    } catch (e) {
      return { totalWorkers: 0, onlineWorkers: 0, offlineWorkers: 0, nodeCount: 0 };
    }
  }

  deployRelay(nodeId) {
    try {
      var vm = this._vms[nodeId];
      if (!vm) return Promise.resolve({ error: 'VM not found' });

      var relayScript = this.generateRelayScript(vm.port, vm.secret);
      var sshCmd = 'ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@' + vm.ip +
        ' "cat > /opt/aries-relay.js && nohup node /opt/aries-relay.js > /var/log/aries-relay.log 2>&1 &"';

      return new Promise(function(resolve) {
        try {
          var child = spawn('sh', ['-c', sshCmd], { timeout: 30000 });
          child.stdin.write(relayScript);
          child.stdin.end();

          var stdout = '';
          var stderr = '';
          child.stdout.on('data', function(d) { stdout += d; });
          child.stderr.on('data', function(d) { stderr += d; });

          child.on('close', function(code) {
            if (code === 0) {
              vm.status = 'deployed';
              resolve({ success: true, message: 'Relay deployed to ' + vm.ip });
            } else {
              resolve({ success: false, error: stderr || 'SSH command failed with code ' + code });
            }
          });

          child.on('error', function(err) {
            resolve({ success: false, error: err.message });
          });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    } catch (e) {
      return Promise.resolve({ error: e.message });
    }
  }

  generateRelayScript(port, secret) {
    try {
      port = port || this._defaultRelayPort;
      secret = secret || this._defaultSecret;

      var templatePath = path.join(__dirname, 'relay-template.js');
      if (fs.existsSync(templatePath)) {
        var template = fs.readFileSync(templatePath, 'utf8');
        template = template.replace(/%%PORT%%/g, String(port));
        template = template.replace(/%%SECRET%%/g, secret);
        return template;
      }

      // Inline fallback
      return [
        '// Aries Swarm Relay Agent v1.0',
        '// Auto-generated — listens on port ' + port,
        'const http = require("http");',
        'const { exec } = require("child_process");',
        'const PORT = ' + port + ';',
        'const SECRET = "' + secret + '";',
        '',
        'function readBody(req) {',
        '  return new Promise(function(resolve) {',
        '    var d = ""; req.on("data", function(c) { d += c; }); req.on("end", function() { resolve(d); });',
        '  });',
        '}',
        '',
        'var server = http.createServer(async function(req, res) {',
        '  res.setHeader("Content-Type", "application/json");',
        '  if (req.headers["x-relay-secret"] !== SECRET) { res.writeHead(401); res.end(JSON.stringify({error:"unauthorized"})); return; }',
        '  if (req.method === "GET" && req.url === "/health") { res.end(JSON.stringify({status:"ok",uptime:process.uptime()})); return; }',
        '  if (req.method === "POST" && req.url === "/task") {',
        '    var body = JSON.parse(await readBody(req));',
        '    var timeout = body.timeout || 30000;',
        '    exec(body.code || "echo ok", { timeout: timeout, maxBuffer: 5*1024*1024 }, function(err, stdout, stderr) {',
        '      res.end(JSON.stringify({ stdout: stdout, stderr: stderr, error: err ? err.message : null, exitCode: err ? err.code : 0 }));',
        '    });',
        '    return;',
        '  }',
        '  res.writeHead(404); res.end(JSON.stringify({error:"not found"}));',
        '});',
        'server.listen(PORT, function() { console.log("Relay on port " + PORT); });'
      ].join('\n');
    } catch (e) {
      return '// Error generating relay script: ' + e.message;
    }
  }

  checkHealth(nodeId) {
    var self = this;
    var vm = this._vms[nodeId];
    if (!vm) return Promise.resolve({ error: 'VM not found' });

    return new Promise(function(resolve) {
      try {
        var startMs = Date.now();
        var req = http.request({
          hostname: vm.ip,
          port: vm.port,
          path: '/health',
          method: 'GET',
          headers: { 'x-relay-secret': vm.secret },
          timeout: 5000
        }, function(res) {
          var data = '';
          res.on('data', function(c) { data += c; });
          res.on('end', function() {
            var elapsed = Date.now() - startMs;
            var result = { healthy: res.statusCode === 200, responseTimeMs: elapsed, checkedAt: new Date().toISOString() };
            try { result.data = JSON.parse(data); } catch (e) {}
            self._healthResults[nodeId] = result;
            vm.lastHealthCheck = result.checkedAt;
            vm.status = result.healthy ? 'active' : 'unreachable';
            vm.healthy = result.healthy;
            self._saveVMs();
            resolve(result);
          });
        });
        req.on('error', function() {
          var result = { healthy: false, responseTimeMs: Date.now() - startMs, checkedAt: new Date().toISOString(), error: 'Connection failed' };
          self._healthResults[nodeId] = result;
          vm.status = 'unreachable';
          vm.healthy = false;
          self._saveVMs();
          resolve(result);
        });
        req.on('timeout', function() { req.destroy(); });
        req.end();
      } catch (e) {
        resolve({ healthy: false, error: e.message });
      }
    });
  }

  async checkAllHealth() {
    try {
      var keys = Object.keys(this._vms);
      var results = {};
      for (var i = 0; i < keys.length; i++) {
        results[keys[i]] = await this.checkHealth(keys[i]);
      }
      return results;
    } catch (e) {
      return {};
    }
  }

  startHealthChecks(intervalMs) {
    try {
      var self = this;
      intervalMs = intervalMs || 30000;
      if (this._healthInterval) clearInterval(this._healthInterval);
      this._healthInterval = setInterval(function() {
        self.checkAllHealth().catch(function() {});
      }, intervalMs);
      // Initial check
      this.checkAllHealth().catch(function() {});
    } catch (e) {}
  }

  stopHealthChecks() {
    try {
      if (this._healthInterval) {
        clearInterval(this._healthInterval);
        this._healthInterval = null;
      }
    } catch (e) {}
  }

  stop() {
    this.stopHealthChecks();
  }
}

module.exports = { SwarmManager };
