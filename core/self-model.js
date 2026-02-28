/**
 * ARIES — Self Model
 * True self-knowledge: capability mapping, bias detection, failure prediction.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'self-model');
const CAPABILITIES_PATH = path.join(DATA_DIR, 'capabilities.json');
const BIASES_PATH = path.join(DATA_DIR, 'biases.json');

const AREAS = [
  'code_generation', 'code_review', 'debugging', 'architecture', 'research',
  'writing', 'math', 'trading_analysis', 'creative_work', 'conversation',
  'teaching', 'planning'
];

const AREA_META = {
  code_generation: { icon: '💻', label: 'Code Generation' },
  code_review: { icon: '🔍', label: 'Code Review' },
  debugging: { icon: '🐛', label: 'Debugging' },
  architecture: { icon: '🏗️', label: 'Architecture' },
  research: { icon: '📚', label: 'Research' },
  writing: { icon: '✍️', label: 'Writing' },
  math: { icon: '🔢', label: 'Math' },
  trading_analysis: { icon: '📈', label: 'Trading Analysis' },
  creative_work: { icon: '🎨', label: 'Creative Work' },
  conversation: { icon: '💬', label: 'Conversation' },
  teaching: { icon: '🎓', label: 'Teaching' },
  planning: { icon: '📋', label: 'Planning' },
};

const COMPENSATIONS = {
  code_generation: 'Write tests alongside code. Use linters. Review generated code before shipping.',
  code_review: 'Use a checklist. Focus on logic errors over style. Run the code if possible.',
  debugging: 'Reproduce first. Add logging. Check assumptions. Rubber duck the problem.',
  architecture: 'Draw diagrams. Consider failure modes. Get a second opinion. Start simple.',
  research: 'Cross-reference multiple sources. Check dates. Be skeptical of initial findings.',
  writing: 'Read aloud. Cut 30% on first edit. Get feedback. Check for jargon.',
  math: 'Double-check with a calculator. Write out steps. Test with known values.',
  trading_analysis: 'Never trust a single indicator. Size positions small. Always define stop-loss.',
  creative_work: 'Generate many options. Combine ideas. Take breaks. Seek diverse inspiration.',
  conversation: 'Listen more. Ask clarifying questions. Don\'t assume intent.',
  teaching: 'Start from what they know. Use analogies. Check understanding frequently.',
  planning: 'Break into phases. Add buffer time. Identify dependencies. Plan for failure.',
};

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class SelfModel {
  constructor() {
    ensureDir();
  }

  /**
   * Record a performance data point.
   */
  recordPerformance(area, task, outcome, quality) {
    if (!AREAS.includes(area)) return { error: 'Invalid area. Valid: ' + AREAS.join(', ') };
    
    const caps = readJSON(CAPABILITIES_PATH, { areas: {}, history: [] });
    if (!caps.areas[area]) caps.areas[area] = { successes: 0, failures: 0, totalQuality: 0, count: 0, failureModes: {} };
    
    const entry = {
      id: uuid(),
      area,
      task: (task || '').slice(0, 200),
      outcome: outcome === 'success' || outcome === true ? 'success' : 'failure',
      quality: Math.max(0, Math.min(100, quality || 50)),
      timestamp: Date.now(),
    };

    const a = caps.areas[area];
    if (entry.outcome === 'success') a.successes++;
    else {
      a.failures++;
      // Track failure modes
      const mode = (task || 'unknown').split(' ').slice(0, 3).join(' ');
      a.failureModes[mode] = (a.failureModes[mode] || 0) + 1;
    }
    a.totalQuality += entry.quality;
    a.count++;

    caps.history.push(entry);
    if (caps.history.length > 2000) caps.history.splice(0, caps.history.length - 2000);

    writeJSON(CAPABILITIES_PATH, caps);
    this._detectBiases(caps);
    return entry;
  }

  /**
   * Get full capability map.
   */
  getCapabilityMap() {
    const caps = readJSON(CAPABILITIES_PATH, { areas: {}, history: [] });
    const map = {};

    for (const area of AREAS) {
      const data = caps.areas[area] || { successes: 0, failures: 0, totalQuality: 0, count: 0, failureModes: {} };
      const total = data.successes + data.failures;
      const successRate = total > 0 ? Math.round((data.successes / total) * 100) : null;
      const avgQuality = data.count > 0 ? Math.round(data.totalQuality / data.count) : null;
      
      // Confidence interval (simplified): wider with less data
      const confidenceWidth = total > 0 ? Math.round(100 / Math.sqrt(total)) : null;

      map[area] = {
        ...AREA_META[area],
        successRate,
        avgQuality,
        totalTasks: total,
        confidenceInterval: successRate !== null ? {
          low: Math.max(0, successRate - confidenceWidth),
          high: Math.min(100, successRate + confidenceWidth),
        } : null,
        topFailureModes: Object.entries(data.failureModes || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([mode, count]) => ({ mode, count })),
        dataQuality: total >= 20 ? 'high' : total >= 5 ? 'medium' : total > 0 ? 'low' : 'none',
      };
    }
    return map;
  }

  /**
   * Predict success probability for a task.
   */
  predictSuccess(area, taskComplexity) {
    const caps = readJSON(CAPABILITIES_PATH, { areas: {}, history: [] });
    const data = caps.areas[area];
    if (!data || data.count < 3) return { probability: null, confidence: 'low', reason: 'Insufficient data for prediction' };

    const total = data.successes + data.failures;
    const baseRate = data.successes / total;
    
    // Adjust for complexity (1-10 scale)
    const complexity = Math.max(1, Math.min(10, taskComplexity || 5));
    const complexityPenalty = (complexity - 5) * 0.05; // ±25% max adjustment
    const adjusted = Math.max(0.05, Math.min(0.95, baseRate - complexityPenalty));
    
    return {
      probability: Math.round(adjusted * 100),
      baseRate: Math.round(baseRate * 100),
      complexityAdjustment: Math.round(-complexityPenalty * 100),
      sampleSize: total,
      confidence: total >= 20 ? 'high' : total >= 5 ? 'medium' : 'low',
    };
  }

  /**
   * Get detected biases.
   */
  getBiases() {
    return readJSON(BIASES_PATH, []);
  }

  /**
   * Get blind spots — areas with low data.
   */
  getBlindSpots() {
    const caps = readJSON(CAPABILITIES_PATH, { areas: {}, history: [] });
    return AREAS.filter(area => {
      const data = caps.areas[area];
      return !data || data.count < 5;
    }).map(area => ({
      area,
      ...AREA_META[area],
      dataPoints: caps.areas[area] ? caps.areas[area].count : 0,
      message: `Not enough data to assess ${AREA_META[area].label}. Need at least 5 tasks.`,
    }));
  }

  /**
   * Get compensation suggestions for an area.
   */
  compensate(area) {
    const caps = readJSON(CAPABILITIES_PATH, { areas: {}, history: [] });
    const data = caps.areas[area];
    const suggestions = [COMPENSATIONS[area] || 'No specific compensations available.'];
    
    if (data && data.failureModes) {
      const topFailures = Object.entries(data.failureModes).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (topFailures.length > 0) {
        suggestions.push('Common failure patterns: ' + topFailures.map(([m, c]) => `"${m}" (${c}x)`).join(', '));
      }
    }

    const total = data ? data.successes + data.failures : 0;
    const successRate = total > 0 ? data.successes / total : null;
    if (successRate !== null && successRate < 0.5) {
      suggestions.push('⚠️ Below 50% success rate — consider delegating or pairing with another approach.');
    }

    return { area, ...AREA_META[area], suggestions };
  }

  /**
   * Track capability evolution over time.
   */
  getEvolution() {
    const caps = readJSON(CAPABILITIES_PATH, { areas: {}, history: [] });
    const history = caps.history || [];
    
    // Group by week
    const weeks = {};
    for (const entry of history) {
      const weekKey = new Date(entry.timestamp).toISOString().slice(0, 10); // daily for now
      if (!weeks[weekKey]) weeks[weekKey] = {};
      if (!weeks[weekKey][entry.area]) weeks[weekKey][entry.area] = { successes: 0, total: 0, quality: 0, count: 0 };
      const w = weeks[weekKey][entry.area];
      w.total++;
      if (entry.outcome === 'success') w.successes++;
      w.quality += entry.quality;
      w.count++;
    }

    // Compute trends per area
    const trends = {};
    for (const area of AREAS) {
      const points = Object.entries(weeks)
        .filter(([, w]) => w[area])
        .map(([date, w]) => ({
          date,
          successRate: Math.round((w[area].successes / w[area].total) * 100),
          avgQuality: Math.round(w[area].quality / w[area].count),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      
      if (points.length >= 2) {
        const first = points[0].successRate;
        const last = points[points.length - 1].successRate;
        trends[area] = {
          points,
          direction: last > first + 5 ? 'improving' : last < first - 5 ? 'declining' : 'stable',
          change: last - first,
        };
      }
    }
    return trends;
  }

  /**
   * Honest self-assessment in natural language.
   */
  getSelfReport() {
    const map = this.getCapabilityMap();
    const biases = this.getBiases();
    const blindSpots = this.getBlindSpots();
    
    const strengths = Object.entries(map)
      .filter(([, v]) => v.successRate !== null && v.successRate >= 75 && v.totalTasks >= 5)
      .sort((a, b) => b[1].successRate - a[1].successRate)
      .slice(0, 3);
    
    const weaknesses = Object.entries(map)
      .filter(([, v]) => v.successRate !== null && v.successRate < 60 && v.totalTasks >= 5)
      .sort((a, b) => a[1].successRate - b[1].successRate)
      .slice(0, 3);

    let report = '📊 Self-Assessment Report\n\n';
    
    if (strengths.length > 0) {
      report += '💪 Strengths:\n';
      for (const [area, data] of strengths) {
        report += `  ${data.icon} ${data.label}: ${data.successRate}% success (${data.totalTasks} tasks)\n`;
      }
    } else {
      report += '💪 Strengths: Not enough data to determine yet.\n';
    }
    
    report += '\n';
    
    if (weaknesses.length > 0) {
      report += '⚠️ Areas for Improvement:\n';
      for (const [area, data] of weaknesses) {
        report += `  ${data.icon} ${data.label}: ${data.successRate}% success — ${COMPENSATIONS[area] || 'needs work'}\n`;
      }
    } else {
      report += '⚠️ Weaknesses: None detected (or insufficient data).\n';
    }

    report += '\n';

    if (blindSpots.length > 0) {
      report += `🔍 Blind Spots (${blindSpots.length} areas with insufficient data):\n`;
      for (const bs of blindSpots.slice(0, 5)) {
        report += `  ${bs.icon} ${bs.label} (${bs.dataPoints} data points)\n`;
      }
    }

    if (biases.length > 0) {
      report += `\n🧠 Detected Biases (${biases.length}):\n`;
      for (const b of biases.slice(0, 5)) {
        report += `  • ${b.description}\n`;
      }
    }

    return report;
  }

  /**
   * Detect biases from performance data.
   */
  _detectBiases(caps) {
    const biases = [];
    const history = caps.history || [];
    if (history.length < 10) return;

    // Bias: consistently lower quality on certain areas
    for (const area of AREAS) {
      const areaHistory = history.filter(h => h.area === area);
      if (areaHistory.length < 5) continue;
      
      const avgQuality = areaHistory.reduce((s, h) => s + h.quality, 0) / areaHistory.length;
      const overallAvg = history.reduce((s, h) => s + h.quality, 0) / history.length;
      
      if (avgQuality < overallAvg - 15) {
        biases.push({
          type: 'quality_gap',
          area,
          description: `${AREA_META[area].label} quality (${Math.round(avgQuality)}) is significantly below average (${Math.round(overallAvg)})`,
          severity: avgQuality < overallAvg - 30 ? 'high' : 'medium',
          detectedAt: Date.now(),
        });
      }
    }

    // Bias: failure clustering (multiple failures in a row)
    const recentFailures = history.slice(-20).filter(h => h.outcome === 'failure');
    if (recentFailures.length >= 5) {
      const areas = [...new Set(recentFailures.map(f => f.area))];
      biases.push({
        type: 'failure_cluster',
        description: `Recent failure cluster: ${recentFailures.length}/20 recent tasks failed, concentrated in ${areas.map(a => AREA_META[a].label).join(', ')}`,
        severity: recentFailures.length >= 10 ? 'high' : 'medium',
        detectedAt: Date.now(),
      });
    }

    // Bias: overconfidence in new areas (high quality self-rating but low success)
    for (const area of AREAS) {
      const data = caps.areas[area];
      if (!data || data.count < 5) continue;
      const successRate = data.successes / (data.successes + data.failures);
      const avgQuality = data.totalQuality / data.count;
      if (avgQuality > 70 && successRate < 0.5) {
        biases.push({
          type: 'overconfidence',
          area,
          description: `Overconfidence in ${AREA_META[area].label}: self-rated quality ${Math.round(avgQuality)} but only ${Math.round(successRate * 100)}% success rate`,
          severity: 'high',
          detectedAt: Date.now(),
        });
      }
    }

    writeJSON(BIASES_PATH, biases);
  }
}

module.exports = SelfModel;
