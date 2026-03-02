/**
 * ARIES — Internal Economy v2.0
 * Emergent prioritization through market dynamics.
 * No central planner — modules bid tokens for resources, trade with each other,
 * and earn/lose influence based on usefulness.
 * 
 * Features: Token wallets, Vickrey auctions, idle taxation, module-to-module trading,
 * market metrics (GDP, inflation, Gini, velocity), boom/bust detection, price discovery,
 * bankruptcy protection, economic history, adaptive tax policy.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'market');
const WALLETS_PATH = path.join(DATA_DIR, 'wallets.json');
const AUCTIONS_PATH = path.join(DATA_DIR, 'auctions.json');
const TRADES_PATH = path.join(DATA_DIR, 'trades.json');
const PRICE_HISTORY_PATH = path.join(DATA_DIR, 'price-history.json');
const LEDGER_PATH = path.join(DATA_DIR, 'ledger.json');
const SUPPLY_PATH = path.join(DATA_DIR, 'supply.json');
const METRICS_PATH = path.join(DATA_DIR, 'metrics-history.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const DEFAULTS = {
  initialBalance: 100,
  taxRate: 0.02,
  idleThresholdMs: 300000,
  targetSupply: 10000,
  supplyAdjustRate: 0.05,
  minBalance: 1,
  maxPriceHistory: 500,
  maxLedger: 1000,
  maxTrades: 500,
  maxMetricsHistory: 200,
  // Resource type base prices
  resourceBasePrices: { cpu: 10, memory: 8, ai_calls: 25, io: 5, general: 10 },
  // Tax policy
  taxHealthMultiplier: true,
  boomThreshold: 1.5,
  bustThreshold: 0.5,
};

class InternalEconomy {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this.config = Object.assign({}, DEFAULTS, opts && opts.config);
    this._timer = null;
    this._tickMs = (opts && opts.tickInterval || 60) * 1000;
    this._tickCount = 0;
    this._lastGDP = 0;
    ensureDir();
    this._ensureSupply();
  }

  _ensureSupply() {
    const supply = readJSON(SUPPLY_PATH, null);
    if (!supply) {
      writeJSON(SUPPLY_PATH, {
        totalMinted: 0,
        totalBurned: 0,
        totalTaxed: 0,
        targetSupply: this.config.targetSupply,
        lastAdjustment: Date.now(),
      });
    }
  }

  // --- Lifecycle ---

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.tick(), this._tickMs);
    if (this._timer.unref) this._timer.unref();
    console.log('[ECONOMY] Internal economy started');
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    console.log('[ECONOMY] Internal economy stopped');
  }

  // --- Wallet Management ---

  createWallet(moduleId) {
    const wallets = readJSON(WALLETS_PATH, {});
    if (wallets[moduleId]) return { error: 'Wallet already exists', wallet: wallets[moduleId] };

    const wallet = {
      moduleId,
      balance: this.config.initialBalance,
      totalEarned: this.config.initialBalance,
      totalSpent: 0,
      totalTaxed: 0,
      lastActivity: Date.now(),
      createdAt: Date.now(),
      bidCount: 0,
      winCount: 0,
      tradeCount: 0,
      priority: 'normal',
      productionValue: 0,
      lastProductionTick: 0,
    };

    wallets[moduleId] = wallet;
    writeJSON(WALLETS_PATH, wallets);

    const supply = readJSON(SUPPLY_PATH, {});
    supply.totalMinted = (supply.totalMinted || 0) + this.config.initialBalance;
    writeJSON(SUPPLY_PATH, supply);

    this._log('wallet_created', { moduleId, balance: wallet.balance });
    return { created: true, wallet };
  }

  getBalance(moduleId) {
    const wallets = readJSON(WALLETS_PATH, {});
    const wallet = wallets[moduleId];
    if (!wallet) return { error: 'Wallet not found', balance: 0 };
    return { balance: wallet.balance, priority: wallet.priority };
  }

  _getOrCreateWallet(moduleId) {
    const wallets = readJSON(WALLETS_PATH, {});
    if (!wallets[moduleId]) {
      this.createWallet(moduleId);
      return readJSON(WALLETS_PATH, {})[moduleId];
    }
    return wallets[moduleId];
  }

  // --- Earning ---

  earn(moduleId, amount, reason) {
    if (amount <= 0) return { error: 'Amount must be positive' };
    const wallets = readJSON(WALLETS_PATH, {});
    if (!wallets[moduleId]) this.createWallet(moduleId);
    const w = readJSON(WALLETS_PATH, {});

    w[moduleId].balance += amount;
    w[moduleId].totalEarned += amount;
    w[moduleId].lastActivity = Date.now();
    w[moduleId].productionValue = (w[moduleId].productionValue || 0) + amount;
    if (w[moduleId].priority === 'bankrupt' && w[moduleId].balance >= this.config.minBalance * 5) {
      w[moduleId].priority = 'low';
    }
    if (w[moduleId].priority === 'low' && w[moduleId].balance >= this.config.initialBalance * 0.5) {
      w[moduleId].priority = 'normal';
    }
    writeJSON(WALLETS_PATH, w);

    const supply = readJSON(SUPPLY_PATH, {});
    supply.totalMinted = (supply.totalMinted || 0) + amount;
    writeJSON(SUPPLY_PATH, supply);

    this._log('earn', { moduleId, amount, reason });
    return { balance: w[moduleId].balance, earned: amount, reason };
  }

  // --- Bidding & Auctions ---

  bid(moduleId, resource, amount) {
    if (amount <= 0) return { error: 'Bid must be positive' };
    const wallets = readJSON(WALLETS_PATH, {});
    if (!wallets[moduleId]) return { error: 'Wallet not found' };
    if (wallets[moduleId].balance < amount) return { error: 'Insufficient balance', balance: wallets[moduleId].balance };

    const auctions = readJSON(AUCTIONS_PATH, {});
    if (!auctions[resource]) {
      auctions[resource] = { resource, bids: [], createdAt: Date.now(), resolved: false, resourceType: this._classifyResource(resource) };
    }
    if (auctions[resource].resolved) {
      auctions[resource] = { resource, bids: [], createdAt: Date.now(), resolved: false, resourceType: this._classifyResource(resource) };
    }

    auctions[resource].bids = auctions[resource].bids.filter(b => b.moduleId !== moduleId);
    auctions[resource].bids.push({ moduleId, amount, timestamp: Date.now() });

    wallets[moduleId].lastActivity = Date.now();
    wallets[moduleId].bidCount = (wallets[moduleId].bidCount || 0) + 1;
    writeJSON(WALLETS_PATH, wallets);
    writeJSON(AUCTIONS_PATH, auctions);

    this._log('bid', { moduleId, resource, amount });
    return { bid: amount, resource, position: auctions[resource].bids.length };
  }

  resolveAuction(resource) {
    const auctions = readJSON(AUCTIONS_PATH, {});
    if (!auctions[resource]) return { error: 'No auction for resource' };
    if (auctions[resource].resolved) return { error: 'Auction already resolved' };
    if (auctions[resource].bids.length === 0) return { error: 'No bids' };

    // Vickrey auction: highest bidder wins, pays second-highest price
    const bids = auctions[resource].bids.sort((a, b) => b.amount - a.amount);
    const winner = bids[0];
    const price = bids.length > 1 ? bids[1].amount : Math.floor(winner.amount * 0.5);

    const wallets = readJSON(WALLETS_PATH, {});
    if (!wallets[winner.moduleId]) return { error: 'Winner wallet missing' };

    const actualPrice = Math.min(price, wallets[winner.moduleId].balance);
    wallets[winner.moduleId].balance -= actualPrice;
    wallets[winner.moduleId].totalSpent += actualPrice;
    wallets[winner.moduleId].winCount = (wallets[winner.moduleId].winCount || 0) + 1;
    wallets[winner.moduleId].lastActivity = Date.now();
    this._checkBankruptcy(wallets[winner.moduleId]);
    writeJSON(WALLETS_PATH, wallets);

    const supply = readJSON(SUPPLY_PATH, {});
    supply.totalBurned = (supply.totalBurned || 0) + actualPrice;
    writeJSON(SUPPLY_PATH, supply);

    this._recordPrice(resource, actualPrice, bids.length);

    auctions[resource].resolved = true;
    auctions[resource].winner = winner.moduleId;
    auctions[resource].price = actualPrice;
    auctions[resource].resolvedAt = Date.now();
    writeJSON(AUCTIONS_PATH, auctions);

    this._log('auction_resolved', { resource, winner: winner.moduleId, price: actualPrice, bidders: bids.length });
    return {
      winner: winner.moduleId,
      resource,
      price: actualPrice,
      bidders: bids.length,
      allBids: bids.map(b => ({ moduleId: b.moduleId, amount: b.amount })),
    };
  }

  getPendingAuctions() {
    const auctions = readJSON(AUCTIONS_PATH, {});
    const pending = {};
    for (const r in auctions) {
      if (!auctions[r].resolved) pending[r] = auctions[r];
    }
    return pending;
  }

  // --- Taxation (adaptive) ---

  tax() {
    const wallets = readJSON(WALLETS_PATH, {});
    const now = Date.now();
    let totalTaxed = 0;

    // Adaptive tax rate based on system health
    let effectiveRate = this.config.taxRate;
    if (this.config.taxHealthMultiplier) {
      const metrics = this._computeMetrics(wallets);
      // Higher tax during boom, lower during bust
      if (metrics.cyclePhase === 'boom') effectiveRate *= 1.5;
      else if (metrics.cyclePhase === 'bust') effectiveRate *= 0.5;
      // Higher inequality → higher tax on rich
      if (metrics.giniCoefficient > 0.6) effectiveRate *= 1.3;
    }

    for (const id in wallets) {
      const w = wallets[id];
      const idle = (now - (w.lastActivity || 0)) > this.config.idleThresholdMs;

      if (idle && w.balance > this.config.minBalance) {
        // Idle taxation: modules that don't produce value lose tokens
        const idlePenalty = (w.productionValue || 0) < 1 ? 1.5 : 1.0;
        const taxAmount = Math.max(1, Math.floor(w.balance * effectiveRate * idlePenalty));
        w.balance -= taxAmount;
        w.totalTaxed = (w.totalTaxed || 0) + taxAmount;
        totalTaxed += taxAmount;
        this._checkBankruptcy(w);
      }
      // Reset production counter per tick
      w.lastProductionTick = this._tickCount;
      w.productionValue = 0;
    }

    writeJSON(WALLETS_PATH, wallets);

    if (totalTaxed > 0) {
      const supply = readJSON(SUPPLY_PATH, {});
      supply.totalTaxed = (supply.totalTaxed || 0) + totalTaxed;
      supply.totalBurned = (supply.totalBurned || 0) + totalTaxed;
      writeJSON(SUPPLY_PATH, supply);
      this._log('tax', { totalTaxed, effectiveRate: Math.round(effectiveRate * 1000) / 1000 });
    }

    return { totalTaxed, effectiveRate: Math.round(effectiveRate * 1000) / 1000 };
  }

  // --- Trading ---

  trade(fromModule, toModule, amount, service) {
    if (amount <= 0) return { error: 'Amount must be positive' };
    const wallets = readJSON(WALLETS_PATH, {});
    if (!wallets[fromModule]) return { error: 'Sender wallet not found' };
    if (!wallets[toModule]) return { error: 'Receiver wallet not found' };
    if (wallets[fromModule].balance < amount) return { error: 'Insufficient balance', balance: wallets[fromModule].balance };

    wallets[fromModule].balance -= amount;
    wallets[fromModule].totalSpent += amount;
    wallets[fromModule].lastActivity = Date.now();
    wallets[fromModule].tradeCount = (wallets[fromModule].tradeCount || 0) + 1;
    this._checkBankruptcy(wallets[fromModule]);

    wallets[toModule].balance += amount;
    wallets[toModule].totalEarned += amount;
    wallets[toModule].lastActivity = Date.now();
    wallets[toModule].tradeCount = (wallets[toModule].tradeCount || 0) + 1;
    if (wallets[toModule].priority === 'bankrupt' && wallets[toModule].balance >= this.config.minBalance * 5) {
      wallets[toModule].priority = 'low';
    }

    writeJSON(WALLETS_PATH, wallets);

    const trade = {
      id: uuid(),
      from: fromModule,
      to: toModule,
      amount,
      service: service || null,
      timestamp: Date.now(),
    };

    const trades = readJSON(TRADES_PATH, []);
    trades.push(trade);
    if (trades.length > this.config.maxTrades) trades.splice(0, trades.length - this.config.maxTrades);
    writeJSON(TRADES_PATH, trades);

    this._log('trade', { from: fromModule, to: toModule, amount, service });
    return { trade };
  }

  // --- Supply Control ---

  adjustSupply() {
    const wallets = readJSON(WALLETS_PATH, {});
    const supply = readJSON(SUPPLY_PATH, {});

    let circulating = 0;
    let moduleCount = 0;
    for (const id in wallets) {
      circulating += wallets[id].balance;
      moduleCount++;
    }

    if (moduleCount === 0) return { circulating: 0, adjustment: 0 };

    const dynamicTarget = moduleCount * this.config.initialBalance * 2;
    const target = Math.max(this.config.targetSupply, dynamicTarget);

    const diff = target - circulating;
    const maxAdjust = Math.floor(circulating * this.config.supplyAdjustRate);
    let adjustment = Math.max(-maxAdjust, Math.min(maxAdjust, diff));

    if (Math.abs(adjustment) < 1) {
      supply.lastAdjustment = Date.now();
      writeJSON(SUPPLY_PATH, supply);
      return { circulating, target, adjustment: 0 };
    }

    if (adjustment > 0) {
      const perModule = Math.max(1, Math.floor(adjustment / moduleCount));
      let distributed = 0;
      for (const id in wallets) {
        wallets[id].balance += perModule;
        wallets[id].totalEarned += perModule;
        distributed += perModule;
      }
      supply.totalMinted = (supply.totalMinted || 0) + distributed;
      adjustment = distributed;
    } else {
      const sorted = Object.values(wallets).sort((a, b) => b.balance - a.balance);
      let toRemove = Math.abs(adjustment);
      for (const w of sorted) {
        if (toRemove <= 0) break;
        const take = Math.min(Math.floor(w.balance * 0.1), toRemove);
        if (take > 0 && w.balance - take >= this.config.minBalance) {
          w.balance -= take;
          w.totalTaxed = (w.totalTaxed || 0) + take;
          toRemove -= take;
          this._checkBankruptcy(w);
        }
      }
      const removed = Math.abs(adjustment) - toRemove;
      supply.totalBurned = (supply.totalBurned || 0) + removed;
      adjustment = -removed;
    }

    writeJSON(WALLETS_PATH, wallets);
    supply.lastAdjustment = Date.now();
    writeJSON(SUPPLY_PATH, supply);

    if (adjustment !== 0) {
      this._log('supply_adjust', { circulating, target, adjustment });
    }

    return { circulating: circulating + adjustment, target, adjustment };
  }

  // --- Market Metrics ---

  getMarketMetrics() {
    const wallets = readJSON(WALLETS_PATH, {});
    const trades = readJSON(TRADES_PATH, []);
    return this._computeMetrics(wallets, trades);
  }

  _computeMetrics(wallets, trades) {
    wallets = wallets || readJSON(WALLETS_PATH, {});
    trades = trades || readJSON(TRADES_PATH, []);
    const modules = Object.values(wallets);

    if (modules.length === 0) return { gdp: 0, inflationRate: 0, giniCoefficient: 0, velocityOfMoney: 0, cyclePhase: 'dormant' };

    // GDP: total production value (earned - initial) in recent window
    const gdp = modules.reduce((s, w) => s + (w.totalEarned - this.config.initialBalance), 0);

    // Circulating supply
    const circulating = modules.reduce((s, w) => s + w.balance, 0);

    // Inflation rate: compare current supply to target
    const supply = readJSON(SUPPLY_PATH, {});
    const inflationRate = this.config.targetSupply > 0
      ? Math.round((circulating - this.config.targetSupply) / this.config.targetSupply * 10000) / 100
      : 0;

    // Gini coefficient
    const gini = this._computeGini(modules.map(m => m.balance));

    // Velocity of money: trade volume / circulating supply
    const recentTrades = trades.filter(t => Date.now() - t.timestamp < 3600000);
    const tradeVolume = recentTrades.reduce((s, t) => s + t.amount, 0);
    const velocity = circulating > 0 ? Math.round(tradeVolume / circulating * 100) / 100 : 0;

    // Boom/bust detection
    const gdpGrowth = this._lastGDP > 0 ? (gdp - this._lastGDP) / this._lastGDP : 0;
    let cyclePhase = 'stable';
    if (gdpGrowth > this.config.boomThreshold - 1) cyclePhase = 'boom';
    else if (gdpGrowth < -(1 - this.config.bustThreshold)) cyclePhase = 'bust';
    else if (gdpGrowth > 0.1) cyclePhase = 'growth';
    else if (gdpGrowth < -0.1) cyclePhase = 'contraction';
    this._lastGDP = gdp;

    // Average and median balance
    const sorted = modules.map(m => m.balance).sort((a, b) => a - b);
    const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
    const avg = modules.length > 0 ? Math.round(circulating / modules.length) : 0;

    return {
      gdp,
      inflationRate,
      giniCoefficient: gini,
      velocityOfMoney: velocity,
      cyclePhase,
      gdpGrowth: Math.round(gdpGrowth * 10000) / 100,
      circulatingSupply: circulating,
      moduleCount: modules.length,
      avgBalance: avg,
      medianBalance: median,
      tradeVolumeHourly: tradeVolume,
      bankruptModules: modules.filter(m => m.priority === 'bankrupt').length,
    };
  }

  _computeGini(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((s, v) => s + v, 0) / n;
    if (mean === 0) return 0;
    let sumDiffs = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sumDiffs += Math.abs(sorted[i] - sorted[j]);
      }
    }
    return Math.round(sumDiffs / (2 * n * n * mean) * 1000) / 1000;
  }

  // --- Price Discovery ---

  getResourcePrices() {
    const history = readJSON(PRICE_HISTORY_PATH, {});
    const prices = {};
    for (const resource in history) {
      const entries = history[resource];
      if (entries.length === 0) continue;
      const recent = entries.slice(-20);
      const avgPrice = Math.round(recent.reduce((s, e) => s + e.price, 0) / recent.length);
      const lastPrice = recent[recent.length - 1].price;
      const resourceType = this._classifyResource(resource);
      const basePrice = this.config.resourceBasePrices[resourceType] || 10;
      prices[resource] = {
        lastPrice,
        avgPrice,
        basePrice,
        resourceType,
        priceRatio: Math.round(avgPrice / basePrice * 100) / 100,
        samples: recent.length,
        trend: recent.length >= 5
          ? (recent.slice(-3).reduce((s, e) => s + e.price, 0) / 3 > recent.slice(0, 3).reduce((s, e) => s + e.price, 0) / 3 ? 'rising' : 'falling')
          : 'insufficient_data',
      };
    }
    return prices;
  }

  _classifyResource(resource) {
    const r = resource.toLowerCase();
    if (r.includes('cpu') || r.includes('compute') || r.includes('process')) return 'cpu';
    if (r.includes('mem') || r.includes('cache') || r.includes('buffer')) return 'memory';
    if (r.includes('ai') || r.includes('llm') || r.includes('model') || r.includes('inference')) return 'ai_calls';
    if (r.includes('io') || r.includes('disk') || r.includes('file') || r.includes('network')) return 'io';
    return 'general';
  }

  // --- Economic History & Trends ---

  getEconomicHistory(limit) {
    const metrics = readJSON(METRICS_PATH, []);
    return metrics.slice(-(limit || 50)).reverse();
  }

  getEconomicTrends() {
    const history = readJSON(METRICS_PATH, []);
    if (history.length < 3) return { status: 'insufficient_data', dataPoints: history.length };

    const recent = history.slice(-10);
    const older = history.length > 10 ? history.slice(-20, -10) : history.slice(0, Math.floor(history.length / 2));

    const avg = arr => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

    const recentGDP = avg(recent.map(m => m.gdp));
    const olderGDP = avg(older.map(m => m.gdp));
    const recentGini = avg(recent.map(m => m.giniCoefficient));
    const olderGini = avg(older.map(m => m.giniCoefficient));
    const recentVelocity = avg(recent.map(m => m.velocityOfMoney));
    const olderVelocity = avg(older.map(m => m.velocityOfMoney));

    return {
      gdpTrend: recentGDP > olderGDP * 1.05 ? 'growing' : recentGDP < olderGDP * 0.95 ? 'shrinking' : 'stable',
      inequalityTrend: recentGini > olderGini + 0.05 ? 'widening' : recentGini < olderGini - 0.05 ? 'narrowing' : 'stable',
      velocityTrend: recentVelocity > olderVelocity * 1.1 ? 'accelerating' : recentVelocity < olderVelocity * 0.9 ? 'decelerating' : 'stable',
      dataPoints: history.length,
      recentAvgGDP: Math.round(recentGDP),
      recentAvgGini: Math.round(recentGini * 1000) / 1000,
    };
  }

  _recordMetricsSnapshot() {
    const metrics = this._computeMetrics();
    metrics.timestamp = Date.now();
    metrics.tick = this._tickCount;

    const history = readJSON(METRICS_PATH, []);
    history.push(metrics);
    if (history.length > this.config.maxMetricsHistory) history.splice(0, history.length - this.config.maxMetricsHistory);
    writeJSON(METRICS_PATH, history);
  }

  // --- Market State & Dashboard ---

  getMarketState() {
    const wallets = readJSON(WALLETS_PATH, {});
    const auctions = readJSON(AUCTIONS_PATH, {});
    const trades = readJSON(TRADES_PATH, []);
    const supply = readJSON(SUPPLY_PATH, {});

    const modules = Object.values(wallets);
    let circulating = 0;
    for (const w of modules) circulating += w.balance;
    const sorted = modules.sort((a, b) => b.balance - a.balance);

    const pendingAuctions = [];
    const recentResolved = [];
    for (const r in auctions) {
      if (!auctions[r].resolved) pendingAuctions.push(auctions[r]);
      else recentResolved.push(auctions[r]);
    }
    recentResolved.sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0));

    const recentTrades = trades.slice(-20).reverse();
    const bankrupt = modules.filter(m => m.priority === 'bankrupt');
    const metrics = this._computeMetrics(wallets, trades);

    return {
      timestamp: Date.now(),
      moduleCount: modules.length,
      circulatingSupply: circulating,
      supply: {
        totalMinted: supply.totalMinted || 0,
        totalBurned: supply.totalBurned || 0,
        totalTaxed: supply.totalTaxed || 0,
      },
      metrics,
      richest: sorted.slice(0, 10).map(w => ({ moduleId: w.moduleId, balance: w.balance, priority: w.priority })),
      poorest: sorted.slice(-5).reverse().map(w => ({ moduleId: w.moduleId, balance: w.balance, priority: w.priority })),
      bankruptCount: bankrupt.length,
      pendingAuctions: pendingAuctions.length,
      recentAuctions: recentResolved.slice(0, 10).map(a => ({ resource: a.resource, winner: a.winner, price: a.price })),
      recentTrades: recentTrades.map(t => ({ from: t.from, to: t.to, amount: t.amount, service: t.service })),
    };
  }

  getPriceHistory(resource) {
    const history = readJSON(PRICE_HISTORY_PATH, {});
    if (!history[resource]) return { resource, prices: [] };
    return { resource, prices: history[resource] };
  }

  // --- Tick ---

  tick() {
    this._tickCount++;
    const taxResult = this.tax();
    const supplyResult = this.adjustSupply();

    // Resolve stale auctions
    const auctions = readJSON(AUCTIONS_PATH, {});
    const now = Date.now();
    const resolved = [];
    for (const r in auctions) {
      if (!auctions[r].resolved && auctions[r].bids.length > 0 && (now - auctions[r].createdAt) > 30000) {
        const result = this.resolveAuction(r);
        if (!result.error) resolved.push(result);
      }
    }

    // Record metrics snapshot every 5 ticks
    if (this._tickCount % 5 === 0) {
      this._recordMetricsSnapshot();
    }

    return {
      tick: this._tickCount,
      taxed: taxResult.totalTaxed,
      taxRate: taxResult.effectiveRate,
      supplyAdjustment: supplyResult.adjustment,
      auctionsResolved: resolved.length,
    };
  }

  // --- Internal Helpers ---

  _checkBankruptcy(wallet) {
    if (wallet.balance <= this.config.minBalance) {
      // Bankruptcy protection: floor at minBalance, never go to zero
      wallet.balance = Math.max(this.config.minBalance, wallet.balance);
      if (wallet.priority !== 'bankrupt') {
        wallet.priority = 'bankrupt';
        this._log('bankruptcy', { moduleId: wallet.moduleId, balance: wallet.balance });
      }
    } else if (wallet.balance < this.config.initialBalance * 0.25) {
      wallet.priority = 'low';
    }
  }

  _recordPrice(resource, price, bidderCount) {
    const history = readJSON(PRICE_HISTORY_PATH, {});
    if (!history[resource]) history[resource] = [];
    history[resource].push({
      price,
      bidders: bidderCount,
      resourceType: this._classifyResource(resource),
      timestamp: Date.now(),
    });
    if (history[resource].length > this.config.maxPriceHistory) {
      history[resource].splice(0, history[resource].length - this.config.maxPriceHistory);
    }
    writeJSON(PRICE_HISTORY_PATH, history);
  }

  _log(type, data) {
    const ledger = readJSON(LEDGER_PATH, []);
    ledger.push({ type, ...data, timestamp: Date.now() });
    if (ledger.length > this.config.maxLedger) ledger.splice(0, ledger.length - this.config.maxLedger);
    writeJSON(LEDGER_PATH, ledger);
  }
}

module.exports = InternalEconomy;
