/**
 * ARIES — Ambient Mode
 * Background process that monitors user activity and offers contextual suggestions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'ambient');
const SUGGESTIONS_PATH = path.join(DATA_DIR, 'suggestions.json');
const WORKSPACE = path.join(__dirname, '..', '..');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const SUGGESTION_TYPES = {
  CODE_HELP: { icon: '💻', label: 'Code Help', color: '#06b6d4' },
  RESEARCH: { icon: '🔍', label: 'Research', color: '#22c55e' },
  REMINDER: { icon: '⏰', label: 'Reminder', color: '#eab308' },
  INSIGHT: { icon: '💡', label: 'Insight', color: '#a78bfa' },
};

const RELEVANCE_THRESHOLD = 70;

class AmbientMode {
  constructor() {
    ensureDir();
    this._monitoring = false;
    this._watchers = [];
    this._recentActivity = [];
    this._dismissedPatterns = [];
  }

  /**
   * Start monitoring user activity.
   */
  startMonitoring() {
    if (this._monitoring) return { status: 'already_monitoring' };
    this._monitoring = true;

    // Watch workspace for file changes
    try {
      const watcher = fs.watch(WORKSPACE, { recursive: false }, (eventType, filename) => {
        if (filename) {
          this._onFileChange(eventType, filename);
        }
      });
      this._watchers.push(watcher);
    } catch (e) {
      // fs.watch may not support recursive on all platforms
    }

    return { status: 'monitoring_started', timestamp: Date.now() };
  }

  /**
   * Stop monitoring.
   */
  stopMonitoring() {
    this._monitoring = false;
    for (const w of this._watchers) {
      try { w.close(); } catch {}
    }
    this._watchers = [];
    return { status: 'monitoring_stopped' };
  }

  /**
   * Handle file change events.
   */
  _onFileChange(eventType, filename) {
    const ext = path.extname(filename || '').toLowerCase();
    const codeExts = ['.js', '.ts', '.py', '.java', '.cpp', '.c', '.go', '.rs', '.html', '.css'];

    if (codeExts.includes(ext)) {
      this._addActivity({ type: 'file_change', file: filename, ext, timestamp: Date.now() });

      // Generate code help suggestion
      const suggestion = this.contextualSuggestion({
        type: 'coding',
        file: filename,
        ext,
        detail: 'Detected changes to ' + filename
      });
      if (suggestion) this._storeSuggestion(suggestion);
    }
  }

  _addActivity(activity) {
    this._recentActivity.push(activity);
    if (this._recentActivity.length > 100) {
      this._recentActivity = this._recentActivity.slice(-50);
    }
  }

  /**
   * Generate a contextual suggestion based on activity.
   */
  contextualSuggestion(activity) {
    if (!activity) return null;

    let type, content, relevance, context;

    switch (activity.type) {
      case 'coding':
        type = 'CODE_HELP';
        content = this._generateCodeSuggestion(activity);
        relevance = 75;
        context = 'Editing ' + (activity.file || 'code');
        break;

      case 'browsing':
        type = 'RESEARCH';
        content = this._generateResearchSuggestion(activity);
        relevance = 72;
        context = 'Browsing ' + (activity.url || 'web');
        break;

      case 'time_trigger':
        type = 'REMINDER';
        content = activity.reminder || 'Time-based reminder';
        relevance = 80;
        context = 'Scheduled';
        break;

      case 'connection':
        type = 'INSIGHT';
        content = activity.insight || 'Connected dots between recent activities';
        relevance = 85;
        context = 'Pattern detected';
        break;

      default:
        return null;
    }

    if (relevance < RELEVANCE_THRESHOLD) return null;

    // Check if similar suggestion was dismissed recently
    if (this._wasDismissedRecently(type, content)) {
      return null;
    }

    return {
      id: uuid(),
      type,
      content,
      relevance,
      context,
      timestamp: Date.now(),
      dismissed: false,
      acted: false,
      ...SUGGESTION_TYPES[type]
    };
  }

  _generateCodeSuggestion(activity) {
    const ext = activity.ext || '';
    const file = activity.file || 'file';
    const suggestions = [
      `You're working on ${file}. Remember to add error handling for edge cases.`,
      `Tip: Consider writing a quick test for the changes in ${file}.`,
      `${file} modified — want me to review the changes for potential issues?`,
      `Detected activity in ${file}. Need help with documentation?`,
    ];
    return suggestions[Math.floor(Math.random() * suggestions.length)];
  }

  _generateResearchSuggestion(activity) {
    return `You seem to be researching "${activity.topic || 'something'}". Want me to compile findings into a knowledge wiki entry?`;
  }

  _wasDismissedRecently(type, content) {
    const suggestions = readJSON(SUGGESTIONS_PATH, []);
    const oneHourAgo = Date.now() - 3600000;
    return suggestions.some(s =>
      s.type === type &&
      s.dismissed &&
      s.timestamp > oneHourAgo &&
      s.content.slice(0, 50) === content.slice(0, 50)
    );
  }

  _storeSuggestion(suggestion) {
    const suggestions = readJSON(SUGGESTIONS_PATH, []);
    suggestions.push(suggestion);
    // Keep last 200
    if (suggestions.length > 200) suggestions.splice(0, suggestions.length - 200);
    writeJSON(SUGGESTIONS_PATH, suggestions);
    return suggestion;
  }

  /**
   * Create and store a manual suggestion.
   */
  addSuggestion(type, content, relevance, context) {
    const typeInfo = SUGGESTION_TYPES[type] || SUGGESTION_TYPES.INSIGHT;
    const suggestion = {
      id: uuid(),
      type: type || 'INSIGHT',
      content,
      relevance: relevance || 75,
      context: context || 'Manual',
      timestamp: Date.now(),
      dismissed: false,
      acted: false,
      ...typeInfo
    };

    if (suggestion.relevance >= RELEVANCE_THRESHOLD) {
      this._storeSuggestion(suggestion);
    }
    return suggestion;
  }

  /**
   * Dismiss a suggestion.
   */
  dismiss(id) {
    const suggestions = readJSON(SUGGESTIONS_PATH, []);
    const s = suggestions.find(x => x.id === id);
    if (!s) return { error: 'Suggestion not found' };
    s.dismissed = true;
    s.dismissedAt = Date.now();
    writeJSON(SUGGESTIONS_PATH, suggestions);
    return s;
  }

  /**
   * Act on a suggestion (user clicked it).
   */
  act(id) {
    const suggestions = readJSON(SUGGESTIONS_PATH, []);
    const s = suggestions.find(x => x.id === id);
    if (!s) return { error: 'Suggestion not found' };
    s.acted = true;
    s.actedAt = Date.now();
    writeJSON(SUGGESTIONS_PATH, suggestions);
    return s;
  }

  /**
   * Get current ambient state.
   */
  getAmbientState() {
    const suggestions = readJSON(SUGGESTIONS_PATH, []);
    const active = suggestions.filter(s => !s.dismissed && !s.acted);
    const recent = active.filter(s => Date.now() - s.timestamp < 86400000); // last 24h

    return {
      monitoring: this._monitoring,
      activeSuggestions: recent.length,
      suggestions: recent.slice(-10).reverse(),
      recentActivity: this._recentActivity.slice(-20),
      stats: {
        total: suggestions.length,
        dismissed: suggestions.filter(s => s.dismissed).length,
        acted: suggestions.filter(s => s.acted).length,
        active: recent.length,
      }
    };
  }

  /**
   * Get all suggestions (with optional filters).
   */
  getSuggestions(filter) {
    const suggestions = readJSON(SUGGESTIONS_PATH, []);
    if (!filter) return suggestions.slice(-50).reverse();

    return suggestions.filter(s => {
      if (filter.type && s.type !== filter.type) return false;
      if (filter.active && (s.dismissed || s.acted)) return false;
      return true;
    }).slice(-50).reverse();
  }
}

module.exports = AmbientMode;
