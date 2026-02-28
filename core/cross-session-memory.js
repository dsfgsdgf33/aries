/**
 * ARIES - Cross-Session Memory
 * Store session summaries, load relevant context for new sessions
 */

const fs = require('fs');
const path = require('path');

const SUMMARIES_DIR = path.join(__dirname, '..', 'data', 'session-summaries');

class CrossSessionMemory {
  constructor(opts) {
    this.ai = opts && opts.ai;
    if (!fs.existsSync(SUMMARIES_DIR)) fs.mkdirSync(SUMMARIES_DIR, { recursive: true });
    this._currentSessionId = Date.now().toString(36);
    this._currentTopics = [];
  }

  async summarizeSession(messages) {
    if (!messages || messages.length === 0) return null;

    const summary = {
      id: this._currentSessionId,
      timestamp: Date.now(),
      date: new Date().toISOString(),
      messageCount: messages.length,
      topics: [],
      questions: [],
      tasksCompleted: [],
      unresolvedItems: [],
      textSummary: ''
    };

    // Extract topics/questions from user messages
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      const text = (msg.content || '').trim();
      if (!text) continue;

      // Detect questions
      if (text.includes('?') || /^(how|what|why|when|where|who|can|could|would|should|is|are|do|does)/i.test(text)) {
        summary.questions.push(text.slice(0, 150));
      }

      // Extract topic keywords (words > 4 chars, top frequency)
      const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 4 && !/^(about|there|their|these|those|which|would|could|should|really|because|through)$/.test(w));
      for (const w of words) {
        const clean = w.replace(/[^a-z]/g, '');
        if (clean.length > 4) summary.topics.push(clean);
      }
    }

    // Deduplicate topics, keep top 10
    const topicCounts = {};
    for (const t of summary.topics) topicCounts[t] = (topicCounts[t] || 0) + 1;
    summary.topics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);

    // AI-enhanced summary if available
    if (this.ai && typeof this.ai.chat === 'function' && messages.length > 2) {
      try {
        const snippet = messages.slice(-20).map(m => m.role + ': ' + (m.content || '').slice(0, 200)).join('\n');
        const result = await this.ai.chat([
          { role: 'system', content: 'Summarize this session in 2-3 sentences. Note: topics discussed, tasks completed, anything left unresolved. Be concise.' },
          { role: 'user', content: snippet }
        ]);
        summary.textSummary = (result.response || '').slice(0, 500);
      } catch (e) { summary.textSummary = 'Session with ' + messages.length + ' messages about ' + summary.topics.slice(0, 3).join(', '); }
    } else {
      summary.textSummary = 'Session with ' + messages.length + ' messages about ' + summary.topics.slice(0, 3).join(', ');
    }

    // Limit arrays
    summary.questions = summary.questions.slice(0, 10);

    // Save
    const filename = new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    fs.writeFileSync(path.join(SUMMARIES_DIR, filename), JSON.stringify(summary, null, 2));
    this._currentSessionId = Date.now().toString(36);
    console.log('[CROSS-SESSION] Session summarized:', filename);
    return summary;
  }

  getPreviousContext(currentMessage) {
    try {
      const files = fs.readdirSync(SUMMARIES_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 10);
      if (files.length === 0) return null;

      const summaries = [];
      for (const f of files) {
        try {
          summaries.push(JSON.parse(fs.readFileSync(path.join(SUMMARIES_DIR, f), 'utf8')));
        } catch (e) {}
      }

      if (summaries.length === 0) return null;

      // Find relevant summaries by topic overlap
      let relevant = summaries;
      if (currentMessage) {
        const words = currentMessage.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        relevant = summaries.filter(s => {
          const topics = s.topics || [];
          return words.some(w => topics.some(t => t.includes(w) || w.includes(t)));
        });
        if (relevant.length === 0) relevant = summaries.slice(0, 3); // fallback to most recent
      }

      return {
        sessions: relevant.slice(0, 5).map(s => ({
          date: s.date,
          summary: s.textSummary,
          topics: s.topics,
          questions: (s.questions || []).slice(0, 3)
        }))
      };
    } catch (e) {
      return null;
    }
  }

  getHistory(limit) {
    try {
      const files = fs.readdirSync(SUMMARIES_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit || 20);
      return files.map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(SUMMARIES_DIR, f), 'utf8')); } catch (e) { return null; }
      }).filter(Boolean);
    } catch (e) { return []; }
  }

  getContextInjection(currentMessage) {
    const ctx = this.getPreviousContext(currentMessage);
    if (!ctx || !ctx.sessions || ctx.sessions.length === 0) return '';
    const latest = ctx.sessions[0];
    return '[Previously] ' + (latest.summary || 'Last session topics: ' + (latest.topics || []).join(', '));
  }
}

module.exports = CrossSessionMemory;
