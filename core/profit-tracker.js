/**
 * ARIES v5.0 — Profit Tracker
 * Polls Solana blockchain for actual wallet balance, tracks changes over time.
 * Pure Node.js, zero dependencies.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const LAMPORTS_PER_SOL = 1e9;
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'profit-history.json');

class ProfitTracker {
  constructor(config) {
    this._config = config || {};
    this._walletAddress = this._extractWalletAddress();
    this._currentBalance = null;
    this._solPrice = 0;
    this._history = [];
    this._pollTimer = null;
    this._priceTimer = null;
    this._loadHistory();
  }

  _extractWalletAddress() {
    const wallet = this._config.wallet || '';
    // Format: SOL:ADDRESS.WORKER#REFERRAL or SOL:ADDRESS
    const match = wallet.match(/^SOL:([A-Za-z0-9]+)/);
    if (match) return match[1];
    // If it contains a dot, take everything before the dot after SOL:
    const match2 = wallet.match(/^SOL:([^.#]+)/);
    if (match2) return match2[1];
    return wallet;
  }

  _loadHistory() {
    try {
      this._history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (!Array.isArray(this._history)) this._history = [];
    } catch { this._history = []; }
  }

  _saveHistory() {
    try {
      const dir = path.dirname(HISTORY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // Keep last 2000 entries
      if (this._history.length > 2000) this._history = this._history.slice(-2000);
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this._history, null, 2));
    } catch (e) { console.error('[PROFIT] Save error:', e.message); }
  }

  _httpPost(urlStr, body) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(urlStr);
      const mod = parsed.protocol === 'https:' ? https : http;
      const postData = JSON.stringify(body);
      const req = mod.request({
        hostname: parsed.hostname, port: parsed.port, path: parsed.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
        timeout: 15000
      }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(postData);
      req.end();
    });
  }

  _httpGet(urlStr) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(urlStr);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request({
        hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search,
        method: 'GET', timeout: 10000
      }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
  }

  async fetchBalance() {
    if (!this._walletAddress) return null;
    try {
      const result = await this._httpPost(SOLANA_RPC, {
        jsonrpc: '2.0', id: 1, method: 'getBalance', params: [this._walletAddress]
      });
      if (result && result.result && result.result.value !== undefined) {
        return result.result.value / LAMPORTS_PER_SOL;
      }
    } catch (e) { console.error('[PROFIT] Balance fetch error:', e.message); }
    return null;
  }

  async fetchSolPrice() {
    try {
      const data = await this._httpGet('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      if (data && data.solana && data.solana.usd) {
        this._solPrice = data.solana.usd;
        return this._solPrice;
      }
    } catch (e) {
      // Fallback: try alternative
      try {
        const data2 = await this._httpGet('https://min-api.cryptocompare.com/data/price?fsym=SOL&tsyms=USD');
        if (data2 && data2.USD) { this._solPrice = data2.USD; return this._solPrice; }
      } catch {}
    }
    return this._solPrice;
  }

  async poll() {
    const balance = await this.fetchBalance();
    if (balance === null) return;

    await this.fetchSolPrice();

    const prevBalance = this._currentBalance;
    this._currentBalance = balance;
    const change = prevBalance !== null ? balance - prevBalance : 0;

    const entry = {
      timestamp: Date.now(),
      balance: balance,
      change: Math.round(change * 1e9) / 1e9,
      solPrice: this._solPrice,
      usdValue: Math.round(balance * this._solPrice * 100) / 100
    };

    this._history.push(entry);

    if (change > 0.000001) {
      console.log(`[PROFIT] Balance increased: +${change.toFixed(9)} SOL ($${(change * this._solPrice).toFixed(4)})`);
    }

    this._saveHistory();
    return entry;
  }

  start() {
    if (!this._walletAddress) {
      console.log('[PROFIT] No wallet address configured, skipping');
      return;
    }
    console.log(`[PROFIT] Tracking wallet: ${this._walletAddress.substring(0, 8)}...${this._walletAddress.slice(-4)}`);
    // Initial poll
    this.poll().catch(e => console.error('[PROFIT] Initial poll error:', e.message));
    // Poll every 5 minutes
    this._pollTimer = setInterval(() => this.poll().catch(() => {}), POLL_INTERVAL);
    // Fetch price more frequently (every 2 min)
    this._priceTimer = setInterval(() => this.fetchSolPrice().catch(() => {}), 120000);
  }

  stop() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this._priceTimer) { clearInterval(this._priceTimer); this._priceTimer = null; }
  }

  getBalance() {
    return {
      address: this._walletAddress,
      balance: this._currentBalance,
      solPrice: this._solPrice,
      usdValue: this._currentBalance !== null ? Math.round(this._currentBalance * this._solPrice * 100) / 100 : null,
      lastUpdate: this._history.length > 0 ? this._history[this._history.length - 1].timestamp : null
    };
  }

  getHistory(limit) {
    const n = limit || 500;
    return this._history.slice(-n);
  }

  getSummary() {
    const now = Date.now();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    let totalEarned = 0;
    let todayEarned = 0;
    for (const entry of this._history) {
      if (entry.change > 0) {
        totalEarned += entry.change;
        if (entry.timestamp >= todayMs) todayEarned += entry.change;
      }
    }

    return {
      address: this._walletAddress,
      balance: this._currentBalance,
      solPrice: this._solPrice,
      usdValue: this._currentBalance !== null ? Math.round(this._currentBalance * this._solPrice * 100) / 100 : null,
      totalEarned: Math.round(totalEarned * 1e9) / 1e9,
      totalEarnedUsd: Math.round(totalEarned * this._solPrice * 100) / 100,
      todayEarned: Math.round(todayEarned * 1e9) / 1e9,
      todayEarnedUsd: Math.round(todayEarned * this._solPrice * 100) / 100,
      historyEntries: this._history.length,
      trackingSince: this._history.length > 0 ? this._history[0].timestamp : null
    };
  }
}

module.exports = { ProfitTracker };
