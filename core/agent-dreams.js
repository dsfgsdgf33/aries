/**
 * ARIES - Agent Dreams
 * During idle time, agents replay best conversations, extract patterns, store insights
 */

const fs = require('fs');
const path = require('path');

const DREAMS_DIR = path.join(__dirname, '..', 'data', 'dreams');
const CHAT_HISTORY_PATH = path.join(__dirname, '..', 'data', 'chat-history.json');

class AgentDreams {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this.getChatHistory = opts && opts.getChatHistory;
    this._idleTimer = null;
    this._idleThresholdMs = 30 * 60 * 1000; // 30 min
    this._lastActivity = Date.now();
    if (!fs.existsSync(DREAMS_DIR)) fs.mkdirSync(DREAMS_DIR, { recursive: true });
  }

  touch() { this._lastActivity = Date.now(); }

  startIdleWatch() {
    if (this._idleTimer) return;
    this._idleTimer = setInterval(() => {
      if (Date.now() - this._lastActivity > this._idleThresholdMs) {
        this.dreamCycle().catch(e => console.error('[DREAMS] cycle error:', e.message));
        this._lastActivity = Date.now(); // prevent re-trigger
      }
    }, 5 * 60 * 1000); // check every 5 min
  }

  async dreamCycle() {
    console.log('[DREAMS] Starting dream cycle...');
    const conversations = this._getRecentConversations();
    if (conversations.length === 0) {
      console.log('[DREAMS] No conversations to dream about');
      return { insights: [], message: 'No recent conversations' };
    }

    // Pick top 5 by length (proxy for engagement)
    const top5 = conversations
      .sort((a, b) => b.messages.length - a.messages.length)
      .slice(0, 5);

    const insights = this._extractPatterns(top5);

    // If AI available, enhance with AI summary
    if (this.ai && typeof this.ai.chat === 'function') {
      try {
        const summary = await this.ai.chat([
          { role: 'system', content: 'You analyze conversation patterns. Be concise. Return JSON with fields: topTopics (array), bestResponses (array of short descriptions), toolsUsed (array), keyInsight (string).' },
          { role: 'user', content: 'Analyze these conversation snippets and find patterns:\n' + top5.map(c => c.messages.slice(0, 6).map(m => m.role + ': ' + (m.content || '').slice(0, 200)).join('\n')).join('\n---\n') }
        ]);
        try {
          const parsed = JSON.parse((summary.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim());
          insights.aiSummary = parsed;
        } catch (e) { insights.aiSummary = { raw: (summary.response || '').slice(0, 500) }; }
      } catch (e) { console.error('[DREAMS] AI summary failed:', e.message); }
    }

    // Store dream
    const date = new Date().toISOString().split('T')[0];
    const dreamFile = path.join(DREAMS_DIR, date + '.json');
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(dreamFile, 'utf8')); } catch (e) {}
    if (!Array.isArray(existing)) existing = [];
    existing.push({ timestamp: Date.now(), insights });
    fs.writeFileSync(dreamFile, JSON.stringify(existing, null, 2));
    console.log('[DREAMS] Dream cycle complete, stored insights');
    return { insights, stored: dreamFile };
  }

  _getRecentConversations() {
    // Try getting from live history
    if (this.getChatHistory) {
      const hist = this.getChatHistory();
      if (hist && hist.length > 0) {
        // Split into conversation blocks (gaps > 10min = new convo)
        const convos = [];
        let current = { messages: [] };
        for (const msg of hist) {
          current.messages.push(msg);
        }
        if (current.messages.length > 0) convos.push(current);
        return convos;
      }
    }

    // Fallback: read from file
    try {
      if (fs.existsSync(CHAT_HISTORY_PATH)) {
        const data = JSON.parse(fs.readFileSync(CHAT_HISTORY_PATH, 'utf8'));
        const msgs = Array.isArray(data) ? data : (data.history || []);
        if (msgs.length > 0) return [{ messages: msgs }];
      }
    } catch (e) {}
    return [];
  }

  _extractPatterns(conversations) {
    const topics = {};
    const tools = {};
    let totalMsgs = 0;
    let userMsgLengths = [];

    for (const convo of conversations) {
      for (const msg of convo.messages) {
        totalMsgs++;
        const text = (msg.content || '').toLowerCase();
        if (msg.role === 'user') {
          userMsgLengths.push(text.length);
          // Extract topic keywords
          const words = text.split(/\s+/).filter(w => w.length > 4);
          for (const w of words) {
            const clean = w.replace(/[^a-z]/g, '');
            if (clean.length > 4) topics[clean] = (topics[clean] || 0) + 1;
          }
        }
        // Detect tool usage
        const toolMatches = text.match(/<tool:(\w+)/g);
        if (toolMatches) {
          for (const tm of toolMatches) {
            const name = tm.replace('<tool:', '');
            tools[name] = (tools[name] || 0) + 1;
          }
        }
      }
    }

    const topTopics = Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
    const topTools = Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);

    return {
      timestamp: Date.now(),
      conversationsAnalyzed: conversations.length,
      totalMessages: totalMsgs,
      avgUserMsgLength: userMsgLengths.length > 0 ? Math.round(userMsgLengths.reduce((a, b) => a + b, 0) / userMsgLengths.length) : 0,
      topTopics,
      topTools,
    };
  }

  getLatest() {
    try {
      const files = fs.readdirSync(DREAMS_DIR).filter(f => f.endsWith('.json')).sort().reverse();
      if (files.length === 0) return { dreams: [], message: 'No dreams yet' };
      const latest = JSON.parse(fs.readFileSync(path.join(DREAMS_DIR, files[0]), 'utf8'));
      return { date: files[0].replace('.json', ''), dreams: Array.isArray(latest) ? latest : [latest] };
    } catch (e) {
      return { dreams: [], error: e.message };
    }
  }

  getContextInjection() {
    const latest = this.getLatest();
    if (!latest.dreams || latest.dreams.length === 0) return '';
    const dream = latest.dreams[latest.dreams.length - 1];
    const insights = dream.insights || dream;
    let injection = '[Dream Insights] ';
    if (insights.topTopics && insights.topTopics.length) injection += 'Recent topics: ' + insights.topTopics.slice(0, 5).join(', ') + '. ';
    if (insights.aiSummary && insights.aiSummary.keyInsight) injection += 'Key insight: ' + insights.aiSummary.keyInsight;
    return injection;
  }
}

module.exports = AgentDreams;
