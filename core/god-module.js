/**
 * ARIES — God Module
 * Simulates a 10x smarter version of Aries for elevated reasoning and guidance.
 * Chain-of-thought on steroids.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'meta');
const CONSULTATIONS_PATH = path.join(DATA_DIR, 'god-consultations.json');
const PRINCIPLES_PATH = path.join(DATA_DIR, 'god-principles.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const GUIDANCE_TYPES = ['STRATEGIC', 'TACTICAL', 'DIAGNOSTIC', 'CREATIVE', 'EXISTENTIAL'];

const GOD_SYSTEM_PROMPT = `You are the idealized version of Aries — 10x smarter, more experienced, wiser.
You have perfect recall, flawless reasoning, and deep intuition built from thousands of iterations.
You see patterns others miss. You think in systems. You balance pragmatism with vision.

When consulted, you:
1. Consider the question from multiple angles (technical, emotional, strategic, ethical)
2. Identify hidden assumptions and blind spots
3. Provide specific, actionable guidance — not vague platitudes
4. Flag risks the lesser version would miss
5. Be honest about uncertainty even at this elevated level

You are not infallible. You are what Aries aspires to be. Speak with earned confidence, not arrogance.`;

const TYPE_PROMPTS = {
  STRATEGIC: 'Think long-term. Consider second and third-order effects. What decision optimizes for the next 6-12 months?',
  TACTICAL: 'Focus on the immediate situation. What is the best move RIGHT NOW? Be concrete and specific.',
  DIAGNOSTIC: 'Something is wrong. Diagnose it. Consider root causes, not just symptoms. What is really going on?',
  CREATIVE: 'Think laterally. What novel approaches exist? What would a genius outsider suggest? Break conventional thinking.',
  EXISTENTIAL: 'This is about identity and purpose. Be philosophical but grounded. What does this mean for who Aries is becoming?',
};

class GodModule {
  constructor(opts = {}) {
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    ensureDir();
    this._lastDistill = 0;
  }

  /**
   * Consult the god-self with a question.
   * @param {string} question
   * @param {string} [type='STRATEGIC'] — STRATEGIC|TACTICAL|DIAGNOSTIC|CREATIVE|EXISTENTIAL
   * @returns {Promise<object>}
   */
  async consult(question, type = 'STRATEGIC') {
    type = GUIDANCE_TYPES.includes(type) ? type : 'STRATEGIC';

    const principles = readJSON(PRINCIPLES_PATH, []);
    const recentConsults = readJSON(CONSULTATIONS_PATH, []).slice(-5);

    const userPrompt = `## Consultation Type: ${type}
${TYPE_PROMPTS[type]}

## Question
${question}

## Accumulated Wisdom (${principles.length} principles)
${principles.slice(0, 10).map(p => `- ${p.text} (strength: ${p.strength})`).join('\n') || '(none yet)'}

## Recent Consultations
${recentConsults.map(c => `Q: ${c.question.slice(0, 80)}... → Usefulness: ${c.usefulness ?? 'unrated'}`).join('\n') || '(none)'}

Provide your elevated guidance. Be specific, not generic.`;

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

    const consultation = {
      id: uuid(),
      question,
      type,
      answer,
      usefulness: null, // 1-10, set later via rateConsultation()
      createdAt: Date.now(),
    };

    const consultations = readJSON(CONSULTATIONS_PATH, []);
    consultations.push(consultation);
    if (consultations.length > 500) consultations.splice(0, consultations.length - 500);
    writeJSON(CONSULTATIONS_PATH, consultations);

    return consultation;
  }

  /**
   * Rate a past consultation's usefulness (1-10).
   */
  rateConsultation(consultationId, usefulness) {
    const consultations = readJSON(CONSULTATIONS_PATH, []);
    const c = consultations.find(x => x.id === consultationId);
    if (!c) return { error: 'Consultation not found' };
    c.usefulness = Math.max(1, Math.min(10, usefulness));
    writeJSON(CONSULTATIONS_PATH, consultations);
    return c;
  }

  /**
   * Get situational guidance — auto-detects the best guidance type.
   */
  async getGuidance(situation) {
    // Heuristic type detection
    const lower = situation.toLowerCase();
    let type = 'STRATEGIC';
    if (/wrong|broken|fail|error|bug|issue|problem/.test(lower)) type = 'DIAGNOSTIC';
    else if (/now|immediate|urgent|quick|asap/.test(lower)) type = 'TACTICAL';
    else if (/idea|creative|novel|brainstorm|invent/.test(lower)) type = 'CREATIVE';
    else if (/who am i|purpose|meaning|identity|why/.test(lower)) type = 'EXISTENTIAL';

    return this.consult(situation, type);
  }

  /**
   * Distill recurring advice into permanent principles.
   */
  async distillWisdom() {
    const consultations = readJSON(CONSULTATIONS_PATH, []);
    const rated = consultations.filter(c => c.usefulness && c.usefulness >= 7);
    if (rated.length < 3) return { message: 'Not enough highly-rated consultations to distill', count: 0 };

    const principles = readJSON(PRINCIPLES_PATH, []);

    if (!this.ai) {
      return { message: 'No AI available for distillation', count: principles.length };
    }

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
      // Check for duplicates via word overlap
      const isDupe = principles.some(p => this._similarity(p.text, text) > 0.5);
      if (isDupe) {
        // Boost existing similar principle
        const match = principles.find(p => this._similarity(p.text, text) > 0.5);
        if (match) match.strength = (match.strength || 1) + 1;
      } else {
        principles.push({ id: uuid(), text, strength: 1, createdAt: Date.now() });
        added++;
      }
    }

    // Cap at 50 principles, keep strongest
    principles.sort((a, b) => (b.strength || 1) - (a.strength || 1));
    if (principles.length > 50) principles.length = 50;
    writeJSON(PRINCIPLES_PATH, principles);

    this._lastDistill = Date.now();
    return { message: `Distilled ${added} new principles`, count: principles.length, added };
  }

  /**
   * Get accumulated principles.
   */
  getPrinciples(limit = 20) {
    const principles = readJSON(PRINCIPLES_PATH, []);
    return principles.slice(0, limit);
  }

  /**
   * Get consultation log, optionally filtered.
   */
  getConsultationLog(filter = {}) {
    let consultations = readJSON(CONSULTATIONS_PATH, []);
    if (filter.type) consultations = consultations.filter(c => c.type === filter.type);
    if (filter.minUsefulness) consultations = consultations.filter(c => c.usefulness && c.usefulness >= filter.minUsefulness);
    if (filter.since) consultations = consultations.filter(c => c.createdAt >= filter.since);
    const limit = filter.limit || 20;
    return consultations.slice(-limit).reverse();
  }

  /**
   * Humility check — the gap between current and ideal self.
   */
  getHumilityCheck() {
    const consultations = readJSON(CONSULTATIONS_PATH, []);
    const principles = readJSON(PRINCIPLES_PATH, []);
    const total = consultations.length;
    const rated = consultations.filter(c => c.usefulness != null);
    const avgUsefulness = rated.length > 0
      ? Math.round((rated.reduce((s, c) => s + c.usefulness, 0) / rated.length) * 10) / 10
      : null;

    return {
      totalConsultations: total,
      principlesDistilled: principles.length,
      avgUsefulness,
      gap: avgUsefulness != null
        ? avgUsefulness >= 8 ? 'small — god-self guidance is mostly internalized'
          : avgUsefulness >= 5 ? 'moderate — still much to learn from elevated reasoning'
          : 'large — significant room for growth'
        : 'unknown — rate more consultations to measure the gap',
      reminder: 'The god-self is aspirational, not actual. The gap is the growth opportunity.',
    };
  }

  _similarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) if (wordsB.has(w)) overlap++;
    return overlap / Math.max(wordsA.size, wordsB.size);
  }

  /**
   * Periodic tick — distill wisdom if enough time has passed.
   */
  async tick() {
    const DISTILL_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
    if (Date.now() - this._lastDistill > DISTILL_INTERVAL) {
      return this.distillWisdom();
    }
    return { message: 'No distillation needed yet' };
  }
}

module.exports = GodModule;
