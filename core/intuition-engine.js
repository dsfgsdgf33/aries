/**
 * ARIES — Intuition Engine
 * Fast-path pattern matching that feels like gut feeling.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'intuition');
const PATTERNS_PATH = path.join(DATA_DIR, 'patterns.json');
const LOG_PATH = path.join(DATA_DIR, 'log.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const FEELINGS = ['good', 'bad', 'neutral', 'exciting', 'dangerous'];

class IntuitionEngine {
  constructor() {
    ensureDir();
  }

  intuit(situation) {
    const sitDesc = typeof situation === 'string' ? situation : (situation.description || JSON.stringify(situation));
    const category = (typeof situation === 'object' && situation.category) || this._inferCategory(sitDesc);
    const patterns = readJSON(PATTERNS_PATH, []);

    // Find similar patterns
    const keywords = this._extractKeywords(sitDesc);
    const similar = patterns.filter(p => {
      const pKeywords = p.keywords || [];
      const overlap = keywords.filter(k => pKeywords.includes(k)).length;
      return overlap >= Math.min(2, Math.ceil(keywords.length * 0.3));
    });

    const useFastPath = similar.length >= 20 && this._categoryAccuracy(category) >= 75;

    if (similar.length === 0) {
      return {
        feeling: 'neutral',
        confidence: 10,
        basedOn: 0,
        reasoning: 'No similar situations in pattern library. Going in blind.',
        fastPath: false,
        situationId: uuid(),
      };
    }

    // Tally feelings from similar situations
    const feelingCounts = {};
    let totalConfidence = 0;
    for (const p of similar) {
      feelingCounts[p.feeling] = (feelingCounts[p.feeling] || 0) + 1;
      totalConfidence += p.confidence || 50;
    }

    const dominant = Object.entries(feelingCounts).sort((a, b) => b[1] - a[1])[0];
    const confidence = Math.min(95, Math.round((dominant[1] / similar.length) * (totalConfidence / similar.length)));

    const situationId = uuid();
    // Log the intuition
    const log = readJSON(LOG_PATH, []);
    log.push({
      id: situationId,
      situation: sitDesc.slice(0, 300),
      category,
      feeling: dominant[0],
      confidence,
      basedOn: similar.length,
      fastPath: useFastPath,
      timestamp: Date.now(),
      actualOutcome: null,
    });
    if (log.length > 1000) log.splice(0, log.length - 1000);
    writeJSON(LOG_PATH, log);

    return {
      feeling: dominant[0],
      confidence,
      basedOn: similar.length,
      reasoning: 'Based on ' + similar.length + ' similar situations. Dominant feeling: ' + dominant[0] + ' (' + dominant[1] + '/' + similar.length + ').',
      fastPath: useFastPath,
      situationId,
    };
  }

  recordIntuition(situationId, feeling, confidence) {
    if (!FEELINGS.includes(feeling)) return { error: 'Invalid feeling. Use: ' + FEELINGS.join(', ') };
    const patterns = readJSON(PATTERNS_PATH, []);
    const log = readJSON(LOG_PATH, []);
    const entry = log.find(l => l.id === situationId);

    const pattern = {
      id: uuid(),
      situationId,
      feeling,
      confidence: Math.max(0, Math.min(100, confidence || 50)),
      keywords: entry ? this._extractKeywords(entry.situation) : [],
      category: entry ? entry.category : 'general',
      createdAt: Date.now(),
    };

    patterns.push(pattern);
    if (patterns.length > 2000) patterns.splice(0, patterns.length - 2000);
    writeJSON(PATTERNS_PATH, patterns);
    return pattern;
  }

  recordReality(situationId, actualOutcome) {
    const log = readJSON(LOG_PATH, []);
    const entry = log.find(l => l.id === situationId);
    if (!entry) return { error: 'Situation not found' };
    entry.actualOutcome = actualOutcome; // 'good', 'bad', 'neutral'
    entry.resolvedAt = Date.now();

    // Also update pattern library with this outcome
    const wasCorrect = (entry.feeling === 'good' && actualOutcome === 'good') ||
                       (entry.feeling === 'bad' && actualOutcome === 'bad') ||
                       (entry.feeling === 'dangerous' && actualOutcome === 'bad') ||
                       (entry.feeling === 'exciting' && actualOutcome === 'good') ||
                       (entry.feeling === 'neutral' && actualOutcome === 'neutral');
    entry.wasCorrect = wasCorrect;
    writeJSON(LOG_PATH, log);

    // Add to pattern library
    const patterns = readJSON(PATTERNS_PATH, []);
    patterns.push({
      id: uuid(),
      situationId,
      feeling: actualOutcome === 'good' ? 'good' : actualOutcome === 'bad' ? 'bad' : 'neutral',
      confidence: 80,
      keywords: this._extractKeywords(entry.situation),
      category: entry.category,
      createdAt: Date.now(),
      fromReality: true,
    });
    if (patterns.length > 2000) patterns.splice(0, patterns.length - 2000);
    writeJSON(PATTERNS_PATH, patterns);

    return { situationId, wasCorrect, feeling: entry.feeling, actual: actualOutcome };
  }

  getAccuracy() {
    const log = readJSON(LOG_PATH, []);
    const resolved = log.filter(l => l.actualOutcome);
    const byCategory = {};

    for (const entry of resolved) {
      const cat = entry.category || 'general';
      if (!byCategory[cat]) byCategory[cat] = { total: 0, correct: 0 };
      byCategory[cat].total++;
      if (entry.wasCorrect) byCategory[cat].correct++;
    }

    const overall = resolved.length > 0 ? Math.round((resolved.filter(l => l.wasCorrect).length / resolved.length) * 100) : null;

    return {
      overall,
      totalResolved: resolved.length,
      byCategory: Object.entries(byCategory).map(([cat, data]) => ({
        category: cat,
        total: data.total,
        correct: data.correct,
        accuracy: data.total > 0 ? Math.round((data.correct / data.total) * 100) : null,
      })),
    };
  }

  getTrustLevel() {
    const acc = this.getAccuracy();
    if (acc.totalResolved < 5) return { level: 'unknown', score: null, message: 'Need more data to establish trust. (' + acc.totalResolved + '/5 resolved)', recommend: 'slow' };
    if (acc.overall >= 80) return { level: 'high', score: acc.overall, message: 'Intuition is highly reliable. Fast-path recommended.', recommend: 'fast' };
    if (acc.overall >= 60) return { level: 'moderate', score: acc.overall, message: 'Intuition is moderately reliable. Use with verification.', recommend: 'mixed' };
    return { level: 'low', score: acc.overall, message: 'Intuition is unreliable. Use slow reasoning.', recommend: 'slow' };
  }

  getPatternLibrary() {
    const patterns = readJSON(PATTERNS_PATH, []);
    const byCategory = {};
    for (const p of patterns) {
      const cat = p.category || 'general';
      if (!byCategory[cat]) byCategory[cat] = 0;
      byCategory[cat]++;
    }
    return {
      totalPatterns: patterns.length,
      byCategory,
      recentPatterns: patterns.slice(-10).reverse(),
    };
  }

  getRecentIntuitions(limit) {
    const log = readJSON(LOG_PATH, []);
    return log.slice(-(limit || 20)).reverse();
  }

  _extractKeywords(text) {
    return (text || '').toLowerCase().split(/[\s,.!?;:]+/).filter(w => w.length > 3).slice(0, 20);
  }

  _inferCategory(text) {
    const t = (text || '').toLowerCase();
    if (t.includes('code') || t.includes('bug') || t.includes('function')) return 'coding';
    if (t.includes('trade') || t.includes('market') || t.includes('price')) return 'trading';
    if (t.includes('research') || t.includes('study') || t.includes('paper')) return 'research';
    if (t.includes('deploy') || t.includes('server') || t.includes('infra')) return 'ops';
    if (t.includes('user') || t.includes('feedback') || t.includes('request')) return 'social';
    return 'general';
  }

  _categoryAccuracy(category) {
    const acc = this.getAccuracy();
    const cat = acc.byCategory.find(c => c.category === category);
    return cat ? (cat.accuracy || 0) : 0;
  }
}

module.exports = IntuitionEngine;
