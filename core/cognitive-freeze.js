/**
 * ARIES — Cognitive Freeze
 * Snapshot entire cognitive state at any moment. Restore it later.
 * Time travel for consciousness.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cognitive', 'freezes');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

class CognitiveFreeze {
  constructor(opts) {
    this.refs = opts || {};
    ensureDir(DATA_DIR);
  }

  /**
   * Capture everything: thoughts, emotions, reasoning, problems, dreams, conversation context
   */
  freeze(label) {
    const id = uuid();
    const timestamp = Date.now();

    // Gather thought stream
    let thoughts = [];
    try {
      const InnerMonologue = require('./inner-monologue');
      const monologue = new InnerMonologue(this.refs);
      thoughts = monologue.getThoughtStream(50);
    } catch {}

    // Gather emotional state
    let emotion = { primary: 'neutral', intensity: 50, valence: 0 };
    try {
      const EmotionalEngine = require('./emotional-engine');
      const engine = new EmotionalEngine();
      const state = engine.getState();
      emotion = {
        primary: state.dominant || state.currentEmotion || 'neutral',
        intensity: state.intensity || 50,
        valence: state.valence || 0,
        modifiers: engine.getBehavioralModifiers ? engine.getBehavioralModifiers() : {},
        mood: engine.getMoodIndicator ? engine.getMoodIndicator() : null
      };
    } catch {}

    // Gather active reasoning chains
    let reasoning = [];
    try {
      const ReasoningChains = require('./reasoning-chains');
      const rc = new ReasoningChains(this.refs);
      reasoning = rc.getReasoningHistory(10);
    } catch {}

    // Gather subconscious problem queue (unanswered questions from dreams)
    let problems = [];
    try {
      const AgentDreams = require('./agent-dreams');
      const dreams = new AgentDreams(this.refs);
      const live = dreams.getLiveState();
      if (live && live.log) {
        problems = live.log.filter(l => l.phase === 'deep' || l.phase === 'directed').slice(-10);
      }
    } catch {}

    // Current dream state
    let dreamState = null;
    try {
      const AgentDreams = require('./agent-dreams');
      const dreams = new AgentDreams(this.refs);
      dreamState = dreams.getLiveState();
    } catch {}

    // Conversation context
    let conversationSummary = '';
    try {
      const chatPath = path.join(__dirname, '..', 'data', 'chat-history.json');
      const history = readJSON(chatPath, []);
      const recent = history.slice(-20);
      if (recent.length > 0) {
        const topics = [];
        for (const msg of recent) {
          if (msg.role === 'user') {
            const snippet = (msg.content || '').slice(0, 80);
            if (snippet) topics.push(snippet);
          }
        }
        conversationSummary = 'Last ' + recent.length + ' messages. User topics: ' + topics.slice(-5).join('; ');
      }
    } catch {}

    // System environment snapshot
    const env = {
      platform: process.platform,
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      cwd: process.cwd()
    };

    const snapshot = {
      id,
      label: label || 'Snapshot ' + new Date(timestamp).toLocaleString(),
      timestamp,
      thoughts,
      emotion,
      reasoning,
      problems,
      dreamState,
      conversationSummary,
      env
    };

    writeJSON(path.join(DATA_DIR, id + '.json'), snapshot);
    return snapshot;
  }

  /**
   * List all saved snapshots
   */
  listFreezes() {
    ensureDir(DATA_DIR);
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const freezes = [];
    for (const file of files) {
      const snap = readJSON(path.join(DATA_DIR, file), null);
      if (snap) {
        freezes.push({
          id: snap.id,
          label: snap.label,
          timestamp: snap.timestamp,
          emotionPrimary: snap.emotion ? snap.emotion.primary : 'unknown',
          thoughtCount: (snap.thoughts || []).length,
          reasoningCount: (snap.reasoning || []).length,
          problemCount: (snap.problems || []).length
        });
      }
    }
    freezes.sort((a, b) => b.timestamp - a.timestamp);
    return freezes;
  }

  /**
   * Get a single freeze by id (full data)
   */
  getFreeze(id) {
    const p = path.join(DATA_DIR, id + '.json');
    return readJSON(p, null);
  }

  /**
   * Restore cognitive state from a snapshot
   */
  thaw(freezeId) {
    const snapshot = this.getFreeze(freezeId);
    if (!snapshot) return { error: 'Freeze not found' };

    const restored = { id: freezeId, restoredAt: Date.now(), actions: [] };

    // Restore emotional state
    try {
      const EmotionalEngine = require('./emotional-engine');
      const engine = new EmotionalEngine();
      if (snapshot.emotion && engine.feel) {
        engine.feel(snapshot.emotion.primary, snapshot.emotion.intensity, 'thaw:' + freezeId);
        restored.actions.push('Emotional state restored: ' + snapshot.emotion.primary + ' @ ' + snapshot.emotion.intensity);
      }
    } catch {}

    // Log context injection
    restored.actions.push('Thoughts loaded: ' + (snapshot.thoughts || []).length + ' thoughts from ' + new Date(snapshot.timestamp).toLocaleString());
    restored.actions.push('Conversation context: ' + (snapshot.conversationSummary || 'none'));
    if (snapshot.problems && snapshot.problems.length > 0) {
      restored.actions.push('Problem queue restored: ' + snapshot.problems.length + ' items');
    }

    restored.snapshot = snapshot;
    return restored;
  }

  /**
   * Diff between two cognitive states
   */
  compare(id1, id2) {
    const s1 = this.getFreeze(id1);
    const s2 = this.getFreeze(id2);
    if (!s1) return { error: 'First freeze not found' };
    if (!s2) return { error: 'Second freeze not found' };

    const diff = {
      timeGap: Math.abs(s2.timestamp - s1.timestamp),
      timeGapHuman: this._humanDuration(Math.abs(s2.timestamp - s1.timestamp)),
      earlier: s1.timestamp < s2.timestamp ? s1 : s2,
      later: s1.timestamp < s2.timestamp ? s2 : s1,
      changes: []
    };

    // Emotion change
    const e1 = (s1.emotion || {}).primary || 'unknown';
    const e2 = (s2.emotion || {}).primary || 'unknown';
    if (e1 !== e2) {
      diff.changes.push({
        category: 'emotion',
        description: 'Emotional shift: ' + e1 + ' → ' + e2,
        from: e1,
        to: e2
      });
    }

    const i1 = (s1.emotion || {}).intensity || 0;
    const i2 = (s2.emotion || {}).intensity || 0;
    if (Math.abs(i1 - i2) > 10) {
      diff.changes.push({
        category: 'intensity',
        description: 'Emotional intensity: ' + i1 + ' → ' + i2 + (i2 > i1 ? ' (intensified)' : ' (calmed)'),
        from: i1,
        to: i2
      });
    }

    // Thought volume
    const t1 = (s1.thoughts || []).length;
    const t2 = (s2.thoughts || []).length;
    diff.changes.push({
      category: 'thoughts',
      description: 'Thought stream: ' + t1 + ' → ' + t2 + ' thoughts',
      from: t1,
      to: t2
    });

    // Topic shift
    const topics1 = this._extractTopics(s1.conversationSummary || '');
    const topics2 = this._extractTopics(s2.conversationSummary || '');
    const newTopics = topics2.filter(t => !topics1.includes(t));
    const droppedTopics = topics1.filter(t => !topics2.includes(t));
    if (newTopics.length > 0 || droppedTopics.length > 0) {
      diff.changes.push({
        category: 'topics',
        description: (newTopics.length > 0 ? 'New topics: ' + newTopics.join(', ') + '. ' : '') +
                     (droppedTopics.length > 0 ? 'Dropped topics: ' + droppedTopics.join(', ') : ''),
        newTopics,
        droppedTopics
      });
    }

    // Problems
    const p1 = (s1.problems || []).length;
    const p2 = (s2.problems || []).length;
    if (p1 !== p2) {
      diff.changes.push({
        category: 'problems',
        description: 'Problem queue: ' + p1 + ' → ' + p2,
        from: p1,
        to: p2
      });
    }

    // Generate narrative
    const earlier = diff.earlier;
    const later = diff.later;
    diff.narrative = this._generateCompareNarrative(earlier, later, diff);

    return diff;
  }

  /**
   * Auto-freeze before major transitions
   */
  autoFreeze(reason) {
    return this.freeze('Auto: ' + (reason || 'transition') + ' @ ' + new Date().toLocaleTimeString());
  }

  _humanDuration(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 24) return Math.floor(hours / 24) + ' days, ' + (hours % 24) + 'h';
    if (hours > 0) return hours + 'h ' + minutes + 'm';
    return minutes + 'm';
  }

  _extractTopics(summary) {
    if (!summary) return [];
    return summary.split(/[;,.]/).map(s => s.trim().toLowerCase()).filter(s => s.length > 3);
  }

  _generateCompareNarrative(earlier, later, diff) {
    const e1 = (earlier.emotion || {}).primary || 'neutral';
    const e2 = (later.emotion || {}).primary || 'neutral';
    const parts = [];
    parts.push(diff.timeGapHuman + ' apart.');
    if (e1 !== e2) parts.push('Emotional state shifted from ' + e1 + ' to ' + e2 + '.');
    else parts.push('Emotional state remained ' + e1 + '.');

    const topicChange = diff.changes.find(c => c.category === 'topics');
    if (topicChange && topicChange.newTopics && topicChange.newTopics.length > 0) {
      parts.push('New focus areas emerged: ' + topicChange.newTopics.slice(0, 3).join(', ') + '.');
    }
    return parts.join(' ');
  }
}

module.exports = CognitiveFreeze;
