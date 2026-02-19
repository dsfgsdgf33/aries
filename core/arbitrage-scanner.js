/**
 * ARIES v5.0 — Arbitrage Scanner
 * Scans DEX prices across Jupiter, Raydium, Orca for SOL token price discrepancies.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const EventEmitter = require('events');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const SOL_MINT = 'So11111111111111111111111111111111111111112';

class ArbitrageScanner extends EventEmitter {
  constructor() {
    super();
    this._timer = null;
    this._opportunities = [];
    this._lastAlert = 0;
  }

  _getConfig() {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return {
        enabled: cfg.arbitrage?.enabled || false,
        minSpreadPercent: cfg.arbitrage?.minSpreadPercent || 1.0,
        coins: cfg.arbitrage?.coins || ['SOL'],
        botToken: cfg.miner?.telegram?.botToken || '',
        chatId: cfg.miner?.telegram?.chatId || '',
      };
    } catch { return { enabled: false, minSpreadPercent: 1.0, coins: ['SOL'], botToken: '', chatId: '' }; }
  }

  start() {
    const cfg = this._getConfig();
    if (!cfg.enabled) { console.log('[ARBITRAGE] Disabled in config'); return; }
    console.log('[ARBITRAGE] Starting scanner (min spread: ' + cfg.minSpreadPercent + '%)');
    this._poll();
    this._timer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  async _poll() {
    const cfg = this._getConfig();
    if (!cfg.enabled) return;
    try {
      const [jupiter, dexScreener] = await Promise.all([
        this._fetchJupiter(),
        this._fetchDexScreener(),
      ]);

      const prices = {};
      if (jupiter?.SOL) prices['Jupiter'] = jupiter.SOL;
      if (dexScreener) {
        for (const [dex, price] of Object.entries(dexScreener)) {
          if (price > 0) prices[dex] = price;
        }
      }

      const dexNames = Object.keys(prices);
      if (dexNames.length < 2) return;

      const now = Date.now();
      for (let i = 0; i < dexNames.length; i++) {
        for (let j = i + 1; j < dexNames.length; j++) {
          const a = dexNames[i], b = dexNames[j];
          const pa = prices[a], pb = prices[b];
          const spread = ((Math.max(pa, pb) - Math.min(pa, pb)) / Math.min(pa, pb)) * 100;
          if (spread >= cfg.minSpreadPercent) {
            const low = pa < pb ? a : b;
            const high = pa < pb ? b : a;
            const lowP = Math.min(pa, pb);
            const highP = Math.max(pa, pb);
            const opp = {
              ts: now,
              coin: 'SOL',
              buyDex: low,
              sellDex: high,
              buyPrice: lowP,
              sellPrice: highP,
              spreadPct: spread,
            };
            this._opportunities.push(opp);
            if (this._opportunities.length > 500) this._opportunities = this._opportunities.slice(-500);
            this.emit('opportunity', opp);
            // Alert via Telegram (cooldown 5 min)
            if (now - this._lastAlert > 5 * 60 * 1000) {
              const msg = `💰 ARB: SOL $${lowP.toFixed(2)} on ${low} vs $${highP.toFixed(2)} on ${high} (+${spread.toFixed(1)}%)`;
              this._sendTelegram(msg, cfg);
              this._lastAlert = now;
            }
          }
        }
      }
    } catch (e) { console.error('[ARBITRAGE] Poll error:', e.message); }
  }

  _fetchJupiter() {
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'price.jup.ag',
        path: '/v4/price?ids=SOL',
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        timeout: 10000,
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            const price = j.data?.SOL?.price;
            resolve(price ? { SOL: parseFloat(price) } : null);
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  _fetchDexScreener() {
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.dexscreener.com',
        path: '/latest/dex/tokens/' + SOL_MINT,
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        timeout: 10000,
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            const prices = {};
            for (const pair of (j.pairs || []).slice(0, 20)) {
              const dex = pair.dexId || 'unknown';
              const p = parseFloat(pair.priceUsd || 0);
              if (p > 0 && !prices[dex]) prices[dex] = p;
            }
            resolve(Object.keys(prices).length ? prices : null);
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  _sendTelegram(message, cfg) {
    if (!cfg.botToken || !cfg.chatId) return;
    const postData = JSON.stringify({ chat_id: cfg.chatId, text: message });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + cfg.botToken + '/sendMessage',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 10000,
    });
    req.on('error', () => {});
    req.write(postData);
    req.end();
  }

  getOpportunities() { return this._opportunities.slice(-50); }

  updateConfig(updates) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      cfg.arbitrage = cfg.arbitrage || {};
      if (updates.enabled !== undefined) cfg.arbitrage.enabled = updates.enabled;
      if (updates.minSpreadPercent !== undefined) cfg.arbitrage.minSpreadPercent = updates.minSpreadPercent;
      if (updates.coins) cfg.arbitrage.coins = updates.coins;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
      // Restart if toggled
      if (updates.enabled === true && !this._timer) this.start();
      if (updates.enabled === false) this.stop();
      return cfg.arbitrage;
    } catch (e) { return { error: e.message }; }
  }
}

module.exports = { ArbitrageScanner };
