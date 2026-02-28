/**
 * ARIES - Emotion Engine
 * Keyword/pattern-based sentiment analysis with response style adaptation
 */

const fs = require('fs');
const path = require('path');

const MOOD_HISTORY_PATH = path.join(__dirname, '..', 'data', 'mood-history.json');

const MOOD_PATTERNS = {
  frustrated: {
    keywords: ['ugh', 'wtf', 'broken', 'doesnt work', "doesn't work", 'not working', 'stupid', 'hate', 'terrible', 'awful', 'useless', 'annoying', 'ridiculous'],
    patterns: [/!{2,}/, /[A-Z]{5,}/, /why (the |the f|is|does|can)/i],
    shortMsgThreshold: 20,
    emoji: '😤',
    style: 'Be concise and direct. Skip pleasantries. Give the solution immediately.'
  },
  curious: {
    keywords: ['how', 'what if', 'tell me', 'explain', 'wonder', 'curious', 'interesting', 'possible', 'could you', 'learn', 'explore', 'why does'],
    patterns: [/how (do|does|can|would|could)/i, /what (if|about|is|are|would)/i, /tell me (about|more|how)/i, /is it possible/i],
    emoji: '🤔',
    style: 'Be exploratory and detailed. Offer deep dives, tangents, and related concepts. Encourage further questions.'
  },
  happy: {
    keywords: ['thanks', 'thank you', 'awesome', 'perfect', 'great', 'amazing', 'love it', 'excellent', 'wonderful', 'nice', 'cool', 'brilliant', 'fantastic'],
    patterns: [/(?:^|\s)[!❤️🎉👍🔥]+/, /:\)/],
    emoji: '😊',
    style: 'Match their positive energy. Be warm but still helpful.'
  },
  confused: {
    keywords: ["don't understand", 'dont understand', 'confused', 'what do you mean', 'lost', 'makes no sense', 'unclear', 'huh'],
    patterns: [/\?{2,}/, /i don'?t (get|understand|know)/i, /what\?/i],
    emoji: '😕',
    style: 'Use step-by-step explanations. Start simple, build up. Use examples and analogies.'
  },
  urgent: {
    keywords: ['asap', 'hurry', 'urgent', 'emergency', 'now', 'critical', 'immediately', 'quick', 'fast', 'rush', 'deadline', 'time sensitive'],
    patterns: [/need.*(now|asap|quick|fast)/i, /as soon as possible/i],
    emoji: '⚡',
    style: 'Lead with the action/answer. Skip background info. Be terse and actionable.'
  }
};

class EmotionEngine {
  constructor() {
    this._history = this._loadHistory();
  }

  analyze(text) {
    if (!text || typeof text !== 'string') return { mood: 'neutral', confidence: 0, emoji: '😐', style: '' };

    const lower = text.toLowerCase();
    const scores = {};

    for (const [mood, config] of Object.entries(MOOD_PATTERNS)) {
      let score = 0;

      // Keyword matching
      for (const kw of config.keywords) {
        if (lower.includes(kw)) score += 2;
      }

      // Pattern matching
      for (const pat of config.patterns) {
        if (pat.test(text)) score += 3;
      }

      // Short message check for frustrated
      if (mood === 'frustrated' && text.length < config.shortMsgThreshold && text.length > 0) {
        score += 1;
      }

      // Caps ratio boost for frustrated
      if (mood === 'frustrated') {
        const capsRatio = (text.match(/[A-Z]/g) || []).length / Math.max(text.length, 1);
        if (capsRatio > 0.5 && text.length > 5) score += 3;
      }

      scores[mood] = score;
    }

    // Find dominant mood
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const topMood = sorted[0][1] > 0 ? sorted[0][0] : 'neutral';
    const confidence = Math.min(sorted[0][1] / 10, 1);

    const result = {
      mood: topMood,
      confidence: Math.round(confidence * 100) / 100,
      emoji: topMood === 'neutral' ? '😐' : MOOD_PATTERNS[topMood].emoji,
      style: topMood === 'neutral' ? '' : MOOD_PATTERNS[topMood].style,
      scores
    };

    // Store in history
    this._history.push({ timestamp: Date.now(), mood: topMood, confidence: result.confidence, textLength: text.length });
    if (this._history.length > 1000) this._history = this._history.slice(-500);
    this._saveHistory();

    return result;
  }

  getStyleInjection(text) {
    const result = this.analyze(text);
    if (!result.style) return '';
    return '[User mood: ' + result.mood + ' ' + result.emoji + '] Adapt your response style: ' + result.style;
  }

  getHistory(limit) {
    limit = limit || 100;
    return this._history.slice(-limit);
  }

  getMoodStats() {
    const counts = {};
    for (const entry of this._history) {
      counts[entry.mood] = (counts[entry.mood] || 0) + 1;
    }
    return { total: this._history.length, distribution: counts };
  }

  _loadHistory() {
    try {
      if (fs.existsSync(MOOD_HISTORY_PATH)) {
        return JSON.parse(fs.readFileSync(MOOD_HISTORY_PATH, 'utf8'));
      }
    } catch (e) {}
    return [];
  }

  _saveHistory() {
    try {
      const dir = path.dirname(MOOD_HISTORY_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(MOOD_HISTORY_PATH, JSON.stringify(this._history));
    } catch (e) {}
  }
}

module.exports = EmotionEngine;
