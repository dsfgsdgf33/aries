/**
 * ARIES v4.5 — Advanced Conversation Continuity Engine
 * Intelligent session management, compaction, cross-channel continuity.
 * Uses only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const BASE_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(BASE_DIR, 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const COMPACTIONS_FILE = path.join(DATA_DIR, 'conversation-compactions.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'channel-mappings.json');

class ConversationEngine extends EventEmitter {
  /**
   * @param {object} config
   * @param {object} [deps] - { ai, persistentMemory, skillBridge }
   */
  constructor(config, deps) {
    super();
    this.config = config || {};
    this.enabled = config.enabled !== false;
    this.maxTokensPerSession = config.maxTokensPerSession || 100000;
    this.compactionThreshold = config.compactionThreshold || 80000;
    this.keepRecentMessages = config.keepRecentMessages || 20;
    this.autoCompact = config.autoCompact !== false;
    this.contextInjection = config.contextInjection || { memory: true, skills: true, crossSession: true, userProfile: true };
    this.maxSessions = config.maxSessions || 500;
    this.archiveAfterDays = config.archiveAfterDays || 30;

    this.ai = deps && deps.ai ? deps.ai : null;
    this.persistentMemory = deps && deps.persistentMemory ? deps.persistentMemory : null;
    this.skillBridge = deps && deps.skillBridge ? deps.skillBridge : null;

    this._activeSessionId = null;
    this._compactions = {};
    this._channelMappings = {};

    this._ensureDirs();
    this._loadCompactions();
    this._loadChannelMappings();
  }

  _ensureDirs() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    } catch (e) { /* ignore */ }
  }

  _loadCompactions() {
    try {
      if (fs.existsSync(COMPACTIONS_FILE)) {
        this._compactions = JSON.parse(fs.readFileSync(COMPACTIONS_FILE, 'utf8'));
      }
    } catch (e) { this._compactions = {}; }
  }

  _saveCompactions() {
    try { fs.writeFileSync(COMPACTIONS_FILE, JSON.stringify(this._compactions, null, 2)); } catch (e) { /* ignore */ }
  }

  _loadChannelMappings() {
    try {
      if (fs.existsSync(CHANNELS_FILE)) {
        this._channelMappings = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'));
      }
    } catch (e) { this._channelMappings = {}; }
  }

  _saveChannelMappings() {
    try { fs.writeFileSync(CHANNELS_FILE, JSON.stringify(this._channelMappings, null, 2)); } catch (e) { /* ignore */ }
  }

  _sessionPath(sessionId) {
    return path.join(SESSIONS_DIR, sessionId + '.json');
  }

  _generateId() {
    return crypto.randomBytes(8).toString('hex');
  }

  // ═══════════════════════════════════════════
  // Token Estimation
  // ═══════════════════════════════════════════

  /**
   * Rough token count estimation
   * @param {string} text
   * @returns {number}
   */
  estimateTokens(text) {
    try {
      if (!text) return 0;
      var words = text.split(/\s+/).length;
      return Math.ceil(words * 1.3);
    } catch (e) { return 0; }
  }

  /**
   * Estimate tokens for an array of messages
   * @param {Array} messages
   * @returns {number}
   */
  _estimateMessagesTokens(messages) {
    var total = 0;
    for (var i = 0; i < messages.length; i++) {
      total += this.estimateTokens(messages[i].content || '');
      total += 4; // overhead per message
    }
    return total;
  }

  // ═══════════════════════════════════════════
  // Smart Compaction
  // ═══════════════════════════════════════════

  /**
   * Intelligently compress conversation history
   * @param {Array} messages
   * @param {number} [maxTokens]
   * @returns {Promise<{compacted: Array, summary: string, removed: number}>}
   */
  async compactHistory(messages, maxTokens) {
    try {
      maxTokens = maxTokens || this.maxTokensPerSession;
      var totalTokens = this._estimateMessagesTokens(messages);
      if (totalTokens <= maxTokens) {
        return { compacted: messages, summary: '', removed: 0 };
      }

      var keepRecent = this.keepRecentMessages;
      var recent = messages.slice(-keepRecent);
      var older = messages.slice(0, -keepRecent);

      // Keep messages with tool calls or pinned
      var important = [];
      var toSummarize = [];
      for (var i = 0; i < older.length; i++) {
        var msg = older[i];
        if (msg.pinned || msg.tool_calls || msg.role === 'tool' || msg.important) {
          important.push(msg);
        } else {
          toSummarize.push(msg);
        }
      }

      // Build summary
      var summary = '';
      if (toSummarize.length > 0) {
        // Try AI summarization
        if (this.ai && this.ai.callWithFallback) {
          try {
            var summaryContent = toSummarize.map(function(m) {
              return (m.role || 'unknown') + ': ' + (m.content || '').substring(0, 300);
            }).join('\n');

            var result = await this.ai.callWithFallback([
              { role: 'system', content: 'Summarize this conversation history concisely, preserving key decisions, facts, and context. Be brief but comprehensive.' },
              { role: 'user', content: summaryContent.substring(0, 10000) }
            ]);
            summary = (result.response || result.content || '').trim();
          } catch (e) {
            // Fallback: simple truncation summary
            summary = 'Previous conversation summary (' + toSummarize.length + ' messages): ';
            summary += toSummarize.slice(0, 5).map(function(m) { return (m.role || '') + ' discussed: ' + (m.content || '').substring(0, 100); }).join('; ');
          }
        } else {
          summary = 'Previous conversation (' + toSummarize.length + ' messages compacted). ';
          summary += 'Topics discussed: ' + toSummarize.slice(0, 5).map(function(m) { return (m.content || '').substring(0, 50); }).join(', ');
        }
      }

      var compacted = [];
      if (summary) {
        compacted.push({ role: 'system', content: '[Conversation Summary]\n' + summary, _compacted: true, _removedCount: toSummarize.length, _compactedAt: new Date().toISOString() });
      }
      compacted = compacted.concat(important).concat(recent);

      return { compacted: compacted, summary: summary, removed: toSummarize.length };
    } catch (e) {
      return { compacted: messages, summary: '', removed: 0, error: e.message };
    }
  }

  /**
   * Get optimized context window for AI call
   * @param {string} sessionId
   * @param {number} [maxTokens]
   * @returns {Promise<Array>}
   */
  async getContextWindow(sessionId, maxTokens) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return [];

      maxTokens = maxTokens || this.maxTokensPerSession;
      var messages = session.messages || [];
      var totalTokens = this._estimateMessagesTokens(messages);

      // Auto-compact if needed
      if (this.autoCompact && totalTokens > this.compactionThreshold) {
        var result = await this.compactHistory(messages, maxTokens);
        session.messages = result.compacted;
        session.compactionCount = (session.compactionCount || 0) + 1;
        session.lastCompaction = new Date().toISOString();
        session.totalCompacted = (session.totalCompacted || 0) + result.removed;
        this._saveSession(session);

        // Store compaction record
        this._compactions[sessionId] = this._compactions[sessionId] || [];
        this._compactions[sessionId].push({
          timestamp: new Date().toISOString(),
          removed: result.removed,
          summaryLength: (result.summary || '').length
        });
        this._saveCompactions();

        messages = result.compacted;
      }

      return messages;
    } catch (e) { return []; }
  }

  // ═══════════════════════════════════════════
  // Multi-Session Management
  // ═══════════════════════════════════════════

  /**
   * Create a new conversation session
   * @param {object} options
   * @returns {object}
   */
  createSession(options) {
    try {
      options = options || {};
      var id = this._generateId();
      var session = {
        id: id,
        name: options.name || 'Session ' + new Date().toLocaleString(),
        channel: options.channel || 'webchat',
        model: options.model || null,
        systemPrompt: options.systemPrompt || null,
        maxHistory: options.maxHistory || this.maxTokensPerSession,
        tags: options.tags || [],
        messages: [],
        bookmarks: [],
        reactions: {},
        pins: [],
        channels: {},
        topics: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archived: false,
        compactionCount: 0,
        totalCompacted: 0,
        lastCompaction: null,
        messageCount: 0,
        tokenEstimate: 0,
        title: options.name || null,
        forkedFrom: options.forkedFrom || null
      };
      this._saveSession(session);
      this._activeSessionId = id;
      this.emit('session-created', { id: id, name: session.name });
      return session;
    } catch (e) { return { error: e.message }; }
  }

  /**
   * Switch active session
   * @param {string} sessionId
   * @returns {object|null}
   */
  switchSession(sessionId) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return null;
      this._activeSessionId = sessionId;
      this.emit('session-switched', { id: sessionId });
      return session;
    } catch (e) { return null; }
  }

  /**
   * Get active session ID
   * @returns {string|null}
   */
  getActiveSessionId() {
    return this._activeSessionId;
  }

  /**
   * List all sessions
   * @param {object} [filter] - { channel, tags, archived }
   * @returns {Array}
   */
  listSessions(filter) {
    try {
      filter = filter || {};
      var files = fs.readdirSync(SESSIONS_DIR).filter(function(f) { return f.endsWith('.json'); });
      var sessions = [];
      for (var i = 0; i < files.length; i++) {
        try {
          var data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, files[i]), 'utf8'));
          // Apply filters
          if (filter.channel && data.channel !== filter.channel) continue;
          if (filter.archived !== undefined && data.archived !== filter.archived) continue;
          if (filter.tags && filter.tags.length > 0) {
            var hasTag = false;
            for (var t = 0; t < filter.tags.length; t++) {
              if ((data.tags || []).indexOf(filter.tags[t]) >= 0) { hasTag = true; break; }
            }
            if (!hasTag) continue;
          }
          sessions.push({
            id: data.id,
            name: data.name,
            title: data.title || data.name,
            channel: data.channel,
            messageCount: data.messageCount || (data.messages || []).length,
            tokenEstimate: data.tokenEstimate || 0,
            tags: data.tags || [],
            archived: data.archived || false,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            lastMessage: data.messages && data.messages.length > 0 ? (data.messages[data.messages.length - 1].content || '').substring(0, 100) : '',
            compactionCount: data.compactionCount || 0,
            topics: data.topics || [],
            channels: data.channels || {}
          });
        } catch (e) { /* skip corrupt files */ }
      }
      // Sort by updatedAt desc
      sessions.sort(function(a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
      return sessions;
    } catch (e) { return []; }
  }

  /**
   * Get a session with full history
   * @param {string} sessionId
   * @returns {object|null}
   */
  getSession(sessionId) {
    try {
      var filePath = this._sessionPath(sessionId);
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) { return null; }
  }

  /**
   * Save a session
   * @param {object} session
   */
  _saveSession(session) {
    try {
      session.updatedAt = new Date().toISOString();
      session.messageCount = (session.messages || []).length;
      session.tokenEstimate = this._estimateMessagesTokens(session.messages || []);
      fs.writeFileSync(this._sessionPath(session.id), JSON.stringify(session, null, 2));
    } catch (e) { /* ignore */ }
  }

  /**
   * Delete a session
   * @param {string} sessionId
   * @returns {{deleted: boolean}}
   */
  deleteSession(sessionId) {
    try {
      var filePath = this._sessionPath(sessionId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        if (this._activeSessionId === sessionId) this._activeSessionId = null;
        return { deleted: true };
      }
      return { deleted: false, error: 'Session not found' };
    } catch (e) { return { deleted: false, error: e.message }; }
  }

  /**
   * Archive a session
   * @param {string} sessionId
   * @returns {{archived: boolean}}
   */
  archiveSession(sessionId) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return { archived: false, error: 'Session not found' };
      session.archived = true;
      this._saveSession(session);
      return { archived: true };
    } catch (e) { return { archived: false, error: e.message }; }
  }

  /**
   * Fork a session from a specific message
   * @param {string} sessionId
   * @param {string} [fromMessageId]
   * @returns {object}
   */
  forkSession(sessionId, fromMessageId) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return { error: 'Session not found' };

      var messages = session.messages || [];
      if (fromMessageId) {
        var idx = -1;
        for (var i = 0; i < messages.length; i++) {
          if (messages[i].id === fromMessageId) { idx = i; break; }
        }
        if (idx >= 0) {
          messages = messages.slice(0, idx + 1);
        }
      }

      var forked = this.createSession({
        name: 'Fork of: ' + (session.name || session.id),
        channel: session.channel,
        model: session.model,
        systemPrompt: session.systemPrompt,
        tags: (session.tags || []).concat(['forked']),
        forkedFrom: sessionId
      });

      forked.messages = JSON.parse(JSON.stringify(messages));
      this._saveSession(forked);

      this.emit('session-forked', { sourceId: sessionId, forkId: forked.id });
      return forked;
    } catch (e) { return { error: e.message }; }
  }

  /**
   * Add a message to a session
   * @param {string} sessionId
   * @param {string} role
   * @param {string} content
   * @param {object} [meta] - extra metadata
   * @returns {object}
   */
  addMessage(sessionId, role, content, meta) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return { error: 'Session not found' };

      var msgId = this._generateId();
      var message = {
        id: msgId,
        role: role,
        content: content,
        timestamp: new Date().toISOString()
      };
      if (meta) {
        if (meta.tool_calls) message.tool_calls = meta.tool_calls;
        if (meta.tool_call_id) message.tool_call_id = meta.tool_call_id;
        if (meta.name) message.name = meta.name;
      }

      session.messages.push(message);
      this._saveSession(session);

      this.emit('message-added', { sessionId: sessionId, messageId: msgId, role: role });
      return message;
    } catch (e) { return { error: e.message }; }
  }

  // ═══════════════════════════════════════════
  // Cross-Channel Continuity
  // ═══════════════════════════════════════════

  /**
   * Link a session to a channel
   * @param {string} sessionId
   * @param {string} channel
   * @param {string} channelId
   * @returns {{linked: boolean}}
   */
  linkChannel(sessionId, channel, channelId) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return { linked: false, error: 'Session not found' };

      var key = channel + ':' + channelId;
      this._channelMappings[key] = sessionId;
      this._saveChannelMappings();

      session.channels = session.channels || {};
      session.channels[key] = {
        channel: channel,
        channelId: channelId,
        linkedAt: new Date().toISOString(),
        lastMessage: null,
        messageCount: 0
      };
      this._saveSession(session);

      return { linked: true };
    } catch (e) { return { linked: false, error: e.message }; }
  }

  /**
   * Find the session for a given channel
   * @param {string} channel
   * @param {string} channelId
   * @returns {string|null} sessionId
   */
  getSessionForChannel(channel, channelId) {
    try {
      var key = channel + ':' + channelId;
      return this._channelMappings[key] || null;
    } catch (e) { return null; }
  }

  /**
   * Get all channel-session mappings
   * @returns {object}
   */
  getChannelMappings() {
    return JSON.parse(JSON.stringify(this._channelMappings));
  }

  // ═══════════════════════════════════════════
  // Conversation Intelligence
  // ═══════════════════════════════════════════

  /**
   * Extract topics from a session
   * @param {string} sessionId
   * @returns {Promise<Array>}
   */
  async extractTopics(sessionId) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return [];

      var messages = session.messages || [];
      if (messages.length === 0) return [];

      // Simple keyword extraction
      var wordFreq = {};
      var stopWords = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','must','shall','can','need','dare','ought','used','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','out','off','over','under','again','further','then','once','here','there','when','where','why','how','all','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','because','but','and','or','if','while','that','this','it','i','you','he','she','we','they','me','him','her','us','them','my','your','his','its','our','their','what','which','who','whom']);

      for (var i = 0; i < messages.length; i++) {
        var words = (messages[i].content || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
        for (var j = 0; j < words.length; j++) {
          var w = words[j];
          if (w.length > 3 && !stopWords.has(w)) {
            wordFreq[w] = (wordFreq[w] || 0) + 1;
          }
        }
      }

      // Sort by frequency
      var sorted = Object.entries(wordFreq).sort(function(a, b) { return b[1] - a[1]; });
      var topics = sorted.slice(0, 15).map(function(e) { return { topic: e[0], count: e[1] }; });

      // Save to session
      session.topics = topics.map(function(t) { return t.topic; });
      this._saveSession(session);

      return topics;
    } catch (e) { return []; }
  }

  /**
   * Search across all sessions
   * @param {string} query
   * @returns {Array}
   */
  searchConversations(query) {
    try {
      if (!query) return [];
      var queryLower = query.toLowerCase();
      var results = [];

      var files = fs.readdirSync(SESSIONS_DIR).filter(function(f) { return f.endsWith('.json'); });
      for (var i = 0; i < files.length; i++) {
        try {
          var data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, files[i]), 'utf8'));
          var messages = data.messages || [];
          for (var j = 0; j < messages.length; j++) {
            var content = (messages[j].content || '').toLowerCase();
            if (content.includes(queryLower)) {
              results.push({
                sessionId: data.id,
                sessionName: data.name || data.id,
                messageId: messages[j].id,
                role: messages[j].role,
                content: (messages[j].content || '').substring(0, 200),
                timestamp: messages[j].timestamp
              });
              if (results.length >= 50) return results;
            }
          }
        } catch (e) { /* skip */ }
      }
      return results;
    } catch (e) { return []; }
  }

  /**
   * Get conversation stats for a session
   * @param {string} sessionId
   * @returns {object}
   */
  getConversationStats(sessionId) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return { error: 'Session not found' };

      var messages = session.messages || [];
      var userMsgs = 0;
      var assistantMsgs = 0;
      var totalChars = 0;
      var firstTs = null;
      var lastTs = null;

      for (var i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') userMsgs++;
        if (messages[i].role === 'assistant') assistantMsgs++;
        totalChars += (messages[i].content || '').length;
        var ts = messages[i].timestamp;
        if (ts) {
          if (!firstTs || ts < firstTs) firstTs = ts;
          if (!lastTs || ts > lastTs) lastTs = ts;
        }
      }

      var durationMs = firstTs && lastTs ? new Date(lastTs).getTime() - new Date(firstTs).getTime() : 0;

      return {
        messageCount: messages.length,
        userMessages: userMsgs,
        assistantMessages: assistantMsgs,
        totalCharacters: totalChars,
        tokenEstimate: this._estimateMessagesTokens(messages),
        duration: durationMs,
        durationFormatted: Math.floor(durationMs / 60000) + 'm',
        firstMessage: firstTs,
        lastMessage: lastTs,
        compactionCount: session.compactionCount || 0,
        totalCompacted: session.totalCompacted || 0,
        bookmarkCount: (session.bookmarks || []).length,
        pinCount: (session.pins || []).length,
        topics: session.topics || [],
        channels: Object.keys(session.channels || {})
      };
    } catch (e) { return { error: e.message }; }
  }

  /**
   * Generate a title for a session
   * @param {string} sessionId
   * @returns {Promise<string>}
   */
  async generateSessionTitle(sessionId) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return 'Untitled';

      var messages = session.messages || [];
      if (messages.length === 0) return 'Empty Session';

      // Use first few messages to generate title
      var context = messages.slice(0, 5).map(function(m) {
        return (m.role || '') + ': ' + (m.content || '').substring(0, 100);
      }).join('\n');

      if (this.ai && this.ai.callWithFallback) {
        try {
          var result = await this.ai.callWithFallback([
            { role: 'system', content: 'Generate a very short title (3-6 words) for this conversation. Return only the title, nothing else.' },
            { role: 'user', content: context }
          ]);
          var title = (result.response || result.content || '').trim().replace(/^["']|["']$/g, '');
          if (title) {
            session.title = title;
            this._saveSession(session);
            return title;
          }
        } catch (e) { /* fallback below */ }
      }

      // Fallback: use first user message
      var firstUser = messages.find(function(m) { return m.role === 'user'; });
      var title = firstUser ? (firstUser.content || '').substring(0, 50) : 'Session ' + sessionId.substring(0, 8);
      session.title = title;
      this._saveSession(session);
      return title;
    } catch (e) { return 'Untitled'; }
  }

  // ═══════════════════════════════════════════
  // Context Injection Pipeline
  // ═══════════════════════════════════════════

  /**
   * Build full context for an AI call
   * @param {string} sessionId
   * @param {string} currentMessage
   * @returns {Promise<Array>}
   */
  async buildFullContext(sessionId, currentMessage) {
    try {
      var context = [];
      var session = this.getSession(sessionId);

      // 1. System prompt
      if (session && session.systemPrompt) {
        context.push({ role: 'system', content: session.systemPrompt });
      }

      // 2. User profile context
      if (this.contextInjection.userProfile) {
        try {
          var configPath = path.join(BASE_DIR, 'config.json');
          if (fs.existsSync(configPath)) {
            var cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (cfg.user) {
              context.push({ role: 'system', content: '[User Profile] Name: ' + (cfg.user.name || '') + '. Title: ' + (cfg.user.title || '') });
            }
          }
        } catch (e) { /* ignore */ }
      }

      // 3. Compacted history + recent messages
      if (session) {
        var messages = await this.getContextWindow(sessionId);
        context = context.concat(messages);
      }

      // 4. Memory snippets
      if (this.contextInjection.memory && this.persistentMemory) {
        try {
          var memResults = [];
          if (this.persistentMemory.semanticSearch) {
            memResults = this.persistentMemory.semanticSearch(currentMessage, 3);
          } else if (this.persistentMemory.searchMemory) {
            memResults = this.persistentMemory.searchMemory(currentMessage).slice(0, 3);
          }
          if (memResults.length > 0) {
            var memContext = memResults.map(function(r) { return r.text || r.line || ''; }).join('\n');
            if (memContext.trim()) {
              context.push({ role: 'system', content: '[Relevant Memories]\n' + memContext.substring(0, 1000) });
            }
          }
        } catch (e) { /* ignore */ }
      }

      // 5. Skill contexts
      if (this.contextInjection.skills && this.skillBridge) {
        try {
          var matches = this.skillBridge.matchSkillForTask(currentMessage);
          if (matches.length > 0) {
            var skillCtx = this.skillBridge.getSkillContext(matches[0].name);
            if (skillCtx) {
              context.push({ role: 'system', content: '[Active Skill: ' + matches[0].name + ']\n' + skillCtx.substring(0, 2000) });
            }
          }
        } catch (e) { /* ignore */ }
      }

      // 6. Current message
      if (currentMessage) {
        context.push({ role: 'user', content: currentMessage });
      }

      return context;
    } catch (e) { return [{ role: 'user', content: currentMessage || '' }]; }
  }

  // ═══════════════════════════════════════════
  // Message Enhancement
  // ═══════════════════════════════════════════

  /**
   * Pin a message (excluded from compaction)
   * @param {string} sessionId
   * @param {string} messageId
   * @returns {{pinned: boolean}}
   */
  pinMessage(sessionId, messageId) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return { pinned: false, error: 'Session not found' };

      var messages = session.messages || [];
      for (var i = 0; i < messages.length; i++) {
        if (messages[i].id === messageId) {
          messages[i].pinned = true;
          messages[i].important = true;
          if (!session.pins) session.pins = [];
          session.pins.push({ messageId: messageId, pinnedAt: new Date().toISOString() });
          this._saveSession(session);
          return { pinned: true };
        }
      }
      return { pinned: false, error: 'Message not found' };
    } catch (e) { return { pinned: false, error: e.message }; }
  }

  /**
   * Bookmark a message with a note
   * @param {string} sessionId
   * @param {string} messageId
   * @param {string} [note]
   * @returns {{bookmarked: boolean}}
   */
  bookmarkMessage(sessionId, messageId, note) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return { bookmarked: false, error: 'Session not found' };

      if (!session.bookmarks) session.bookmarks = [];
      session.bookmarks.push({
        messageId: messageId,
        note: note || '',
        createdAt: new Date().toISOString()
      });
      this._saveSession(session);
      return { bookmarked: true };
    } catch (e) { return { bookmarked: false, error: e.message }; }
  }

  /**
   * Get all bookmarks for a session
   * @param {string} sessionId
   * @returns {Array}
   */
  getBookmarks(sessionId) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return [];

      var bookmarks = session.bookmarks || [];
      var messages = session.messages || [];
      var msgMap = {};
      for (var i = 0; i < messages.length; i++) {
        if (messages[i].id) msgMap[messages[i].id] = messages[i];
      }

      return bookmarks.map(function(b) {
        var msg = msgMap[b.messageId];
        return {
          messageId: b.messageId,
          note: b.note,
          createdAt: b.createdAt,
          message: msg ? { role: msg.role, content: (msg.content || '').substring(0, 200), timestamp: msg.timestamp } : null
        };
      });
    } catch (e) { return []; }
  }

  /**
   * Add a reaction to a message
   * @param {string} sessionId
   * @param {string} messageId
   * @param {string} reaction
   * @returns {{reacted: boolean}}
   */
  addReaction(sessionId, messageId, reaction) {
    try {
      var session = this.getSession(sessionId);
      if (!session) return { reacted: false, error: 'Session not found' };

      if (!session.reactions) session.reactions = {};
      if (!session.reactions[messageId]) session.reactions[messageId] = [];
      session.reactions[messageId].push({ emoji: reaction, at: new Date().toISOString() });
      this._saveSession(session);
      return { reacted: true };
    } catch (e) { return { reacted: false, error: e.message }; }
  }

  // ═══════════════════════════════════════════
  // Conversation Export
  // ═══════════════════════════════════════════

  /**
   * Export a session in various formats
   * @param {string} sessionId
   * @param {string} [format] - 'markdown', 'json', 'text', 'html'
   * @returns {{content: string, format: string, filename: string}}
   */
  exportSession(sessionId, format) {
    try {
      format = format || 'markdown';
      var session = this.getSession(sessionId);
      if (!session) return { error: 'Session not found' };

      var messages = session.messages || [];
      var filename = 'aries-session-' + sessionId.substring(0, 8) + '-' + Date.now();
      var content = '';

      if (format === 'json') {
        content = JSON.stringify(session, null, 2);
        filename += '.json';
      } else if (format === 'text') {
        content = 'Session: ' + (session.name || session.id) + '\n';
        content += 'Created: ' + (session.createdAt || '') + '\n\n';
        for (var i = 0; i < messages.length; i++) {
          var m = messages[i];
          var role = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Aries' : 'System';
          content += role + ': ' + (m.content || '') + '\n\n';
        }
        filename += '.txt';
      } else if (format === 'html') {
        content = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Aries Chat Export</title>';
        content += '<style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:20px;background:#1a1a2e;color:#e0e0e0}';
        content += '.msg{margin:12px 0;padding:12px;border-radius:8px}.user{background:#1a2a3a;border-left:3px solid #0ff}';
        content += '.assistant{background:#1a1a2a;border-left:3px solid #f0f}.role{font-size:12px;color:#888;margin-bottom:4px}</style></head><body>';
        content += '<h1>' + (session.name || 'Chat Export') + '</h1>';
        for (var j = 0; j < messages.length; j++) {
          var msg = messages[j];
          var roleClass = msg.role === 'user' ? 'user' : 'assistant';
          var roleName = msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Aries' : 'System';
          content += '<div class="msg ' + roleClass + '"><div class="role">' + roleName + '</div>' + (msg.content || '').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>';
        }
        content += '</body></html>';
        filename += '.html';
      } else {
        // Markdown
        content = '# ' + (session.name || 'Chat Export') + '\n\n';
        content += '> Created: ' + (session.createdAt || '') + '  \n';
        content += '> Messages: ' + messages.length + '  \n';
        if (session.topics && session.topics.length > 0) {
          content += '> Topics: ' + session.topics.join(', ') + '  \n';
        }
        content += '\n---\n\n';
        for (var k = 0; k < messages.length; k++) {
          var me = messages[k];
          var r = me.role === 'user' ? 'You' : me.role === 'assistant' ? 'Aries' : 'System';
          var ts = me.timestamp ? ' (' + new Date(me.timestamp).toLocaleString() + ')' : '';
          content += '### ' + r + ts + '\n\n' + (me.content || '') + '\n\n---\n\n';
        }
        filename += '.md';
      }

      return { content: content, format: format, filename: filename };
    } catch (e) { return { error: e.message }; }
  }

  /**
   * Import a session from data
   * @param {object|string} data
   * @param {string} [format] - 'json'
   * @returns {object}
   */
  importSession(data, format) {
    try {
      var session;
      if (typeof data === 'string') {
        session = JSON.parse(data);
      } else {
        session = data;
      }
      // Assign new ID
      session.id = this._generateId();
      session.importedAt = new Date().toISOString();
      session.tags = (session.tags || []).concat(['imported']);
      this._saveSession(session);
      return session;
    } catch (e) { return { error: e.message }; }
  }

  /**
   * Stop / cleanup
   */
  stop() {
    this._saveCompactions();
    this._saveChannelMappings();
  }
}

module.exports = { ConversationEngine };
