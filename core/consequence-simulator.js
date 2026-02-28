/**
 * ARIES — Consequence Simulator
 * Simulate possible futures before taking action.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'simulations');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const ACCURACY_PATH = path.join(DATA_DIR, 'accuracy.json');

const CATEGORIES = ['code_change', 'file_operation', 'api_call', 'user_interaction', 'system_change'];
const IMPACTS = ['positive', 'neutral', 'negative'];

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

// Deterministic outcome generation based on action/context analysis
function analyzeAction(action, context) {
  const actionLower = (action || '').toLowerCase();
  const ctxLower = (context || '').toLowerCase();

  let category = 'system_change';
  if (actionLower.includes('code') || actionLower.includes('refactor') || actionLower.includes('fix') || actionLower.includes('implement')) category = 'code_change';
  else if (actionLower.includes('file') || actionLower.includes('delete') || actionLower.includes('move') || actionLower.includes('create')) category = 'file_operation';
  else if (actionLower.includes('api') || actionLower.includes('request') || actionLower.includes('fetch')) category = 'api_call';
  else if (actionLower.includes('user') || actionLower.includes('message') || actionLower.includes('respond') || actionLower.includes('ask')) category = 'user_interaction';

  const riskFactors = [];
  if (actionLower.includes('delete') || actionLower.includes('remove')) riskFactors.push('destructive_operation');
  if (actionLower.includes('production') || ctxLower.includes('production')) riskFactors.push('production_environment');
  if (actionLower.includes('database') || actionLower.includes('migration')) riskFactors.push('data_modification');
  if (actionLower.includes('deploy') || actionLower.includes('release')) riskFactors.push('deployment');
  if (actionLower.includes('security') || actionLower.includes('auth')) riskFactors.push('security_sensitive');

  const baseRisk = Math.min(10, 2 + riskFactors.length * 2);
  return { category, riskFactors, baseRisk };
}

class ConsequenceSimulator {
  constructor(opts) {
    this.ai = opts && opts.ai;
    ensureDir();
  }

  /**
   * Simulate N possible outcomes for an action
   */
  simulate(action, context, numFutures = 10) {
    const analysis = analyzeAction(action, context);
    const simId = uuid();
    const futures = [];

    // Generate outcome templates based on category
    const templates = this._getTemplates(analysis.category, action, context);

    for (let i = 0; i < numFutures && i < templates.length; i++) {
      const t = templates[i];
      futures.push({
        id: uuid(),
        action,
        outcome: t.outcome,
        probability: t.probability,
        impact: t.impact,
        severity: t.severity,
        reasoning: t.reasoning,
        risks: t.risks,
        mitigations: t.mitigations,
      });
    }

    // Sort by probability descending
    futures.sort((a, b) => b.probability - a.probability);

    // Compute aggregates
    const bestCase = futures.find(f => f.impact === 'positive' && f.severity <= 3) || futures[0];
    const worstCase = [...futures].sort((a, b) => b.severity - a.severity)[0];
    const mostLikely = futures[0]; // highest probability

    const weightedImpact = futures.reduce((acc, f) => {
      const val = f.impact === 'positive' ? f.severity : f.impact === 'negative' ? -f.severity : 0;
      return acc + (val * f.probability / 100);
    }, 0);

    const riskScore = Math.round(analysis.baseRisk * 10 + futures.filter(f => f.impact === 'negative').reduce((a, f) => a + f.severity * f.probability / 100, 0));
    const recommendation = riskScore > 70 ? 'abort' : riskScore > 40 ? 'caution' : 'proceed';

    const simulation = {
      id: simId,
      action,
      context,
      category: analysis.category,
      riskFactors: analysis.riskFactors,
      futures,
      aggregate: {
        bestCase: { outcome: bestCase.outcome, probability: bestCase.probability },
        worstCase: { outcome: worstCase.outcome, probability: worstCase.probability, severity: worstCase.severity },
        mostLikely: { outcome: mostLikely.outcome, probability: mostLikely.probability },
        expectedValue: Math.round(weightedImpact * 100) / 100,
        riskScore: Math.min(100, riskScore),
        recommendation,
      },
      actualOutcome: null,
      timestamp: Date.now(),
    };

    // Store
    const history = readJSON(HISTORY_PATH, []);
    history.push(simulation);
    if (history.length > 200) history.splice(0, history.length - 200);
    writeJSON(HISTORY_PATH, history);

    return simulation;
  }

  _getTemplates(category, action, context) {
    const actionLower = (action || '').toLowerCase();
    const base = [];

    if (category === 'code_change') {
      base.push(
        { outcome: 'Change works perfectly, all tests pass', probability: 40, impact: 'positive', severity: 1, reasoning: 'Most code changes are straightforward', risks: ['None significant'], mitigations: ['Run tests'] },
        { outcome: 'Change works but introduces minor side effect', probability: 25, impact: 'neutral', severity: 3, reasoning: 'Side effects are common in interconnected code', risks: ['Unexpected behavior in related modules'], mitigations: ['Review dependent modules', 'Add integration tests'] },
        { outcome: 'Change breaks existing tests', probability: 15, impact: 'negative', severity: 5, reasoning: 'Refactors often break existing assumptions', risks: ['Deployment blocked', 'Rollback needed'], mitigations: ['Run full test suite before committing', 'Keep backup'] },
        { outcome: 'Change causes runtime error in edge case', probability: 10, impact: 'negative', severity: 6, reasoning: 'Edge cases are hard to predict', risks: ['Production errors', 'Data corruption'], mitigations: ['Add error handling', 'Test edge cases explicitly'] },
        { outcome: 'Change improves performance unexpectedly', probability: 5, impact: 'positive', severity: 2, reasoning: 'Optimizations sometimes have cascading benefits', risks: [], mitigations: [] },
        { outcome: 'Change creates dependency conflict', probability: 3, impact: 'negative', severity: 7, reasoning: 'Module dependencies can be fragile', risks: ['Build failure', 'Version lock'], mitigations: ['Check dependency tree', 'Use lockfile'] },
        { outcome: 'Change has no visible effect', probability: 2, impact: 'neutral', severity: 1, reasoning: 'Dead code or unreachable path', risks: ['Wasted effort'], mitigations: ['Verify the code path is exercised'] },
      );
    } else if (category === 'file_operation') {
      base.push(
        { outcome: 'Operation completes successfully', probability: 60, impact: 'positive', severity: 1, reasoning: 'File operations are usually reliable', risks: ['None'], mitigations: ['Verify file exists'] },
        { outcome: 'Permission denied', probability: 10, impact: 'negative', severity: 4, reasoning: 'File permissions can block operations', risks: ['Operation fails silently'], mitigations: ['Check permissions first'] },
        { outcome: 'File not found', probability: 10, impact: 'negative', severity: 3, reasoning: 'Path may be wrong or file moved', risks: ['Data loss if overwriting'], mitigations: ['Verify path before operating'] },
        { outcome: 'Disk space insufficient', probability: 3, impact: 'negative', severity: 6, reasoning: 'Large files can fill disk', risks: ['System instability'], mitigations: ['Check disk space'] },
        { outcome: 'File locked by another process', probability: 7, impact: 'negative', severity: 4, reasoning: 'Concurrent access conflicts', risks: ['Data corruption'], mitigations: ['Retry with backoff'] },
        { outcome: 'Accidental data loss', probability: actionLower.includes('delete') ? 8 : 2, impact: 'negative', severity: 9, reasoning: 'Destructive operations are irreversible', risks: ['Permanent data loss'], mitigations: ['Backup first', 'Use trash instead of delete'] },
      );
    } else if (category === 'api_call') {
      base.push(
        { outcome: 'API responds successfully', probability: 55, impact: 'positive', severity: 1, reasoning: 'Most API calls succeed', risks: [], mitigations: [] },
        { outcome: 'Rate limited', probability: 15, impact: 'negative', severity: 3, reasoning: 'APIs enforce rate limits', risks: ['Delayed processing'], mitigations: ['Implement retry with backoff'] },
        { outcome: 'Timeout', probability: 10, impact: 'negative', severity: 4, reasoning: 'Network latency or server load', risks: ['Incomplete operation'], mitigations: ['Set reasonable timeout', 'Implement retry'] },
        { outcome: 'Authentication failure', probability: 8, impact: 'negative', severity: 5, reasoning: 'Token expired or invalid', risks: ['Blocked access'], mitigations: ['Refresh token before call'] },
        { outcome: 'Unexpected response format', probability: 7, impact: 'negative', severity: 4, reasoning: 'API may have changed', risks: ['Parse errors'], mitigations: ['Validate response schema'] },
        { outcome: 'Server error (5xx)', probability: 5, impact: 'negative', severity: 5, reasoning: 'Server-side issues', risks: ['Data inconsistency'], mitigations: ['Implement idempotency'] },
      );
    } else if (category === 'user_interaction') {
      base.push(
        { outcome: 'User is satisfied with response', probability: 50, impact: 'positive', severity: 1, reasoning: 'Clear communication usually works', risks: [], mitigations: [] },
        { outcome: 'User needs clarification', probability: 20, impact: 'neutral', severity: 2, reasoning: 'Complex topics need iteration', risks: ['Frustration'], mitigations: ['Be concise and clear'] },
        { outcome: 'User misunderstands response', probability: 12, impact: 'negative', severity: 4, reasoning: 'Ambiguous phrasing', risks: ['Wrong action taken'], mitigations: ['Use concrete examples', 'Ask for confirmation'] },
        { outcome: 'User is impressed', probability: 10, impact: 'positive', severity: 1, reasoning: 'Exceeding expectations', risks: [], mitigations: [] },
        { outcome: 'User is frustrated by response', probability: 5, impact: 'negative', severity: 6, reasoning: 'Tone or content mismatch', risks: ['Trust erosion'], mitigations: ['Read emotional cues', 'Acknowledge difficulty'] },
        { outcome: 'User abandons interaction', probability: 3, impact: 'negative', severity: 7, reasoning: 'Response too complex or off-topic', risks: ['Lost engagement'], mitigations: ['Keep it simple', 'Stay on topic'] },
      );
    } else {
      base.push(
        { outcome: 'System change applies cleanly', probability: 50, impact: 'positive', severity: 1, reasoning: 'Standard operation', risks: [], mitigations: [] },
        { outcome: 'Requires restart to take effect', probability: 15, impact: 'neutral', severity: 2, reasoning: 'Some changes need service restart', risks: ['Brief downtime'], mitigations: ['Schedule during low usage'] },
        { outcome: 'Configuration conflict', probability: 12, impact: 'negative', severity: 5, reasoning: 'Conflicting settings', risks: ['Service degradation'], mitigations: ['Validate config before applying'] },
        { outcome: 'Unexpected cascade effect', probability: 8, impact: 'negative', severity: 7, reasoning: 'System interconnections', risks: ['Multiple services affected'], mitigations: ['Change one thing at a time'] },
        { outcome: 'Rollback needed', probability: 5, impact: 'negative', severity: 6, reasoning: 'Change causes instability', risks: ['Extended downtime'], mitigations: ['Always have rollback plan'] },
      );
    }

    return base.slice(0, 10);
  }

  /**
   * Record what actually happened after acting
   */
  recordActualOutcome(simulationId, whatHappened) {
    const history = readJSON(HISTORY_PATH, []);
    const sim = history.find(s => s.id === simulationId);
    if (!sim) return { error: 'Simulation not found' };

    sim.actualOutcome = {
      description: whatHappened,
      recordedAt: Date.now(),
    };

    // Calculate accuracy — did our most likely prediction match?
    const mostLikely = sim.futures[0];
    const actualLower = (whatHappened || '').toLowerCase();
    const predictedLower = (mostLikely ? mostLikely.outcome : '').toLowerCase();

    // Simple similarity check
    const words1 = new Set(predictedLower.split(/\s+/));
    const words2 = new Set(actualLower.split(/\s+/));
    const intersection = [...words1].filter(w => words2.has(w) && w.length > 3);
    const similarity = Math.round((intersection.length / Math.max(words1.size, words2.size)) * 100);

    sim.actualOutcome.accuracy = similarity;
    sim.actualOutcome.matchedPrediction = similarity > 30;

    writeJSON(HISTORY_PATH, history);

    // Update accuracy stats
    const accuracy = readJSON(ACCURACY_PATH, { total: 0, correct: 0, history: [] });
    accuracy.total++;
    if (sim.actualOutcome.matchedPrediction) accuracy.correct++;
    accuracy.history.push({
      simId: simulationId,
      accuracy: similarity,
      matched: sim.actualOutcome.matchedPrediction,
      timestamp: Date.now(),
    });
    if (accuracy.history.length > 200) accuracy.history = accuracy.history.slice(-200);
    writeJSON(ACCURACY_PATH, accuracy);

    return { simulationId, accuracy: similarity, matched: sim.actualOutcome.matchedPrediction };
  }

  /**
   * Overall prediction accuracy
   */
  getAccuracy() {
    const accuracy = readJSON(ACCURACY_PATH, { total: 0, correct: 0, history: [] });
    const rate = accuracy.total > 0 ? Math.round((accuracy.correct / accuracy.total) * 100) : 0;

    // Recent trend (last 20)
    const recent = accuracy.history.slice(-20);
    const recentRate = recent.length > 0 ? Math.round((recent.filter(h => h.matched).length / recent.length) * 100) : 0;

    return {
      totalSimulations: accuracy.total,
      correctPredictions: accuracy.correct,
      accuracyRate: rate,
      recentAccuracy: recentRate,
      trend: recentRate > rate ? 'improving' : recentRate < rate ? 'declining' : 'stable',
      recentHistory: recent.slice(-10),
    };
  }

  /**
   * Get simulation history
   */
  getSimulationHistory(limit = 20) {
    const history = readJSON(HISTORY_PATH, []);
    return history.slice(-limit).reverse();
  }
}

module.exports = ConsequenceSimulator;
