/**
 * ARIES — Time Perception v1.0
 * Temporal awareness — understanding urgency, pacing, duration.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'temporal');
const PATTERNS_FILE = path.join(DATA_DIR, 'patterns.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const PACE = { RAPID: 'RAPID', NORMAL: 'NORMAL', SLOW: 'SLOW', IDLE: 'IDLE' };
const URGENCY = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' };
const URGENT_KEYWORDS = ['urgent', 'asap', 'emergency', 'now', 'immediately', 'hurry', 'critical', 'broken', 'down', 'crash', 'fix', 'help', 'stuck'];

class TimePerception {
  constructor(opts) {
    this.sessionStart = Date.now();
    this.messageTimestamps = [];
    this.messageCount = 0;
    this.topicChanges = [];
    this.currentTopic = null;
    this.topicStartTime = Date.now();
    this.idleGaps = [];
    this._patterns = { hourlyActivity: new Array(24).fill(0), dailyActivity: new Array(7).fill(0), sessions: [] };
    ensureDir();
    this._loadPatterns();
  }

  _loadPatterns() {
    const saved = readJSON(PATTERNS_FILE, null);
    if (saved) {
      this._patterns = { ...this._patterns, ...saved };
    }
  }

  _savePatterns() {
    writeJSON(PATTERNS_FILE, this._patterns);
  }

  // ── Record a message ──

  recordMessage(message, timestamp) {
    timestamp = timestamp || Date.now();
    this.messageTimestamps.push(timestamp);
    this.messageCount++;

    // Track hourly/daily patterns
    const d = new Date(timestamp);
    this._patterns.hourlyActivity[d.getHours()]++;
    this._patterns.dailyActivity[d.getDay()]++;

    // Detect topic change (simple heuristic)
    if (message) {
      const words = message.toLowerCase().split(/\s+/).filter(w => w.length > 5).slice(0, 5);
      const topicKey = words.join(' ');
      if (this.currentTopic && topicKey && !this.currentTopic.includes(words[0] || '___')) {
        this.topicChanges.push({ from: this.currentTopic, to: topicKey, at: timestamp });
        this.topicStartTime = timestamp;
      }
      if (topicKey) this.currentTopic = topicKey;
    }

    // Detect idle gaps
    if (this.messageTimestamps.length >= 2) {
      const gap = timestamp - this.messageTimestamps[this.messageTimestamps.length - 2];
      if (gap > 30 * 60 * 1000) { // >30 min
        this.idleGaps.push({ start: this.messageTimestamps[this.messageTimestamps.length - 2], end: timestamp, duration: gap });
      }
    }

    // Periodic save
    if (this.messageCount % 20 === 0) this._savePatterns();
  }

  // ── Conversation Pace ──

  getConversationPace() {
    if (this.messageTimestamps.length < 2) return PACE.IDLE;
    const last = this.messageTimestamps[this.messageTimestamps.length - 1];
    const prev = this.messageTimestamps[this.messageTimestamps.length - 2];
    const gap = (last - prev) / 1000;

    if (gap < 30) return PACE.RAPID;
    if (gap < 300) return PACE.NORMAL;
    if (gap < 1800) return PACE.SLOW;
    return PACE.IDLE;
  }

  // ── Urgency Estimation ──

  getUrgency(context) {
    let score = 0;
    const pace = this.getConversationPace();
    if (pace === PACE.RAPID) score += 3;
    else if (pace === PACE.NORMAL) score += 1;

    // Keyword scan
    if (context && typeof context === 'string') {
      const lower = context.toLowerCase();
      for (const kw of URGENT_KEYWORDS) {
        if (lower.includes(kw)) score += 2;
      }
      // ALL CAPS
      if (context === context.toUpperCase() && context.length > 10) score += 2;
      // Multiple exclamation/question marks
      if ((context.match(/[!?]{2,}/g) || []).length > 0) score += 1;
    }

    // Time of day
    const hour = new Date().getHours();
    if (hour >= 9 && hour <= 17) score += 1; // business hours = slightly more urgent
    if (this.isLateNight()) score -= 1; // late night = probably less urgent

    if (score >= 7) return URGENCY.CRITICAL;
    if (score >= 4) return URGENCY.HIGH;
    if (score >= 2) return URGENCY.MEDIUM;
    return URGENCY.LOW;
  }

  // ── Time Since ──

  timeSince(event) {
    const ms = Date.now() - (typeof event === 'number' ? event : Date.parse(event) || Date.now());
    if (ms < 0) return 'in the future';
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return dayNames[new Date(typeof event === 'number' ? event : Date.parse(event)).getDay()];
    }
    if (days < 30) return `${days} days ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
  }

  // ── Activity Patterns ──

  getActivityPattern() {
    const hourly = this._patterns.hourlyActivity;
    const daily = this._patterns.dailyActivity;
    const peakHour = hourly.indexOf(Math.max(...hourly));
    const peakDay = daily.indexOf(Math.max(...daily));
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Find quiet hours
    const quietHours = [];
    for (let i = 0; i < 24; i++) {
      if (hourly[i] === 0) quietHours.push(i);
    }

    return {
      peakHour,
      peakDay: dayNames[peakDay],
      hourlyActivity: hourly,
      dailyActivity: daily,
      quietHours,
      totalMessages: hourly.reduce((a, b) => a + b, 0),
    };
  }

  // ── Contextual Time ──

  isLateNight() {
    const h = new Date().getHours();
    return h >= 23 || h < 6;
  }

  isRushHour() {
    const h = new Date().getHours();
    return (h >= 7 && h <= 9) || (h >= 16 && h <= 18);
  }

  isWeekend() {
    const d = new Date().getDay();
    return d === 0 || d === 6;
  }

  // ── Stuck Detection ──

  estimateStuckDuration() {
    if (!this.currentTopic || this.topicChanges.length === 0) return null;
    const duration = Date.now() - this.topicStartTime;
    if (duration < 10 * 60 * 1000) return null; // less than 10 min, not stuck
    return {
      topic: this.currentTopic,
      duration,
      durationStr: this.timeSince(this.topicStartTime),
      isLikelyStuck: duration > 30 * 60 * 1000,
    };
  }

  // ── Full Temporal Context ──

  getTemporalContext() {
    const sessionDuration = Date.now() - this.sessionStart;
    return {
      pace: this.getConversationPace(),
      sessionDuration,
      sessionDurationStr: this._formatDuration(sessionDuration),
      messageCount: this.messageCount,
      topicChanges: this.topicChanges.length,
      currentTopic: this.currentTopic,
      stuckEstimate: this.estimateStuckDuration(),
      isLateNight: this.isLateNight(),
      isRushHour: this.isRushHour(),
      isWeekend: this.isWeekend(),
      idleGaps: this.idleGaps.length,
      lastMessage: this.messageTimestamps.length > 0 ? this.timeSince(this.messageTimestamps[this.messageTimestamps.length - 1]) : 'never',
    };
  }

  _formatDuration(ms) {
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const hours = Math.floor(mins / 60);
    if (hours > 0) return `${hours}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m ${secs % 60}s`;
    return `${secs}s`;
  }
}

module.exports = TimePerception;
