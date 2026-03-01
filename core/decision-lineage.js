/**
 * Decision Lineage — Immutable chain of decisions for 5-Whys traceability
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class DecisionLineage {
  constructor(opts) {
    opts = opts || {};
    this.dataDir = opts.dataDir || path.join(__dirname, '..', 'data', 'lineage');
    this.decisionsFile = path.join(this.dataDir, 'decisions.json');
    try { fs.mkdirSync(this.dataDir, { recursive: true }); } catch {}
    this.decisions = this._load();
    this._index = new Map();
    for (const d of this.decisions) this._index.set(d.id, d);
  }

  _load() {
    try { return JSON.parse(fs.readFileSync(this.decisionsFile, 'utf8')); } catch { return []; }
  }

  _save() {
    try { fs.writeFileSync(this.decisionsFile, JSON.stringify(this.decisions, null, 2)); } catch {}
  }

  _computeHash(record) {
    const obj = { ...record };
    delete obj.immutable_hash;
    return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }

  recordDecision(request, context, rules, action, opts) {
    opts = opts || {};
    const record = {
      id: 'dl_' + crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      request: request || {},
      context: Array.isArray(context) ? context : [],
      rules_applied: Array.isArray(rules) ? rules : [],
      action_taken: action || {},
      outcome: opts.outcome || { status: 'pending', metrics: {} },
      lineage_chain: Array.isArray(opts.parentIds) ? opts.parentIds : [],
      immutable_hash: ''
    };
    record.immutable_hash = this._computeHash(record);
    this.decisions.push(record);
    this._index.set(record.id, record);
    this._save();
    return record;
  }

  getDecision(id) {
    return this._index.get(id) || null;
  }

  traceLineage(id, depth) {
    depth = depth || 10;
    const chain = [];
    let current = this._index.get(id);
    let d = 0;
    while (current && d < depth) {
      chain.push(current);
      if (!current.lineage_chain || current.lineage_chain.length === 0) break;
      current = this._index.get(current.lineage_chain[0]);
      d++;
    }
    return chain;
  }

  queryDecisions(filters) {
    filters = filters || {};
    let results = this.decisions;
    if (filters.agentId) results = results.filter(d => d.request && d.request.from === filters.agentId);
    if (filters.status) results = results.filter(d => d.outcome && d.outcome.status === filters.status);
    if (filters.from) { const f = new Date(filters.from).getTime(); results = results.filter(d => new Date(d.timestamp).getTime() >= f); }
    if (filters.to) { const t = new Date(filters.to).getTime(); results = results.filter(d => new Date(d.timestamp).getTime() <= t); }
    if (filters.limit) results = results.slice(-filters.limit);
    return results;
  }

  getDecisionTree(rootId) {
    const root = this._index.get(rootId);
    if (!root) return null;
    // Build tree: find all decisions that reference this as parent
    const children = this.decisions.filter(d => d.lineage_chain && d.lineage_chain.includes(rootId));
    return {
      decision: root,
      children: children.map(c => ({ id: c.id, timestamp: c.timestamp, action: c.action_taken, outcome: c.outcome }))
    };
  }

  verifyIntegrity(id) {
    const record = this._index.get(id);
    if (!record) return { valid: false, reason: 'not found' };
    const expected = this._computeHash(record);
    return { valid: expected === record.immutable_hash, expected, actual: record.immutable_hash };
  }

  getStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const today = this.decisions.filter(d => new Date(d.timestamp).getTime() >= todayStart);
    const successes = this.decisions.filter(d => d.outcome && d.outcome.status === 'success');
    const chainDepths = this.decisions.map(d => {
      let depth = 0, cur = d;
      while (cur && cur.lineage_chain && cur.lineage_chain.length > 0 && depth < 20) {
        cur = this._index.get(cur.lineage_chain[0]);
        depth++;
      }
      return depth;
    });
    const avgDepth = chainDepths.length > 0 ? chainDepths.reduce((a, b) => a + b, 0) / chainDepths.length : 0;
    return {
      total: this.decisions.length,
      today: today.length,
      successRate: this.decisions.length > 0 ? (successes.length / this.decisions.length * 100).toFixed(1) + '%' : 'N/A',
      avgChainDepth: avgDepth.toFixed(1)
    };
  }
}

module.exports = DecisionLineage;
