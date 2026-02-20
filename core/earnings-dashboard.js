/**
 * ARIES v5.0 — Live Earnings Dashboard
 * Aggregates all revenue streams into a unified dashboard.
 * Streams: Solana wallet, mining (unMineable), proxy network, SaaS/Stripe, referrals.
 * Pure Node.js, zero dependencies.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const WALLET_ADDRESS = '7xhn1y9DBxaawPynE1Yj6ogEtEpB1c89hhffEg58tfcJ';
const LAMPORTS_PER_SOL = 1e9;
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const DATA_DIR = path.join(__dirname, '..', 'data');
const EARNINGS_DIR = path.join(DATA_DIR, 'earnings');
const PROXY_FILE = path.join(DATA_DIR, 'proxy-earnings.json');
const STRIPE_FILE = path.join(DATA_DIR, 'stripe-revenue.json');
const REFERRAL_FILE = path.join(DATA_DIR, 'referral-earnings.json');

class EarningsDashboard {
  constructor(config) {
    this._config = config || {};
    this._timer = null;
    this._solBalance = null;
    this._solPrice = 0;
    this._lastRefresh = null;
    this._streams = {
      wallet: { label: 'Solana Wallet', todayUsd: 0, totalUsd: 0, details: {} },
      mining: { label: 'Mining (unMineable)', todayUsd: 0, totalUsd: 0, details: {} },
      proxy: { label: 'Proxy Network', todayUsd: 0, totalUsd: 0, details: {} },
      saas: { label: 'SaaS / Stripe', todayUsd: 0, totalUsd: 0, details: {} },
      referrals: { label: 'Referrals', todayUsd: 0, totalUsd: 0, details: {} }
    };
    this._previousBalance = null;
    this._ensureDirs();
  }

  // ── HTTP helpers (match existing codebase pattern) ──

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

  _ensureDirs() {
    try {
      if (!fs.existsSync(EARNINGS_DIR)) fs.mkdirSync(EARNINGS_DIR, { recursive: true });
    } catch (e) { console.error('[EARNINGS] Dir create error:', e.message); }
  }

  // ── Data fetchers ──

  async _fetchSolBalance() {
    try {
      const result = await this._httpPost(SOLANA_RPC, {
        jsonrpc: '2.0', id: 1, method: 'getBalance', params: [WALLET_ADDRESS]
      });
      if (result && result.result && result.result.value !== undefined) {
        return result.result.value / LAMPORTS_PER_SOL;
      }
    } catch (e) { console.error('[EARNINGS] SOL balance error:', e.message); }
    return null;
  }

  async _fetchSolPrice() {
    try {
      const data = await this._httpGet('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      if (data && data.solana && data.solana.usd) return data.solana.usd;
    } catch {}
    // Fallback
    try {
      const data = await this._httpGet('https://min-api.cryptocompare.com/data/price?fsym=SOL&tsyms=USD');
      if (data && data.USD) return data.USD;
    } catch {}
    return this._solPrice || 0;
  }

  _readJsonFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (e) { console.error(`[EARNINGS] Read error ${path.basename(filePath)}:`, e.message); }
    return null;
  }

  _todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ── Stream calculations ──

  _calcWalletStream(balance, price) {
    const stream = this._streams.wallet;
    const balanceChange = this._previousBalance !== null ? balance - this._previousBalance : 0;
    const changeUsd = balanceChange * price;

    if (balanceChange > 0) {
      stream.todayUsd = Math.round((stream.todayUsd + changeUsd) * 100) / 100;
      stream.totalUsd = Math.round((stream.totalUsd + changeUsd) * 100) / 100;
    }

    stream.details = {
      address: WALLET_ADDRESS.substring(0, 8) + '...' + WALLET_ADDRESS.slice(-4),
      balanceSol: balance,
      balanceUsd: Math.round(balance * price * 100) / 100,
      solPrice: price,
      lastChange: Math.round(balanceChange * 1e9) / 1e9
    };
  }

  _calcMiningStream(price) {
    const stream = this._streams.mining;
    // Read mining config for hashrate estimation
    const cfg = this._config;
    const hashrateMhs = cfg.miningHashrate || 30; // default 30 MH/s for ETH-algo
    // Rough estimate: unMineable SOL mining yield
    // ~0.0001 SOL/day per MH/s is a rough approximation (varies heavily)
    const estimatedSolPerDay = hashrateMhs * 0.0001;
    const estimatedUsdPerDay = Math.round(estimatedSolPerDay * price * 100) / 100;

    stream.details = {
      hashrateMhs,
      estimatedSolPerDay: Math.round(estimatedSolPerDay * 1e6) / 1e6,
      estimatedUsdPerDay,
      algo: cfg.miningAlgo || 'ethash',
      note: 'Estimate based on hashrate × expected yield'
    };
    stream.todayUsd = estimatedUsdPerDay;
    stream.totalUsd = Math.round((stream.totalUsd + estimatedUsdPerDay / 288) * 100) / 100; // per 5-min tick
  }

  _calcProxyStream() {
    const stream = this._streams.proxy;
    const data = this._readJsonFile(PROXY_FILE);
    if (!data) {
      stream.details = { status: 'no data file', path: PROXY_FILE };
      return;
    }
    const today = this._todayKey();
    stream.todayUsd = Math.round((data.daily && data.daily[today] ? data.daily[today] : data.todayUsd || 0) * 100) / 100;
    stream.totalUsd = Math.round((data.totalUsd || 0) * 100) / 100;
    stream.details = {
      activeProxies: data.activeProxies || 0,
      bandwidthGb: data.bandwidthGb || 0,
      ratePerGb: data.ratePerGb || 0,
      provider: data.provider || 'unknown'
    };
  }

  _calcSaasStream() {
    const stream = this._streams.saas;
    const data = this._readJsonFile(STRIPE_FILE);
    if (!data) {
      stream.details = { status: 'no data file', path: STRIPE_FILE };
      return;
    }
    const today = this._todayKey();
    stream.todayUsd = Math.round((data.daily && data.daily[today] ? data.daily[today] : data.todayUsd || 0) * 100) / 100;
    stream.totalUsd = Math.round((data.totalUsd || data.mrr || 0) * 100) / 100;
    stream.details = {
      mrr: data.mrr || 0,
      activeSubscriptions: data.activeSubscriptions || 0,
      churnRate: data.churnRate || 0,
      plan: data.plan || 'unknown'
    };
  }

  _calcReferralStream() {
    const stream = this._streams.referrals;
    const data = this._readJsonFile(REFERRAL_FILE);
    if (!data) {
      // Check if referral-system.js exports data we can use
      stream.details = { status: 'no data file', path: REFERRAL_FILE };
      return;
    }
    const today = this._todayKey();
    stream.todayUsd = Math.round((data.daily && data.daily[today] ? data.daily[today] : data.todayUsd || 0) * 100) / 100;
    stream.totalUsd = Math.round((data.totalUsd || 0) * 100) / 100;
    stream.details = {
      activeReferrals: data.activeReferrals || 0,
      conversionRate: data.conversionRate || 0,
      tier: data.tier || 'standard'
    };
  }

  // ── Core refresh ──

  async refresh() {
    try {
      const [balance, price] = await Promise.all([
        this._fetchSolBalance(),
        this._fetchSolPrice()
      ]);

      if (price) this._solPrice = price;

      if (balance !== null) {
        this._calcWalletStream(balance, this._solPrice);
        this._previousBalance = this._solBalance;
        this._solBalance = balance;
      }

      this._calcMiningStream(this._solPrice);
      this._calcProxyStream();
      this._calcSaasStream();
      this._calcReferralStream();

      this._lastRefresh = Date.now();
      this._saveDailySnapshot();

      const total = this.getTodayTotal();
      console.log(`[EARNINGS] Refreshed — today: $${total.toFixed(2)} | SOL: ${this._solBalance?.toFixed(4) || '?'} @ $${this._solPrice.toFixed(2)}`);
    } catch (e) {
      console.error('[EARNINGS] Refresh error:', e.message);
    }
  }

  getTodayTotal() {
    let total = 0;
    for (const key of Object.keys(this._streams)) {
      total += this._streams[key].todayUsd || 0;
    }
    return Math.round(total * 100) / 100;
  }

  // ── Snapshot storage ──

  _saveDailySnapshot() {
    const today = this._todayKey();
    const snapshotFile = path.join(EARNINGS_DIR, `${today}.json`);
    const snapshot = {
      date: today,
      timestamp: Date.now(),
      todayTotalUsd: this.getTodayTotal(),
      solPrice: this._solPrice,
      solBalance: this._solBalance,
      streams: JSON.parse(JSON.stringify(this._streams))
    };
    try {
      fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
    } catch (e) { console.error('[EARNINGS] Snapshot save error:', e.message); }
  }

  _loadDailySnapshot() {
    const today = this._todayKey();
    const snapshotFile = path.join(EARNINGS_DIR, `${today}.json`);
    try {
      if (fs.existsSync(snapshotFile)) {
        const data = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
        if (data.streams) this._streams = data.streams;
        if (data.solBalance) this._solBalance = data.solBalance;
        if (data.solPrice) this._solPrice = data.solPrice;
        this._previousBalance = this._solBalance;
      }
    } catch {}
  }

  // ── Public API ──

  getEarnings() {
    return {
      timestamp: Date.now(),
      lastRefresh: this._lastRefresh,
      todayTotalUsd: this.getTodayTotal(),
      todayMessage: `Today you made $${this.getTodayTotal().toFixed(2)}`,
      solPrice: this._solPrice,
      solBalance: this._solBalance,
      solBalanceUsd: this._solBalance !== null ? Math.round(this._solBalance * this._solPrice * 100) / 100 : null,
      wallet: WALLET_ADDRESS.substring(0, 8) + '...' + WALLET_ADDRESS.slice(-4),
      streams: this._streams
    };
  }

  getHistory(days) {
    const numDays = days || 30;
    const results = [];
    const now = new Date();

    for (let i = 0; i < numDays; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const file = path.join(EARNINGS_DIR, `${key}.json`);
      try {
        if (fs.existsSync(file)) {
          results.push(JSON.parse(fs.readFileSync(file, 'utf8')));
        }
      } catch {}
    }

    return {
      days: numDays,
      entries: results,
      totalUsd: Math.round(results.reduce((sum, e) => sum + (e.todayTotalUsd || 0), 0) * 100) / 100
    };
  }

  getStreams() {
    const streams = {};
    for (const [key, val] of Object.entries(this._streams)) {
      streams[key] = {
        label: val.label,
        todayUsd: val.todayUsd,
        totalUsd: val.totalUsd,
        details: val.details
      };
    }
    return { timestamp: Date.now(), streams };
  }

  // ── API route handler (attach to existing api-server) ──

  handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/api/manage/earnings' && req.method === 'GET') {
      const data = this.getEarnings();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
      return true;
    }

    if (pathname === '/api/manage/earnings/history' && req.method === 'GET') {
      const days = parseInt(url.searchParams.get('days')) || 30;
      const data = this.getHistory(days);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
      return true;
    }

    if (pathname === '/api/manage/earnings/streams' && req.method === 'GET') {
      const data = this.getStreams();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
      return true;
    }

    return false; // not handled
  }

  // ── Lifecycle ──

  start() {
    console.log(`[EARNINGS] Starting dashboard — wallet: ${WALLET_ADDRESS.substring(0, 8)}...${WALLET_ADDRESS.slice(-4)}`);
    this._loadDailySnapshot();
    this.refresh().catch(e => console.error('[EARNINGS] Initial refresh error:', e.message));
    this._timer = setInterval(() => this.refresh().catch(() => {}), REFRESH_INTERVAL);
    return this;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._saveDailySnapshot();
    console.log('[EARNINGS] Dashboard stopped');
  }
}

module.exports = { EarningsDashboard };
