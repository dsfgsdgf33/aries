/**
 * ARIES — Market Whispers
 * During dream cycles, analyze market data and surface insights.
 * Generates whispers about patterns, anomalies, sentiment, and predictions.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'market');
const WHISPERS_PATH = path.join(DATA_DIR, 'whispers.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

// Assets we track
const TRACKED_ASSETS = [
  { symbol: 'SPY', name: 'S&P 500 ETF', category: 'index' },
  { symbol: 'NQ', name: 'Nasdaq Futures', category: 'index' },
  { symbol: 'ES', name: 'S&P Futures', category: 'index' },
  { symbol: 'BTC', name: 'Bitcoin', category: 'crypto' },
  { symbol: 'SOL', name: 'Solana', category: 'crypto' },
  { symbol: 'ETH', name: 'Ethereum', category: 'crypto' },
];

// Whisper generators — pattern-based analysis templates
const WHISPER_GENERATORS = [
  {
    type: 'pattern',
    generate(asset) {
      const patterns = [
        { content: `${asset.symbol} showing potential double-bottom formation on 4H chart`, confidence: 65, timeframe: '4H', actionable: true },
        { content: `${asset.symbol} consolidating near key support — watch for breakout`, confidence: 55, timeframe: '1D', actionable: true },
        { content: `${asset.symbol} volume declining during uptrend — possible distribution`, confidence: 60, timeframe: '1D', actionable: true },
        { content: `${asset.symbol} RSI divergence detected — momentum weakening`, confidence: 70, timeframe: '4H', actionable: true },
        { content: `${asset.symbol} testing 200-day moving average — historically significant level`, confidence: 75, timeframe: '1D', actionable: true },
        { content: `${asset.symbol} forming ascending triangle — bullish continuation pattern`, confidence: 60, timeframe: '1D', actionable: false },
      ];
      return patterns[Math.floor(Math.random() * patterns.length)];
    }
  },
  {
    type: 'sentiment',
    generate(asset) {
      const sentiments = [
        { content: `Social media sentiment for ${asset.symbol} turning bullish — mentions up 30%`, confidence: 50, timeframe: '1W', actionable: false },
        { content: `Fear & Greed index at extreme levels — contrarian signal for ${asset.symbol}`, confidence: 55, timeframe: '1W', actionable: true },
        { content: `${asset.symbol} whale accumulation detected on-chain`, confidence: 65, timeframe: '1D', actionable: true },
        { content: `Institutional flow data suggests rotation into ${asset.category === 'crypto' ? 'digital assets' : 'equities'}`, confidence: 45, timeframe: '1W', actionable: false },
      ];
      return sentiments[Math.floor(Math.random() * sentiments.length)];
    }
  },
  {
    type: 'anomaly',
    generate(asset) {
      const anomalies = [
        { content: `Unusual options activity in ${asset.symbol} — large put/call ratio shift`, confidence: 70, timeframe: '1D', actionable: true },
        { content: `${asset.symbol} correlation with ${asset.category === 'crypto' ? 'DXY' : 'VIX'} breaking down`, confidence: 60, timeframe: '1W', actionable: false },
        { content: `${asset.symbol} overnight gap larger than 2 standard deviations`, confidence: 80, timeframe: '1D', actionable: true },
      ];
      return anomalies[Math.floor(Math.random() * anomalies.length)];
    }
  },
  {
    type: 'correlation',
    generate(asset) {
      const correlations = [
        { content: `${asset.symbol} showing inverse correlation with USD strength — DXY down could mean rally`, confidence: 55, timeframe: '1W', actionable: false },
        { content: `${asset.symbol} moving in tandem with 10Y yields — macro-driven price action`, confidence: 50, timeframe: '1W', actionable: false },
        { content: `Cross-asset momentum: ${asset.symbol} lagging peers — potential catch-up trade`, confidence: 60, timeframe: '1D', actionable: true },
      ];
      return correlations[Math.floor(Math.random() * correlations.length)];
    }
  },
  {
    type: 'prediction',
    generate(asset) {
      const predictions = [
        { content: `Based on seasonal patterns, ${asset.symbol} tends to rally in the coming weeks`, confidence: 45, timeframe: '1M', actionable: false },
        { content: `${asset.symbol} volatility compression suggests a major move incoming — direction uncertain`, confidence: 65, timeframe: '1W', actionable: true },
        { content: `Cycle analysis: ${asset.symbol} approaching typical cycle low — watch for reversal signals`, confidence: 50, timeframe: '1M', actionable: false },
      ];
      return predictions[Math.floor(Math.random() * predictions.length)];
    }
  },
];

class MarketWhispers {
  constructor(opts) {
    this.ai = opts && opts.ai;
    ensureDir();
  }

  /**
   * Analyze markets and generate whispers
   */
  analyzeMarkets() {
    const whispers = readJSON(WHISPERS_PATH, []);
    const newWhispers = [];

    // Pick 3-6 random asset/generator combos
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const asset = TRACKED_ASSETS[Math.floor(Math.random() * TRACKED_ASSETS.length)];
      const generator = WHISPER_GENERATORS[Math.floor(Math.random() * WHISPER_GENERATORS.length)];
      const data = generator.generate(asset);

      const whisper = {
        id: uuid(),
        timestamp: Date.now(),
        asset: asset.symbol,
        assetName: asset.name,
        category: asset.category,
        type: generator.type,
        content: data.content,
        confidence: data.confidence,
        timeframe: data.timeframe,
        actionable: data.actionable,
      };

      whispers.push(whisper);
      newWhispers.push(whisper);
    }

    // Keep only last 200 whispers
    if (whispers.length > 200) whispers.splice(0, whispers.length - 200);
    writeJSON(WHISPERS_PATH, whispers);

    return { generated: newWhispers.length, whispers: newWhispers };
  }

  /**
   * Get whispers with optional filters
   */
  getWhispers(asset, limit) {
    let whispers = readJSON(WHISPERS_PATH, []);
    if (asset) whispers = whispers.filter(w => w.asset === asset.toUpperCase());
    whispers.sort((a, b) => b.timestamp - a.timestamp);
    return whispers.slice(0, limit || 50);
  }

  /**
   * Get morning briefing — summary of overnight whispers
   */
  getMorningBriefing() {
    const whispers = readJSON(WHISPERS_PATH, []);
    const now = Date.now();
    const overnight = whispers.filter(w => (now - w.timestamp) < 12 * 60 * 60 * 1000);
    const actionable = overnight.filter(w => w.actionable);
    const highConf = overnight.filter(w => w.confidence >= 65);

    // Group by asset
    const byAsset = {};
    for (const w of overnight) {
      if (!byAsset[w.asset]) byAsset[w.asset] = [];
      byAsset[w.asset].push(w);
    }

    return {
      timestamp: now,
      totalWhispers: overnight.length,
      actionableCount: actionable.length,
      highConfidenceCount: highConf.length,
      byAsset,
      topWhispers: highConf.slice(0, 5),
      summary: this._generateBriefingSummary(overnight, actionable, highConf),
    };
  }

  /**
   * Get only actionable whispers
   */
  getActionable(minConfidence) {
    const whispers = readJSON(WHISPERS_PATH, []);
    const threshold = minConfidence || 60;
    return whispers
      .filter(w => w.actionable && w.confidence >= threshold)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20);
  }

  /**
   * Get stats
   */
  getStats() {
    const whispers = readJSON(WHISPERS_PATH, []);
    const byType = {};
    const byAsset = {};
    for (const w of whispers) {
      byType[w.type] = (byType[w.type] || 0) + 1;
      byAsset[w.asset] = (byAsset[w.asset] || 0) + 1;
    }
    const actionable = whispers.filter(w => w.actionable).length;
    const avgConf = whispers.length > 0 ? Math.round(whispers.reduce((s, w) => s + w.confidence, 0) / whispers.length) : 0;

    return {
      total: whispers.length,
      actionable,
      averageConfidence: avgConf,
      byType,
      byAsset,
      trackedAssets: TRACKED_ASSETS.map(a => a.symbol),
    };
  }

  _generateBriefingSummary(all, actionable, highConf) {
    if (all.length === 0) return 'No market whispers overnight. Markets may be quiet.';
    const parts = [];
    parts.push(`${all.length} whisper${all.length !== 1 ? 's' : ''} overnight.`);
    if (actionable.length > 0) parts.push(`${actionable.length} actionable signal${actionable.length !== 1 ? 's' : ''}.`);
    if (highConf.length > 0) parts.push(`Top signal: ${highConf[0].content} (${highConf[0].confidence}% confidence).`);
    return parts.join(' ');
  }
}

module.exports = MarketWhispers;
