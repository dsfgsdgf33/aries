/**
 * Earned Autonomy — Maturity model where agents earn increasing independence
 * Grades: G0 (Setup) → G1 (Shadow) → G2 (Copilot) → G3 (Conditional Autonomy)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GRADES = ['G0', 'G1', 'G2', 'G3'];

// Permission matrix: grade → riskClass → permission
// ❌ = deny, 👁️ = observe, ✅ = allow, 🔑 = needs approval
const PERMISSION_MATRIX = {
  G0: { R0: 'deny', R1: 'deny', R2: 'deny', R3: 'deny' },
  G1: { R0: 'observe', R1: 'observe', R2: 'observe', R3: 'observe' },
  G2: { R0: 'allow', R1: 'approval', R2: 'observe', R3: 'observe' },
  G3: { R0: 'allow', R1: 'allow', R2: 'approval', R3: 'observe' }
};

class EarnedAutonomy {
  constructor(opts) {
    opts = opts || {};
    this.dataDir = opts.dataDir || path.join(__dirname, '..', 'data', 'autonomy');
    this.agentsFile = path.join(this.dataDir, 'agents.json');
    this.historyFile = path.join(this.dataDir, 'history.json');
    this.thresholdsFile = path.join(this.dataDir, 'thresholds.json');
    this._ensureDir();
    this.agents = this._load(this.agentsFile, {});
    this.history = this._load(this.historyFile, []);
    this.thresholds = this._load(this.thresholdsFile, {
      minTimeInGradeDays: 7, minSuccessfulActions: 50, minAccuracy: 0.9, zeroR2PlusFailures: true
    });
  }

  _ensureDir() {
    try { fs.mkdirSync(this.dataDir, { recursive: true }); } catch {}
  }

  _load(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }

  _saveAgents() {
    try { fs.writeFileSync(this.agentsFile, JSON.stringify(this.agents, null, 2)); } catch {}
  }

  _saveHistory() {
    try { fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2)); } catch {}
  }

  _initAgent(agentId) {
    if (!this.agents[agentId]) {
      this.agents[agentId] = {
        grade: 'G0',
        confidence: { accuracy: 0, totalActions: 0, successfulActions: 0, failedActions: 0, r2PlusFailures: 0 },
        gradeChangedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      this._saveAgents();
    }
    return this.agents[agentId];
  }

  getGrade(agentId) {
    const a = this._initAgent(agentId);
    return a.grade;
  }

  getConfidence(agentId) {
    const a = this._initAgent(agentId);
    return a.confidence;
  }

  recordOutcome(agentId, action, outcome) {
    const a = this._initAgent(agentId);
    const c = a.confidence;
    c.totalActions++;
    if (outcome === 'success') {
      c.successfulActions++;
    } else {
      c.failedActions++;
      const riskClass = (action && action.riskClass) || 'R0';
      if (riskClass === 'R2' || riskClass === 'R3') {
        c.r2PlusFailures++;
        // Auto-demote on critical failure
        this.demote(agentId, 'R2+ failure: ' + (action.type || 'unknown'));
      }
    }
    c.accuracy = c.totalActions > 0 ? c.successfulActions / c.totalActions : 0;
    this._saveAgents();
    return c;
  }

  checkPromotion(agentId) {
    const a = this._initAgent(agentId);
    const c = a.confidence;
    const t = this.thresholds;
    const gradeIdx = GRADES.indexOf(a.grade);
    if (gradeIdx >= GRADES.length - 1) return { eligible: false, reason: 'Already at max grade' };

    const daysSinceChange = (Date.now() - new Date(a.gradeChangedAt).getTime()) / (1000 * 60 * 60 * 24);
    const checks = [];
    if (daysSinceChange < (t.minTimeInGradeDays || 7)) checks.push('Need ' + (t.minTimeInGradeDays || 7) + ' days in grade (' + Math.floor(daysSinceChange) + ' so far)');
    if (c.successfulActions < (t.minSuccessfulActions || 50)) checks.push('Need ' + (t.minSuccessfulActions || 50) + ' successful actions (' + c.successfulActions + ' so far)');
    if (c.accuracy < (t.minAccuracy || 0.9)) checks.push('Need ' + ((t.minAccuracy || 0.9) * 100) + '% accuracy (' + (c.accuracy * 100).toFixed(1) + '% current)');
    if (t.zeroR2PlusFailures && c.r2PlusFailures > 0) checks.push('Has ' + c.r2PlusFailures + ' R2+ failures (need 0)');

    return checks.length === 0
      ? { eligible: true, nextGrade: GRADES[gradeIdx + 1] }
      : { eligible: false, blockers: checks };
  }

  promote(agentId) {
    const a = this._initAgent(agentId);
    const idx = GRADES.indexOf(a.grade);
    if (idx >= GRADES.length - 1) return { ok: false, reason: 'Already at max grade' };
    const oldGrade = a.grade;
    a.grade = GRADES[idx + 1];
    a.gradeChangedAt = new Date().toISOString();
    this._saveAgents();
    const entry = { agentId, type: 'promotion', from: oldGrade, to: a.grade, timestamp: a.gradeChangedAt, reason: 'manual or threshold met' };
    this.history.push(entry);
    this._saveHistory();
    return { ok: true, from: oldGrade, to: a.grade };
  }

  demote(agentId, reason) {
    const a = this._initAgent(agentId);
    const idx = GRADES.indexOf(a.grade);
    if (idx <= 0) return { ok: false, reason: 'Already at min grade' };
    const oldGrade = a.grade;
    a.grade = GRADES[idx - 1];
    a.gradeChangedAt = new Date().toISOString();
    this._saveAgents();
    const entry = { agentId, type: 'demotion', from: oldGrade, to: a.grade, timestamp: a.gradeChangedAt, reason: reason || 'unspecified' };
    this.history.push(entry);
    this._saveHistory();
    return { ok: true, from: oldGrade, to: a.grade };
  }

  getHistory(agentId) {
    if (!agentId) return this.history;
    return this.history.filter(h => h.agentId === agentId);
  }

  canExecute(agentId, riskClass) {
    const grade = this.getGrade(agentId);
    const perm = PERMISSION_MATRIX[grade] && PERMISSION_MATRIX[grade][riskClass];
    return perm === 'allow';
  }

  getPermission(agentId, riskClass) {
    const grade = this.getGrade(agentId);
    return (PERMISSION_MATRIX[grade] && PERMISSION_MATRIX[grade][riskClass]) || 'deny';
  }

  getPermissionMatrix() {
    return PERMISSION_MATRIX;
  }

  getAllAgents() {
    // Ensure all agents are initialized
    const result = {};
    for (const [id, data] of Object.entries(this.agents)) {
      result[id] = { ...data };
    }
    return result;
  }

  getThresholds() {
    return this.thresholds;
  }
}

module.exports = EarnedAutonomy;
