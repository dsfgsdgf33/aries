/**
 * ARIES v5.0 — Crypto Price Alerts
 * Monitors SOL/BTC prices via CoinGecko, detects significant moves, sends Telegram alerts.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const EventEmitter = require('events');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const PRICE_HISTORY_PATH = path.join(__dirname, '..', 'data', 'price-history.json');
const ALERT_HISTORY_PATH = path.join(__dirname, '..', 'data', 'crypto-alert-history.json');
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_HISTORY_ENTRIES = 288; // 24h of 5-min candles
const FLASH_CRASH_PCT = 15;
const ALERT_COOLDOWN_MS = 10 * 60 * 1000; // 10 min cooldown per coin per alert type

class CryptoAlerts extends EventEmitter {
  constructor() {
    super();
    this._timer = null;
    this._priceHistory = {}; // { solana: [{ts, price},...], bitcoin: [...] }
    this._alertHistory = [];
    this._lastAlerts = {}; // key → timestamp
    this._ath = {}; // coin → price
    this._currentPrices = {};
    this._loadHistory();
    this._loadAlertHistory();
  }

  _getConfig() {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return {
        enabled: cfg.cryptoAlerts?.enabled !== false,
        coins: cfg.cryptoAlerts?.coins || ['solana', 'bitcoin'],
        thresholds: {
          hourly: cfg.cryptoAlerts?.thresholds?.hourly || 5,
          daily: cfg.cryptoAlerts?.thresholds?.daily || 10,
        },
        botToken: cfg.miner?.telegram?.botToken || '',
        chatId: cfg.miner?.telegram?.chatId || '',
      };
    } catch { return { enabled: false, coins: ['solana', 'bitcoin'], thresholds: { hourly: 5, daily: 10 }, botToken: '', chatId: '' }; }
  }

  _loadHistory() {
    try { this._priceHistory = JSON.parse(fs.readFileSync(PRICE_HISTORY_PATH, 'utf8')); } catch { this._priceHistory = {}; }
  }

  _saveHistory() {
    try {
      const dir = path.dirname(PRICE_HISTORY_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(PRICE_HISTORY_PATH, JSON.stringify(this._priceHistory, null, 2));
    } catch {}
  }

  _loadAlertHistory() {
    try { this._alertHistory = JSON.parse(fs.readFileSync(ALERT_HISTORY_PATH, 'utf8')); } catch { this._alertHistory = []; }
  }

  _saveAlertHistory() {
    try { fs.writeFileSync(ALERT_HISTORY_PATH, JSON.stringify(this._alertHistory.slice(-500), null, 2)); } catch {}
  }

  start() {
    const cfg = this._getConfig();
    if (!cfg.enabled) return;
    console.log('[CRYPTO-ALERTS] Starting price monitor for: ' + cfg.coins.join(', '));
    this._poll();
    this._timer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  async _poll() {
    const cfg = this._getConfig();
    if (!cfg.enabled || !cfg.coins.length) return;
    try {
      const prices = await this._fetchPrices(cfg.coins);
      if (!prices) return;
      const now = Date.now();
      for (const coin of cfg.coins) {
        const price = prices[coin]?.usd;
        if (!price) continue;
        this._currentPrices[coin] = { price, usd_24h_change: prices[coin]?.usd_24h_change || 0, ts: now };
        if (!this._priceHistory[coin]) this._priceHistory[coin] = [];
        this._priceHistory[coin].push({ ts: now, price });
        // Trim to 24h
        const cutoff = now - 24 * 60 * 60 * 1000;
        this._priceHistory[coin] = this._priceHistory[coin].filter(e => e.ts > cutoff).slice(-MAX_HISTORY_ENTRIES);
        // Detect alerts
        this._checkAlerts(coin, price, cfg);
      }
      this._saveHistory();
    } catch (e) { console.error('[CRYPTO-ALERTS] Poll error:', e.message); }
  }

  _checkAlerts(coin, price, cfg) {
    const history = this._priceHistory[coin] || [];
    const now = Date.now();
    const symbol = coin === 'solana' ? 'SOL' : coin === 'bitcoin' ? 'BTC' : coin.toUpperCase();
    const fmtPrice = price >= 1000 ? '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '$' + price.toFixed(2);

    // 1-hour change
    const hourAgo = history.filter(e => e.ts < now - 55 * 60 * 1000 && e.ts > now - 65 * 60 * 1000);
    if (hourAgo.length > 0) {
      const oldPrice = hourAgo[hourAgo.length - 1].price;
      const pctChange = ((price - oldPrice) / oldPrice) * 100;
      if (Math.abs(pctChange) >= cfg.thresholds.hourly) {
        const key = coin + '-hourly';
        if (!this._lastAlerts[key] || now - this._lastAlerts[key] > ALERT_COOLDOWN_MS) {
          const emoji = pctChange > 0 ? '🚀' : '📉';
          const dir = pctChange > 0 ? 'up' : 'down';
          this._sendAlert(`${emoji} ${symbol} ${dir} ${Math.abs(pctChange).toFixed(1)}% (${fmtPrice}) in last hour!`, cfg);
          this._lastAlerts[key] = now;
        }
      }
      // Flash crash check
      if (pctChange <= -FLASH_CRASH_PCT) {
        const key = coin + '-flash';
        if (!this._lastAlerts[key] || now - this._lastAlerts[key] > ALERT_COOLDOWN_MS) {
          this._sendAlert(`⚠️ ${symbol} dropped ${Math.abs(pctChange).toFixed(1)}% (${fmtPrice}) — flash crash!`, cfg);
          this._lastAlerts[key] = now;
        }
      }
    }

    // 24-hour change
    const dayAgo = history.filter(e => e.ts < now - 23 * 60 * 60 * 1000 && e.ts > now - 25 * 60 * 60 * 1000);
    if (dayAgo.length > 0) {
      const oldPrice = dayAgo[dayAgo.length - 1].price;
      const pctChange = ((price - oldPrice) / oldPrice) * 100;
      if (Math.abs(pctChange) >= cfg.thresholds.daily) {
        const key = coin + '-daily';
        if (!this._lastAlerts[key] || now - this._lastAlerts[key] > ALERT_COOLDOWN_MS) {
          const emoji = pctChange > 0 ? '📈' : '📉';
          const dir = pctChange > 0 ? 'up' : 'down';
          this._sendAlert(`${emoji} ${symbol} ${dir} ${Math.abs(pctChange).toFixed(1)}% (${fmtPrice}) in 24h!`, cfg);
          this._lastAlerts[key] = now;
        }
      }
    }

    // ATH check
    if (!this._ath[coin] || price > this._ath[coin]) {
      if (this._ath[coin] && price > this._ath[coin] * 1.001) { // Must be meaningfully above
        const key = coin + '-ath';
        if (!this._lastAlerts[key] || now - this._lastAlerts[key] > 60 * 60 * 1000) { // 1hr cooldown for ATH
          this._sendAlert(`🏆 ${symbol} new all-time high: ${fmtPrice}!`, cfg);
          this._lastAlerts[key] = now;
        }
      }
      this._ath[coin] = price;
    }
  }

  _sendAlert(message, cfg) {
    this._alertHistory.push({ ts: Date.now(), message });
    this._saveAlertHistory();
    this.emit('alert', { message, ts: Date.now() });
    if (!cfg.botToken || !cfg.chatId) return;
    const postData = JSON.stringify({ chat_id: cfg.chatId, text: message, parse_mode: 'HTML' });
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

  _fetchPrices(coins) {
    return new Promise((resolve) => {
      const ids = coins.join(',');
      const req = https.request({
        hostname: 'api.coingecko.com',
        path: '/api/v3/simple/price?ids=' + ids + '&vs_currencies=usd&include_24hr_change=true',
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        timeout: 15000,
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  getCurrentPrices() { return this._currentPrices; }
  getAlertHistory() { return this._alertHistory.slice(-100); }
  getPriceHistory() { return this._priceHistory; }
}

module.exports = { CryptoAlerts };
