/**
 * ARIES — Internal Economy v1.0
 * Emergent prioritization through market dynamics.
 * No central planner — modules bid tokens for resources, trade with each other,
 * and earn/lose influence based on usefulness.
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

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const DEFAULTS = {
  initialBalance: 100,
  taxRate: 0.02,           // 2% idle tax per tick
  idleThresholdMs: 300000, // 5 minutes of no activity = idle
  targetSupply: 10000,     // target total token supply
  supplyAdjustRate: 0.05,  // 5% max adjustment per tick
  minBalance: 1,           // bankruptcy threshold
  maxPriceHistory: 500,
  maxLedger: 1000,
  maxTrades: 500,
};

class InternalEconomy {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this.config = Object.assign({}, DEFAULTS, opts && opts.config);
    this._timer = null;
    this._tickMs = (opts && opts.tickInterval || 60) * 1000;
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
      priority: 'normal', // normal | low | bankrupt
    };

    wallets[moduleId] = wallet;
    writeJSON(WALLETS_PATH, wallets);

    // Update supply
    const supply = readJSON(SUPPLY_PATH, {});
    supply.totalMinted = (supply.totalMinted || 0) + this.config.initialBalance;
    writeJSON(SUPPLY_PATH, supply);

    this._log('wallet_created', { moduleId, balance: wallet.balance });
    console.log(`[ECONOMY] 💰 Wallet created: ${moduleId} (${wallet.balance} tokens)`);
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
    const w = readJSON(WALLETS_PATH, {}); // re-read after possible create

    w[moduleId].balance += amount;
    w[moduleId].totalEarned += amount;
    w[moduleId].lastActivity = Date.now();
    // Restore from bankruptcy if earning
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
      auctions[resource] = { resource, bids: [], createdAt: Date.now(), resolved: false };
    }
    if (auctions[resource].resolved) {
      auctions[resource] = { resource, bids: [], createdAt: Date.now(), resolved: false };
    }

    // Remove any existing bid from this module for this resource
    auctions[resource].bids = auctions[resource].bids.filter(b => b.moduleId !== moduleId);

    auctions[resource].bids.push({
      moduleId,
      amount,
      timestamp: Date.now(),
    });

    // Update wallet activity
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

    // Dutch auction: highest bidder wins, pays second-highest price (Vickrey auction)
    const bids = auctions[resource].bids.sort((a, b) => b.amount - a.amount);
    const winner = bids[0];
    const price = bids.length > 1 ? bids[1].amount : Math.floor(winner.amount * 0.5); // pay 2nd price, or half if sole bidder

    // Deduct from winner
    const wallets = readJSON(WALLETS_PATH, {});
    if (!wallets[winner.moduleId]) return { error: 'Winner wallet missing' };

    const actualPrice = Math.min(price, wallets[winner.moduleId].balance);
    wallets[winner.moduleId].balance -= actualPrice;
    wallets[winner.moduleId].totalSpent += actualPrice;
    wallets[winner.moduleId].winCount = (wallets[winner.moduleId].winCount || 0) + 1;
    wallets[winner.moduleId].lastActivity = Date.now();
    this._checkBankruptcy(wallets[winner.moduleId]);
    writeJSON(WALLETS_PATH, wallets);

    // Burn the spent tokens (they leave circulation)
    const supply = readJSON(SUPPLY_PATH, {});
    supply.totalBurned = (supply.totalBurned || 0) + actualPrice;
    writeJSON(SUPPLY_PATH, supply);

    // Record price history
    this._recordPrice(resource, actualPrice, bids.length);

    // Mark auction resolved
    auctions[resource].resolved = true;
    auctions[resource].winner = winner.moduleId;
    auctions[resource].price = actualPrice;
    auctions[resource].resolvedAt = Date.now();
    writeJSON(AUCTIONS_PATH, auctions);

    this._log('auction_resolved', { resource, winner: winner.moduleId, price: actualPrice, bidders: bids.length });
    console.log(`[ECONOMY] 🏆 Auction: ${winner.moduleId} won "${resource}" for ${actualPrice} tokens (${bids.length} bidders)`);

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

  // --- Taxation ---

  tax() {
    const wallets = readJSON(WALLETS_PATH, {});
    const now = Date.now();
    let totalTaxed = 0;

    for (const id in wallets) {
      const w = wallets[id];
      const idle = (now - (w.lastActivity || 0)) > this.config.idleThresholdMs;

      if (idle && w.balance > this.config.minBalance) {
        const taxAmount = Math.max(1, Math.floor(w.balance * this.config.taxRate));
        w.balance -= taxAmount;
        w.totalTaxed = (w.totalTaxed || 0) + taxAmount;
        totalTaxed += taxAmount;
        this._checkBankruptcy(w);
      }
    }

    writeJSON(WALLETS_PATH, wallets);

    if (totalTaxed > 0) {
      const supply = readJSON(SUPPLY_PATH, {});
      supply.totalTaxed = (supply.totalTaxed || 0) + totalTaxed;
      supply.totalBurned = (supply.totalBurned || 0) + totalTaxed;
      writeJSON(SUPPLY_PATH, supply);
      this._log('tax', { totalTaxed });
    }

    return { totalTaxed };
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
    // Restore from bankruptcy
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
    console.log(`[ECONOMY] 🤝 Trade: ${fromModule} → ${toModule} (${amount} tokens for "${service || 'unspecified'}")`);

    return { trade };
  }

  // --- Supply Control ---

  adjustSupply() {
    const wallets = readJSON(WALLETS_PATH, {});
    const supply = readJSON(SUPPLY_PATH, {});

    // Calculate current circulating supply
    let circulating = 0;
    let moduleCount = 0;
    for (const id in wallets) {
      circulating += wallets[id].balance;
      moduleCount++;
    }

    if (moduleCount === 0) return { circulating: 0, adjustment: 0 };

    // Dynamic target: scale with module count
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
      // Inflation: distribute evenly to all modules
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
      // Deflation: tax proportionally from richest
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
      console.log(`[ECONOMY] 📊 Supply adjustment: ${adjustment > 0 ? '+' : ''}${adjustment} tokens (circulating: ${circulating + adjustment})`);
    }

    return { circulating: circulating + adjustment, target, adjustment };
  }

  // --- Market State & Dashboard ---

  getMarketState() {
    const wallets = readJSON(WALLETS_PATH, {});
    const auctions = readJSON(AUCTIONS_PATH, {});
    const trades = readJSON(TRADES_PATH, []);
    const supply = readJSON(SUPPLY_PATH, {});

    // Wallet stats
    const modules = Object.values(wallets);
    let circulating = 0;
    for (const w of modules) circulating += w.balance;
    const sorted = modules.sort((a, b) => b.balance - a.balance);

    // Active auctions
    const pendingAuctions = [];
    const recentResolved = [];
    for (const r in auctions) {
      if (!auctions[r].resolved) pendingAuctions.push(auctions[r]);
      else recentResolved.push(auctions[r]);
    }
    recentResolved.sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0));

    // Recent trades
    const recentTrades = trades.slice(-20).reverse();

    // Most traded resources
    const resourceCounts = {};
    for (const r in auctions) {
      if (auctions[r].resolved) {
        resourceCounts[r] = (resourceCounts[r] || 0) + 1;
      }
    }
    const topResources = Object.entries(resourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([resource, count]) => ({ resource, auctionCount: count }));

    // Bankrupt modules
    const bankrupt = modules.filter(m => m.priority === 'bankrupt');

    return {
      timestamp: Date.now(),
      moduleCount: modules.length,
      circulatingSupply: circulating,
      supply: {
        totalMinted: supply.totalMinted || 0,
        totalBurned: supply.totalBurned || 0,
        totalTaxed: supply.totalTaxed || 0,
      },
      richest: sorted.slice(0, 10).map(w => ({ moduleId: w.moduleId, balance: w.balance, priority: w.priority })),
      poorest: sorted.slice(-5).reverse().map(w => ({ moduleId: w.moduleId, balance: w.balance, priority: w.priority })),
      bankruptCount: bankrupt.length,
      pendingAuctions: pendingAuctions.length,
      recentAuctions: recentResolved.slice(0, 10).map(a => ({ resource: a.resource, winner: a.winner, price: a.price })),
      topResources,
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
    const taxResult = this.tax();
    const supplyResult = this.adjustSupply();

    // Resolve any stale auctions (older than 30 seconds)
    const auctions = readJSON(AUCTIONS_PATH, {});
    const now = Date.now();
    const resolved = [];
    for (const r in auctions) {
      if (!auctions[r].resolved && auctions[r].bids.length > 0 && (now - auctions[r].createdAt) > 30000) {
        const result = this.resolveAuction(r);
        if (!result.error) resolved.push(result);
      }
    }

    return { taxed: taxResult.totalTaxed, supplyAdjustment: supplyResult.adjustment, auctionsResolved: resolved.length };
  }

  // --- Internal Helpers ---

  _checkBankruptcy(wallet) {
    if (wallet.balance <= this.config.minBalance) {
      if (wallet.priority !== 'bankrupt') {
        wallet.priority = 'bankrupt';
        console.log(`[ECONOMY] 💸 Bankruptcy: ${wallet.moduleId} (balance: ${wallet.balance})`);
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
