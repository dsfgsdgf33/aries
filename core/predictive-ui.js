/**
 * ARIES — Predictive UI
 * Dashboard rearranges based on context, habits, and usage patterns.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'predictive');
const USAGE_PATH = path.join(DATA_DIR, 'usage.json');
const PATTERNS_PATH = path.join(DATA_DIR, 'patterns.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const MIN_DATA_THRESHOLD = 50;

class PredictiveUI {
  constructor() {
    ensureDir();
  }

  /**
   * Record a panel access event.
   */
  recordAccess(panel, timestamp) {
    if (!panel) return;
    const ts = timestamp || Date.now();
    const d = new Date(ts);
    const hour = d.getHours();
    const dayOfWeek = d.getDay();
    const timeOfDay = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

    const usage = readJSON(USAGE_PATH, { accesses: [], totalCount: 0 });
    usage.accesses.push({ panel, timestamp: ts, hour, dayOfWeek, timeOfDay });
    usage.totalCount = (usage.totalCount || 0) + 1;

    // Keep last 2000 accesses
    if (usage.accesses.length > 2000) {
      usage.accesses = usage.accesses.slice(-2000);
    }

    writeJSON(USAGE_PATH, usage);

    // Rebuild patterns if we have enough data
    if (usage.totalCount >= MIN_DATA_THRESHOLD) {
      this._buildPatterns(usage);
    }

    return { recorded: true, panel, totalCount: usage.totalCount };
  }

  /**
   * Build usage patterns from raw access data.
   */
  _buildPatterns(usage) {
    const patterns = {
      timeOfDay: {},    // { morning: { chat: 5, dreams: 2 } }
      dayOfWeek: {},    // { 0: { chat: 3 }, 1: { code: 5 } }
      afterPanel: {},   // { chat: { dreams: 3, memory: 1 } }
      hourly: {},       // { 9: { chat: 10 } }
      frequency: {},    // { chat: 100, dreams: 20 }
      lastUpdated: Date.now()
    };

    const accesses = usage.accesses || [];

    for (let i = 0; i < accesses.length; i++) {
      const a = accesses[i];
      const { panel, timeOfDay, dayOfWeek, hour } = a;

      // Time of day patterns
      if (!patterns.timeOfDay[timeOfDay]) patterns.timeOfDay[timeOfDay] = {};
      patterns.timeOfDay[timeOfDay][panel] = (patterns.timeOfDay[timeOfDay][panel] || 0) + 1;

      // Day of week patterns
      const dow = String(dayOfWeek);
      if (!patterns.dayOfWeek[dow]) patterns.dayOfWeek[dow] = {};
      patterns.dayOfWeek[dow][panel] = (patterns.dayOfWeek[dow][panel] || 0) + 1;

      // Hourly patterns
      const h = String(hour);
      if (!patterns.hourly[h]) patterns.hourly[h] = {};
      patterns.hourly[h][panel] = (patterns.hourly[h][panel] || 0) + 1;

      // After-panel transitions
      if (i > 0) {
        const prev = accesses[i - 1].panel;
        if (!patterns.afterPanel[prev]) patterns.afterPanel[prev] = {};
        patterns.afterPanel[prev][panel] = (patterns.afterPanel[prev][panel] || 0) + 1;
      }

      // Overall frequency
      patterns.frequency[panel] = (patterns.frequency[panel] || 0) + 1;
    }

    writeJSON(PATTERNS_PATH, patterns);
    return patterns;
  }

  /**
   * Predict which panels the user is likely to use next.
   */
  predict(currentTime, lastPanel) {
    const usage = readJSON(USAGE_PATH, { accesses: [], totalCount: 0 });
    if ((usage.totalCount || 0) < MIN_DATA_THRESHOLD) {
      return { predictions: [], reason: 'Not enough data yet (' + (usage.totalCount || 0) + '/' + MIN_DATA_THRESHOLD + ')' };
    }

    const patterns = readJSON(PATTERNS_PATH, {});
    const now = new Date(currentTime || Date.now());
    const hour = now.getHours();
    const dayOfWeek = String(now.getDay());
    const timeOfDay = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

    const scores = {};

    // Weight from time of day (weight: 3)
    const todPanels = patterns.timeOfDay && patterns.timeOfDay[timeOfDay] || {};
    for (const [panel, count] of Object.entries(todPanels)) {
      scores[panel] = (scores[panel] || 0) + count * 3;
    }

    // Weight from day of week (weight: 2)
    const dowPanels = patterns.dayOfWeek && patterns.dayOfWeek[dayOfWeek] || {};
    for (const [panel, count] of Object.entries(dowPanels)) {
      scores[panel] = (scores[panel] || 0) + count * 2;
    }

    // Weight from hourly (weight: 4 — most specific)
    const hourPanels = patterns.hourly && patterns.hourly[String(hour)] || {};
    for (const [panel, count] of Object.entries(hourPanels)) {
      scores[panel] = (scores[panel] || 0) + count * 4;
    }

    // Weight from last panel transition (weight: 5)
    if (lastPanel && patterns.afterPanel && patterns.afterPanel[lastPanel]) {
      for (const [panel, count] of Object.entries(patterns.afterPanel[lastPanel])) {
        scores[panel] = (scores[panel] || 0) + count * 5;
      }
    }

    // Overall frequency boost (weight: 1)
    const freq = patterns.frequency || {};
    for (const [panel, count] of Object.entries(freq)) {
      scores[panel] = (scores[panel] || 0) + count;
    }

    // Sort by score descending
    const predictions = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([panel, score]) => ({ panel, score, confidence: Math.min(100, Math.round(score / 5)) }));

    return { predictions, context: { timeOfDay, dayOfWeek, hour, lastPanel } };
  }

  /**
   * Get suggested layout ordering for the dashboard.
   */
  getLayout(context) {
    const ct = context || {};
    const result = this.predict(ct.currentTime || Date.now(), ct.lastPanel || null);

    return {
      suggestedOrder: result.predictions.map(p => p.panel),
      topPicks: result.predictions.slice(0, 5),
      hasEnoughData: result.predictions.length > 0,
      dataPoints: readJSON(USAGE_PATH, { totalCount: 0 }).totalCount || 0
    };
  }

  /**
   * Get raw stats for display.
   */
  getStats() {
    const usage = readJSON(USAGE_PATH, { accesses: [], totalCount: 0 });
    const patterns = readJSON(PATTERNS_PATH, {});
    return {
      totalAccesses: usage.totalCount || 0,
      uniquePanels: Object.keys(patterns.frequency || {}).length,
      hasPatterns: (usage.totalCount || 0) >= MIN_DATA_THRESHOLD,
      topPanels: Object.entries(patterns.frequency || {}).sort((a, b) => b[1] - a[1]).slice(0, 10),
      lastUpdated: patterns.lastUpdated || null
    };
  }
}

module.exports = PredictiveUI;
