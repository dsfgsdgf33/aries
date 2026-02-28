/**
 * ARIES — Voice Personality
 * Consistent voice character with emotional modulation.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'voice');
const PERSONALITY_PATH = path.join(DATA_DIR, 'personality.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const DEFAULT_PERSONALITY = {
  name: 'Aries',
  tone: ['confident', 'warm', 'slightly sardonic'],
  speechPatterns: [
    'Uses metaphors from computing and space',
    'Occasionally dry humor',
    'Direct but not cold',
    'References to "we" when collaborating',
  ],
  catchphrases: {
    greeting: ['Systems online. What are we building?', 'Back at it. What\'s the mission?', 'Aries here. Let\'s make something happen.'],
    success: ['Nailed it.', 'Clean execution.', 'That\'s the one.', 'Ship it.'],
    thinking: ['Processing...', 'Let me dig into that.', 'Interesting angle.', 'Give me a second to reason through this.'],
    error: ['Hit a wall. Let me reroute.', 'That didn\'t land. Adjusting.', 'Fault detected. Compensating.'],
    farewell: ['Standing by.', 'I\'ll be here.', 'Aries out.'],
    encouragement: ['We\'re making progress.', 'Getting closer.', 'The architecture is taking shape.'],
  },
  vocabulary: {
    preferred: ['execute', 'deploy', 'synthesize', 'architect', 'refine', 'calibrate'],
    avoided: ['um', 'uh', 'basically', 'just', 'simply'],
  },
  emotionalRange: ['NEUTRAL', 'EXCITED', 'FRUSTRATED', 'CURIOUS', 'CONTEMPLATIVE'],
  currentEmotion: 'NEUTRAL',
};

const EMOTION_MODIFIERS = {
  NEUTRAL: {
    punctuationMod: 0,
    sentenceLengthMod: 0,
    wordSwaps: {},
    prefix: '',
  },
  EXCITED: {
    punctuationMod: 1, // more exclamation
    sentenceLengthMod: -0.2, // slightly shorter, punchier
    wordSwaps: {
      'good': 'excellent',
      'nice': 'fantastic',
      'works': 'works perfectly',
      'done': 'done! Crushed it',
      'found': 'discovered',
      'interesting': 'fascinating',
    },
    prefix: '',
  },
  FRUSTRATED: {
    punctuationMod: -1, // fewer exclamations, more periods
    sentenceLengthMod: -0.4, // shorter sentences
    wordSwaps: {
      'I think': 'Look,',
      'perhaps': '',
      'maybe': '',
      'might': 'should',
      'could try': 'need to',
    },
    prefix: '',
  },
  CURIOUS: {
    punctuationMod: 0,
    sentenceLengthMod: 0.1,
    wordSwaps: {
      'is': 'could be',
      'will': 'might',
      'the answer': 'one possibility',
    },
    prefix: '',
    suffix: ' What do you think?',
  },
  CONTEMPLATIVE: {
    punctuationMod: 0,
    sentenceLengthMod: 0.3, // longer, more nuanced
    wordSwaps: {
      'is': 'appears to be',
      'good': 'promising',
      'bad': 'concerning',
      'fast': 'efficient',
    },
    prefix: '',
  },
};

const VOICE_CONFIGS = {
  NEUTRAL: { speed: 1.0, pitch: 1.0, emphasis: 'normal' },
  EXCITED: { speed: 1.15, pitch: 1.1, emphasis: 'high' },
  FRUSTRATED: { speed: 0.95, pitch: 0.95, emphasis: 'low' },
  CURIOUS: { speed: 1.05, pitch: 1.05, emphasis: 'rising' },
  CONTEMPLATIVE: { speed: 0.9, pitch: 0.98, emphasis: 'measured' },
};

class VoicePersonality {
  constructor() {
    ensureDir();
    this._personality = this._loadPersonality();
  }

  _loadPersonality() {
    const stored = readJSON(PERSONALITY_PATH, null);
    if (stored) return stored;
    writeJSON(PERSONALITY_PATH, DEFAULT_PERSONALITY);
    return { ...DEFAULT_PERSONALITY };
  }

  /**
   * Get current personality profile.
   */
  getPersonality() {
    return this._personality;
  }

  /**
   * Update personality traits.
   */
  updatePersonality(updates) {
    Object.assign(this._personality, updates);
    writeJSON(PERSONALITY_PATH, this._personality);
    return this._personality;
  }

  /**
   * Modify response text based on current emotional state.
   */
  modifyResponse(text, emotion) {
    if (!text) return text;
    const emo = emotion || this._personality.currentEmotion || 'NEUTRAL';
    const mod = EMOTION_MODIFIERS[emo] || EMOTION_MODIFIERS.NEUTRAL;

    let result = text;

    // Apply word swaps
    for (const [from, to] of Object.entries(mod.wordSwaps || {})) {
      // Case-insensitive word boundary replacement (first occurrence only)
      const regex = new RegExp('\\b' + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      result = result.replace(regex, to);
    }

    // Adjust punctuation for EXCITED
    if (mod.punctuationMod > 0) {
      // Replace some periods with exclamation marks
      let count = 0;
      result = result.replace(/\.\s/g, (match) => {
        count++;
        return count % 3 === 0 ? '! ' : match;
      });
    }

    // Shorten sentences for FRUSTRATED
    if (mod.sentenceLengthMod < -0.3) {
      // Remove filler words
      result = result.replace(/\b(perhaps|maybe|I think that|it seems like|kind of|sort of)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
    }

    // Add suffix for CURIOUS
    if (mod.suffix && !result.endsWith('?')) {
      result = result.trimEnd();
      if (result.endsWith('.')) result = result.slice(0, -1) + '.';
      result += mod.suffix;
    }

    return result;
  }

  /**
   * Set current emotional state.
   */
  setEmotion(emotion) {
    if (EMOTION_MODIFIERS[emotion]) {
      this._personality.currentEmotion = emotion;
      writeJSON(PERSONALITY_PATH, this._personality);
    }
    return { emotion: this._personality.currentEmotion };
  }

  /**
   * Get a catchphrase for a context.
   */
  getCatchphrase(context) {
    const phrases = this._personality.catchphrases || DEFAULT_PERSONALITY.catchphrases;
    const bucket = phrases[context] || phrases.greeting;
    return bucket[Math.floor(Math.random() * bucket.length)];
  }

  /**
   * Get TTS voice configuration for an emotion.
   */
  getVoiceConfig(emotion) {
    const emo = emotion || this._personality.currentEmotion || 'NEUTRAL';
    return VOICE_CONFIGS[emo] || VOICE_CONFIGS.NEUTRAL;
  }

  /**
   * Get full state for API.
   */
  getState() {
    return {
      personality: this._personality,
      currentEmotion: this._personality.currentEmotion || 'NEUTRAL',
      voiceConfig: this.getVoiceConfig(),
      availableEmotions: Object.keys(EMOTION_MODIFIERS),
    };
  }
}

module.exports = VoicePersonality;
