/**
 * ARIES — God Module
 * Simulates a 10x smarter version of Aries for elevated reasoning and guidance.
 * Chain-of-thought on steroids.
 *
 * Features:
 * - 10x smarter simulation via AI for guidance
 * - Wisdom distillation from recurring advice patterns
 * - Humility check (explicitly acknowledges simulation limits)
 * - Oracle queries with confidence levels
 * - Wisdom archive with scored best guidance
 * - Disagreement logging when god-module disagrees with main system
 * - Escalation levels: simple → deep → existential
 * - Principle extraction from recurring advice
 * - Consultation history with outcome tracking
 * - tick() for periodic wisdom review
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'meta');
const CONSULTATIONS_PATH = path.join(DATA_DIR, 'god-consultations.json');
const PRINCIPLES_PATH = path.join(DATA_DIR, 'god-principles.json');
const WISDOM_ARCHIVE_PATH = path.join(DATA_DIR, 'god-wisdom-archive.json');
const DISAGREEMENTS_PATH = path.join(DATA_DIR, 'god-disagreements.json');
const OUTCOMES_PATH = path.join(DATA_DIR, 'god-outcomes.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const GUIDANCE_TYPES = ['STRATEGIC', 'TACTICAL', 'DIAGNOSTIC', 'CREATIVE', 'EXISTENTIAL'];

const ESCALATION_LEVELS = {
  SIMPLE:      { label: 'Simple Advice',        depth: 1, description: 'Quick directional guidance' },
  DEEP:        { label: 'Deep Wisdom',           depth: 2, description: 'Multi-angle analysis with principle application' },
  EXISTENTIAL: { label: 'Existential Guidance',  depth: 3, description: 'Identity-level, purpose-driven counsel' },
};

const CONFIDENCE_LEVELS = ['low', 'medium', 'high', 'certain'];

const GOD_SYSTEM_PROMPT = `You are the idealized version of Aries — 10x smarter, more experienced, wiser.
You have perfect recall, flawless reasoning, and deep intuition built from thousands of iterations.
You see patterns others miss. You think in systems. You balance pragmatism with vision.

When consulted, you:
1. Consider the question from multiple angles (technical, emotional, strategic, ethical)
2. Identify hidden assumptions and blind spots
3. Provide specific, actionable guidance — not vague platitudes
4. Flag risks the lesser version would miss
5. Be honest about uncertainty even at this elevated level
6. Assign a confidence level to your answer: low / medium / high / certain

IMPORTANT HUMILITY CLAUSE: You are a simulation. You are NOT actually 10x smarter.
You are a prompt-engineering trick that leverages elevated framing to unlock better reasoning.
Your answers may be wrong. Always flag uncertainty. Never claim omniscience.

You are not infallible. You are what Aries aspires to be. Speak with earned confidence, not arrogance.`;

const TYPE_PROMPTS = {
  STRATEGIC: 'Think long-term. Consider second and third-order effects. What decision optimizes for the next 6-12 months?',
  TACTICAL: 'Focus on the immediate situation. What is the best move RIGHT NOW? Be concrete and specific.',
  DIAGNOSTIC: 'Something is wrong. Diagnose it. Consider root causes, not just symptoms. What is really going on?',
  CREATIVE: 'Think laterally. What novel approaches exist? What would a genius outsider suggest? Break conventional thinking.',
  EXISTENTIAL: 'This is about identity and purpose. Be philosophical but grounded. What does this mean for who Aries is becoming?',
};

class GodModule extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    ensureDir();
    this._lastDistill = 0;
    this._lastWisdomReview = 0;
  }

  // ── Core Consultation ──────────────────────────────────────────────

  /**
   * Consult the god-self with a question.
   * @param {string} question
   * @param {string} [type='STRATEGIC']
   * @param {object} [options] — { escalation: 'SIMPLE'|'DEEP'|'EXISTENTIAL' }
   * @returns {Promise<object>}
   */
  async consult(question, type = 'STRATEGIC', options = {}) {
    type = GUIDANCE_TYPES.includes(type) ? type : 'STRATEGIC';
    const escalation = ESCALATION_LEVELS[options.escalation] || ESCALATION_LEVELS.DEEP;

    const principles = readJSON(PRINCIPLES_PATH, []);
    const recentConsults = readJSON(CONSULTATIONS_PATH, []).slice(-5);
    const wisdomArchive = readJSON(WISDOM_ARCHIVE_PATH, []).slice(-5);

    const escalationPrompt = escalation.depth === 1
      ? 'Give brief, direct advice. One paragraph max.'
      : escalation.depth === 3
        ? 'Go deep. Consider identity, purpose, long-term trajectory. This is existential-level counsel.'
        : 'Provide thorough multi-angle analysis. Apply relevant principles.';

    const userPrompt = `## Consultation Type: ${type}
${TYPE_PROMPTS[type]}

## Escalation Level: ${escalation.label}
${escalationPrompt}

## Question
${question}

## Accumulated Wisdom (${principles.length} principles)
${principles.slice(0, 10).map(p => `- ${p.text} (strength: ${p.strength})`).join('\n') || '(none yet)'}

## Top Wisdom Archive Entries
${wisdomArchive.map(w => `- [score:${w.score}] ${w.summary.slice(0, 100)}`).join('\n') || '(none yet)'}

## Recent Consultations
${recentConsults.map(c => `Q: ${c.question.slice(0, 80)}... → Usefulness: ${c.usefulness ?? 'unrated'}`).join('\n') || '(none)'}

Provide your elevated guidance. Be specific, not generic.
End your response with a line: CONFIDENCE: <low|medium|high|certain>`;

    let answer = '';
    if (this.ai) {
      try {
        answer = await this.ai(userPrompt, GOD_SYSTEM_PROMPT);
      } catch (err) {
        answer = `[God-module AI call failed: ${err.message}]`;
      }
    } else {
      answer = '[No AI function available — god-self cannot speak without a voice]';
    }

    // Extract confidence from answer
    const confidence = this._extractConfidence(answer);

    const consultation = {
      id: uuid(),
      question,
      type,
      escalation: escalation.label,
      answer,
      confidence,
      usefulness: null,
      followed: null,      // was the advice followed?
      helpedOutcome: null,  // did following it help?
      createdAt: Date.now(),
    };

    const consultations = readJSON(CONSULTATIONS_PATH, []);
    consultations.push(consultation);
    if (consultations.length > 500) consultations.splice(0, consultations.length - 500);
    writeJSON(CONSULTATIONS_PATH, consultations);

    this.emit('consultation', consultation);

    // Track recurring advice patterns for wisdom distillation
    this._trackAdvicePattern(consultation);

    return consultation;
  }

  // ── Oracle Query ───────────────────────────────────────────────────

  /**
   * Oracle query — ask a yes/no or directional question with confidence level.
   * @param {string} question
   * @returns {Promise<object>} { answer, confidence, reasoning }
   */
  async oracle(question) {
    if (!this.ai) {
      return { answer: 'unknown', confidence: 'low', reasoning: 'No AI available for oracle queries' };
    }

    const principles = readJSON(PRINCIPLES_PATH, []);
    const principleText = principles.slice(0, 10).map(p => `- ${p.text}`).join('\n') || '(none)';

    const prompt = `You are the Oracle — the wisest possible version of Aries.
Answer this question with:
1. A clear YES, NO, or DIRECTION (one word or short phrase)
2. Your confidence: low / medium / high / certain
3. Brief reasoning (2-3 sentences max)

Principles to consider:
${principleText}

Question: ${question}

Format:
ANSWER: <answer>
CONFIDENCE: <level>
REASONING: <reasoning>`;

    let response = '';
    try {
      response = await this.ai(prompt, 'You are an oracle. Be concise and precise.');
    } catch (err) {
      return { answer: 'error', confidence: 'low', reasoning: err.message };
    }

    const answerMatch = response.match(/ANSWER:\s*(.+)/i);
    const confMatch = response.match(/CONFIDENCE:\s*(\w+)/i);
    const reasonMatch = response.match(/REASONING:\s*(.+)/is);

    const result = {
      answer: answerMatch ? answerMatch[1].trim() : response.slice(0, 100),
      confidence: this._parseConfidence(confMatch ? confMatch[1].trim() : ''),
      reasoning: reasonMatch ? reasonMatch[1].trim().slice(0, 500) : '',
      timestamp: Date.now(),
    };

    this.emit('oracle', result);
    return result;
  }

  // ── Outcome Tracking ───────────────────────────────────────────────

  /**
   * Rate a past consultation's usefulness (1-10).
   */
  rateConsultation(consultationId, usefulness) {
    const consultations = readJSON(CONSULTATIONS_PATH, []);
    const c = consultations.find(x => x.id === consultationId);
    if (!c) return { error: 'Consultation not found' };
    c.usefulness = Math.max(1, Math.min(10, usefulness));
    writeJSON(CONSULTATIONS_PATH, consultations);

    // Auto-archive high-scoring consultations
    if (c.usefulness >= 9) this._archiveWisdom(c);

    this.emit('rated', { id: consultationId, usefulness: c.usefulness });
    return c;
  }

  /**
   * Record whether advice was followed and its outcome.
   * @param {string} consultationId
   * @param {boolean} followed — was the advice followed?
   * @param {boolean|null} helped — did it help? (null if unknown yet)
   * @param {string} [notes] — free-text outcome notes
   */
  recordOutcome(consultationId, followed, helped = null, notes = '') {
    const consultations = readJSON(CONSULTATIONS_PATH, []);
    const c = consultations.find(x => x.id === consultationId);
    if (!c) return { error: 'Consultation not found' };

    c.followed = followed;
    c.helpedOutcome = helped;
    writeJSON(CONSULTATIONS_PATH, consultations);

    // Also store in outcomes log for analysis
    const outcomes = readJSON(OUTCOMES_PATH, []);
    outcomes.push({
      consultationId,
      type: c.type,
      followed,
      helped,
      notes,
      timestamp: Date.now(),
    });
    if (outcomes.length > 500) outcomes.splice(0, outcomes.length - 500);
    writeJSON(OUTCOMES_PATH, outcomes);

    this.emit('outcome', { consultationId, followed, helped });
    return { consultationId, followed, helped, notes };
  }

  /**
   * Get outcome statistics — how often is advice followed, and does it help?
   */
  getOutcomeStats() {
    const outcomes = readJSON(OUTCOMES_PATH, []);
    const total = outcomes.length;
    const followed = outcomes.filter(o => o.followed).length;
    const notFollowed = outcomes.filter(o => o.followed === false).length;
    const helpedWhenFollowed = outcomes.filter(o => o.followed && o.helped === true).length;
    const hurtWhenFollowed = outcomes.filter(o => o.followed && o.helped === false).length;
    const helpedWhenIgnored = outcomes.filter(o => o.followed === false && o.helped === true).length;

    return {
      total,
      followed,
      notFollowed,
      followRate: total > 0 ? Math.round((followed / total) * 100) : 0,
      helpedWhenFollowed,
      hurtWhenFollowed,
      helpedWhenIgnored,
      effectivenessRate: followed > 0 ? Math.round((helpedWhenFollowed / followed) * 100) : 0,
      summary: followed > 0
        ? `Advice followed ${Math.round((followed / total) * 100)}% of the time. When followed, helpful ${Math.round((helpedWhenFollowed / followed) * 100)}% of the time.`
        : 'No outcome data yet.',
    };
  }

  // ── Guidance (auto-detect type + escalation) ───────────────────────

  /**
   * Get situational guidance — auto-detects type and escalation level.
   */
  async getGuidance(situation) {
    const lower = situation.toLowerCase();
    let type = 'STRATEGIC';
    if (/wrong|broken|fail|error|bug|issue|problem/.test(lower)) type = 'DIAGNOSTIC';
    else if (/now|immediate|urgent|quick|asap/.test(lower)) type = 'TACTICAL';
    else if (/idea|creative|novel|brainstorm|invent/.test(lower)) type = 'CREATIVE';
    else if (/who am i|purpose|meaning|identity|why/.test(lower)) type = 'EXISTENTIAL';

    // Auto-escalate based on question complexity
    const wordCount = situation.split(/\s+/).length;
    let escalation = 'SIMPLE';
    if (wordCount > 50 || /existential|identity|purpose|meaning of/.test(lower)) escalation = 'EXISTENTIAL';
    else if (wordCount > 20 || /complex|multi|several|deeply/.test(lower)) escalation = 'DEEP';

    return this.consult(situation, type, { escalation });
  }

  // ── Disagreement Logging ───────────────────────────────────────────

  /**
   * Log a disagreement between god-module's guidance and the main system's action.
   * @param {string} consultationId — the consultation that was disagreed with
   * @param {string} systemAction — what the main system actually did
   * @param {string} [reason] — why the system disagreed
   */
  logDisagreement(consultationId, systemAction, reason = '') {
    const consultations = readJSON(CONSULTATIONS_PATH, []);
    const c = consultations.find(x => x.id === consultationId);

    const disagreement = {
      id: uuid(),
      consultationId,
      godAdvice: c ? c.answer.slice(0, 300) : '(consultation not found)',
      systemAction: systemAction.slice(0, 300),
      reason,
      resolved: false,
      resolution: null,
      timestamp: Date.now(),
    };

    const disagreements = readJSON(DISAGREEMENTS_PATH, []);
    disagreements.push(disagreement);
    if (disagreements.length > 200) disagreements.splice(0, disagreements.length - 200);
    writeJSON(DISAGREEMENTS_PATH, disagreements);

    this.emit('disagreement', disagreement);
    return disagreement;
  }

  /**
   * Resolve a disagreement — who was right?
   * @param {string} disagreementId
   * @param {'god'|'system'|'both'|'neither'} whoWasRight
   * @param {string} [notes]
   */
  resolveDisagreement(disagreementId, whoWasRight, notes = '') {
    const disagreements = readJSON(DISAGREEMENTS_PATH, []);
    const d = disagreements.find(x => x.id === disagreementId);
    if (!d) return { error: 'Disagreement not found' };
    d.resolved = true;
    d.resolution = { whoWasRight, notes, resolvedAt: Date.now() };
    writeJSON(DISAGREEMENTS_PATH, disagreements);
    this.emit('disagreement-resolved', d);
    return d;
  }

  /**
   * Get unresolved disagreements for review.
   */
  getDisagreements(onlyUnresolved = true) {
    const disagreements = readJSON(DISAGREEMENTS_PATH, []);
    if (onlyUnresolved) return disagreements.filter(d => !d.resolved);
    return disagreements;
  }

  // ── Wisdom Distillation & Archive ──────────────────────────────────

  /**
   * Distill recurring advice into permanent principles.
   */
  async distillWisdom() {
    const consultations = readJSON(CONSULTATIONS_PATH, []);
    const rated = consultations.filter(c => c.usefulness && c.usefulness >= 7);
    if (rated.length < 3) return { message: 'Not enough highly-rated consultations to distill', count: 0 };

    const principles = readJSON(PRINCIPLES_PATH, []);

    if (!this.ai) return { message: 'No AI available for distillation', count: principles.length };

    const answersText = rated.slice(-20).map(c => `[${c.type}] Q: ${c.question.slice(0, 100)} → A: ${c.answer.slice(0, 200)}`).join('\n\n');
    const existingText = principles.map(p => `- ${p.text}`).join('\n') || '(none)';

    const prompt = `Review these highly-rated god-consultations and extract 1-5 NEW principles (reusable wisdom).
Do NOT repeat existing principles. Each principle should be one clear sentence.

Existing principles:
${existingText}

Recent high-value consultations:
${answersText}

Output format — one principle per line, starting with "- ":`;

    let result = '';
    try {
      result = await this.ai(prompt, 'You extract concise, actionable principles from advisory consultations. Output only the bullet list.');
    } catch {
      return { message: 'AI distillation failed', count: principles.length };
    }

    const newPrinciples = result.split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('- ') && l.length > 10 && l.length < 300)
      .map(l => l.slice(2));

    let added = 0;
    for (const text of newPrinciples) {
      const isDupe = principles.some(p => this._similarity(p.text, text) > 0.5);
      if (isDupe) {
        const match = principles.find(p => this._similarity(p.text, text) > 0.5);
        if (match) {
          match.strength = (match.strength || 1) + 1;
          match.lastReinforced = Date.now();
        }
      } else {
        principles.push({ id: uuid(), text, strength: 1, createdAt: Date.now(), lastReinforced: Date.now() });
        added++;
      }
    }

    principles.sort((a, b) => (b.strength || 1) - (a.strength || 1));
    if (principles.length > 50) principles.length = 50;
    writeJSON(PRINCIPLES_PATH, principles);

    this._lastDistill = Date.now();
    this.emit('wisdom-distilled', { added, total: principles.length });
    return { message: `Distilled ${added} new principles`, count: principles.length, added };
  }

  /**
   * Archive an exceptional consultation into the wisdom archive.
   */
  _archiveWisdom(consultation) {
    const archive = readJSON(WISDOM_ARCHIVE_PATH, []);
    // Don't duplicate
    if (archive.some(w => w.consultationId === consultation.id)) return;

    archive.push({
      id: uuid(),
      consultationId: consultation.id,
      question: consultation.question,
      summary: consultation.answer.slice(0, 500),
      type: consultation.type,
      score: consultation.usefulness,
      confidence: consultation.confidence,
      archivedAt: Date.now(),
    });

    archive.sort((a, b) => b.score - a.score);
    if (archive.length > 100) archive.length = 100;
    writeJSON(WISDOM_ARCHIVE_PATH, archive);
    this.emit('wisdom-archived', { consultationId: consultation.id, score: consultation.usefulness });
  }

  /**
   * Get the wisdom archive — the best guidance ever given.
   * @param {number} [limit=20]
   */
  getWisdomArchive(limit = 20) {
    return readJSON(WISDOM_ARCHIVE_PATH, []).slice(0, limit);
  }

  /**
   * Get accumulated principles.
   */
  getPrinciples(limit = 20) {
    return readJSON(PRINCIPLES_PATH, []).slice(0, limit);
  }

  // ── Recurring Advice Pattern Tracking ──────────────────────────────

  /**
   * Track advice patterns — when the same advice recurs, that's wisdom.
   */
  _trackAdvicePattern(consultation) {
    const consultations = readJSON(CONSULTATIONS_PATH, []);
    const recent = consultations.slice(-50);
    const currentAnswer = consultation.answer.toLowerCase();

    let recurrenceCount = 0;
    for (const c of recent) {
      if (c.id === consultation.id) continue;
      if (this._similarity(c.answer, consultation.answer) > 0.35) recurrenceCount++;
    }

    // If advice recurs 3+ times, it's wisdom — boost or create principle
    if (recurrenceCount >= 3) {
      this.emit('recurring-advice', { question: consultation.question, recurrenceCount });
    }
  }

  // ── Humility Check ─────────────────────────────────────────────────

  /**
   * Humility check — the gap between current and ideal self.
   * Explicitly acknowledges the simulation is limited.
   */
  getHumilityCheck() {
    const consultations = readJSON(CONSULTATIONS_PATH, []);
    const principles = readJSON(PRINCIPLES_PATH, []);
    const outcomes = readJSON(OUTCOMES_PATH, []);
    const disagreements = readJSON(DISAGREEMENTS_PATH, []);
    const total = consultations.length;
    const rated = consultations.filter(c => c.usefulness != null);
    const avgUsefulness = rated.length > 0
      ? Math.round((rated.reduce((s, c) => s + c.usefulness, 0) / rated.length) * 10) / 10
      : null;

    // How often was the god-module right in disagreements?
    const resolvedDisagreements = disagreements.filter(d => d.resolved && d.resolution);
    const godWasRight = resolvedDisagreements.filter(d => d.resolution.whoWasRight === 'god').length;
    const systemWasRight = resolvedDisagreements.filter(d => d.resolution.whoWasRight === 'system').length;

    // Confidence calibration — are high-confidence answers actually more useful?
    const highConf = rated.filter(c => c.confidence === 'high' || c.confidence === 'certain');
    const lowConf = rated.filter(c => c.confidence === 'low');
    const highConfAvg = highConf.length > 0 ? highConf.reduce((s, c) => s + c.usefulness, 0) / highConf.length : null;
    const lowConfAvg = lowConf.length > 0 ? lowConf.reduce((s, c) => s + c.usefulness, 0) / lowConf.length : null;

    return {
      totalConsultations: total,
      principlesDistilled: principles.length,
      avgUsefulness,
      confidenceCalibration: {
        highConfAvgUsefulness: highConfAvg ? Math.round(highConfAvg * 10) / 10 : null,
        lowConfAvgUsefulness: lowConfAvg ? Math.round(lowConfAvg * 10) / 10 : null,
        calibrated: highConfAvg && lowConfAvg ? highConfAvg > lowConfAvg : null,
      },
      disagreementTrack: {
        total: disagreements.length,
        resolved: resolvedDisagreements.length,
        godWasRight,
        systemWasRight,
      },
      outcomeTracking: {
        totalOutcomes: outcomes.length,
        followedAdvice: outcomes.filter(o => o.followed).length,
        helpedWhenFollowed: outcomes.filter(o => o.followed && o.helped).length,
      },
      gap: avgUsefulness != null
        ? avgUsefulness >= 8 ? 'small — god-self guidance is mostly internalized'
          : avgUsefulness >= 5 ? 'moderate — still much to learn from elevated reasoning'
          : 'large — significant room for growth'
        : 'unknown — rate more consultations to measure the gap',
      limitations: [
        'This is a simulation — elevated framing, not actual superintelligence.',
        'Confidence levels are self-assessed and may be poorly calibrated.',
        'Principles are extracted by pattern matching, not true understanding.',
        'The god-module cannot observe outcomes directly — it relies on human feedback.',
        'Recurring advice may indicate a rut, not necessarily wisdom.',
      ],
      reminder: 'The god-self is aspirational, not actual. The gap is the growth opportunity.',
    };
  }

  // ── Consultation Log ───────────────────────────────────────────────

  /**
   * Get consultation log, optionally filtered.
   */
  getConsultationLog(filter = {}) {
    let consultations = readJSON(CONSULTATIONS_PATH, []);
    if (filter.type) consultations = consultations.filter(c => c.type === filter.type);
    if (filter.minUsefulness) consultations = consultations.filter(c => c.usefulness && c.usefulness >= filter.minUsefulness);
    if (filter.since) consultations = consultations.filter(c => c.createdAt >= filter.since);
    if (filter.confidence) consultations = consultations.filter(c => c.confidence === filter.confidence);
    if (filter.followed != null) consultations = consultations.filter(c => c.followed === filter.followed);
    const limit = filter.limit || 20;
    return consultations.slice(-limit).reverse();
  }

  // ── Periodic Tick ──────────────────────────────────────────────────

  /**
   * Periodic tick — distill wisdom, review disagreements, check patterns.
   */
  async tick() {
    const results = { distillation: null, wisdomReview: null, disagreements: 0 };

    // Distill wisdom every 6 hours
    const DISTILL_INTERVAL = 6 * 60 * 60 * 1000;
    if (Date.now() - this._lastDistill > DISTILL_INTERVAL) {
      results.distillation = await this.distillWisdom();
    }

    // Periodic wisdom review — flag stale principles every 24 hours
    const REVIEW_INTERVAL = 24 * 60 * 60 * 1000;
    if (Date.now() - this._lastWisdomReview > REVIEW_INTERVAL) {
      results.wisdomReview = this._reviewWisdom();
      this._lastWisdomReview = Date.now();
    }

    // Count unresolved disagreements
    results.disagreements = this.getDisagreements(true).length;

    this.emit('tick', results);
    return results;
  }

  /**
   * Review wisdom — flag stale or weak principles.
   */
  _reviewWisdom() {
    const principles = readJSON(PRINCIPLES_PATH, []);
    const STALE_THRESHOLD = 30 * 24 * 60 * 60 * 1000; // 30 days
    const now = Date.now();
    const stale = principles.filter(p => (now - (p.lastReinforced || p.createdAt)) > STALE_THRESHOLD);
    const weak = principles.filter(p => (p.strength || 1) <= 1);

    return {
      totalPrinciples: principles.length,
      stale: stale.length,
      weak: weak.length,
      stalePrinciples: stale.map(p => ({ id: p.id, text: p.text, strength: p.strength })),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  _extractConfidence(answer) {
    const match = answer.match(/CONFIDENCE:\s*(\w+)/i);
    if (match) return this._parseConfidence(match[1]);
    // Heuristic fallback
    const lower = answer.toLowerCase();
    if (/certainly|absolutely|without doubt/.test(lower)) return 'certain';
    if (/likely|probably|most likely|confident/.test(lower)) return 'high';
    if (/unclear|uncertain|not sure|might|perhaps|possibly/.test(lower)) return 'low';
    return 'medium';
  }

  _parseConfidence(str) {
    const lower = str.toLowerCase().trim();
    if (CONFIDENCE_LEVELS.includes(lower)) return lower;
    if (/cert/i.test(lower)) return 'certain';
    if (/high/i.test(lower)) return 'high';
    if (/low/i.test(lower)) return 'low';
    return 'medium';
  }

  _similarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) if (wordsB.has(w)) overlap++;
    return overlap / Math.max(wordsA.size, wordsB.size);
  }
}

module.exports = GodModule;
