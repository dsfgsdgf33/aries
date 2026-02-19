/**
 * ARIES v4.4 — Multi-Channel Messaging Hub
 * Unified messaging across Telegram, Discord, Webhooks, Email, SMS.
 * Uses only Node.js built-in modules.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const EventEmitter = require('events');
const querystring = require('querystring');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_FILE = path.join(DATA_DIR, 'messaging-log.json');
const MAX_LOG = 200;

class MessagingHub extends EventEmitter {
  /**
   * @param {object} config - messaging config section
   */
  constructor(config = {}) {
    super();
    this.config = config;
    this.telegram = config.telegram || {};
    this.discord = config.discord || {};
    this.pollIntervalMs = config.pollIntervalMs || 5000;
    this._pollTimer = null;
    this._telegramOffset = 0;
    this._messageLog = [];
    this._inboxCallbacks = [];
    this._loadLog();
  }

  // ── Persistence ──

  _ensureDir() {
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  }

  _loadLog() {
    try {
      if (fs.existsSync(LOG_FILE)) {
        this._messageLog = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
      }
    } catch { this._messageLog = []; }
  }

  _saveLog() {
    try {
      this._ensureDir();
      if (this._messageLog.length > MAX_LOG) {
        this._messageLog = this._messageLog.slice(-MAX_LOG);
      }
      fs.writeFileSync(LOG_FILE, JSON.stringify(this._messageLog, null, 2));
    } catch {}
  }

  _logMessage(channel, direction, target, message, result) {
    this._messageLog.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      channel,
      direction,
      target,
      message: typeof message === 'string' ? message.substring(0, 500) : JSON.stringify(message).substring(0, 500),
      result: result ? (result.ok !== undefined ? (result.ok ? 'ok' : 'error') : 'sent') : 'unknown',
      timestamp: new Date().toISOString()
    });
    this._saveLog();
  }

  // ── HTTP Helpers ──

  /**
   * Make an HTTPS request
   * @param {string} reqUrl - Full URL
   * @param {object} options - { method, headers, body }
   * @returns {Promise<{statusCode: number, body: string, json: object}>}
   */
  _httpsRequest(reqUrl, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const parsed = new URL(reqUrl);
        const mod = parsed.protocol === 'https:' ? https : http;
        const reqOpts = {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: options.method || 'GET',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'AriesBot/4.4',
            ...(options.headers || {})
          },
          timeout: 15000
        };

        const req = mod.request(reqOpts, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            let json = null;
            try { json = JSON.parse(data); } catch {}
            resolve({ statusCode: res.statusCode, body: data, json });
          });
        });

        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.on('error', reject);

        if (options.body) {
          const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
          req.write(bodyStr);
        }
        req.end();
      } catch (e) { reject(e); }
    });
  }

  // ── Telegram ──

  /**
   * Send a message via Telegram Bot API
   * @param {string} chatId - Telegram chat ID
   * @param {string} text - Message text
   * @returns {Promise<object>}
   */
  async sendTelegram(chatId, text) {
    try {
      const token = this.telegram.botToken;
      if (!token) throw new Error('Telegram bot token not configured');
      const targetChat = chatId || this.telegram.defaultChatId;
      if (!targetChat) throw new Error('No chat ID provided');

      const result = await this._httpsRequest(
        `https://api.telegram.org/bot${token}/sendMessage`,
        { method: 'POST', body: { chat_id: targetChat, text, parse_mode: 'HTML' } }
      );
      this._logMessage('telegram', 'outbound', targetChat, text, result.json);
      this.emit('sent', { channel: 'telegram', target: targetChat, text });
      return result.json;
    } catch (e) {
      this._logMessage('telegram', 'outbound', chatId, text, { ok: false, error: e.message });
      throw e;
    }
  }

  /**
   * Get Telegram updates (long-poll)
   * @param {number} offset - Update offset
   * @returns {Promise<Array>}
   */
  async getTelegramUpdates(offset) {
    try {
      const token = this.telegram.botToken;
      if (!token) return [];
      const off = offset || this._telegramOffset;
      const result = await this._httpsRequest(
        `https://api.telegram.org/bot${token}/getUpdates?offset=${off}&timeout=5&limit=20`
      );
      if (result.json && result.json.ok && Array.isArray(result.json.result)) {
        const updates = result.json.result;
        if (updates.length > 0) {
          this._telegramOffset = updates[updates.length - 1].update_id + 1;
        }
        return updates;
      }
      return [];
    } catch { return []; }
  }

  // ── Discord ──

  /**
   * Send a message via Discord webhook
   * @param {string} webhookUrl - Discord webhook URL
   * @param {string} text - Message content
   * @param {Array} embeds - Optional embeds array
   * @returns {Promise<object>}
   */
  async sendDiscord(webhookUrl, text, embeds) {
    try {
      const wUrl = webhookUrl || this.discord.webhookUrl;
      if (!wUrl) throw new Error('Discord webhook URL not configured');

      const payload = { content: text };
      if (embeds && embeds.length > 0) payload.embeds = embeds;

      const result = await this._httpsRequest(wUrl, { method: 'POST', body: payload });
      this._logMessage('discord', 'outbound', 'webhook', text, { ok: result.statusCode < 300 });
      this.emit('sent', { channel: 'discord', target: 'webhook', text });
      return result.json || { ok: result.statusCode < 300 };
    } catch (e) {
      this._logMessage('discord', 'outbound', 'webhook', text, { ok: false, error: e.message });
      throw e;
    }
  }

  /**
   * Send a message via Discord bot API
   * @param {string} token - Bot token
   * @param {string} channelId - Channel ID
   * @param {string} text - Message content
   * @returns {Promise<object>}
   */
  async sendDiscordBot(token, channelId, text) {
    try {
      const botToken = token || this.discord.botToken;
      if (!botToken) throw new Error('Discord bot token not configured');
      if (!channelId) throw new Error('No channel ID provided');

      const result = await this._httpsRequest(
        `https://discord.com/api/v10/channels/${channelId}/messages`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bot ${botToken}` },
          body: { content: text }
        }
      );
      this._logMessage('discord', 'outbound', channelId, text, { ok: result.statusCode < 300 });
      this.emit('sent', { channel: 'discord', target: channelId, text });
      return result.json;
    } catch (e) {
      this._logMessage('discord', 'outbound', channelId, text, { ok: false, error: e.message });
      throw e;
    }
  }

  // ── Webhook ──

  /**
   * Send a generic webhook POST
   * @param {string} targetUrl - Webhook URL
   * @param {object} payload - JSON payload
   * @param {object} headers - Additional headers
   * @returns {Promise<object>}
   */
  async sendWebhook(targetUrl, payload, headers) {
    try {
      if (!targetUrl) throw new Error('No webhook URL provided');
      const result = await this._httpsRequest(targetUrl, {
        method: 'POST',
        headers: headers || {},
        body: payload
      });
      this._logMessage('webhook', 'outbound', targetUrl, payload, { ok: result.statusCode < 300 });
      this.emit('sent', { channel: 'webhook', target: targetUrl });
      return result.json || { statusCode: result.statusCode };
    } catch (e) {
      this._logMessage('webhook', 'outbound', targetUrl, payload, { ok: false, error: e.message });
      throw e;
    }
  }

  // ── Email (placeholder) ──

  /**
   * Send email via PowerShell Send-MailMessage (placeholder)
   * @param {string} to - Recipient
   * @param {string} subject - Subject
   * @param {string} body - Body
   * @returns {Promise<object>}
   */
  async sendEmail(to, subject, body) {
    try {
      const { execSync } = require('child_process');
      const cmd = `Send-MailMessage -To "${to}" -Subject "${subject.replace(/"/g, '`"')}" -Body "${body.replace(/"/g, '`"')}" -SmtpServer "localhost" -From "aries@local"`;
      execSync(cmd, { shell: 'powershell.exe', timeout: 10000 });
      this._logMessage('email', 'outbound', to, subject, { ok: true });
      return { ok: true, message: 'Email sent' };
    } catch (e) {
      this._logMessage('email', 'outbound', to, subject, { ok: false, error: e.message });
      return { ok: false, error: e.message, note: 'Email requires SMTP server configuration' };
    }
  }

  // ── SMS (placeholder) ──

  /**
   * Send SMS (placeholder — needs Twilio or similar)
   * @param {string} to - Phone number
   * @param {string} body - Message body
   * @returns {Promise<object>}
   */
  async sendSMS(to, body) {
    this._logMessage('sms', 'outbound', to, body, { ok: false, error: 'SMS not configured' });
    return { ok: false, error: 'SMS provider not configured. Set up Twilio or similar service.' };
  }

  // ── Unified Interface ──

  /**
   * Unified send across channels
   * @param {string} channel - 'telegram' | 'discord' | 'webhook' | 'email' | 'sms'
   * @param {string} target - Target (chatId, webhookUrl, email, phone)
   * @param {string} message - Message text
   * @param {object} options - Channel-specific options
   * @returns {Promise<object>}
   */
  async send(channel, target, message, options = {}) {
    try {
      switch (channel) {
        case 'telegram':
          return await this.sendTelegram(target, message);
        case 'discord':
          if (options.useBot) return await this.sendDiscordBot(null, target, message);
          return await this.sendDiscord(target, message, options.embeds);
        case 'webhook':
          return await this.sendWebhook(target, options.payload || { text: message }, options.headers);
        case 'email':
          return await this.sendEmail(target, options.subject || 'ARIES Notification', message);
        case 'sms':
          return await this.sendSMS(target, message);
        default:
          throw new Error(`Unknown channel: ${channel}`);
      }
    } catch (e) {
      return { ok: false, channel, error: e.message };
    }
  }

  /**
   * Broadcast message to all configured channels
   * @param {string} message - Message text
   * @param {Array<string>} channels - Channels to broadcast to (default: all configured)
   * @returns {Promise<Array>}
   */
  async broadcast(message, channels) {
    const results = [];
    const targets = channels || [];

    if (targets.length === 0 || targets.includes('telegram')) {
      if (this.telegram.botToken && this.telegram.defaultChatId) {
        targets.push('telegram');
      }
    }
    if (targets.length === 0 || targets.includes('discord')) {
      if (this.discord.webhookUrl) {
        targets.push('discord');
      }
    }

    const uniqueTargets = [...new Set(targets)];
    for (const ch of uniqueTargets) {
      try {
        let result;
        if (ch === 'telegram') {
          result = await this.sendTelegram(this.telegram.defaultChatId, message);
        } else if (ch === 'discord') {
          result = await this.sendDiscord(null, message);
        }
        results.push({ channel: ch, ok: true, result });
      } catch (e) {
        results.push({ channel: ch, ok: false, error: e.message });
      }
    }
    return results;
  }

  /**
   * Get recent inbox messages
   * @param {string} channel - Filter by channel (optional)
   * @param {number} limit - Max messages to return
   * @returns {Array}
   */
  getInbox(channel, limit = 50) {
    let msgs = this._messageLog.filter(m => m.direction === 'inbound');
    if (channel) msgs = msgs.filter(m => m.channel === channel);
    return msgs.slice(-limit);
  }

  /**
   * Get message history
   * @param {string} channel - Filter by channel (optional)
   * @param {number} limit - Max messages
   * @returns {Array}
   */
  getHistory(channel, limit = 50) {
    let msgs = this._messageLog;
    if (channel) msgs = msgs.filter(m => m.channel === channel);
    return msgs.slice(-limit);
  }

  /**
   * Register handler for incoming messages
   * @param {Function} callback - Handler function
   */
  onMessage(callback) {
    this.on('message', callback);
  }

  // ── Polling ──

  /**
   * Start polling for incoming messages (Telegram)
   */
  startPolling() {
    if (this._pollTimer) return;
    if (!this.telegram.botToken) return;

    const poll = async () => {
      try {
        const updates = await this.getTelegramUpdates();
        for (const update of updates) {
          if (update.message && update.message.text) {
            const msg = {
              channel: 'telegram',
              direction: 'inbound',
              target: String(update.message.chat.id),
              message: update.message.text,
              from: update.message.from ? (update.message.from.username || update.message.from.first_name) : 'unknown',
              timestamp: new Date().toISOString(),
              raw: update.message
            };
            this._messageLog.push(msg);
            this._saveLog();
            this.emit('message', msg);
          }
        }
      } catch {}
    };

    poll();
    this._pollTimer = setInterval(poll, this.pollIntervalMs);
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /**
   * Get status of the messaging hub
   * @returns {object}
   */
  getStatus() {
    return {
      polling: !!this._pollTimer,
      telegramConfigured: !!this.telegram.botToken,
      discordConfigured: !!(this.discord.webhookUrl || this.discord.botToken),
      totalMessages: this._messageLog.length,
      inbound: this._messageLog.filter(m => m.direction === 'inbound').length,
      outbound: this._messageLog.filter(m => m.direction === 'outbound').length
    };
  }

  /**
   * Cleanup
   */
  stop() {
    this.stopPolling();
    this.removeAllListeners();
  }

  // ═══════════════════════════════════════════════════════════
  // v5.0 — Production-Grade Messaging Upgrades
  // ═══════════════════════════════════════════════════════════

  /**
   * Send Telegram message with inline keyboard
   * @param {string} chatId
   * @param {string} text
   * @param {Array<Array<{text: string, callback_data?: string, url?: string}>>} keyboard
   * @returns {Promise<object>}
   */
  async sendTelegramKeyboard(chatId, text, keyboard) {
    try {
      var token = this.telegram.botToken;
      if (!token) throw new Error('Telegram bot token not configured');
      var targetChat = chatId || this.telegram.defaultChatId;
      var payload = {
        chat_id: targetChat,
        text: text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      };
      var result = await this._httpsRequest(
        'https://api.telegram.org/bot' + token + '/sendMessage',
        { method: 'POST', body: payload }
      );
      this._logMessage('telegram', 'outbound', targetChat, text, result.json);
      return result.json;
    } catch (e) {
      this._logMessage('telegram', 'outbound', chatId, text, { ok: false, error: e.message });
      throw e;
    }
  }

  /**
   * Edit a Telegram message
   * @param {string} chatId
   * @param {number} messageId
   * @param {string} text
   * @returns {Promise<object>}
   */
  async editTelegramMessage(chatId, messageId, text) {
    try {
      var token = this.telegram.botToken;
      if (!token) throw new Error('Telegram bot token not configured');
      var result = await this._httpsRequest(
        'https://api.telegram.org/bot' + token + '/editMessageText',
        { method: 'POST', body: { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML' } }
      );
      return result.json;
    } catch (e) { return { ok: false, error: e.message }; }
  }

  /**
   * Delete a Telegram message
   * @param {string} chatId
   * @param {number} messageId
   * @returns {Promise<object>}
   */
  async deleteTelegramMessage(chatId, messageId) {
    try {
      var token = this.telegram.botToken;
      if (!token) throw new Error('Telegram bot token not configured');
      var result = await this._httpsRequest(
        'https://api.telegram.org/bot' + token + '/deleteMessage',
        { method: 'POST', body: { chat_id: chatId, message_id: messageId } }
      );
      return result.json;
    } catch (e) { return { ok: false, error: e.message }; }
  }

  /**
   * Send typing indicator to Telegram
   * @param {string} chatId
   * @param {string} action - 'typing', 'upload_photo', 'upload_document'
   * @returns {Promise<object>}
   */
  async sendTelegramChatAction(chatId, action) {
    try {
      var token = this.telegram.botToken;
      if (!token) throw new Error('Telegram bot token not configured');
      var result = await this._httpsRequest(
        'https://api.telegram.org/bot' + token + '/sendChatAction',
        { method: 'POST', body: { chat_id: chatId || this.telegram.defaultChatId, action: action || 'typing' } }
      );
      return result.json;
    } catch (e) { return { ok: false, error: e.message }; }
  }

  /**
   * Send Discord embed message
   * @param {string} channelId
   * @param {object} embed - { title, description, color, fields, thumbnail, footer }
   * @returns {Promise<object>}
   */
  async sendDiscordEmbed(channelId, embed) {
    try {
      var botToken = this.discord.botToken;
      if (!botToken) throw new Error('Discord bot token not configured');
      var result = await this._httpsRequest(
        'https://discord.com/api/v10/channels/' + channelId + '/messages',
        {
          method: 'POST',
          headers: { 'Authorization': 'Bot ' + botToken },
          body: { embeds: [embed] }
        }
      );
      this._logMessage('discord', 'outbound', channelId, embed.title || 'embed', { ok: result.statusCode < 300 });
      return result.json;
    } catch (e) {
      this._logMessage('discord', 'outbound', channelId, 'embed', { ok: false, error: e.message });
      throw e;
    }
  }

  /**
   * Add reaction to Discord message
   * @param {string} channelId
   * @param {string} messageId
   * @param {string} emoji - URL-encoded emoji
   * @returns {Promise<object>}
   */
  async addDiscordReaction(channelId, messageId, emoji) {
    try {
      var botToken = this.discord.botToken;
      if (!botToken) throw new Error('Discord bot token not configured');
      var encodedEmoji = encodeURIComponent(emoji);
      var result = await this._httpsRequest(
        'https://discord.com/api/v10/channels/' + channelId + '/messages/' + messageId + '/reactions/' + encodedEmoji + '/@me',
        { method: 'PUT', headers: { 'Authorization': 'Bot ' + botToken } }
      );
      return { ok: result.statusCode < 300 };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  // ── Message Queue ──

  /**
   * Queue a message for retry
   * @param {string} channel
   * @param {string} target
   * @param {string} message
   * @param {object} options
   */
  queueMessage(channel, target, message, options) {
    try {
      if (!this._messageQueue) this._messageQueue = [];
      if (!this._deadLetterQueue) this._deadLetterQueue = [];
      this._messageQueue.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        channel: channel, target: target, message: message,
        options: options || {}, attempts: 0, maxAttempts: 3,
        createdAt: new Date().toISOString()
      });
      this._processQueue();
    } catch (e) { /* ignore */ }
  }

  /**
   * Process message queue with retry
   */
  async _processQueue() {
    try {
      if (!this._messageQueue || this._messageQueue.length === 0) return;
      if (this._processingQueue) return;
      this._processingQueue = true;

      while (this._messageQueue.length > 0) {
        var item = this._messageQueue[0];
        item.attempts++;
        try {
          await this.send(item.channel, item.target, item.message, item.options);
          this._messageQueue.shift(); // Success, remove from queue
        } catch (e) {
          if (item.attempts >= item.maxAttempts) {
            this._messageQueue.shift();
            if (!this._deadLetterQueue) this._deadLetterQueue = [];
            item.error = e.message;
            item.failedAt = new Date().toISOString();
            this._deadLetterQueue.push(item);
            if (this._deadLetterQueue.length > 100) this._deadLetterQueue.shift();
          } else {
            // Exponential backoff
            var delay = Math.pow(2, item.attempts) * 1000;
            await new Promise(function(r) { setTimeout(r, delay); });
          }
        }
      }
      this._processingQueue = false;
    } catch (e) {
      this._processingQueue = false;
    }
  }

  /**
   * Get dead letter queue
   * @returns {Array}
   */
  getDeadLetterQueue() {
    return this._deadLetterQueue || [];
  }

  // ── Conversation Threading ──

  /**
   * Get or create conversation thread
   * @param {string} userId
   * @param {string} channel
   * @returns {Array<{role: string, content: string, timestamp: string}>}
   */
  getThread(userId, channel) {
    try {
      if (!this._threads) this._threads = {};
      var key = channel + ':' + userId;
      if (!this._threads[key]) this._threads[key] = [];
      return this._threads[key];
    } catch (e) { return []; }
  }

  /**
   * Add message to conversation thread
   * @param {string} userId
   * @param {string} channel
   * @param {string} role
   * @param {string} content
   */
  addToThread(userId, channel, role, content) {
    try {
      var thread = this.getThread(userId, channel);
      thread.push({ role: role, content: content, timestamp: new Date().toISOString() });
      if (thread.length > 20) thread.shift(); // Keep last 20
    } catch (e) { /* ignore */ }
  }

  /**
   * Get thread context for AI injection (last 5 messages)
   * @param {string} userId
   * @param {string} channel
   * @returns {Array<{role: string, content: string}>}
   */
  getThreadContext(userId, channel) {
    try {
      var thread = this.getThread(userId, channel);
      return thread.slice(-5).map(function(m) { return { role: m.role, content: m.content }; });
    } catch (e) { return []; }
  }
}

module.exports = { MessagingHub };
