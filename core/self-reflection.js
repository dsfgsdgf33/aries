'use strict';

/**
 * @module self-reflection
 * @description Nightly self-reflection loop — Aries reviews its own day, collecting conversations,
 * tool usage, errors, and decisions, then generating insights that compound over time.
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'reflections');
const INSIGHTS_FILE = path.join(DATA_DIR, 'insights.json');

class SelfReflection extends EventEmitter {
  constructor() {
    super();
    this._loaded = false;
    this._insights = [];
    this._cronTimer = null;
  }

  async init() {
    if (this._loaded) return;
    this._loaded = true;
    await fs.promises.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
    await this._loadInsights();
  }

  async _loadInsights() {
    try {
      const raw = await fs.promises.readFile(INSIGHTS_FILE, 'utf8');
      this._insights = JSON.parse(raw);
    } catch {
      this._insights = [];
    }
  }

  async _saveInsights() {
    await fs.promises.writeFile(INSIGHTS_FILE, JSON.stringify(this._insights, null, 2), 'utf8');
  }

  _dateStr(date) {
    const d = date ? new Date(date) : new Date();
    return d.toISOString().split('T')[0];
  }

  _reflectionPath(dateStr) {
    return path.join(DATA_DIR, `${dateStr}.json`);
  }

  /**
   * Collect context for a given day from various sources.
   */
  async _collectContext(dateStr) {
    const context = { date: dateStr, conversations: [], toolUsage: [], errors: [], decisions: [], handOutputs: [] };

    // Try to read memory file for the day
    const memoryFile = path.join(__dirname, 'memory', `${dateStr}.md`);
    try {
      const content = await fs.promises.readFile(memoryFile, 'utf8');
      context.conversations.push({ source: 'daily-memory', content: content.slice(0, 5000) });
    } catch {}

    // Try to read pipeline history
    const pipelinesFile = path.join(__dirname, 'data', 'pipelines.json');
    try {
      const raw = await fs.promises.readFile(pipelinesFile, 'utf8');
      const data = JSON.parse(raw);
      if (data.history) {
        const todayRuns = data.history.filter(r => r.startedAt && r.startedAt.startsWith(dateStr));
        context.handOutputs = todayRuns.map(r => ({
          pipeline: r.pipelineName,
          status: r.status,
          steps: r.steps ? r.steps.length : 0,
          error: r.error || null,
        }));
      }
    } catch {}

    // Try to collect from data dir for any logs
    const dataDir = path.join(__dirname, 'data');
    try {
      const files = await fs.promises.readdir(dataDir);
      for (const f of files) {
        if (f.endsWith('.log')) {
          try {
            const logContent = await fs.promises.readFile(path.join(dataDir, f), 'utf8');
            const todayLines = logContent.split('\n').filter(l => l.includes(dateStr));
            if (todayLines.length > 0) {
              context.toolUsage.push({ source: f, entries: todayLines.slice(-50) });
            }
          } catch {}
        }
      }
    } catch {}

    return context;
  }

  /**
   * Run reflection for a given date.
   * @param {string} [date] - YYYY-MM-DD string, defaults to today
   * @param {Function} aiFunction - async (prompt, systemPrompt) => string. The AI call.
   */
  async reflect(date, aiFunction) {
    await this.init();
    const dateStr = this._dateStr(date);

    const context = await this._collectContext(dateStr);

    const systemPrompt = `You are Aries reflecting on your day. Be honest, specific, and actionable. Focus on patterns and improvements.`;
    const userPrompt = `Review your activity for ${dateStr} and answer:
1. What worked well today?
2. What failed or could have gone better?
3. What patterns do you notice?
4. What specific improvements should you make tomorrow?
5. Any new insights or lessons learned?

Today's context:
${JSON.stringify(context, null, 2)}

Previous top insights for reference:
${this._insights.slice(-5).map(i => `- ${i.text}`).join('\n') || '(none yet)'}`;

    let reflectionText = '';
    if (typeof aiFunction === 'function') {
      try {
        reflectionText = await aiFunction(userPrompt, systemPrompt);
      } catch (err) {
        reflectionText = `[AI reflection failed: ${err.message}] Manual review needed for ${dateStr}.`;
      }
    } else {
      reflectionText = `[No AI function provided] Context collected for ${dateStr}. ${context.conversations.length} conversations, ${context.handOutputs.length} hand outputs.`;
    }

    // Extract insights (simple: look for lines starting with - or numbered)
    const newInsights = [];
    const lines = reflectionText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if ((trimmed.startsWith('- ') || /^\d+\.\s/.test(trimmed)) && trimmed.length > 20 && trimmed.length < 300) {
        newInsights.push({
          text: trimmed.replace(/^[-\d.]\s*/, ''),
          date: dateStr,
          score: 1,
          id: `insight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
      }
    }

    // Merge new insights, boost recurring themes
    for (const ni of newInsights) {
      const existing = this._insights.find(i => this._similarity(i.text, ni.text) > 0.5);
      if (existing) {
        existing.score = (existing.score || 1) + 1;
        existing.lastSeen = dateStr;
      } else {
        this._insights.push(ni);
      }
    }

    // Cap insights at 100, keep highest scored
    this._insights.sort((a, b) => (b.score || 1) - (a.score || 1));
    this._insights = this._insights.slice(0, 100);

    const reflection = {
      date: dateStr,
      generatedAt: new Date().toISOString(),
      context: { conversationCount: context.conversations.length, handOutputCount: context.handOutputs.length, errorCount: context.errors.length },
      reflection: reflectionText,
      newInsights: newInsights.length,
    };

    await fs.promises.writeFile(this._reflectionPath(dateStr), JSON.stringify(reflection, null, 2), 'utf8');
    await this._saveInsights();

    this.emit('reflection-complete', { date: dateStr, insightsAdded: newInsights.length });
    return reflection;
  }

  /**
   * Simple word-overlap similarity between two strings.
   */
  _similarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) if (wordsB.has(w)) overlap++;
    return overlap / Math.max(wordsA.size, wordsB.size);
  }

  async getReflection(date) {
    await this.init();
    const dateStr = this._dateStr(date);
    try {
      const raw = await fs.promises.readFile(this._reflectionPath(dateStr), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Get top insights sorted by score.
   * @param {number} [limit=10]
   */
  async getInsights(limit = 10) {
    await this.init();
    return this._insights.slice(0, limit);
  }

  /**
   * Get top insights formatted for injection into system prompts.
   * @param {number} [n=5]
   */
  async getTopInsights(n = 5) {
    await this.init();
    const top = this._insights.slice(0, n);
    if (top.length === 0) return '';
    return `## Learned Insights\n${top.map(i => `- ${i.text} (confidence: ${i.score || 1})`).join('\n')}`;
  }

  /**
   * Calculate reflection streak (consecutive days with reflections).
   */
  async getStreak() {
    await this.init();
    let streak = 0;
    const now = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      try {
        await fs.promises.access(this._reflectionPath(dateStr));
        streak++;
      } catch {
        break;
      }
    }
    return streak;
  }

  /**
   * Alias for reflect() with today's date.
   */
  async triggerReflection(aiFunction) {
    return this.reflect(undefined, aiFunction);
  }

  /**
   * Start a nightly cron (checks every minute, triggers at specified hour).
   * @param {number} [hour=23] - Hour to trigger (0-23)
   * @param {Function} aiFunction
   */
  startNightlyCron(hour = 23, aiFunction) {
    if (this._cronTimer) return;
    let lastRun = null;
    this._cronTimer = setInterval(() => {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      if (now.getHours() === hour && now.getMinutes() === 0 && lastRun !== today) {
        lastRun = today;
        this.reflect(today, aiFunction).catch(err => {
          this.emit('reflection-error', { error: err.message });
        });
      }
    }, 60000);
  }

  stopNightlyCron() {
    if (this._cronTimer) {
      clearInterval(this._cronTimer);
      this._cronTimer = null;
    }
  }
}

let _instance = null;
function getInstance() {
  if (!_instance) _instance = new SelfReflection();
  return _instance;
}

module.exports = { SelfReflection, getInstance };
