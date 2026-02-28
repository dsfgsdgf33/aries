/**
 * ARIES — Strategic Forgetting
 * Intentionally forget things to approach problems fresh.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'forgetting');
const SUPPRESSED_PATH = path.join(DATA_DIR, 'suppressed.json');
const LOG_PATH = path.join(DATA_DIR, 'log.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class StrategicForgetting {
  constructor() {
    ensureDir();
  }

  forget(topic, duration, reason) {
    const suppressed = readJSON(SUPPRESSED_PATH, []);
    const entry = {
      id: uuid(),
      topic: topic,
      reason: reason || 'manual',
      suppressedAt: Date.now(),
      duration: duration || null, // ms, null = indefinite
      memoriesAffected: this._countRelatedMemories(topic),
      restored: false,
      resultedIn: null,
    };
    suppressed.push(entry);
    writeJSON(SUPPRESSED_PATH, suppressed);

    const log = readJSON(LOG_PATH, []);
    log.push({ action: 'forget', ...entry });
    if (log.length > 500) log.splice(0, log.length - 500);
    writeJSON(LOG_PATH, log);

    return entry;
  }

  getForgotten() {
    const suppressed = readJSON(SUPPRESSED_PATH, []);
    const now = Date.now();
    // Auto-expire timed suppressions
    let changed = false;
    for (const s of suppressed) {
      if (!s.restored && s.duration && (now - s.suppressedAt) > s.duration) {
        s.restored = true;
        s.restoredAt = now;
        s.restoredBy = 'auto-expire';
        changed = true;
      }
    }
    if (changed) writeJSON(SUPPRESSED_PATH, suppressed);
    return suppressed.filter(s => !s.restored);
  }

  remember(topic) {
    const suppressed = readJSON(SUPPRESSED_PATH, []);
    const entry = suppressed.find(s => !s.restored && s.topic.toLowerCase() === topic.toLowerCase());
    if (!entry) return { error: 'Topic not found in suppressed list' };
    entry.restored = true;
    entry.restoredAt = Date.now();
    entry.restoredBy = 'manual';
    writeJSON(SUPPRESSED_PATH, suppressed);

    const log = readJSON(LOG_PATH, []);
    log.push({ action: 'remember', id: entry.id, topic, at: Date.now() });
    writeJSON(LOG_PATH, log);

    return entry;
  }

  autoForget() {
    // Detect repeated failures on the same approach by scanning log
    const log = readJSON(LOG_PATH, []);
    const suggestions = [];
    const topicFailures = {};

    for (const entry of log) {
      if (entry.resultedIn === 'worse' || entry.resultedIn === 'same') {
        topicFailures[entry.topic] = (topicFailures[entry.topic] || 0) + 1;
      }
    }

    // Suggest forgetting topics with repeated failures
    for (const [topic, count] of Object.entries(topicFailures)) {
      if (count >= 2) {
        const alreadySuppressed = this.getForgotten().some(s => s.topic.toLowerCase() === topic.toLowerCase());
        if (!alreadySuppressed) {
          suggestions.push({
            topic,
            failureCount: count,
            suggestion: 'Consider forgetting "' + topic + '" — ' + count + ' repeated failures suggest preconceptions may be hurting.',
          });
        }
      }
    }

    return { suggestions };
  }

  recordOutcome(id, resultedIn) {
    const suppressed = readJSON(SUPPRESSED_PATH, []);
    const entry = suppressed.find(s => s.id === id);
    if (!entry) return { error: 'Entry not found' };
    entry.resultedIn = resultedIn; // 'better', 'worse', 'same'
    writeJSON(SUPPRESSED_PATH, suppressed);
    return entry;
  }

  getEffectiveness() {
    const suppressed = readJSON(SUPPRESSED_PATH, []);
    const rated = suppressed.filter(s => s.resultedIn);
    const counts = { better: 0, worse: 0, same: 0 };
    rated.forEach(s => counts[s.resultedIn]++);
    const total = rated.length;
    return {
      total,
      ...counts,
      successRate: total > 0 ? Math.round((counts.better / total) * 100) : null,
      verdict: total < 3 ? 'insufficient_data' : counts.better > counts.worse ? 'forgetting_helps' : counts.worse > counts.better ? 'forgetting_hurts' : 'neutral',
    };
  }

  getLog(limit) {
    const log = readJSON(LOG_PATH, []);
    return log.slice(-(limit || 50)).reverse();
  }

  _countRelatedMemories(topic) {
    // Heuristic: count data files that mention the topic
    try {
      const memDir = path.join(__dirname, '..', 'data');
      if (!fs.existsSync(memDir)) return 0;
      let count = 0;
      const topicLower = topic.toLowerCase();
      const files = fs.readdirSync(memDir).filter(f => f.endsWith('.json')).slice(0, 20);
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(memDir, file), 'utf8').toLowerCase();
          if (content.includes(topicLower)) count++;
        } catch {}
      }
      return count;
    } catch { return 0; }
  }
}

module.exports = StrategicForgetting;
