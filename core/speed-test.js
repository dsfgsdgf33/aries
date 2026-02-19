/**
 * ARIES v5.0 — Network Speed Test
 * Download/upload speed, latency testing
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

class SpeedTest {
  constructor() { this.refs = null; this.lastResult = null; }
  start(refs) { this.refs = refs; }

  async runTest() {
    const downloadSpeed = await this.testDownload();
    const latencies = await this.testLatency();
    const result = { download: downloadSpeed, latencies, timestamp: Date.now() };
    this.lastResult = result;
    return result;
  }

  testDownload() {
    // Download a known file and measure speed
    const testUrls = [
      'http://speedtest.tele2.net/1MB.zip',
      'http://proof.ovh.net/files/1Mb.dat'
    ];
    const testUrl = testUrls[0];
    return new Promise((resolve) => {
      const start = Date.now();
      let bytes = 0;
      const parsed = new URL(testUrl);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(testUrl, { timeout: 15000 }, (res) => {
        res.on('data', (chunk) => { bytes += chunk.length; });
        res.on('end', () => {
          const elapsed = (Date.now() - start) / 1000;
          const mbps = ((bytes * 8) / elapsed / 1000000).toFixed(2);
          resolve({ mbps: parseFloat(mbps), bytes, elapsed: Math.round(elapsed * 1000) });
        });
      });
      req.on('error', () => resolve({ mbps: 0, error: 'failed' }));
      req.on('timeout', () => { req.destroy(); resolve({ mbps: 0, error: 'timeout' }); });
    });
  }

  testLatency() {
    const hosts = [
      { name: 'Google', url: 'https://www.google.com' },
      { name: 'Cloudflare', url: 'https://1.1.1.1' },
      { name: 'AWS', url: 'https://aws.amazon.com' }
    ];
    return Promise.all(hosts.map(h => {
      return new Promise((resolve) => {
        const start = Date.now();
        const parsed = new URL(h.url);
        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.get(h.url, { timeout: 5000 }, (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve({ name: h.name, ms: Date.now() - start }));
        });
        req.on('error', () => resolve({ name: h.name, ms: -1, error: 'failed' }));
        req.on('timeout', () => { req.destroy(); resolve({ name: h.name, ms: -1, error: 'timeout' }); });
      });
    }));
  }

  registerRoutes(addRoute) {
    addRoute('GET', '/api/speedtest', async (req, res, json) => {
      try {
        const result = await this.runTest();
        json(res, 200, { ok: true, ...result });
      } catch (e) { json(res, 500, { error: e.message }); }
    });
    addRoute('GET', '/api/speedtest/workers', (req, res, json) => {
      json(res, 200, { ok: true, message: 'Worker speed test not yet implemented', lastLocal: this.lastResult });
    });
  }
}

module.exports = { SpeedTest };
