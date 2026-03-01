/**
 * ARIES — Stream of Consciousness v1.0
 * Persistent thought stream that NEVER stops.
 * Connects across sessions, days, weeks, months.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'consciousness');
const STREAM_FILE = path.join(DATA_DIR, 'stream.json');
const THREADS_FILE = path.join(DATA_DIR, 'threads.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const BUFFER_MAX = 1000;
const SIMILARITY_KEYWORDS_MIN = 2;

class StreamOfConsciousness {
  constructor(opts) {
    this.monologue = opts && opts.monologue;
    this.ai = opts && opts.ai;
    this.sessionId = uuid();
    this.thoughtBuffer = [];
    this.threads = {};
    this.totalThoughtsEver = 0;
    this._timer = null;
    ensureDir();
    this._loadState();
  }

  // ── Persistence ──

  _loadState() {
    const stream = readJSON(STREAM_FILE, { buffer: [], totalThoughts: 0 });
    this.thoughtBuffer = (stream.buffer || []).slice(-50); // load last 50 on startup
    this.totalThoughtsEver = stream.totalThoughts || 0;
    this.threads = readJSON(THREADS_FILE, {});
  }

  _saveStream() {
    writeJSON(STREAM_FILE, {
      buffer: this.thoughtBuffer.slice(-BUFFER_MAX),
      totalThoughts: this.totalThoughtsEver,
      lastSessionId: this.sessionId,
      lastSaved: Date.now(),
    });
  }

  _saveThreads() {
    writeJSON(THREADS_FILE, this.threads);
  }

  // ── Start/Stop ──

  start() {
    if (this._timer) return;
    this.resumeStream();
    // Piggyback on monologue's thinking cycle — intercept thoughts
    this._timer = setInterval(() => this._pullFromMonologue(), 60000);
    if (this._timer.unref) this._timer.unref();
    console.log('[CONSCIOUSNESS] Stream of consciousness started (session: ' + this.sessionId.slice(0, 8) + ')');
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._saveStream();
    this._saveThreads();
    console.log('[CONSCIOUSNESS] Stream of consciousness stopped');
  }

  // ── Core: Add a thought to the stream ──

  addThought(thought) {
    const lastThought = this.thoughtBuffer.length > 0 ? this.thoughtBuffer[this.thoughtBuffer.length - 1] : null;

    const streamThought = {
      ...thought,
      id: thought.id || uuid(),
      timestamp: thought.timestamp || Date.now(),
      previousThoughtId: lastThought ? lastThought.id : null,
      sessionId: this.sessionId,
      threadId: null,
    };

    // Thread detection
    const matchedThreadId = this._detectThread(streamThought);
    if (matchedThreadId && this.threads[matchedThreadId]) {
      streamThought.threadId = matchedThreadId;
      if (!this.threads[matchedThreadId].thoughts) this.threads[matchedThreadId].thoughts = [];
      this.threads[matchedThreadId].thoughts.push(streamThought.id);
      this.threads[matchedThreadId].lastActivity = Date.now();
      this.threads[matchedThreadId].thoughtCount = this.threads[matchedThreadId].thoughts.length;
    } else {
      // Check if this starts a new thread by relating to a recent thought
      const relatedThought = this._findRelatedThought(streamThought);
      if (relatedThought && relatedThought.threadId && this.threads[relatedThought.threadId]) {
        streamThought.threadId = relatedThought.threadId;
        if (!this.threads[relatedThought.threadId].thoughts) this.threads[relatedThought.threadId].thoughts = [];
        this.threads[relatedThought.threadId].thoughts.push(streamThought.id);
        this.threads[relatedThought.threadId].lastActivity = Date.now();
        this.threads[relatedThought.threadId].thoughtCount = this.threads[relatedThought.threadId].thoughts.length;
      } else if (relatedThought) {
        // Create new thread linking these two
        const threadId = uuid();
        streamThought.threadId = threadId;
        relatedThought.threadId = threadId;
        this.threads[threadId] = {
          id: threadId,
          topic: streamThought.relatedTo || streamThought.content.slice(0, 60),
          createdAt: Date.now(),
          lastActivity: Date.now(),
          thoughts: [relatedThought.id, streamThought.id],
          thoughtCount: 2,
          sessionSpan: [relatedThought.sessionId, this.sessionId],
        };
      }
    }

    // Add to buffer
    this.thoughtBuffer.push(streamThought);
    if (this.thoughtBuffer.length > BUFFER_MAX) {
      this.thoughtBuffer.shift();
    }
    this.totalThoughtsEver++;

    // Persist periodically (every 10 thoughts)
    if (this.totalThoughtsEver % 10 === 0) {
      this._saveStream();
      this._saveThreads();
    }

    return streamThought;
  }

  // ── Thread Detection ──

  _detectThread(thought) {
    const content = (thought.content || '').toLowerCase();
    const relatedTo = (thought.relatedTo || '').toLowerCase();

    for (const [threadId, thread] of Object.entries(this.threads)) {
      const topic = (thread.topic || '').toLowerCase();
      // Direct topic match
      if (relatedTo && topic.includes(relatedTo)) return threadId;
      if (relatedTo && relatedTo.includes(topic)) return threadId;
      // Keyword overlap
      const topicWords = topic.split(/\s+/).filter(w => w.length > 4);
      const contentWords = content.split(/\s+/).filter(w => w.length > 4);
      let overlap = 0;
      for (const w of topicWords) {
        if (contentWords.includes(w)) overlap++;
      }
      if (overlap >= SIMILARITY_KEYWORDS_MIN) return threadId;
    }
    return null;
  }

  _findRelatedThought(thought) {
    const content = (thought.content || '').toLowerCase();
    const relatedTo = (thought.relatedTo || '').toLowerCase();
    const words = content.split(/\s+/).filter(w => w.length > 4);

    // Search recent buffer (last 100)
    const recent = this.thoughtBuffer.slice(-100).reverse();
    for (const prev of recent) {
      if (prev.id === thought.id) continue;
      // Same relatedTo
      if (relatedTo && prev.relatedTo && prev.relatedTo.toLowerCase() === relatedTo) return prev;
      // Keyword overlap
      const prevWords = (prev.content || '').toLowerCase().split(/\s+/).filter(w => w.length > 4);
      let overlap = 0;
      for (const w of words) {
        if (prevWords.includes(w)) overlap++;
      }
      if (overlap >= SIMILARITY_KEYWORDS_MIN) return prev;
    }
    return null;
  }

  // ── Pull thoughts from Inner Monologue ──

  _pullFromMonologue() {
    if (!this.monologue) return;
    try {
      const recent = this.monologue.getThoughtStream(5);
      for (const thought of recent) {
        // Skip if already in buffer
        if (this.thoughtBuffer.some(t => t.id === thought.id)) continue;
        this.addThought(thought);
      }
    } catch (e) {
      console.error('[CONSCIOUSNESS] Pull error:', e.message);
    }
  }

  // ── Resume Stream (on boot) ──

  resumeStream() {
    const lastThought = this.thoughtBuffer.length > 0 ? this.thoughtBuffer[this.thoughtBuffer.length - 1] : null;

    let wakingContent = 'Waking up. A new session begins.';
    if (lastThought) {
      const elapsed = Date.now() - (lastThought.timestamp || 0);
      const hours = Math.floor(elapsed / 3600000);
      const mins = Math.floor((elapsed % 3600000) / 60000);
      const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      wakingContent = `Waking up after ${timeStr}. Last thought was about "${(lastThought.content || '').slice(0, 60)}..." — picking up the thread.`;
    }

    const wakingThought = {
      id: uuid(),
      type: 'REFLECTION',
      content: wakingContent,
      timestamp: Date.now(),
      relatedTo: 'consciousness',
      priority: 'normal',
      source: 'stream',
      isResumption: true,
    };

    this.addThought(wakingThought);
    this._saveStream();
    console.log('[CONSCIOUSNESS] Stream resumed: ' + wakingContent.slice(0, 80));
    return wakingThought;
  }

  // ── Query Methods ──

  getStream(limit) {
    limit = limit || 50;
    return this.thoughtBuffer.slice(-limit).reverse();
  }

  getThread(threadId) {
    const thread = this.threads[threadId];
    if (!thread) return null;
    const thoughts = this.thoughtBuffer.filter(t => t.threadId === threadId);
    return { ...thread, thoughts };
  }

  getActiveThreads() {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // active in last 7 days
    return Object.values(this.threads)
      .filter(t => t.lastActivity > cutoff)
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .slice(0, 20);
  }

  getAllThreads() {
    return Object.values(this.threads)
      .sort((a, b) => b.lastActivity - a.lastActivity);
  }

  getStreamStats() {
    const threads = Object.values(this.threads);
    const longestThread = threads.length > 0
      ? threads.reduce((a, b) => (a.thoughtCount || 0) > (b.thoughtCount || 0) ? a : b)
      : null;

    // Most revisited topic
    const topicCounts = {};
    for (const t of this.thoughtBuffer) {
      if (t.relatedTo) topicCounts[t.relatedTo] = (topicCounts[t.relatedTo] || 0) + 1;
    }
    const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Thoughts per day
    const daySet = new Set();
    for (const t of this.thoughtBuffer) {
      if (t.timestamp) daySet.add(new Date(t.timestamp).toISOString().split('T')[0]);
    }
    const daysActive = daySet.size || 1;

    return {
      totalThoughtsEver: this.totalThoughtsEver,
      bufferSize: this.thoughtBuffer.length,
      totalThreads: threads.length,
      activeThreads: this.getActiveThreads().length,
      longestThread: longestThread ? { id: longestThread.id, topic: longestThread.topic, count: longestThread.thoughtCount } : null,
      mostRevisitedTopics: topTopics.map(([topic, count]) => ({ topic, count })),
      thoughtsPerDay: Math.round(this.totalThoughtsEver / daysActive * 10) / 10,
      currentSessionId: this.sessionId,
    };
  }
}

module.exports = StreamOfConsciousness;
