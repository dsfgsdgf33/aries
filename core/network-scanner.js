/**
 * ARIES v5.0 — Network Scanner
 * LAN discovery, port scanning, OS fingerprinting
 */
const { exec } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

class NetworkScanner {
  constructor() {
    this.historyFile = path.join(__dirname, '..', 'data', 'scan-history.json');
    this.history = [];
    this.refs = null;
  }

  start(refs) {
    this.refs = refs;
    try { this.history = JSON.parse(fs.readFileSync(this.historyFile, 'utf8')); } catch { this.history = []; }
  }

  scanLAN() {
    return new Promise((resolve) => {
      exec('arp -a', { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve([]);
        const devices = [];
        const lines = stdout.split('\n');
        for (const line of lines) {
          const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\w-]+)\s+(\w+)/);
          if (match) {
            devices.push({ ip: match[1], mac: match[2], type: match[3] });
          }
        }
        const result = { type: 'lan', devices, timestamp: Date.now() };
        this.history.push(result);
        if (this.history.length > 50) this.history = this.history.slice(-50);
        try { fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2)); } catch {}
        resolve(devices);
      });
    });
  }

  scanPorts(host, ports) {
    const portList = ports || [21, 22, 80, 443, 3389, 8080, 8443, 3306, 5432, 27017, 6379, 9090];
    const results = [];
    return new Promise((resolve) => {
      let pending = portList.length;
      if (pending === 0) return resolve([]);
      for (const port of portList) {
        const sock = new net.Socket();
        sock.setTimeout(1500);
        sock.on('connect', () => {
          results.push({ port, status: 'open' });
          sock.destroy();
          if (--pending === 0) finish();
        });
        sock.on('timeout', () => { sock.destroy(); results.push({ port, status: 'closed' }); if (--pending === 0) finish(); });
        sock.on('error', () => { results.push({ port, status: 'closed' }); if (--pending === 0) finish(); });
        sock.connect(port, host);
      }
      function finish() {
        const sorted = results.sort((a, b) => a.port - b.port);
        const scanResult = { type: 'port', host, results: sorted, timestamp: Date.now() };
        // save to history (but don't let it grow huge)
        resolve(sorted);
      }
    });
  }

  pingSweep(subnet) {
    // subnet like "192.168.1" — ping .1 to .254
    return new Promise((resolve) => {
      const base = subnet || '192.168.1';
      // Use PowerShell parallel ping for speed
      const ps = `1..254 | ForEach-Object -Parallel { $ip="${base}.$_"; if(Test-Connection $ip -Count 1 -TimeoutSeconds 1 -Quiet){$ip} } -ThrottleLimit 50`;
      exec(`powershell -NoProfile -Command "${ps}"`, { timeout: 60000 }, (err, stdout) => {
        if (err) return resolve([]);
        const hosts = stdout.trim().split('\n').map(s => s.trim()).filter(Boolean);
        resolve(hosts);
      });
    });
  }

  registerRoutes(addRoute) {
    addRoute('GET', '/api/scan/lan', async (req, res, json) => {
      try {
        const devices = await this.scanLAN();
        json(res, 200, { ok: true, devices });
      } catch (e) { json(res, 500, { error: e.message }); }
    });

    addRoute('POST', '/api/scan/ports', async (req, res, json, body) => {
      try {
        const data = JSON.parse(body);
        const results = await this.scanPorts(data.host || '127.0.0.1', data.ports);
        json(res, 200, { ok: true, host: data.host, results });
      } catch (e) { json(res, 500, { error: e.message }); }
    });

    addRoute('GET', '/api/scan/history', (req, res, json) => {
      json(res, 200, { ok: true, history: this.history.slice(-20) });
    });
  }
}

module.exports = { NetworkScanner: NetworkScanner };
