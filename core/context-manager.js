/**
 * ARIES v5.0 — Smart Context Window Manager
 * 
 * Manages conversation context intelligently. When context gets too long,
 * auto-summarizes older messages using a cheap model call.
 * Tracks token counts per message. Supports pinned messages.
 */

const EventEmitter = require('events');

// Rough token estimation (4 chars ≈ 1 token)
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

class ContextManager extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.maxTokens=16000] - Max context window tokens
   * @param {number} [options.summarizeAt=12000] - Token count to trigger summarization
   * @param {string} [options.summaryModel] - Model to use for summarization
   * @param {object} [options.ai] - AI core reference for summarization
   */
  constructor(options = {}) {
    super();
    this.maxTokens = options.maxTokens || 16000;
    this.summarizeAt = options.summarizeAt || 12000;
    this.summaryModel = options.summaryModel || null;
    this.ai = options.ai || null;
    this.messages = [];
    this.pinnedMessages = [];
    this.summaries = [];
    this.totalTokens = 0;
    this.summarizeCount = 0;
  }

  /**
   * Add a message to context
   * @param {string} role - 'user', 'assistant', or 'system'
   * @param {string} content - Message content
   * @param {object} [opts] - Options
   * @param {boolean} [opts.pinned] - Pin this message (never summarized)
   * @returns {object} The message object
   */
  addMessage(role, content, opts = {}) {
    const tokens = estimateTokens(content);
    const msg = {
      role,
      content,
      tokens,
      timestamp: Date.now(),
      pinned: opts.pinned || false,
      id: this.messages.length,
    };

    if (msg.pinned) {
      this.pinnedMessages.push(msg);
    }

    this.messages.push(msg);
    this.totalTokens += tokens;

    // Check if summarization needed
    if (this.totalTokens > this.summarizeAt) {
      this._scheduleSummarize();
    }

    return msg;
  }

  /**
   * Pin a message by index so it's never summarized
   * @param {number} index
   */
  pinMessage(index) {
    if (index >= 0 && index < this.messages.length) {
      this.messages[index].pinned = true;
      if (!this.pinnedMessages.find(m => m.id === this.messages[index].id)) {
        this.pinnedMessages.push(this.messages[index]);
      }
    }
  }

  /**
   * Get the current context window as messages array
   * @returns {{ role: string, content: string }[]}
   */
  getContext() {
    const result = [];

    // Add summaries first
    if (this.summaries.length > 0) {
      result.push({
        role: 'system',
        content: `Previous conversation summary:\n${this.summaries.map(s => s.text).join('\n\n')}`,
      });
    }

    // Add pinned messages that are from summarized range
    for (const pin of this.pinnedMessages) {
      if (!this.messages.includes(pin)) {
        result.push({ role: pin.role, content: pin.content });
      }
    }

    // Add active messages
    for (const msg of this.messages) {
      result.push({ role: msg.role, content: msg.content });
    }

    return result;
  }

  /**
   * Get token count stats
   * @returns {object}
   */
  getStats() {
    return {
      totalMessages: this.messages.length,
      pinnedMessages: this.pinnedMessages.length,
      summaryCount: this.summaries.length,
      currentTokens: this.totalTokens,
      maxTokens: this.maxTokens,
      summarizeAt: this.summarizeAt,
      summarizeCount: this.summarizeCount,
    };
  }

  /**
   * Schedule summarization of older messages
   * @private
   */
  async _scheduleSummarize() {
    if (this._summarizing) return;
    this._summarizing = true;

    try {
      await this._summarize();
    } catch (err) {
      this.emit('error', err);
      // Fallback: just trim old messages
      this._trimOldMessages();
    } finally {
      this._summarizing = false;
    }
  }

  /**
   * Summarize older messages using AI
   * @private
   */
  async _summarize() {
    // Keep last ~30% of messages, summarize the rest
    const keepCount = Math.max(4, Math.floor(this.messages.length * 0.3));
    const toSummarize = this.messages.slice(0, this.messages.length - keepCount);
    const toKeep = this.messages.slice(this.messages.length - keepCount);

    if (toSummarize.length < 2) return;

    // Separate pinned messages
    const pinned = toSummarize.filter(m => m.pinned);
    const summarizable = toSummarize.filter(m => !m.pinned);

    if (summarizable.length < 2) return;

    let summaryText;

    if (this.ai) {
      try {
        const convo = summarizable.map(m => `${m.role}: ${m.content}`).join('\n');
        const result = await this.ai.chat([
          { role: 'user', content: `Summarize this conversation concisely, preserving key decisions, facts, and context:\n\n${convo}` }
        ]);
        summaryText = result.response || 'Summary unavailable';
      } catch {
        // Fallback to simple truncation
        summaryText = summarizable.map(m => {
          const preview = m.content.substring(0, 100);
          return `[${m.role}] ${preview}${m.content.length > 100 ? '...' : ''}`;
        }).join('\n');
      }
    } else {
      // No AI available — simple truncation summary
      summaryText = summarizable.map(m => {
        const preview = m.content.substring(0, 100);
        return `[${m.role}] ${preview}${m.content.length > 100 ? '...' : ''}`;
      }).join('\n');
    }

    this.summaries.push({
      text: summaryText,
      messageCount: summarizable.length,
      timestamp: Date.now(),
    });

    // Replace messages with kept ones (pinned stay as pinnedMessages)
    this.messages = toKeep;
    this.totalTokens = this.messages.reduce((sum, m) => sum + m.tokens, 0);
    this.totalTokens += estimateTokens(summaryText);
    this.summarizeCount++;

    this.emit('summarized', {
      summarized: summarizable.length,
      remaining: this.messages.length,
      tokens: this.totalTokens,
    });
  }

  /**
   * Fallback: trim old messages without AI summarization
   * @private
   */
  _trimOldMessages() {
    const keepCount = Math.max(4, Math.floor(this.messages.length * 0.5));
    const removed = this.messages.splice(0, this.messages.length - keepCount);
    this.totalTokens = this.messages.reduce((sum, m) => sum + m.tokens, 0);

    this.summaries.push({
      text: `[${removed.length} messages trimmed]`,
      messageCount: removed.length,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear all context
   */
  clear() {
    this.messages = [];
    this.pinnedMessages = [];
    this.summaries = [];
    this.totalTokens = 0;
  }
}

module.exports = { ContextManager, estimateTokens };
