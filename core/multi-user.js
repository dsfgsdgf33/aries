/**
 * ARIES v5.0 — Multi-User Session Management
 * 
 * Multiple users can interact with Aries simultaneously.
 * Each user gets their own session with separate chat history and context.
 * Operators can see all sessions. Session auth via simple tokens.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'user-sessions.json');

class MultiUser extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} [opts.config] - multiUser config section
   */
  constructor(opts = {}) {
    super();
    this.operators = (opts.config && opts.config.operators) || ['Admin'];
    this.maxSessions = (opts.config && opts.config.maxSessions) || 20;
    this._sessions = new Map(); // token -> session

    // Ensure data dir
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

    // Load persisted sessions
    this._loadSessions();
  }

  /** Load sessions from disk */
  _loadSessions() {
    try {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        for (const s of data) {
          this._sessions.set(s.token, s);
        }
      }
    } catch {}
  }

  /** Save sessions to disk */
  _saveSessions() {
    try {
      const arr = [...this._sessions.values()];
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(arr, null, 2));
    } catch {}
  }

  /**
   * Create a new user session
   * @param {string} userId - Unique user identifier
   * @param {string} name - Display name
   * @returns {object} session with token
   */
  createSession(userId, name) {
    // Check if user already has a session
    for (const [token, session] of this._sessions) {
      if (session.userId === userId) {
        session.lastActive = new Date().toISOString();
        this._saveSessions();
        return session;
      }
    }

    // Check max sessions
    if (this._sessions.size >= this.maxSessions) {
      // Evict oldest inactive session
      let oldest = null;
      let oldestTime = Date.now();
      for (const [token, session] of this._sessions) {
        const lastActive = new Date(session.lastActive || session.createdAt).getTime();
        if (lastActive < oldestTime) {
          oldestTime = lastActive;
          oldest = token;
        }
      }
      if (oldest) this._sessions.delete(oldest);
    }

    const token = crypto.randomBytes(24).toString('hex');
    const session = {
      token,
      userId,
      name: name || userId,
      isOperator: this.operators.includes(userId),
      chatHistory: [],
      context: {},
      stats: { messages: 0, tokensEstimate: 0, tasks: 0 },
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
    };

    this._sessions.set(token, session);
    this._saveSessions();
    this.emit('session-created', { userId, name, token: token.substring(0, 8) + '...' });
    return session;
  }

  /**
   * Get session by token
   * @param {string} token
   * @returns {object|null} session or null
   */
  getSession(token) {
    const session = this._sessions.get(token);
    if (session) {
      session.lastActive = new Date().toISOString();
    }
    return session || null;
  }

  /**
   * Add a message to a user's chat history
   * @param {string} token
   * @param {string} role - user|assistant|system
   * @param {string} content
   */
  addMessage(token, role, content) {
    const session = this._sessions.get(token);
    if (!session) return;
    session.chatHistory.push({ role, content, timestamp: new Date().toISOString() });
    // Keep history bounded
    if (session.chatHistory.length > 100) session.chatHistory = session.chatHistory.slice(-100);
    session.stats.messages++;
    session.stats.tokensEstimate += Math.ceil((content || '').length / 4);
    session.lastActive = new Date().toISOString();
    this._saveSessions();
  }

  /**
   * List all sessions (operator only returns full data)
   * @param {boolean} [isOperator=false]
   * @returns {Array}
   */
  listSessions(isOperator) {
    const sessions = [...this._sessions.values()];
    if (isOperator) {
      return sessions.map(s => ({
        userId: s.userId,
        name: s.name,
        isOperator: s.isOperator,
        stats: s.stats,
        createdAt: s.createdAt,
        lastActive: s.lastActive,
        historyLength: s.chatHistory.length,
      }));
    }
    return sessions.map(s => ({
      userId: s.userId,
      name: s.name,
      lastActive: s.lastActive,
    }));
  }

  /**
   * Broadcast a message to all sessions
   * @param {string} message
   */
  broadcastToAll(message) {
    const ts = new Date().toISOString();
    for (const [token, session] of this._sessions) {
      session.chatHistory.push({ role: 'system', content: message, timestamp: ts });
      if (session.chatHistory.length > 100) session.chatHistory = session.chatHistory.slice(-100);
    }
    this._saveSessions();
    this.emit('broadcast', { message, sessionCount: this._sessions.size });
  }

  /**
   * Remove a session by userId
   * @param {string} userId
   * @returns {boolean}
   */
  removeSession(userId) {
    for (const [token, session] of this._sessions) {
      if (session.userId === userId) {
        this._sessions.delete(token);
        this._saveSessions();
        this.emit('session-removed', { userId });
        return true;
      }
    }
    return false;
  }

  /**
   * Get user info by token
   * @param {string} token
   * @returns {object|null}
   */
  getUserInfo(token) {
    const session = this._sessions.get(token);
    if (!session) return null;
    return {
      userId: session.userId,
      name: session.name,
      isOperator: session.isOperator,
      stats: session.stats,
      createdAt: session.createdAt,
      lastActive: session.lastActive,
      historyLength: session.chatHistory.length,
    };
  }

  /**
   * Increment task count for a user
   * @param {string} token
   */
  recordTask(token) {
    const session = this._sessions.get(token);
    if (session) {
      session.stats.tasks++;
      this._saveSessions();
    }
  }
}

module.exports = { MultiUser };
