/**
 * ARIES — Failure Archaeology
 * Re-analyzing old mistakes with current intelligence.
 * Only fires when revisiting old data, but powerful when it does.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'learnings');
const CATALOG_FILE = path.join(DATA_DIR, 'failure-catalog.json');
const DISCOVERIES_FILE = path.join(DATA_DIR, 'discoveries.json');
const PATTERNS_FILE = path.join(DATA_DIR, 'patterns.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class FailureArchaeology extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.digsPerTick = this.config.digsPerTick || 1;
    this.maxCatalog = this.config.maxCatalog || 500;
    ensureDir();
  }

  // ── Persistence helpers ──

  _getCatalog() { return readJSON(CATALOG_FILE, { failures: [] }); }
  _saveCatalog(data) { writeJSON(CATALOG_FILE, data); }
  _getDiscoveries() { return readJSON(DISCOVERIES_FILE, { discoveries: [] }); }
  _saveDiscoveries(data) { writeJSON(DISCOVERIES_FILE, data); }
  _getPatterns() { return readJSON(PATTERNS_FILE, { patterns: [], lastAnalysis: null }); }
  _savePatterns(data) { writeJSON(PATTERNS_FILE, data); }

  // ── Core: Catalog a failure ──

  /**
   * Log a failure for future archaeological analysis.
   * @param {string} description - What went wrong
   * @param {object} context - Surrounding context (task, inputs, state)
   * @param {string} originalAnalysis - What we thought at the time
   * @returns {object} The cataloged failure entry
   */
  catalogFailure(description, context = {}, originalAnalysis = '') {
    const catalog = this._getCatalog();

    const failure = {
      id: uuid(),
      description: (description || '').substring(0, 2000),
      context,
      originalAnalysis: (originalAnalysis || '').substring(0, 2000),
      timestamp: Date.now(),
      catalogedAt: new Date().toISOString(),
      impact: context.impact || 'unknown',  // low, medium, high, critical
      tags: context.tags || [],
      digCount: 0,
      lastDigAt: null,
      discoveries: [],
      currentLesson: originalAnalysis || '',
    };

    catalog.failures.push(failure);

    // Prune if over max
    if (catalog.failures.length > this.maxCatalog) {
      catalog.failures = catalog.failures.slice(-this.maxCatalog);
    }

    this._saveCatalog(catalog);
    this.emit('failure-cataloged', failure);
    return failure;
  }

  /**
   * AI re-analyzes an old failure with current intelligence.
   * @param {string} failureId
   * @returns {object|null} Discovery if new insight found, null otherwise
   */
  async dig(failureId) {
    if (!this.ai) return null;

    const catalog = this._getCatalog();
    const failure = catalog.failures.find(f => f.id === failureId);
    if (!failure) return null;

    const prompt = `You are re-analyzing an old failure with fresh eyes. Your goal is to find insights the original analysis missed.

FAILURE: ${failure.description}

CONTEXT: ${JSON.stringify(failure.context, null, 2)}

ORIGINAL ANALYSIS (at the time): ${failure.originalAnalysis}

TIMES PREVIOUSLY RE-EXAMINED: ${failure.digCount}
${failure.discoveries.length > 0 ? `PREVIOUS DISCOVERIES:\n${failure.discoveries.map(d => '- ' + d).join('\n')}` : ''}

Instructions:
1. Re-analyze this failure with fresh perspective
2. Look for root causes the original analysis missed
3. Consider systemic factors, hidden assumptions, or patterns
4. If you find genuinely new insight, state it clearly
5. If the original analysis was thorough, say so

Respond in JSON:
{
  "hasNewInsight": true/false,
  "newInsight": "...",
  "updatedLesson": "...",
  "confidence": 0.0-1.0,
  "rootCauses": ["..."],
  "hiddenFactors": ["..."]
}`;

    try {
      const response = await this.ai.chat([{ role: 'user', content: prompt }], {
        model: this.config.model,
        temperature: 0.7,
      });

      const text = typeof response === 'string' ? response : (response.content || response.text || '');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]);

      // Update failure record
      failure.digCount++;
      failure.lastDigAt = Date.now();

      if (result.hasNewInsight && result.newInsight) {
        failure.discoveries.push(result.newInsight);
        failure.currentLesson = result.updatedLesson || failure.currentLesson;

        const discovery = {
          id: uuid(),
          failureId,
          insight: result.newInsight,
          updatedLesson: result.updatedLesson || '',
          confidence: result.confidence || 0.5,
          rootCauses: result.rootCauses || [],
          hiddenFactors: result.hiddenFactors || [],
          discoveredAt: Date.now(),
          digNumber: failure.digCount,
        };

        const discoveries = this._getDiscoveries();
        discoveries.discoveries.push(discovery);
        this._saveDiscoveries(discoveries);

        this._saveCatalog(catalog);
        this.emit('discovery', discovery);
        return discovery;
      }

      this._saveCatalog(catalog);
      return null;
    } catch (e) {
      console.error('[FAILURE-ARCHAEOLOGY] Dig error:', e.message);
      return null;
    }
  }

  /**
   * Cross-failure pattern analysis using AI.
   * @returns {object|null} Patterns found
   */
  async discoverPatterns() {
    if (!this.ai) return null;

    const catalog = this._getCatalog();
    if (catalog.failures.length < 3) return null;

    // Take a sample: most recent + highest impact
    const sorted = [...catalog.failures].sort((a, b) => {
      const impactOrder = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };
      return (impactOrder[b.impact] || 0) - (impactOrder[a.impact] || 0);
    });
    const sample = sorted.slice(0, 20);

    const summaries = sample.map((f, i) =>
      `${i + 1}. [${f.catalogedAt}] ${f.description.substring(0, 200)}\n   Original: ${(f.originalAnalysis || 'none').substring(0, 150)}\n   Tags: ${(f.tags || []).join(', ') || 'none'}`
    ).join('\n\n');

    const prompt = `Analyze these failures for cross-cutting patterns, recurring themes, and systemic root causes that might not be visible in any single failure.

FAILURES:
${summaries}

Look for:
1. Recurring failure modes
2. Common root causes
3. Temporal patterns (clusters, escalation)
4. Systemic issues that multiple failures point to
5. Blind spots — types of failures that keep surprising

Respond in JSON:
{
  "patterns": [
    { "name": "...", "description": "...", "failureIds": [...indices], "severity": "low/medium/high" }
  ],
  "systemicIssues": ["..."],
  "blindSpots": ["..."]
}`;

    try {
      const response = await this.ai.chat([{ role: 'user', content: prompt }], {
        model: this.config.model,
        temperature: 0.6,
      });

      const text = typeof response === 'string' ? response : (response.content || response.text || '');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]);
      const patternData = this._getPatterns();
      patternData.patterns = result.patterns || [];
      patternData.systemicIssues = result.systemicIssues || [];
      patternData.blindSpots = result.blindSpots || [];
      patternData.lastAnalysis = Date.now();
      patternData.failureCount = catalog.failures.length;
      this._savePatterns(patternData);

      this.emit('patterns-discovered', result);
      return result;
    } catch (e) {
      console.error('[FAILURE-ARCHAEOLOGY] Pattern discovery error:', e.message);
      return null;
    }
  }

  /**
   * Get all archaeological discoveries.
   * @returns {object[]}
   */
  getDiscoveries() {
    return this._getDiscoveries().discoveries.sort((a, b) => b.discoveredAt - a.discoveredAt);
  }

  /**
   * Get the next n failures to re-examine, prioritized by:
   * 1. Never-dug failures (oldest first)
   * 2. Highest-impact failures
   * 3. Longest since last dig
   * @param {number} n
   * @returns {object[]}
   */
  getDigSchedule(n = 5) {
    const catalog = this._getCatalog();
    const impactOrder = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };

    const scored = catalog.failures.map(f => {
      let score = 0;
      // Never dug = highest priority
      if (f.digCount === 0) score += 100;
      // Impact score
      score += (impactOrder[f.impact] || 0) * 10;
      // Staleness — longer since last dig = higher priority
      if (f.lastDigAt) {
        const daysSinceDig = (Date.now() - f.lastDigAt) / 86400000;
        score += Math.min(daysSinceDig, 30);
      } else {
        // Age of failure if never dug
        const age = (Date.now() - f.timestamp) / 86400000;
        score += Math.min(age, 50);
      }
      return { ...f, _score: score };
    });

    return scored
      .sort((a, b) => b._score - a._score)
      .slice(0, n)
      .map(f => { const { _score, ...rest } = f; return rest; });
  }

  /**
   * Get all cataloged failures.
   * @param {object} [opts]
   * @param {string} [opts.impact] - Filter by impact level
   * @param {number} [opts.limit] - Max results
   * @returns {object[]}
   */
  getCatalog(opts = {}) {
    const catalog = this._getCatalog();
    let failures = catalog.failures;
    if (opts.impact) failures = failures.filter(f => f.impact === opts.impact);
    if (opts.limit) failures = failures.slice(-opts.limit);
    return failures;
  }

  /**
   * Get known patterns.
   * @returns {object}
   */
  getPatterns() {
    return this._getPatterns();
  }

  /**
   * Periodic tick — performs scheduled digs.
   * @returns {object[]} Any discoveries made
   */
  async tick() {
    const schedule = this.getDigSchedule(this.digsPerTick);
    const discoveries = [];

    for (const failure of schedule) {
      const discovery = await this.dig(failure.id);
      if (discovery) discoveries.push(discovery);
    }

    if (discoveries.length > 0) {
      this.emit('tick-discoveries', discoveries);
    }
    return discoveries;
  }

  /** Get summary stats */
  getStats() {
    const catalog = this._getCatalog();
    const discoveries = this._getDiscoveries();
    const patterns = this._getPatterns();
    const neverDug = catalog.failures.filter(f => f.digCount === 0).length;

    return {
      totalFailures: catalog.failures.length,
      totalDiscoveries: discoveries.discoveries.length,
      totalPatterns: (patterns.patterns || []).length,
      neverExamined: neverDug,
      lastPatternAnalysis: patterns.lastAnalysis,
    };
  }
}

module.exports = FailureArchaeology;
