/**
 * Aries Auto-Scaler — Rule-based auto-scaling engine for swarm workers.
 * No external dependencies.
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RULES_FILE = path.join(DATA_DIR, 'autoscale-rules.json');
const LOG_FILE = path.join(DATA_DIR, 'autoscale-log.json');

const VALID_METRICS = [
  'mining_profit_daily', 'proxy_revenue_daily', 'avg_cpu',
  'avg_hashrate', 'worker_count', 'avg_utilization', 'cost_per_worker'
];
const VALID_OPERATORS = ['>', '<', '>=', '<=', '==', '!='];
const VALID_ACTIONS = ['scale-up', 'scale-down', 'alert', 'rebalance'];
const EVAL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// Provider cost models (monthly estimates)
const PROVIDER_COSTS = {
  oracle:       { free_tier: 4, cost_per_worker: 0 },   // 4 free ARM instances
  gcp:          { free_tier: 1, cost_per_worker: 0 },
  azure:        { free_tier: 1, cost_per_worker: 0 },
  aws:          { free_tier: 1, cost_per_worker: 0 },
  hetzner:      { free_tier: 0, cost_per_worker: 4.5 },
  vultr:        { free_tier: 0, cost_per_worker: 6 },
  digitalocean: { free_tier: 0, cost_per_worker: 6 },
};

const DEFAULT_LIMITS = {
  max_workers_per_provider: 10,
  max_total_cost: 0,        // $0 = free tier only by default
  min_total_workers: 1,
};

class AutoScaler extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    this.metricsProvider = opts.metricsProvider || null; // fn() => metrics object
    this.actionHandler = opts.actionHandler || null;     // fn(action, context) => result
    this._interval = null;
    this._cooldowns = new Map(); // ruleId → last execution timestamp
    this._ensureDataDir();
    this.rules = this._loadRules();
    this.log = this._loadLog();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  start() {
    if (this._interval) return;
    this._interval = setInterval(() => this.evaluate(), EVAL_INTERVAL_MS);
    this.emit('started');
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this.emit('stopped');
  }

  // ── Rule Management ────────────────────────────────────────────────

  addRule(rule) {
    this._validateRule(rule);
    const id = rule.id || this._genId();
    const full = {
      id,
      name: rule.name || `Rule ${id}`,
      condition: rule.condition,
      action: rule.action,
      cooldown: rule.cooldown ?? 3600,
      enabled: rule.enabled !== false,
      created: Date.now(),
    };
    this.rules.push(full);
    this._saveRules();
    this.emit('rule:added', full);
    return full;
  }

  updateRule(id, patch) {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx === -1) throw new Error(`Rule ${id} not found`);
    if (patch.condition) this._validateCondition(patch.condition);
    if (patch.action) this._validateAction(patch.action);
    Object.assign(this.rules[idx], patch, { updated: Date.now() });
    this._saveRules();
    this.emit('rule:updated', this.rules[idx]);
    return this.rules[idx];
  }

  deleteRule(id) {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx === -1) throw new Error(`Rule ${id} not found`);
    const removed = this.rules.splice(idx, 1)[0];
    this._saveRules();
    this.emit('rule:deleted', removed);
    return removed;
  }

  getRules() { return this.rules; }
  getLog(limit = 100) { return this.log.slice(-limit); }

  // ── Evaluation Engine ──────────────────────────────────────────────

  async evaluate() {
    const metrics = await this._getMetrics();
    const results = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (this._isOnCooldown(rule)) continue;

      const matched = this._evalCondition(rule.condition, metrics);
      if (!matched) continue;

      // Cost & limit checks before acting
      const blocked = this._checkLimits(rule, metrics);
      if (blocked) {
        this._logEntry(rule, metrics, 'blocked', blocked);
        results.push({ rule: rule.id, status: 'blocked', reason: blocked });
        continue;
      }

      // Execute action
      const result = await this._executeAction(rule, metrics);
      this._cooldowns.set(rule.id, Date.now());
      this._logEntry(rule, metrics, result.status, result.detail);
      results.push({ rule: rule.id, ...result });
    }

    this._saveLog();
    this.emit('evaluated', results);
    return results;
  }

  // ── Condition Evaluation ───────────────────────────────────────────

  _evalCondition(cond, metrics) {
    // Support compound conditions (array = AND)
    if (Array.isArray(cond)) {
      return cond.every(c => this._evalSingle(c, metrics));
    }
    return this._evalSingle(cond, metrics);
  }

  _evalSingle(cond, metrics) {
    const val = metrics[cond.metric];
    if (val === undefined) return false;
    const t = cond.threshold;
    switch (cond.operator) {
      case '>':  return val > t;
      case '<':  return val < t;
      case '>=': return val >= t;
      case '<=': return val <= t;
      case '==': return val == t;
      case '!=': return val != t;
      default:   return false;
    }
  }

  // ── Limit & Cost Checks ────────────────────────────────────────────

  _checkLimits(rule, metrics) {
    const act = rule.action;

    if (act.type === 'scale-up') {
      const provider = act.provider;
      const providerInfo = PROVIDER_COSTS[provider];
      const count = act.count || 1;

      // Check max workers per provider
      const currentWorkers = metrics[`workers_${provider}`] || 0;
      if (currentWorkers + count > this.limits.max_workers_per_provider) {
        return `Would exceed max_workers_per_provider (${this.limits.max_workers_per_provider})`;
      }

      // Check cost — free tier providers must stay at $0
      if (providerInfo) {
        const newTotal = currentWorkers + count;
        const paidWorkers = Math.max(0, newTotal - providerInfo.free_tier);
        const monthlyCost = paidWorkers * providerInfo.cost_per_worker;
        if (providerInfo.cost_per_worker === 0 && newTotal > providerInfo.free_tier) {
          // Free-tier provider but would exceed free allocation — block
          return `Would exceed free tier for ${provider} (max ${providerInfo.free_tier})`;
        }
        // Check total cost across all providers
        const currentTotalCost = metrics.total_monthly_cost || 0;
        if (currentTotalCost + monthlyCost > this.limits.max_total_cost) {
          return `Would exceed max_total_cost ($${this.limits.max_total_cost})`;
        }
      }
    }

    if (act.type === 'scale-down') {
      const totalWorkers = metrics.worker_count || 1;
      const removeCount = act.count || 1;
      if (totalWorkers - removeCount < this.limits.min_total_workers) {
        return `Cannot scale below ${this.limits.min_total_workers} worker(s)`;
      }
    }

    return null; // no block
  }

  // ── Action Execution ───────────────────────────────────────────────

  async _executeAction(rule, metrics) {
    const act = rule.action;

    if (this.actionHandler) {
      try {
        const res = await this.actionHandler(act, { rule, metrics });
        return { status: 'executed', detail: res || act.type };
      } catch (err) {
        return { status: 'error', detail: err.message };
      }
    }

    // Default: emit event only (dry-run)
    this.emit('action', { rule, action: act, metrics });
    return { status: 'emitted', detail: `${act.type}: ${act.provider || 'all'} x${act.count || 1}` };
  }

  // ── Cooldown ───────────────────────────────────────────────────────

  _isOnCooldown(rule) {
    const last = this._cooldowns.get(rule.id);
    if (!last) return false;
    return (Date.now() - last) < (rule.cooldown * 1000);
  }

  // ── Metrics ────────────────────────────────────────────────────────

  async _getMetrics() {
    if (this.metricsProvider) {
      return typeof this.metricsProvider === 'function'
        ? await this.metricsProvider()
        : this.metricsProvider;
    }
    // Stub metrics for standalone testing
    return {
      mining_profit_daily: 0,
      proxy_revenue_daily: 0,
      avg_cpu: 0,
      avg_hashrate: 0,
      worker_count: 1,
      avg_utilization: 0,
      cost_per_worker: 0,
      total_monthly_cost: 0,
    };
  }

  // ── Logging ────────────────────────────────────────────────────────

  _logEntry(rule, metrics, status, detail) {
    const entry = {
      ts: Date.now(),
      ruleId: rule.id,
      ruleName: rule.name,
      status,
      detail: detail || null,
      metrics: { ...metrics },
    };
    this.log.push(entry);
    // Keep last 1000 entries
    if (this.log.length > 1000) this.log = this.log.slice(-1000);
  }

  // ── Persistence ────────────────────────────────────────────────────

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _loadRules() {
    try { return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')); }
    catch { return []; }
  }

  _saveRules() {
    fs.writeFileSync(RULES_FILE, JSON.stringify(this.rules, null, 2));
  }

  _loadLog() {
    try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); }
    catch { return []; }
  }

  _saveLog() {
    fs.writeFileSync(LOG_FILE, JSON.stringify(this.log, null, 2));
  }

  // ── Validation ─────────────────────────────────────────────────────

  _validateRule(rule) {
    if (!rule.condition) throw new Error('Rule must have a condition');
    if (!rule.action) throw new Error('Rule must have an action');
    const conds = Array.isArray(rule.condition) ? rule.condition : [rule.condition];
    conds.forEach(c => this._validateCondition(c));
    this._validateAction(rule.action);
  }

  _validateCondition(c) {
    if (!VALID_METRICS.includes(c.metric)) throw new Error(`Invalid metric: ${c.metric}`);
    if (!VALID_OPERATORS.includes(c.operator)) throw new Error(`Invalid operator: ${c.operator}`);
    if (typeof c.threshold !== 'number') throw new Error('Threshold must be a number');
  }

  _validateAction(a) {
    if (!VALID_ACTIONS.includes(a.type)) throw new Error(`Invalid action type: ${a.type}`);
  }

  _genId() {
    return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ── HTTP API Routes ────────────────────────────────────────────────

  registerRoutes(router) {
    // GET /api/manage/autoscale/rules
    router.get('/api/manage/autoscale/rules', (_req, res) => {
      res.json({ ok: true, rules: this.getRules() });
    });

    // POST /api/manage/autoscale/rules
    router.post('/api/manage/autoscale/rules', (req, res) => {
      try {
        const rule = this.addRule(req.body);
        res.json({ ok: true, rule });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    // PUT /api/manage/autoscale/rules/:id
    router.put('/api/manage/autoscale/rules/:id', (req, res) => {
      try {
        const rule = this.updateRule(req.params.id, req.body);
        res.json({ ok: true, rule });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    // DELETE /api/manage/autoscale/rules/:id
    router.delete('/api/manage/autoscale/rules/:id', (req, res) => {
      try {
        const rule = this.deleteRule(req.params.id);
        res.json({ ok: true, rule });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    // GET /api/manage/autoscale/log
    router.get('/api/manage/autoscale/log', (req, res) => {
      const limit = parseInt(req.query.limit) || 100;
      res.json({ ok: true, log: this.getLog(limit) });
    });

    // POST /api/manage/autoscale/evaluate
    router.post('/api/manage/autoscale/evaluate', async (_req, res) => {
      try {
        const results = await this.evaluate();
        res.json({ ok: true, results });
      } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });

    return router;
  }
}

// ── Example Rules (seed) ─────────────────────────────────────────────

AutoScaler.EXAMPLE_RULES = [
  {
    name: 'High profit → scale Oracle +2',
    condition: { metric: 'mining_profit_daily', operator: '>', threshold: 50 },
    action: { type: 'scale-up', provider: 'oracle', count: 2 },
    cooldown: 3600,
  },
  {
    name: 'Low profit → scale down to free tier',
    condition: { metric: 'mining_profit_daily', operator: '<', threshold: 10 },
    action: { type: 'scale-down', provider: 'all', count: 0 },
    cooldown: 7200,
  },
  {
    name: 'High CPU → add 1 worker',
    condition: { metric: 'avg_cpu', operator: '>', threshold: 95 },
    action: { type: 'scale-up', provider: 'oracle', count: 1 },
    cooldown: 900,
  },
  {
    name: 'Over-provisioned → remove 2 lowest',
    condition: [
      { metric: 'worker_count', operator: '>', threshold: 20 },
      { metric: 'avg_utilization', operator: '<', threshold: 30 },
    ],
    action: { type: 'scale-down', count: 2 },
    cooldown: 3600,
  },
  {
    name: 'Low proxy revenue/worker → consolidate',
    condition: { metric: 'cost_per_worker', operator: '<', threshold: 1 },
    action: { type: 'rebalance' },
    cooldown: 7200,
  },
];

AutoScaler.PROVIDER_COSTS = PROVIDER_COSTS;
AutoScaler.VALID_METRICS = VALID_METRICS;

module.exports = AutoScaler;
