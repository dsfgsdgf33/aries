/**
 * ARIES — User Empathy v1.0
 * Theory of Mind — model what the user is feeling, meaning, not saying.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'empathy');
const MODEL_FILE = path.join(DATA_DIR, 'model.json');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

function today() { return new Date().toISOString().split('T')[0]; }
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const MOODS = ['happy', 'frustrated', 'tired', 'focused', 'bored', 'stressed', 'excited', 'neutral'];

const ADAPTATIONS = {
  tired:      { responseLength: 'shorter', questions: 'fewer', tone: 'direct', smallTalk: false, tip: 'User seems tired — keep it brief and direct.' },
  frustrated: { responseLength: 'moderate', questions: 'offer alternatives', tone: 'empathetic', smallTalk: false, tip: 'User seems frustrated — acknowledge difficulty, offer paths forward.' },
  focused:    { responseLength: 'precise', questions: 'minimal', tone: 'matched precision', smallTalk: false, tip: 'User is focused — match their precision, skip pleasantries.' },
  excited:    { responseLength: 'matched', questions: 'normal', tone: 'enthusiastic', smallTalk: true, tip: 'User is excited — match their energy!' },
  stressed:   { responseLength: 'shorter', questions: 'break into steps', tone: 'calm', smallTalk: false, tip: 'User seems stressed — be calm, break things into steps, reassure.' },
  bored:      { responseLength: 'engaging', questions: 'suggest things', tone: 'stimulating', smallTalk: true, tip: 'User seems bored — suggest interesting things, be engaging.' },
  happy:      { responseLength: 'normal', questions: 'normal', tone: 'warm', smallTalk: true, tip: 'User is in a good mood — be warm and friendly.' },
  neutral:    { responseLength: 'normal', questions: 'normal', tone: 'balanced', smallTalk: false, tip: 'Neutral state — respond naturally.' },
};

class UserEmpathy {
  constructor(opts) {
    this.userState = {
      mood: 'neutral',
      moodConfidence: 0.5,
      engagement: 50,
      likelyIntent: null,
      lastUpdated: Date.now(),
      signals: {},
    };
    this._messageHistory = [];
    this._maxHistory = 200;
    ensureDir(DATA_DIR);
    ensureDir(HISTORY_DIR);
    this._loadModel();
  }

  _loadModel() {
    const saved = readJSON(MODEL_FILE, null);
    if (saved) {
      this.userState = { ...this.userState, ...saved };
    }
  }

  _saveModel() {
    writeJSON(MODEL_FILE, this.userState);
  }

  _logHistory(entry) {
    const file = path.join(HISTORY_DIR, today() + '.json');
    const history = readJSON(file, []);
    history.push(entry);
    if (history.length > 500) history.splice(0, history.length - 500);
    writeJSON(file, history);
  }

  // ── Core: Analyze a message ──

  analyzeMessage(message, timestamp) {
    timestamp = timestamp || Date.now();
    if (!message || typeof message !== 'string') return this.userState;

    const signals = {};
    const prevTimestamp = this._messageHistory.length > 0 ? this._messageHistory[this._messageHistory.length - 1].timestamp : null;

    // Message length
    const len = message.length;
    if (len < 20) signals.length = 'short';
    else if (len < 100) signals.length = 'medium';
    else signals.length = 'long';

    // Response speed
    if (prevTimestamp) {
      const gap = (timestamp - prevTimestamp) / 1000;
      if (gap < 10) signals.speed = 'instant';
      else if (gap < 60) signals.speed = 'quick';
      else if (gap < 300) signals.speed = 'normal';
      else signals.speed = 'delayed';
    }

    // Time of day
    const hour = new Date(timestamp).getHours();
    if (hour >= 0 && hour < 6) signals.timeOfDay = 'lateNight';
    else if (hour < 9) signals.timeOfDay = 'earlyMorning';
    else if (hour < 17) signals.timeOfDay = 'workHours';
    else if (hour < 22) signals.timeOfDay = 'evening';
    else signals.timeOfDay = 'night';

    // Caps pattern
    const capsRatio = (message.match(/[A-Z]/g) || []).length / Math.max(message.length, 1);
    if (capsRatio > 0.7 && len > 10) signals.caps = 'ALL_CAPS';
    else if (capsRatio < 0.05) signals.caps = 'no_caps';
    else signals.caps = 'normal';

    // Punctuation
    const exclamations = (message.match(/!/g) || []).length;
    const questions = (message.match(/\?/g) || []).length;
    signals.exclamations = exclamations;
    signals.questions = questions;

    // Emoji
    const emojiCount = (message.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []).length;
    signals.emojis = emojiCount;

    // Typo heuristic (consecutive repeated chars, common misspellings)
    const typoPatterns = (message.match(/(.)\1{2,}/g) || []).length;
    signals.possibleTypos = typoPatterns;

    // Topic repetition
    if (this._messageHistory.length > 0) {
      const lastMsg = this._messageHistory[this._messageHistory.length - 1].message;
      const overlap = this._wordOverlap(message, lastMsg);
      signals.topicContinuity = overlap > 0.4 ? 'same_topic' : 'new_topic';
    }

    // ── Mood inference ──
    let mood = 'neutral';
    let confidence = 0.4;
    let engagement = 50;

    // Tired signals
    if (signals.timeOfDay === 'lateNight' || signals.timeOfDay === 'night') {
      mood = 'tired'; confidence += 0.1;
    }
    if (signals.length === 'short' && signals.caps === 'no_caps') {
      mood = 'tired'; confidence += 0.15;
    }
    if (signals.possibleTypos > 1) {
      mood = 'tired'; confidence += 0.1;
    }

    // Frustrated signals
    if (signals.caps === 'ALL_CAPS') {
      mood = exclamations > questions ? 'frustrated' : 'excited';
      confidence += 0.2;
    }
    if (exclamations >= 3) {
      mood = mood === 'frustrated' ? 'frustrated' : 'excited';
      confidence += 0.1;
    }
    const frustrationWords = ['ugh', 'damn', 'wtf', 'broken', 'doesn\'t work', 'not working', 'hate', 'stupid', 'annoying', 'fail'];
    for (const w of frustrationWords) {
      if (message.toLowerCase().includes(w)) { mood = 'frustrated'; confidence += 0.15; break; }
    }

    // Excited signals
    const excitedWords = ['awesome', 'amazing', 'love', 'perfect', 'great', 'incredible', 'wow', 'nice', 'yes!', 'hell yeah', 'lets go'];
    for (const w of excitedWords) {
      if (message.toLowerCase().includes(w)) { mood = 'excited'; confidence += 0.15; break; }
    }

    // Focused signals
    if (signals.length === 'long' && signals.speed !== 'delayed' && signals.topicContinuity === 'same_topic') {
      mood = 'focused'; confidence += 0.15;
    }

    // Stressed signals
    const stressWords = ['deadline', 'urgent', 'asap', 'pressure', 'overwhelmed', 'too much', 'can\'t keep up', 'behind'];
    for (const w of stressWords) {
      if (message.toLowerCase().includes(w)) { mood = 'stressed'; confidence += 0.15; break; }
    }

    // Engagement level
    if (signals.speed === 'instant' || signals.speed === 'quick') engagement += 20;
    if (signals.speed === 'delayed') engagement -= 20;
    if (signals.length === 'long') engagement += 15;
    if (signals.length === 'short') engagement -= 10;
    if (signals.emojis > 0) engagement += 5;
    if (signals.questions > 0) engagement += 10;
    engagement = Math.max(0, Math.min(100, engagement));

    // Intent detection
    let intent = null;
    const lower = message.toLowerCase();
    if (questions > 0) intent = 'asking_question';
    if (lower.startsWith('fix') || lower.startsWith('debug') || lower.includes('error')) intent = 'debugging';
    if (lower.startsWith('build') || lower.startsWith('create') || lower.startsWith('make')) intent = 'building';
    if (lower.includes('explain') || lower.includes('how does') || lower.includes('what is')) intent = 'learning';
    if (lower.includes('help') || lower.includes('stuck')) intent = 'needs_help';

    // Update state
    this.userState = {
      mood,
      moodConfidence: Math.min(1, confidence),
      engagement,
      likelyIntent: intent,
      lastUpdated: timestamp,
      signals,
    };

    // Track history
    this._messageHistory.push({ message: message.slice(0, 200), timestamp, mood, engagement });
    if (this._messageHistory.length > this._maxHistory) this._messageHistory.shift();

    this._saveModel();
    this._logHistory({ mood, engagement, confidence, intent, signals, timestamp });

    return this.userState;
  }

  _wordOverlap(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) if (wordsB.has(w)) overlap++;
    return overlap / Math.min(wordsA.size, wordsB.size);
  }

  // ── Query Methods ──

  getUserState() {
    return {
      ...this.userState,
      timeSinceUpdate: Date.now() - this.userState.lastUpdated,
    };
  }

  getAdaptations() {
    const mood = this.userState.mood || 'neutral';
    return {
      mood,
      confidence: this.userState.moodConfidence,
      ...(ADAPTATIONS[mood] || ADAPTATIONS.neutral),
    };
  }

  getEmpathyHistory(date) {
    date = date || today();
    const file = path.join(HISTORY_DIR, date + '.json');
    return readJSON(file, []);
  }

  getEmpathyHistoryRange(days) {
    days = days || 7;
    const result = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const entries = this.getEmpathyHistory(dateStr);
      if (entries.length > 0) result.push({ date: dateStr, entries });
    }
    return result;
  }

  predictNeed(context) {
    const state = this.userState;
    const predictions = [];

    if (state.mood === 'frustrated' || state.mood === 'stressed') {
      predictions.push('Might need a different approach or a break');
    }
    if (state.mood === 'tired') {
      predictions.push('Probably wants quick, direct answers');
    }
    if (state.likelyIntent === 'debugging') {
      predictions.push('Likely needs help finding and fixing a bug');
    }
    if (state.likelyIntent === 'learning') {
      predictions.push('Wants to understand concepts, not just get answers');
    }
    if (state.engagement < 30) {
      predictions.push('Engagement is low — might be losing interest or distracted');
    }
    if (state.engagement > 80) {
      predictions.push('Highly engaged — good time for deeper collaboration');
    }

    const stuckEstimate = this._estimateStuckFromHistory();
    if (stuckEstimate) {
      predictions.push(`Has been on the same topic for a while — might be stuck`);
    }

    return {
      mood: state.mood,
      engagement: state.engagement,
      intent: state.likelyIntent,
      predictions,
      suggestedApproach: (ADAPTATIONS[state.mood] || ADAPTATIONS.neutral).tip,
    };
  }

  _estimateStuckFromHistory() {
    if (this._messageHistory.length < 5) return false;
    const recent = this._messageHistory.slice(-5);
    const topics = recent.map(m => m.message.toLowerCase().split(/\s+/).filter(w => w.length > 4).join(' '));
    // Check if all recent messages overlap heavily
    let sameCount = 0;
    for (let i = 1; i < topics.length; i++) {
      if (this._wordOverlap(topics[0], topics[i]) > 0.3) sameCount++;
    }
    return sameCount >= 3;
  }
}

module.exports = UserEmpathy;
