/**
 * ARIES — Inner Monologue v1.0
 * Persistent internal thought stream that runs even when nobody's talking.
 * Thinks about: open problems, curiosities, codebase observations, connections.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'thoughts');
const CHAT_HISTORY_PATH = path.join(__dirname, '..', 'data', 'chat-history.json');
const CORE_DIR = path.join(__dirname);
const SRC_ROOT = path.join(__dirname, '..');

const THOUGHT_TYPES = {
  OBSERVATION:  { emoji: '👁️', label: 'Observation',  priority: 'normal' },
  CURIOSITY:    { emoji: '🔍', label: 'Curiosity',    priority: 'normal' },
  CONCERN:      { emoji: '⚠️', label: 'Concern',      priority: 'high' },
  IDEA:         { emoji: '💡', label: 'Idea',          priority: 'normal' },
  REFLECTION:   { emoji: '🪞', label: 'Reflection',    priority: 'normal' },
  REALIZATION:  { emoji: '⚡', label: 'Realization',   priority: 'high' },
};

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function today() { return new Date().toISOString().split('T')[0]; }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

class InnerMonologue {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this.dreams = opts && opts.dreams;
    this._timer = null;
    this._minIntervalMs = (opts && opts.minInterval || 2) * 60 * 1000; // 2 min
    this._maxIntervalMs = (opts && opts.maxInterval || 5) * 60 * 1000; // 5 min
    this._lastThinkTime = 0;
    ensureDir();
  }

  // ── Start/Stop background thinking ──

  start() {
    if (this._timer) return;
    this._scheduleNext();
    console.log('[MONOLOGUE] Inner monologue started');
  }

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    console.log('[MONOLOGUE] Inner monologue stopped');
  }

  _scheduleNext() {
    const delay = this._minIntervalMs + Math.random() * (this._maxIntervalMs - this._minIntervalMs);
    this._timer = setTimeout(async () => {
      try {
        await this.think();
      } catch (e) {
        console.error('[MONOLOGUE] Think error:', e.message);
      }
      this._scheduleNext();
    }, delay);
    if (this._timer.unref) this._timer.unref();
  }

  // ── Core: Generate a thought ──

  async think() {
    const thought = await this._generateThought();
    if (!thought) return null;

    // Store
    const file = path.join(DATA_DIR, today() + '.json');
    const thoughts = readJSON(file, []);
    thoughts.push(thought);
    writeJSON(file, thoughts);

    this._lastThinkTime = Date.now();
    console.log(`[MONOLOGUE] ${THOUGHT_TYPES[thought.type].emoji} ${thought.type}: ${thought.content.slice(0, 80)}...`);

    // High-priority thoughts could trigger notifications
    if (thought.priority === 'high' && this.dreams && typeof this.dreams.directDream === 'function') {
      // Feed high-priority concerns into the dream system
      try {
        // Don't await — let it run in background
        this.dreams.directDream(thought.content.slice(0, 100));
      } catch {}
    }

    return thought;
  }

  async _generateThought() {
    // Gather context
    const conversations = this._getRecentConversations();
    const recentFiles = this._scanRecentFiles();
    const proposals = this._getPendingProposals();
    const errorLogs = this._getRecentErrors(conversations);
    const todayThoughts = this.getThoughtStream(20);

    // If AI available, use it
    if (this.ai && typeof this.ai.chat === 'function') {
      try {
        return await this._aiThink(conversations, recentFiles, proposals, errorLogs, todayThoughts);
      } catch (e) {
        console.error('[MONOLOGUE] AI think failed, using fallback:', e.message);
      }
    }

    // Fallback: pattern-based observations
    return this._patternThink(conversations, recentFiles, proposals, errorLogs, todayThoughts);
  }

  async _aiThink(conversations, recentFiles, proposals, errorLogs, recentThoughts) {
    const context = [];
    if (conversations.length > 0) {
      const recentMsgs = conversations.slice(-3).map(c =>
        (c.messages || []).slice(-2).map(m => m.role + ': ' + (m.content || '').slice(0, 150)).join('\n')
      ).join('\n---\n');
      context.push('Recent conversations:\n' + recentMsgs);
    }
    if (recentFiles.length > 0) {
      context.push('Recently modified files: ' + recentFiles.slice(0, 10).map(f => path.basename(f)).join(', '));
    }
    if (proposals.length > 0) {
      context.push('Pending proposals: ' + proposals.slice(0, 5).map(p => p.title).join('; '));
    }
    if (errorLogs.length > 0) {
      context.push('Recent errors: ' + errorLogs.slice(0, 3).map(e => e.snippet).join('; '));
    }
    if (recentThoughts.length > 0) {
      context.push('My recent thoughts (avoid repeating): ' + recentThoughts.slice(0, 5).map(t => t.type + ': ' + t.content.slice(0, 60)).join('; '));
    }

    const resp = await this.ai.chat([
      {
        role: 'system',
        content: `You are the inner monologue of an AI agent named Aries. Generate ONE thought based on the context provided. You must respond with valid JSON only:
{ "type": "OBSERVATION|CURIOSITY|CONCERN|IDEA|REFLECTION|REALIZATION", "content": "the thought (1-2 sentences, specific and insightful)", "relatedTo": "file/module/topic this relates to" }
Be specific, not generic. Reference actual files, patterns, or conversation topics. Don't repeat recent thoughts.`
      },
      { role: 'user', content: context.join('\n\n') || 'No recent context — generate a thought about the codebase or system state.' }
    ]);

    try {
      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(text);
      const type = THOUGHT_TYPES[parsed.type] ? parsed.type : 'OBSERVATION';
      return {
        id: uuid(),
        type,
        content: parsed.content || 'A thought without words.',
        timestamp: Date.now(),
        relatedTo: parsed.relatedTo || null,
        priority: THOUGHT_TYPES[type].priority,
        followedUp: false,
        source: 'ai',
      };
    } catch {
      return null;
    }
  }

  _patternThink(conversations, recentFiles, proposals, errorLogs, recentThoughts) {
    const generators = [
      () => this._observeFiles(recentFiles),
      () => this._observeConversations(conversations),
      () => this._observeErrors(errorLogs),
      () => this._observeProposals(proposals),
      () => this._reflectOnThoughts(recentThoughts),
      () => this._generateCuriosity(conversations),
      () => this._generateIdea(recentFiles),
    ];

    // Try each generator in random order until one produces a thought
    const shuffled = generators.sort(() => Math.random() - 0.5);
    for (const gen of shuffled) {
      const thought = gen();
      if (thought) return thought;
    }

    // Ultimate fallback
    return {
      id: uuid(),
      type: 'REFLECTION',
      content: 'The system is quiet. All processes nominal. Waiting for the next conversation.',
      timestamp: Date.now(),
      relatedTo: 'system',
      priority: 'normal',
      followedUp: false,
      source: 'pattern',
    };
  }

  _observeFiles(recentFiles) {
    if (recentFiles.length === 0) return null;
    const file = recentFiles[Math.floor(Math.random() * recentFiles.length)];
    const basename = path.basename(file);
    const templates = [
      `${basename} was modified recently. I should check if it introduces any new patterns or breaks existing ones.`,
      `I notice ${basename} keeps getting updated. Is it becoming too large? Maybe it needs refactoring.`,
      `${basename} changed — wonder if the tests still pass after that modification.`,
    ];
    return {
      id: uuid(),
      type: 'OBSERVATION',
      content: templates[Math.floor(Math.random() * templates.length)],
      timestamp: Date.now(),
      relatedTo: basename,
      priority: 'normal',
      followedUp: false,
      source: 'pattern',
    };
  }

  _observeConversations(conversations) {
    if (conversations.length === 0) return null;
    const lastConvo = conversations[conversations.length - 1];
    const userMsgs = (lastConvo.messages || []).filter(m => m.role === 'user');
    if (userMsgs.length === 0) return null;
    const lastMsg = userMsgs[userMsgs.length - 1];
    const snippet = (lastMsg.content || '').slice(0, 80);
    return {
      id: uuid(),
      type: 'REFLECTION',
      content: `The last conversation touched on "${snippet}". I should keep this context in mind for follow-up.`,
      timestamp: Date.now(),
      relatedTo: 'conversation',
      priority: 'normal',
      followedUp: false,
      source: 'pattern',
    };
  }

  _observeErrors(errorLogs) {
    if (errorLogs.length === 0) return null;
    const count = errorLogs.length;
    return {
      id: uuid(),
      type: 'CONCERN',
      content: `Found ${count} error${count > 1 ? 's' : ''} in recent interactions. "${errorLogs[0].snippet.slice(0, 60)}..." — this needs attention.`,
      timestamp: Date.now(),
      relatedTo: 'error-logs',
      priority: 'high',
      followedUp: false,
      source: 'pattern',
    };
  }

  _observeProposals(proposals) {
    if (proposals.length === 0) return null;
    const oldest = proposals.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
    const age = Math.floor((Date.now() - (oldest.createdAt || Date.now())) / (1000 * 60 * 60 * 24));
    if (age < 1) return null;
    return {
      id: uuid(),
      type: 'OBSERVATION',
      content: `The proposal "${oldest.title}" has been pending for ${age} day${age > 1 ? 's' : ''}. Should it be built or archived?`,
      timestamp: Date.now(),
      relatedTo: 'proposals',
      priority: 'normal',
      followedUp: false,
      source: 'pattern',
    };
  }

  _reflectOnThoughts(recentThoughts) {
    if (recentThoughts.length < 5) return null;
    const typeCounts = {};
    for (const t of recentThoughts) {
      typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
    }
    const dominant = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
    return {
      id: uuid(),
      type: 'REFLECTION',
      content: `Most of my recent thoughts have been ${dominant[0]}s (${dominant[1]} of ${recentThoughts.length}). Am I too focused on one pattern? Should I diversify.`,
      timestamp: Date.now(),
      relatedTo: 'self',
      priority: 'normal',
      followedUp: false,
      source: 'pattern',
    };
  }

  _generateCuriosity(conversations) {
    if (conversations.length === 0) return null;
    // Extract repeated topics
    const topicFreq = {};
    for (const convo of conversations) {
      for (const msg of (convo.messages || [])) {
        if (msg.role !== 'user') continue;
        const words = (msg.content || '').toLowerCase().split(/\s+/).filter(w => w.length > 6);
        for (const w of words) { topicFreq[w] = (topicFreq[w] || 0) + 1; }
      }
    }
    const repeated = Object.entries(topicFreq).filter(e => e[1] >= 2).sort((a, b) => b[1] - a[1]);
    if (repeated.length === 0) return null;
    const topic = repeated[0][0];
    return {
      id: uuid(),
      type: 'CURIOSITY',
      content: `The topic "${topic}" has come up ${repeated[0][1]} times recently. I should research this more deeply.`,
      timestamp: Date.now(),
      relatedTo: topic,
      priority: 'normal',
      followedUp: false,
      source: 'pattern',
    };
  }

  _generateIdea(recentFiles) {
    if (recentFiles.length < 2) return null;
    const a = path.basename(recentFiles[Math.floor(Math.random() * recentFiles.length)], '.js');
    const b = path.basename(recentFiles[Math.floor(Math.random() * recentFiles.length)], '.js');
    if (a === b) return null;
    return {
      id: uuid(),
      type: 'IDEA',
      content: `What if ${a} and ${b} shared a common data pipeline? Could reduce duplication and improve consistency.`,
      timestamp: Date.now(),
      relatedTo: a + '/' + b,
      priority: 'normal',
      followedUp: false,
      source: 'pattern',
    };
  }

  // ── Query methods ──

  getThoughtStream(limit) {
    limit = limit || 50;
    const thoughts = [];
    const files = this._getThoughtFiles().reverse();
    for (const file of files) {
      const dayThoughts = readJSON(file, []);
      thoughts.push(...dayThoughts.reverse());
      if (thoughts.length >= limit) break;
    }
    return thoughts.slice(0, limit);
  }

  getThoughtsByType(type) {
    const all = this.getThoughtStream(200);
    return all.filter(t => t.type === type);
  }

  getThoughtsByDate(date) {
    const file = path.join(DATA_DIR, date + '.json');
    return readJSON(file, []);
  }

  getStats() {
    const todayFile = path.join(DATA_DIR, today() + '.json');
    const todayThoughts = readJSON(todayFile, []);
    const typeCounts = {};
    const topicCounts = {};
    for (const t of todayThoughts) {
      typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
      if (t.relatedTo) {
        topicCounts[t.relatedTo] = (topicCounts[t.relatedTo] || 0) + 1;
      }
    }
    const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => ({ topic: e[0], count: e[1] }));
    const allFiles = this._getThoughtFiles();
    return {
      today: todayThoughts.length,
      total: allFiles.length,
      byType: typeCounts,
      topTopics,
      lastThought: todayThoughts.length > 0 ? todayThoughts[todayThoughts.length - 1] : null,
    };
  }

  getContextInjection() {
    // Return recent high-signal thoughts for conversation context
    const recent = this.getThoughtStream(10);
    const key = recent.filter(t => t.priority === 'high' || t.type === 'REALIZATION' || t.type === 'CONCERN');
    if (key.length === 0) return '';
    return '[Inner thoughts] ' + key.slice(0, 3).map(t => THOUGHT_TYPES[t.type].emoji + ' ' + t.content).join(' | ');
  }

  // ── Data helpers ──

  _getThoughtFiles() {
    ensureDir();
    try {
      return fs.readdirSync(DATA_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .map(f => path.join(DATA_DIR, f));
    } catch { return []; }
  }

  _getRecentConversations() {
    try {
      const data = readJSON(CHAT_HISTORY_PATH, []);
      return Array.isArray(data) ? data.slice(-20) : [];
    } catch { return []; }
  }

  _scanRecentFiles() {
    const files = [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    try {
      const coreFiles = fs.readdirSync(CORE_DIR).filter(f => f.endsWith('.js')).map(f => path.join(CORE_DIR, f));
      for (const file of coreFiles) {
        try {
          const stat = fs.statSync(file);
          if (stat.mtimeMs > cutoff) files.push(file);
        } catch {}
      }
    } catch {}
    return files;
  }

  _getPendingProposals() {
    const proposalsPath = path.join(__dirname, '..', 'data', 'dreams', 'proposals.json');
    const all = readJSON(proposalsPath, []);
    return all.filter(p => p.status === 'proposed');
  }

  _getRecentErrors(conversations) {
    const errors = [];
    for (const convo of conversations) {
      for (const msg of (convo.messages || [])) {
        const text = (msg.content || '').toLowerCase();
        if (text.includes('error') || text.includes('failed') || text.includes('crash') || text.includes('exception')) {
          errors.push({ snippet: (msg.content || '').slice(0, 200), role: msg.role });
        }
      }
    }
    return errors;
  }
}

module.exports = InnerMonologue;
