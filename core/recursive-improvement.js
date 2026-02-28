/**
 * ARIES — Recursive Improvement (Meta-Learning)
 * Improve the improvement process itself.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'meta-learning');
const IMPROVEMENTS_PATH = path.join(DATA_DIR, 'improvements.json');
const METHODS_PATH = path.join(DATA_DIR, 'methods.json');

const MAX_RECURSION_DEPTH = 5;

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

class RecursiveImprovement {
  constructor(opts) {
    this.ai = opts && opts.ai;
    ensureDir();
  }

  /**
   * Record an improvement cycle
   * @param {string} target - what was improved
   * @param {string} method - method/technique used
   * @param {number} beforeMetric - metric before (0-100)
   * @param {number} afterMetric - metric after (0-100)
   * @param {number} depth - recursion depth (0=direct, 1=improving the method, etc.)
   */
  recordImprovement(target, method, beforeMetric, afterMetric, depth = 0) {
    if (depth > MAX_RECURSION_DEPTH) {
      return { error: 'Max recursion depth exceeded', maxDepth: MAX_RECURSION_DEPTH };
    }

    const improvements = readJSON(IMPROVEMENTS_PATH, []);
    const methods = readJSON(METHODS_PATH, {});

    const improvement = {
      id: uuid(),
      target,
      method,
      beforeMetric: Math.max(0, Math.min(100, beforeMetric)),
      afterMetric: Math.max(0, Math.min(100, afterMetric)),
      delta: afterMetric - beforeMetric,
      effectiveness: afterMetric > beforeMetric ? 'positive' : afterMetric < beforeMetric ? 'negative' : 'neutral',
      depth,
      timestamp: Date.now(),
      date: new Date().toISOString().split('T')[0],
    };

    improvements.push(improvement);
    // Keep last 1000
    if (improvements.length > 1000) improvements.splice(0, improvements.length - 1000);
    writeJSON(IMPROVEMENTS_PATH, improvements);

    // Update method stats
    if (!methods[method]) {
      methods[method] = {
        id: method,
        name: method,
        uses: 0,
        totalDelta: 0,
        avgDelta: 0,
        successes: 0,
        failures: 0,
        targets: [],
        createdAt: Date.now(),
        lastUsedAt: null,
        improvements: [], // improvements to this method itself (depth+1)
      };
    }
    const m = methods[method];
    m.uses++;
    m.totalDelta += improvement.delta;
    m.avgDelta = Math.round((m.totalDelta / m.uses) * 100) / 100;
    if (improvement.delta > 0) m.successes++;
    else if (improvement.delta < 0) m.failures++;
    if (!m.targets.includes(target)) m.targets.push(target);
    m.lastUsedAt = Date.now();
    writeJSON(METHODS_PATH, methods);

    return improvement;
  }

  /**
   * Analyze which improvement methods work best and which targets improve easiest
   */
  analyzeImprovementPatterns() {
    const improvements = readJSON(IMPROVEMENTS_PATH, []);
    const methods = readJSON(METHODS_PATH, {});

    // Method effectiveness ranking
    const methodRanking = Object.values(methods)
      .map(m => ({
        method: m.name,
        uses: m.uses,
        avgDelta: m.avgDelta,
        successRate: m.uses > 0 ? Math.round((m.successes / m.uses) * 100) : 0,
        score: m.avgDelta * (m.uses > 0 ? m.successes / m.uses : 0),
      }))
      .sort((a, b) => b.score - a.score);

    // Target ease ranking
    const targetMap = {};
    for (const imp of improvements) {
      if (!targetMap[imp.target]) targetMap[imp.target] = { target: imp.target, deltas: [], count: 0 };
      targetMap[imp.target].deltas.push(imp.delta);
      targetMap[imp.target].count++;
    }
    const targetRanking = Object.values(targetMap)
      .map(t => ({
        target: t.target,
        count: t.count,
        avgDelta: t.deltas.length > 0 ? Math.round((t.deltas.reduce((a, b) => a + b, 0) / t.deltas.length) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.avgDelta - a.avgDelta);

    return { methodRanking, targetRanking, totalImprovements: improvements.length };
  }

  /**
   * Improve a method itself (meta-improvement)
   */
  improveMethod(methodId) {
    const methods = readJSON(METHODS_PATH, {});
    const method = methods[methodId];
    if (!method) return { error: 'Method not found' };

    // Analyze method performance
    const improvements = readJSON(IMPROVEMENTS_PATH, []);
    const methodImprovements = improvements.filter(i => i.method === methodId);

    // Find patterns: when does this method work best?
    const successfulTargets = methodImprovements.filter(i => i.delta > 0).map(i => i.target);
    const failedTargets = methodImprovements.filter(i => i.delta <= 0).map(i => i.target);

    const suggestion = {
      method: methodId,
      currentAvgDelta: method.avgDelta,
      successRate: method.uses > 0 ? Math.round((method.successes / method.uses) * 100) : 0,
      bestTargets: [...new Set(successfulTargets)].slice(0, 5),
      worstTargets: [...new Set(failedTargets)].slice(0, 5),
      recommendation: method.avgDelta > 5 ? 'Method is effective — apply more broadly'
        : method.avgDelta > 0 ? 'Method is marginally effective — consider refinement'
        : method.avgDelta === 0 ? 'Method has no measurable effect — consider replacing'
        : 'Method is counterproductive — stop using or fundamentally redesign',
      timestamp: Date.now(),
    };

    // Record this as a depth-1 improvement
    method.improvements.push({
      id: uuid(),
      analysis: suggestion,
      timestamp: Date.now(),
    });
    if (method.improvements.length > 50) method.improvements = method.improvements.slice(-50);
    writeJSON(METHODS_PATH, methods);

    return suggestion;
  }

  /**
   * Meta-stats: are we improving faster over time?
   */
  getMetaStats() {
    const improvements = readJSON(IMPROVEMENTS_PATH, []);
    const methods = readJSON(METHODS_PATH, {});

    if (improvements.length === 0) {
      return {
        totalImprovements: 0,
        improvementRate: 0,
        accelerating: false,
        mostEffectiveMethods: [],
        diminishingReturns: [],
        depthDistribution: {},
      };
    }

    // Group by date
    const byDate = {};
    for (const imp of improvements) {
      const d = imp.date || new Date(imp.timestamp).toISOString().split('T')[0];
      if (!byDate[d]) byDate[d] = { count: 0, totalDelta: 0 };
      byDate[d].count++;
      byDate[d].totalDelta += imp.delta;
    }

    const dates = Object.keys(byDate).sort();
    const rates = dates.map(d => byDate[d].totalDelta / Math.max(byDate[d].count, 1));

    // Are we accelerating? Compare first half vs second half
    const mid = Math.floor(rates.length / 2);
    const firstHalf = rates.slice(0, mid);
    const secondHalf = rates.slice(mid);
    const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : 0;
    const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : 0;

    // Depth distribution
    const depthDist = {};
    for (const imp of improvements) {
      depthDist[imp.depth || 0] = (depthDist[imp.depth || 0] || 0) + 1;
    }

    // Diminishing returns detection per target
    const diminishing = [];
    const targetGroups = {};
    for (const imp of improvements) {
      if (!targetGroups[imp.target]) targetGroups[imp.target] = [];
      targetGroups[imp.target].push(imp);
    }
    for (const [target, imps] of Object.entries(targetGroups)) {
      if (imps.length < 3) continue;
      const sorted = imps.sort((a, b) => a.timestamp - b.timestamp);
      const recentDeltas = sorted.slice(-3).map(i => i.delta);
      const avgRecent = recentDeltas.reduce((a, b) => a + b, 0) / recentDeltas.length;
      if (avgRecent < 1 && sorted.length >= 5) {
        diminishing.push({ target, avgRecentDelta: Math.round(avgRecent * 100) / 100, totalAttempts: sorted.length });
      }
    }

    // Most effective methods
    const topMethods = Object.values(methods)
      .sort((a, b) => b.avgDelta - a.avgDelta)
      .slice(0, 5)
      .map(m => ({ method: m.name, avgDelta: m.avgDelta, uses: m.uses, successRate: m.uses > 0 ? Math.round((m.successes / m.uses) * 100) : 0 }));

    return {
      totalImprovements: improvements.length,
      improvementRate: Math.round(secondAvg * 100) / 100,
      accelerating: secondAvg > firstAvg,
      acceleration: Math.round((secondAvg - firstAvg) * 100) / 100,
      mostEffectiveMethods: topMethods,
      diminishingReturns: diminishing,
      depthDistribution: depthDist,
      dailyRates: dates.slice(-14).map((d, i) => ({ date: d, rate: Math.round(rates[dates.indexOf(d)] * 100) / 100 })),
    };
  }

  /**
   * Suggest what to improve next based on meta-analysis
   */
  suggestNextImprovement() {
    const improvements = readJSON(IMPROVEMENTS_PATH, []);
    const methods = readJSON(METHODS_PATH, {});
    const patterns = this.analyzeImprovementPatterns();

    // Find targets with room to improve (not diminishing returns)
    const targetDeltas = {};
    for (const imp of improvements) {
      if (!targetDeltas[imp.target]) targetDeltas[imp.target] = { deltas: [], lastMetric: 0 };
      targetDeltas[imp.target].deltas.push(imp.delta);
      targetDeltas[imp.target].lastMetric = imp.afterMetric;
    }

    // Targets that still have room
    const candidates = Object.entries(targetDeltas)
      .filter(([_, v]) => v.lastMetric < 90) // still room to improve
      .map(([target, v]) => {
        const avgDelta = v.deltas.reduce((a, b) => a + b, 0) / v.deltas.length;
        const recentDelta = v.deltas.slice(-3).reduce((a, b) => a + b, 0) / Math.min(v.deltas.length, 3);
        return {
          target,
          currentMetric: v.lastMetric,
          roomToImprove: 100 - v.lastMetric,
          recentMomentum: Math.round(recentDelta * 100) / 100,
          attempts: v.deltas.length,
        };
      })
      .sort((a, b) => (b.roomToImprove * b.recentMomentum) - (a.roomToImprove * a.recentMomentum));

    // Best method for the top candidate
    const bestMethod = patterns.methodRanking[0];
    const topCandidate = candidates[0] || null;

    return {
      suggestion: topCandidate ? {
        target: topCandidate.target,
        reason: `${topCandidate.roomToImprove}% room to improve, momentum: ${topCandidate.recentMomentum}`,
        recommendedMethod: bestMethod ? bestMethod.method : 'experiment',
        confidence: topCandidate.recentMomentum > 0 ? 'high' : 'medium',
      } : {
        target: 'new_area',
        reason: 'No existing targets with clear improvement potential — explore new areas',
        recommendedMethod: 'experiment',
        confidence: 'low',
      },
      alternatives: candidates.slice(1, 4),
      totalCandidates: candidates.length,
    };
  }

  /**
   * Get recursive improvement tree
   */
  getImprovementTree() {
    const improvements = readJSON(IMPROVEMENTS_PATH, []);
    const methods = readJSON(METHODS_PATH, {});

    // Build tree by depth
    const tree = {};
    for (let depth = 0; depth <= MAX_RECURSION_DEPTH; depth++) {
      const atDepth = improvements.filter(i => (i.depth || 0) === depth);
      if (atDepth.length > 0) {
        tree[`depth_${depth}`] = {
          label: depth === 0 ? 'Direct Improvements' : depth === 1 ? 'Method Improvements' : `Meta-level ${depth}`,
          count: atDepth.length,
          avgDelta: Math.round((atDepth.reduce((a, b) => a + b.delta, 0) / atDepth.length) * 100) / 100,
          recent: atDepth.slice(-5).map(i => ({ target: i.target, method: i.method, delta: i.delta, date: i.date })),
        };
      }
    }

    // Method improvement chains
    const chains = [];
    for (const [id, method] of Object.entries(methods)) {
      if (method.improvements && method.improvements.length > 0) {
        chains.push({
          method: id,
          avgDelta: method.avgDelta,
          metaImprovements: method.improvements.length,
          latest: method.improvements[method.improvements.length - 1],
        });
      }
    }

    return { tree, chains, maxDepth: MAX_RECURSION_DEPTH };
  }

  /**
   * Detect diminishing returns for a specific area
   */
  detectDiminishingReturns(area) {
    const improvements = readJSON(IMPROVEMENTS_PATH, []);
    const areaImps = improvements.filter(i => i.target === area).sort((a, b) => a.timestamp - b.timestamp);

    if (areaImps.length < 3) {
      return { area, status: 'insufficient_data', dataPoints: areaImps.length, plateaued: false };
    }

    const deltas = areaImps.map(i => i.delta);
    const recentDeltas = deltas.slice(-5);
    const olderDeltas = deltas.slice(0, -5);

    const recentAvg = recentDeltas.reduce((a, b) => a + b, 0) / recentDeltas.length;
    const olderAvg = olderDeltas.length > 0 ? olderDeltas.reduce((a, b) => a + b, 0) / olderDeltas.length : recentAvg;

    const declining = recentAvg < olderAvg * 0.5;
    const plateaued = Math.abs(recentAvg) < 1;
    const negative = recentAvg < 0;

    return {
      area,
      totalAttempts: areaImps.length,
      recentAvgDelta: Math.round(recentAvg * 100) / 100,
      olderAvgDelta: Math.round(olderAvg * 100) / 100,
      plateaued,
      declining,
      negative,
      status: negative ? 'regressing' : plateaued ? 'plateaued' : declining ? 'diminishing' : 'improving',
      recommendation: negative ? 'Stop — changes are making things worse'
        : plateaued ? 'Move on — this area has plateaued'
        : declining ? 'Consider a different approach — returns are diminishing'
        : 'Keep going — still seeing improvement',
      lastMetric: areaImps[areaImps.length - 1].afterMetric,
    };
  }

  /**
   * Get all improvements (for API)
   */
  getImprovements(limit = 50) {
    const improvements = readJSON(IMPROVEMENTS_PATH, []);
    return improvements.slice(-limit).reverse();
  }

  /**
   * Get all methods (for API)
   */
  getMethods() {
    return readJSON(METHODS_PATH, {});
  }
}

module.exports = RecursiveImprovement;
