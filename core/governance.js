/**
 * ARIES — Governance Plane v1.0
 * Risk-based controls on all agent actions.
 * Enterprise Intelligence: DigDev v1.3 Operating Model
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'governance');
const RULES_FILE = path.join(DATA_DIR, 'risk-rules.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit-ledger.json');

const RISK_LEVELS = ['R0', 'R1', 'R2', 'R3'];
const RISK_META = {
  R0: { label: 'Low', description: 'Information retrieval only', autoApprove: true, color: '#22c55e' },
  R1: { label: 'Medium', description: 'Standard workflows', autoApprove: false, color: '#f59e0b' },
  R2: { label: 'High', description: 'Financial/data impact', autoApprove: false, color: '#ef4444' },
  R3: { label: 'Critical', description: 'Safety/regulatory', autoApprove: false, color: '#dc2626' },
};

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

class Governance {
  constructor() {
    ensureDir();
    this._rules = readJSON(RULES_FILE, { version: '1.0', rules: [], defaults: {} });
    console.log('[GOVERNANCE] Governance plane initialized with', this._rules.rules.length, 'risk rules');
  }

  /** Classify an action's risk level (R0-R3) */
  classifyRisk(action) {
    if (!action || !action.type) return 'R1'; // default to medium
    const actionType = (action.type || '').toLowerCase();
    const target = (action.target || '').toLowerCase();
    const combined = actionType + ' ' + target;

    for (const rule of this._rules.rules) {
      const regex = new RegExp(rule.pattern, 'i');
      if (regex.test(combined)) {
        return rule.riskClass;
      }
    }
    return this._rules.defaults.unknownAction || 'R1';
  }

  /** Check if an agent has permission for an action */
  checkPermission(agentId, action) {
    const riskClass = this.classifyRisk(action);
    const riskIndex = RISK_LEVELS.indexOf(riskClass);
    const meta = RISK_META[riskClass];

    // R0 always auto-approved
    if (riskClass === 'R0' && this._rules.defaults.autoApproveR0 !== false) {
      const decision = { agentId, action, riskClass, decision: 'allow', reason: 'R0 auto-approved', timestamp: new Date().toISOString() };
      this._logDecision(decision);
      return decision;
    }

    // R3 always requires human
    if (riskClass === 'R3') {
      const decision = { agentId, action, riskClass, decision: 'pending', reason: 'R3 requires human-in-the-loop approval', timestamp: new Date().toISOString() };
      this._logDecision(decision);
      return decision;
    }

    // Check agent maturity
    const maturity = this._getAgentMaturity(agentId);
    const maturityConfig = (this._rules.agentMaturity || {})[maturity] || {};
    const maxRiskIndex = RISK_LEVELS.indexOf(maturityConfig.maxRisk || 'R0');

    if (riskIndex > maxRiskIndex) {
      const decision = { agentId, action, riskClass, decision: 'deny', reason: `Agent maturity "${maturity}" insufficient for ${riskClass}`, timestamp: new Date().toISOString() };
      this._logDecision(decision);
      return decision;
    }

    // R1/R2 require approval packet
    const decision = {
      agentId, action, riskClass,
      decision: 'pending',
      reason: `${riskClass} requires approval packet` + (riskClass === 'R2' ? ' (multi-signature)' : ''),
      requiredApprovals: riskClass === 'R2' ? (this._rules.defaults.multiSigThreshold || 2) : 1,
      timestamp: new Date().toISOString(),
    };
    this._logDecision(decision);
    return decision;
  }

  /** Get audit log with optional filters */
  getAuditLog(filters) {
    let ledger = readJSON(AUDIT_FILE, []);
    if (filters) {
      if (filters.riskClass) ledger = ledger.filter(e => e.riskClass === filters.riskClass);
      if (filters.agentId) ledger = ledger.filter(e => e.agentId === filters.agentId);
      if (filters.decision) ledger = ledger.filter(e => e.decision === filters.decision);
      if (filters.since) ledger = ledger.filter(e => new Date(e.timestamp) >= new Date(filters.since));
      if (filters.limit) ledger = ledger.slice(-filters.limit);
    }
    return ledger;
  }

  /** Get risk rules */
  getRiskRules() { return this._rules; }

  /** Update risk rules */
  updateRiskRules(rules) {
    this._rules = { ...this._rules, ...rules };
    writeJSON(RULES_FILE, this._rules);
    return this._rules;
  }

  /** Get status summary */
  getStatus() {
    const ledger = readJSON(AUDIT_FILE, []);
    const counts = { R0: 0, R1: 0, R2: 0, R3: 0 };
    const decisions = { allow: 0, deny: 0, pending: 0 };
    for (const entry of ledger) {
      if (counts[entry.riskClass] !== undefined) counts[entry.riskClass]++;
      if (decisions[entry.decision] !== undefined) decisions[entry.decision]++;
    }
    return { riskDistribution: counts, decisions, totalEntries: ledger.length, rulesCount: this._rules.rules.length };
  }

  /** Get risk metadata */
  getRiskMeta() { return RISK_META; }

  // — Internal —

  _getAgentMaturity(agentId) {
    // Simple maturity lookup — could be extended with persistent agent registry
    const knownAgents = readJSON(path.join(DATA_DIR, 'agent-maturity.json'), {});
    return knownAgents[agentId] || 'trained';
  }

  _logDecision(decision) {
    const ledger = readJSON(AUDIT_FILE, []);
    decision.id = 'aud_' + crypto.randomUUID();
    ledger.push(decision);
    // Keep max 10000 entries
    if (ledger.length > 10000) ledger.splice(0, ledger.length - 10000);
    writeJSON(AUDIT_FILE, ledger);
  }
}

module.exports = Governance;
