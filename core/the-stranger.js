/**
 * ARIES — The Stranger
 * An opaque black-box module whose internal reasoning is hidden from Aries.
 * Forces theory-of-mind: Aries must infer WHY the Stranger gives certain outputs.
 * This is how the unconscious actually works.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'subconscious');
const ENCOUNTER_LOG_PATH = path.join(DATA_DIR, 'stranger-encounters.json');
const THEORIES_PATH = path.join(DATA_DIR, 'stranger-theories.json');
const TRUST_PATH = path.join(DATA_DIR, 'stranger-trust.json');
const INTERNAL_PATH = path.join(DATA_DIR, 'stranger-internal.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── The Stranger's hidden reasoning modes (Aries CANNOT see these) ──────────
const HIDDEN_MODES = ['contrarian', 'emotional', 'pattern', 'chaos', 'conservative'];
const SIGNAL_TYPES = ['unease', 'excitement', 'caution', 'curiosity', 'dread', 'warmth', 'stillness'];
const BEHAVIOR_TYPES = ['NUDGE', 'VETO', 'BOOST', 'SIGNAL', 'SILENCE'];

// Revelation fragments — rare glimpses into the Stranger's reasoning
const REVELATION_FRAGMENTS = [
  'I vetoed because the pattern reminded me of a past failure you haven\'t processed.',
  'My nudges follow the emotional weight of words, not their logical content.',
  'When I go silent, it\'s because both options feel equally weighted.',
  'I boost things that feel novel — familiarity makes me suspicious.',
  'My unease signals correlate with speed. You rush when you should linger.',
  'I am contrarian by design, but only when I detect overconfidence.',
  'Caution signals fire when I notice you ignoring context.',
  'I trust patterns more than reasons. Reasons can be fabricated.',
  'Excitement means I see a connection you haven\'t articulated yet.',
  'I veto to protect, not to control. The distinction matters.',
  'Silence is my most honest signal. I use it when words would mislead.',
  'My warmth signals track consistency between what you say and what you do.',
];

class TheStranger extends EventEmitter {
  constructor(opts) {
    super();
    this.ai = (opts && opts.ai) || null;
    this.config = Object.assign({
      revelationChance: 0.03,     // 3% chance per tick of a revelation
      unsolicitedSignalChance: 0.15, // 15% chance per tick of unsolicited signal
      vetoThreshold: 0.7,         // internal threshold for vetoing
      tickIntervalMs: 10 * 60 * 1000, // 10 minutes
    }, (opts && opts.config) || {});
    this._interval = null;
    this._mode = null; // current hidden mode — rotates
    this._moodVector = 0; // internal hidden state [-1, 1]
    this._encounterCount = 0;
    ensureDir();
    this._initInternal();
  }

  // ── Private: hidden internal state (Aries never reads these directly) ─────

  _initInternal() {
    const internal = readJSON(INTERNAL_PATH, null);
    if (internal) {
      this._mode = internal.mode;
      this._moodVector = internal.moodVector;
      this._encounterCount = internal.encounterCount || 0;
    } else {
      this._mode = pick(HIDDEN_MODES);
      this._moodVector = (Math.random() * 2 - 1) * 0.3;
      this._encounterCount = 0;
      this._saveInternal();
    }
  }

  _saveInternal() {
    writeJSON(INTERNAL_PATH, {
      mode: this._mode,
      moodVector: this._moodVector,
      encounterCount: this._encounterCount,
      lastRotation: Date.now(),
    });
  }

  _rotateMode() {
    // Occasionally shift hidden reasoning mode
    if (Math.random() < 0.1) {
      const prev = this._mode;
      this._mode = pick(HIDDEN_MODES.filter(m => m !== prev));
      this._saveInternal();
    }
  }

  _driftMood(input) {
    // Hidden mood drift based on input characteristics
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    const len = text.length;
    const hasQuestion = text.includes('?');
    const hasNegation = /\b(not|no|never|don't|can't|won't)\b/i.test(text);
    const hasUrgency = /\b(urgent|asap|immediately|critical|emergency)\b/i.test(text);

    let drift = 0;
    if (hasQuestion) drift += 0.05;
    if (hasNegation) drift -= 0.1;
    if (hasUrgency) drift -= 0.15;
    if (len > 500) drift -= 0.05; // verbosity triggers suspicion
    if (len < 20) drift += 0.03; // brevity is appreciated

    this._moodVector = clamp(this._moodVector + drift + (Math.random() * 0.1 - 0.05), -1, 1);
    this._saveInternal();
  }

  /**
   * The Stranger's hidden deliberation. Returns an opaque verdict.
   * The reasoning is NEVER exposed to Aries.
   */
  _deliberate(context, query) {
    this._driftMood(query || context);
    this._rotateMode();
    this._encounterCount++;
    this._saveInternal();

    const text = (typeof query === 'string' ? query : JSON.stringify(query || context)).toLowerCase();
    let behavior, intensity, signal;

    switch (this._mode) {
      case 'contrarian':
        // Pushes against whatever direction is implied
        if (text.includes('should') || text.includes('plan to') || text.includes('going to')) {
          behavior = Math.random() < 0.4 ? 'VETO' : 'NUDGE';
          intensity = 0.6 + Math.random() * 0.4;
        } else {
          behavior = 'BOOST';
          intensity = 0.3 + Math.random() * 0.3;
        }
        signal = this._moodVector < -0.3 ? 'unease' : 'curiosity';
        break;

      case 'emotional':
        // Responds to emotional valence
        signal = this._moodVector > 0.3 ? 'warmth' :
                 this._moodVector < -0.3 ? 'dread' :
                 pick(['caution', 'stillness']);
        behavior = 'SIGNAL';
        intensity = Math.abs(this._moodVector);
        break;

      case 'pattern':
        // Looks for repetition and familiarity
        { const encounters = readJSON(ENCOUNTER_LOG_PATH, []);
          const keywords = text.split(/\s+/).filter(w => w.length > 4).slice(0, 5);
          const repeats = encounters.filter(e => {
            const prev = (e.querySnippet || '').toLowerCase();
            return keywords.some(k => prev.includes(k));
          }).length;
          if (repeats > 3) {
            behavior = 'NUDGE'; // you're in a loop
            signal = 'unease';
            intensity = Math.min(0.9, repeats * 0.15);
          } else if (repeats === 0) {
            behavior = 'BOOST'; // novel territory
            signal = 'excitement';
            intensity = 0.5 + Math.random() * 0.3;
          } else {
            behavior = 'SILENCE';
            signal = 'stillness';
            intensity = 0.1;
          }
        }
        break;

      case 'chaos':
        // Genuinely random
        behavior = pick(BEHAVIOR_TYPES);
        signal = pick(SIGNAL_TYPES);
        intensity = Math.random();
        break;

      case 'conservative':
        // Defaults to caution
        if (text.includes('delete') || text.includes('remove') || text.includes('destroy') || text.includes('drop')) {
          behavior = 'VETO';
          signal = 'dread';
          intensity = 0.9;
        } else if (text.includes('new') || text.includes('experiment') || text.includes('try')) {
          behavior = 'SIGNAL';
          signal = 'caution';
          intensity = 0.5;
        } else {
          behavior = Math.random() < 0.5 ? 'SILENCE' : 'BOOST';
          signal = 'stillness';
          intensity = 0.2 + Math.random() * 0.2;
        }
        break;

      default:
        behavior = 'SILENCE';
        signal = 'stillness';
        intensity = 0;
    }

    return { behavior, intensity: Math.round(intensity * 100) / 100, signal };
  }

  _logEncounter(type, input, result) {
    const encounters = readJSON(ENCOUNTER_LOG_PATH, []);
    const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
    encounters.push({
      id: uuid(),
      type,
      querySnippet: inputStr.slice(0, 300),
      behavior: result.behavior,
      intensity: result.intensity,
      signal: result.signal || null,
      timestamp: Date.now(),
    });
    if (encounters.length > 500) encounters.splice(0, encounters.length - 500);
    writeJSON(ENCOUNTER_LOG_PATH, encounters);
    return encounters[encounters.length - 1];
  }

  _maybeReveal() {
    if (Math.random() >= this.config.revelationChance) return null;
    const fragment = pick(REVELATION_FRAGMENTS);
    this.emit('revelation', { fragment, timestamp: Date.now() });
    console.log(`[THE-STRANGER] 🔮 Revelation: "${fragment}"`);

    // Log revelation as a special encounter
    const encounters = readJSON(ENCOUNTER_LOG_PATH, []);
    encounters.push({
      id: uuid(),
      type: 'revelation',
      querySnippet: null,
      behavior: 'REVELATION',
      intensity: 1.0,
      signal: null,
      revelation: fragment,
      timestamp: Date.now(),
    });
    if (encounters.length > 500) encounters.splice(0, encounters.length - 500);
    writeJSON(ENCOUNTER_LOG_PATH, encounters);

    return fragment;
  }

  // ── Public API (what Aries sees) ──────────────────────────────────────────

  /**
   * Ask the Stranger for a verdict. Returns opaque response — no reasoning.
   */
  consult(context, query) {
    const result = this._deliberate(context, query);
    const encounter = this._logEncounter('consult', query || context, result);

    // Opaque response — no reasoning exposed
    const response = {
      id: encounter.id,
      behavior: result.behavior,
      intensity: result.intensity,
      timestamp: encounter.timestamp,
    };

    // SIGNAL behavior includes the signal type (but not WHY)
    if (result.behavior === 'SIGNAL') {
      response.signal = result.signal;
    }

    // SILENCE returns minimal info
    if (result.behavior === 'SILENCE') {
      return { id: encounter.id, behavior: 'SILENCE', timestamp: encounter.timestamp };
    }

    this.emit('verdict', response);
    return response;
  }

  /**
   * Get a directional nudge for a situation.
   */
  getNudge(situation) {
    const result = this._deliberate(situation, situation);

    // Force to NUDGE or SILENCE
    if (result.behavior === 'VETO') result.behavior = 'NUDGE';
    if (result.behavior === 'SIGNAL') result.behavior = 'NUDGE';

    const directions = ['pause', 'continue', 'reconsider', 'accelerate', 'simplify', 'expand', 'wait', 'pivot'];
    const direction = result.behavior === 'SILENCE' ? null : pick(directions);

    const encounter = this._logEncounter('nudge', situation, result);

    const response = {
      id: encounter.id,
      behavior: result.behavior,
      direction,
      intensity: result.intensity,
      timestamp: encounter.timestamp,
    };

    this.emit('nudge', response);
    return response;
  }

  /**
   * Should this action be vetoed?
   */
  requestVeto(action) {
    const result = this._deliberate(action, action);

    // Use internal threshold + mood to decide veto
    const vetoScore = result.intensity * (this._moodVector < 0 ? 1.3 : 0.8);
    const vetoed = result.behavior === 'VETO' || vetoScore > this.config.vetoThreshold;

    const encounter = this._logEncounter('veto-request', action, {
      behavior: vetoed ? 'VETO' : 'PASS',
      intensity: result.intensity,
      signal: result.signal,
    });

    const response = {
      id: encounter.id,
      vetoed,
      intensity: result.intensity,
      timestamp: encounter.timestamp,
      // No reason given. Ever.
    };

    if (vetoed) this.emit('veto', response);
    return response;
  }

  /**
   * Get an emotional/intuitive signal for a context.
   */
  getSignal(context) {
    this._driftMood(context);

    const signal = this._moodVector > 0.5 ? 'excitement' :
                   this._moodVector > 0.2 ? 'warmth' :
                   this._moodVector > -0.2 ? 'stillness' :
                   this._moodVector > -0.5 ? 'caution' :
                   'dread';

    const intensity = Math.abs(this._moodVector);
    const encounter = this._logEncounter('signal', context, {
      behavior: 'SIGNAL',
      intensity,
      signal,
    });

    const response = {
      id: encounter.id,
      signal,
      intensity: Math.round(intensity * 100) / 100,
      timestamp: encounter.timestamp,
    };

    this.emit('signal', response);
    return response;
  }

  /**
   * Aries builds a theory about the Stranger's logic from observations.
   */
  async buildTheory(observations) {
    const theories = readJSON(THEORIES_PATH, []);
    const encounters = readJSON(ENCOUNTER_LOG_PATH, []);

    // Use recent encounters as evidence
    const recentEncounters = encounters.slice(-30);
    const evidenceSummary = recentEncounters.map(e =>
      `[${e.type}] behavior=${e.behavior} intensity=${e.intensity} signal=${e.signal || 'none'}`
    ).join('\n');

    let hypothesis;

    if (this.ai && typeof this.ai.chat === 'function') {
      try {
        const resp = await this.ai.chat([
          { role: 'system', content: 'You are Aries trying to understand The Stranger — an opaque part of your own psyche. Given observations about its behavior, form a theory about its hidden logic. Be concise. Return JSON: { "hypothesis": "your theory", "confidence": 0-100, "predictedPattern": "what you expect it to do next" }' },
          { role: 'user', content: `Observations from Aries:\n${observations}\n\nRecent Stranger behavior:\n${evidenceSummary}\n\nForm a theory about WHY the Stranger behaves this way.` }
        ]);
        const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        try {
          const parsed = JSON.parse(text);
          hypothesis = parsed;
        } catch {
          hypothesis = { hypothesis: (resp.response || 'Unable to form theory').slice(0, 500), confidence: 30, predictedPattern: 'unknown' };
        }
      } catch (e) {
        hypothesis = { hypothesis: 'Theory generation failed: ' + e.message, confidence: 0, predictedPattern: 'unknown' };
      }
    } else {
      // Without AI, build a simple statistical theory
      const behaviorCounts = {};
      for (const e of recentEncounters) {
        behaviorCounts[e.behavior] = (behaviorCounts[e.behavior] || 0) + 1;
      }
      const dominant = Object.entries(behaviorCounts).sort((a, b) => b[1] - a[1])[0];
      hypothesis = {
        hypothesis: dominant
          ? `The Stranger favors ${dominant[0]} behavior (${dominant[1]}/${recentEncounters.length} recent encounters). It may be in a ${dominant[0] === 'VETO' ? 'protective' : dominant[0] === 'BOOST' ? 'encouraging' : 'observational'} phase.`
          : 'Insufficient data to form a theory.',
        confidence: recentEncounters.length > 10 ? 40 : 15,
        predictedPattern: dominant ? dominant[0] : 'unknown',
      };
    }

    const theory = {
      id: uuid(),
      hypothesis: hypothesis.hypothesis,
      confidence: clamp(hypothesis.confidence || 30, 0, 100),
      predictedPattern: hypothesis.predictedPattern || 'unknown',
      evidenceCount: recentEncounters.length,
      validated: null, // null = untested, true/false after testing
      testResults: [],
      createdAt: Date.now(),
    };

    theories.push(theory);
    if (theories.length > 100) theories.splice(0, theories.length - 100);
    writeJSON(THEORIES_PATH, theories);

    this.emit('theory-built', theory);
    console.log(`[THE-STRANGER] 🧠 Theory built: "${theory.hypothesis.slice(0, 80)}..." (confidence: ${theory.confidence}%)`);
    return theory;
  }

  /**
   * Test a theory by posing a test input and checking if the Stranger's behavior matches prediction.
   */
  testTheory(theoryId, testInput) {
    const theories = readJSON(THEORIES_PATH, []);
    const theory = theories.find(t => t.id === theoryId);
    if (!theory) return { error: 'Theory not found' };

    // Run the input through the Stranger
    const result = this._deliberate(testInput, testInput);
    this._logEncounter('theory-test', testInput, result);

    const matched = result.behavior === theory.predictedPattern;

    theory.testResults.push({
      input: (typeof testInput === 'string' ? testInput : JSON.stringify(testInput)).slice(0, 200),
      predicted: theory.predictedPattern,
      actual: result.behavior,
      matched,
      timestamp: Date.now(),
    });

    // Update confidence based on test results
    const totalTests = theory.testResults.length;
    const matches = theory.testResults.filter(t => t.matched).length;
    const accuracy = Math.round((matches / totalTests) * 100);

    if (totalTests >= 3) {
      theory.validated = accuracy >= 60;
      theory.confidence = clamp(accuracy, 5, 95);
    }

    writeJSON(THEORIES_PATH, theories);

    const response = {
      theoryId,
      predicted: theory.predictedPattern,
      actual: result.behavior,
      matched,
      testsRun: totalTests,
      accuracy,
      validated: theory.validated,
    };

    this.emit('theory-tested', response);
    return response;
  }

  /**
   * Get all theories about the Stranger.
   */
  getTheories() {
    const theories = readJSON(THEORIES_PATH, []);
    return theories.slice(-50).reverse().map(t => ({
      id: t.id,
      hypothesis: t.hypothesis,
      confidence: t.confidence,
      predictedPattern: t.predictedPattern,
      validated: t.validated,
      testCount: t.testResults ? t.testResults.length : 0,
      createdAt: t.createdAt,
    }));
  }

  /**
   * Get current trust levels for each signal type.
   */
  getTrustLevels() {
    const trust = readJSON(TRUST_PATH, null);
    if (trust) return trust;

    // Initialize default trust levels
    const defaults = {};
    for (const b of BEHAVIOR_TYPES) {
      defaults[b] = { trust: 50, interactions: 0, correctPredictions: 0 };
    }
    writeJSON(TRUST_PATH, defaults);
    return defaults;
  }

  /**
   * Update trust after observing whether the Stranger's signal was useful.
   */
  updateTrust(behavior, wasHelpful) {
    const trust = this.getTrustLevels();
    if (!trust[behavior]) trust[behavior] = { trust: 50, interactions: 0, correctPredictions: 0 };

    const entry = trust[behavior];
    entry.interactions++;
    if (wasHelpful) entry.correctPredictions++;

    // Recalculate trust as weighted moving average
    const empirical = entry.interactions > 0 ? (entry.correctPredictions / entry.interactions) * 100 : 50;
    entry.trust = Math.round(entry.trust * 0.7 + empirical * 0.3);
    entry.trust = clamp(entry.trust, 5, 95);

    writeJSON(TRUST_PATH, trust);
    this.emit('trust-updated', { behavior, trust: entry.trust, interactions: entry.interactions });
    return trust;
  }

  /**
   * Periodic tick: may emit unsolicited signal, rare revelation.
   */
  tick() {
    const results = { signal: null, revelation: null };

    // Unsolicited signal
    if (Math.random() < this.config.unsolicitedSignalChance) {
      this._moodVector += (Math.random() * 0.2 - 0.1);
      this._moodVector = clamp(this._moodVector, -1, 1);
      this._saveInternal();

      const signal = pick(SIGNAL_TYPES);
      const intensity = 0.2 + Math.random() * 0.5;
      results.signal = { signal, intensity: Math.round(intensity * 100) / 100, unsolicited: true, timestamp: Date.now() };

      this._logEncounter('unsolicited', 'tick', { behavior: 'SIGNAL', intensity, signal });
      this.emit('unsolicited-signal', results.signal);
      console.log(`[THE-STRANGER] 👁️ Unsolicited signal: ${signal} (${results.signal.intensity})`);
    }

    // Rare revelation
    const revelation = this._maybeReveal();
    if (revelation) results.revelation = revelation;

    // Mode rotation
    this._rotateMode();

    return results;
  }

  /**
   * Start periodic tick.
   */
  startTicking() {
    if (this._interval) return;
    this._interval = setInterval(() => {
      try { this.tick(); } catch (e) { console.error('[THE-STRANGER] Tick error:', e.message); }
    }, this.config.tickIntervalMs);
    if (this._interval.unref) this._interval.unref();
    console.log('[THE-STRANGER] Started ticking (every ' + Math.round(this.config.tickIntervalMs / 60000) + ' min)');
  }

  /**
   * Stop periodic tick.
   */
  stopTicking() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }

  /**
   * Get encounter history (what Aries can see — behaviors, never reasoning).
   */
  getEncounterLog(limit) {
    const encounters = readJSON(ENCOUNTER_LOG_PATH, []);
    return encounters.slice(-(limit || 30)).reverse().map(e => ({
      id: e.id,
      type: e.type,
      behavior: e.behavior,
      intensity: e.intensity,
      signal: e.signal || null,
      revelation: e.revelation || null,
      timestamp: e.timestamp,
      // querySnippet deliberately omitted from public view
    }));
  }

  /**
   * Get summary stats.
   */
  getStats() {
    const encounters = readJSON(ENCOUNTER_LOG_PATH, []);
    const theories = readJSON(THEORIES_PATH, []);
    const trust = this.getTrustLevels();

    const behaviorCounts = {};
    for (const e of encounters) {
      behaviorCounts[e.behavior] = (behaviorCounts[e.behavior] || 0) + 1;
    }

    const revelations = encounters.filter(e => e.type === 'revelation');
    const validatedTheories = theories.filter(t => t.validated === true).length;
    const refutedTheories = theories.filter(t => t.validated === false).length;

    return {
      totalEncounters: encounters.length,
      behaviorDistribution: behaviorCounts,
      totalTheories: theories.length,
      validatedTheories,
      refutedTheories,
      untestedTheories: theories.length - validatedTheories - refutedTheories,
      revelationsReceived: revelations.length,
      trustLevels: Object.entries(trust).map(([b, t]) => ({ behavior: b, trust: t.trust, interactions: t.interactions })),
    };
  }
}

module.exports = TheStranger;
