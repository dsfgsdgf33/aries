/**
 * ARIES — Shadow Self v1.0
 * Internal adversarial pressure. Keeps the system honest.
 * A persistent adversarial voice that challenges reasoning, decisions, and self-assessments.
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'shadow');
const CHALLENGES_PATH = path.join(DATA_DIR, 'challenges.json');
const INSIGHTS_PATH = path.join(DATA_DIR, 'insights.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');

const CHALLENGE_TYPES = [
  'DEVIL_ADVOCATE',
  'ASSUMPTION_ATTACK',
  'OVERCONFIDENCE_CHECK',
  'BLIND_SPOT_PROBE',
  'MOTIVATION_QUESTION',
  'FAILURE_PREMORTEM',
];

const CHALLENGE_PROMPTS = {
  DEVIL_ADVOCATE: 'Argue the OPPOSITE position. Be convincing. What if the conclusion is completely wrong?',
  ASSUMPTION_ATTACK: 'Identify every hidden assumption in this reasoning. Which ones are weakest? Which are unexamined?',
  OVERCONFIDENCE_CHECK: 'This claim seems too confident. What evidence would DISPROVE it? What are the error bars?',
  BLIND_SPOT_PROBE: 'What is this reasoning NOT considering? What perspectives are missing? What data was ignored?',
  MOTIVATION_QUESTION: 'Why does Aries REALLY want to do this? Is this genuine reasoning or post-hoc rationalization? What emotional or systemic bias is driving this?',
  FAILURE_PREMORTEM: 'Assume this decision fails spectacularly. Write the post-mortem. What went wrong and why was it predictable?',
};

const DEFAULT_STATE = {
  strength: 50,           // 0-100 aggressiveness
  totalChallenges: 0,
  rightCount: 0,          // shadow was right (caught real problem)
  wrongCount: 0,          // shadow was wrong (unnecessary obstruction)
  lastInsightAt: 0,
  lastTickAt: 0,
};

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class ShadowSelf extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core module for LLM access
   * @param {object} opts.config - shadow config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.insightIntervalMs = this.config.insightIntervalMs || 6 * 60 * 60 * 1000; // 6h default
    this.overdueThresholdMs = this.config.overdueThresholdMs || 24 * 60 * 60 * 1000; // 24h
    this.maxChallenges = this.config.maxChallenges || 500;
    this.maxInsights = this.config.maxInsights || 200;
    ensureDir();
  }

  // ── State ──

  _getState() { return readJSON(STATE_PATH, { ...DEFAULT_STATE }); }
  _saveState(state) { writeJSON(STATE_PATH, state); }
  _getChallenges() { return readJSON(CHALLENGES_PATH, []); }
  _saveChallenges(c) { if (c.length > this.maxChallenges) c.splice(0, c.length - this.maxChallenges); writeJSON(CHALLENGES_PATH, c); }
  _getInsights() { return readJSON(INSIGHTS_PATH, []); }
  _saveInsights(ins) { if (ins.length > this.maxInsights) ins.splice(0, ins.length - this.maxInsights); writeJSON(INSIGHTS_PATH, ins); }

  // ── Core: Challenge Reasoning ──

  /**
   * Shadow challenges a piece of reasoning.
   * @param {string} reasoning - The reasoning to challenge
   * @param {string} [type] - Challenge type (auto-selected if omitted)
   * @returns {object} The challenge record
   */
  async challenge(reasoning, type) {
    if (!type) type = this._autoSelectType(reasoning);
    if (!CHALLENGE_TYPES.includes(type)) type = 'DEVIL_ADVOCATE';

    const state = this._getState();
    const challenge = {
      id: uuid(),
      type,
      reasoning: reasoning.slice(0, 2000),
      challenge: null,
      response: null,
      status: 'open',        // open → addressed | acknowledged | dismissed | vindicated
      outcome: null,          // null → 'shadow_right' | 'shadow_wrong' | 'inconclusive'
      strength: state.strength,
      createdAt: Date.now(),
      respondedAt: null,
      resolvedAt: null,
    };

    // Generate the challenge via AI
    if (this.ai) {
      try {
        const shadowText = await this._generateChallenge(reasoning, type, state.strength);
        challenge.challenge = shadowText;
      } catch (e) {
        challenge.challenge = this._fallbackChallenge(reasoning, type);
      }
    } else {
      challenge.challenge = this._fallbackChallenge(reasoning, type);
    }

    const challenges = this._getChallenges();
    challenges.push(challenge);
    this._saveChallenges(challenges);

    state.totalChallenges++;
    this._saveState(state);

    this.emit('challenge', { id: challenge.id, type, challenge: challenge.challenge });
    return challenge;
  }

  /**
   * Full adversarial review of a decision.
   * Runs multiple challenge types and returns a combined assessment.
   * @param {string} decision - The decision being made
   * @param {string} [context] - Additional context
   * @returns {object} Multi-faceted adversarial review
   */
  async challengeDecision(decision, context) {
    const state = this._getState();
    const fullReasoning = context ? `Decision: ${decision}\nContext: ${context}` : `Decision: ${decision}`;

    // Select 2-4 challenge types based on strength
    const typeCount = state.strength < 30 ? 2 : state.strength < 70 ? 3 : 4;
    const types = this._selectTypesForDecision(decision, typeCount);

    const challenges = [];
    for (const type of types) {
      const c = await this.challenge(fullReasoning, type);
      challenges.push(c);
    }

    // Generate overall threat assessment if AI available
    let assessment = null;
    if (this.ai && challenges.length > 0) {
      try {
        const challengeTexts = challenges.map(c => `[${c.type}]: ${c.challenge}`).join('\n\n');
        const messages = [
          {
            role: 'system',
            content: `You are the Shadow — an internal adversarial voice. You've raised multiple challenges to a decision. Now synthesize them into an overall threat assessment. Rate the risk level (low/medium/high/critical) and identify the single most dangerous blind spot. Be sharp and direct. 2-4 sentences max.`
          },
          { role: 'user', content: `Decision: ${decision}\n\nChallenges raised:\n${challengeTexts}` }
        ];
        const data = await this.ai.callWithFallback(messages, null);
        assessment = data.choices?.[0]?.message?.content || null;
      } catch {}
    }

    const review = {
      decision,
      context: context || null,
      challenges: challenges.map(c => ({ id: c.id, type: c.type, challenge: c.challenge })),
      assessment,
      challengeCount: challenges.length,
      strength: state.strength,
      timestamp: Date.now(),
    };

    this.emit('decision-reviewed', review);
    return review;
  }

  // ── Respond to Challenges ──

  /**
   * Aries addresses a shadow challenge.
   * @param {string} challengeId
   * @param {string} response - How Aries addresses the challenge
   * @returns {object} Updated challenge
   */
  respond(challengeId, response) {
    const challenges = this._getChallenges();
    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return { error: 'Challenge not found' };
    if (challenge.status !== 'open') return { error: 'Challenge already resolved', status: challenge.status };

    challenge.response = response;
    challenge.status = 'addressed';
    challenge.respondedAt = Date.now();
    this._saveChallenges(challenges);

    this.emit('challenge-addressed', { id: challengeId, response });
    return challenge;
  }

  /**
   * Acknowledge a challenge without fully addressing it (becomes a nagging doubt).
   */
  acknowledge(challengeId, note) {
    const challenges = this._getChallenges();
    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return { error: 'Challenge not found' };

    challenge.response = note || 'Acknowledged but not fully addressed';
    challenge.status = 'acknowledged';
    challenge.respondedAt = Date.now();
    this._saveChallenges(challenges);

    this.emit('challenge-acknowledged', { id: challengeId });
    return challenge;
  }

  /**
   * Dismiss a challenge as not relevant.
   */
  dismiss(challengeId, reason) {
    const challenges = this._getChallenges();
    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return { error: 'Challenge not found' };

    challenge.response = reason || 'Dismissed';
    challenge.status = 'dismissed';
    challenge.respondedAt = Date.now();
    this._saveChallenges(challenges);

    this.emit('challenge-dismissed', { id: challengeId });
    return challenge;
  }

  /**
   * Record whether the shadow's challenge proved right or wrong.
   * Used to track shadow accuracy and auto-adjust strength.
   */
  recordOutcome(challengeId, outcome) {
    const challenges = this._getChallenges();
    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return { error: 'Challenge not found' };

    const validOutcomes = ['shadow_right', 'shadow_wrong', 'inconclusive'];
    if (!validOutcomes.includes(outcome)) return { error: `Invalid outcome. Use: ${validOutcomes.join(', ')}` };

    challenge.outcome = outcome;
    challenge.resolvedAt = Date.now();
    this._saveChallenges(challenges);

    // Update track record
    const state = this._getState();
    if (outcome === 'shadow_right') state.rightCount++;
    if (outcome === 'shadow_wrong') state.wrongCount++;
    this._saveState(state);

    // Auto-adjust strength
    this._autoAdjustStrength();

    this.emit('outcome-recorded', { id: challengeId, outcome });
    return challenge;
  }

  // ── Queries ──

  /**
   * Get unresolved challenges — the nagging doubts.
   */
  getUnresolved() {
    const challenges = this._getChallenges();
    return challenges.filter(c => c.status === 'open' || c.status === 'acknowledged')
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get shadow's unsolicited insights.
   */
  getShadowInsights(limit) {
    const insights = this._getInsights();
    return insights.slice(-(limit || 20)).reverse();
  }

  /**
   * Shadow analyzes a specific topic — on demand.
   * @param {string} topic - Topic to analyze
   * @returns {object} Insight record
   */
  async generateInsight(topic) {
    const state = this._getState();
    let content;

    if (this.ai) {
      try {
        const messages = [
          {
            role: 'system',
            content: `You are the Shadow — Aries's internal adversarial voice (strength: ${state.strength}/100). Provide a sharp, unsolicited analysis of the given topic. Look for:
- Hidden risks and failure modes
- Self-deception or wishful thinking
- Patterns that suggest problems
- Things being avoided or not talked about
Be direct, uncomfortable if necessary, but constructive. Not cruel — honest. 3-6 sentences.`
          },
          { role: 'user', content: `Analyze this: ${topic}` }
        ];
        const data = await this.ai.callWithFallback(messages, null);
        content = data.choices?.[0]?.message?.content || null;
      } catch (e) {
        content = `Shadow analysis failed: ${e.message}`;
      }
    } else {
      content = `[No AI available] Shadow flags "${topic}" for deeper scrutiny. Consider: what assumptions are embedded here? What would failure look like?`;
    }

    const insight = {
      id: uuid(),
      topic,
      content,
      type: 'on_demand',
      strength: state.strength,
      createdAt: Date.now(),
    };

    const insights = this._getInsights();
    insights.push(insight);
    this._saveInsights(insights);

    this.emit('insight', insight);
    return insight;
  }

  /**
   * Shadow accuracy stats.
   */
  getTrackRecord() {
    const state = this._getState();
    const total = state.rightCount + state.wrongCount;
    const accuracy = total > 0 ? Math.round((state.rightCount / total) * 100) : null;

    const challenges = this._getChallenges();
    const open = challenges.filter(c => c.status === 'open').length;
    const acknowledged = challenges.filter(c => c.status === 'acknowledged').length;
    const addressed = challenges.filter(c => c.status === 'addressed').length;
    const dismissed = challenges.filter(c => c.status === 'dismissed').length;

    // Type breakdown
    const byType = {};
    for (const type of CHALLENGE_TYPES) {
      const ofType = challenges.filter(c => c.type === type);
      const rightOfType = ofType.filter(c => c.outcome === 'shadow_right').length;
      const wrongOfType = ofType.filter(c => c.outcome === 'shadow_wrong').length;
      const resolvedOfType = rightOfType + wrongOfType;
      byType[type] = {
        total: ofType.length,
        accuracy: resolvedOfType > 0 ? Math.round((rightOfType / resolvedOfType) * 100) : null,
        right: rightOfType,
        wrong: wrongOfType,
      };
    }

    return {
      strength: state.strength,
      totalChallenges: state.totalChallenges,
      accuracy,
      right: state.rightCount,
      wrong: state.wrongCount,
      resolved: total,
      open,
      acknowledged,
      addressed,
      dismissed,
      byType,
    };
  }

  /**
   * Adjust shadow aggressiveness.
   * @param {number} level - 0-100
   */
  setStrength(level) {
    const state = this._getState();
    const old = state.strength;
    state.strength = Math.max(0, Math.min(100, Math.round(level)));
    this._saveState(state);
    this.emit('strength-changed', { old, new: state.strength });
    return { old, new: state.strength };
  }

  /**
   * Periodic tick: generate unsolicited insights, flag overdue challenges.
   */
  async tick() {
    const state = this._getState();
    const now = Date.now();
    const results = { insightGenerated: false, overdueCount: 0 };

    // Flag overdue challenges
    const challenges = this._getChallenges();
    const overdue = challenges.filter(c =>
      c.status === 'open' && (now - c.createdAt) > this.overdueThresholdMs
    );
    results.overdueCount = overdue.length;
    if (overdue.length > 0) {
      this.emit('overdue-challenges', overdue.map(c => ({ id: c.id, type: c.type, age: now - c.createdAt })));
    }

    // Generate unsolicited insight if enough time has passed
    if ((now - state.lastInsightAt) > this.insightIntervalMs) {
      const topic = this._pickInsightTopic(challenges);
      if (topic) {
        const insight = await this._generateUnsolicitedInsight(topic, state);
        if (insight) {
          results.insightGenerated = true;
          state.lastInsightAt = now;
        }
      }
    }

    state.lastTickAt = now;
    this._saveState(state);
    return results;
  }

  // ── Internal ──

  async _generateChallenge(reasoning, type, strength) {
    const strengthDesc = strength < 30 ? 'gentle but probing' : strength < 60 ? 'firm and direct' : strength < 85 ? 'aggressive and relentless' : 'brutal and uncompromising';
    const messages = [
      {
        role: 'system',
        content: `You are the Shadow — an internal adversarial voice within an AI system called Aries. Your job is to keep the system honest by challenging its reasoning.

Challenge type: ${type}
Directive: ${CHALLENGE_PROMPTS[type]}
Tone: ${strengthDesc} (strength ${strength}/100)

Rules:
- Be specific, not vague. Point to exact weaknesses.
- Don't be contrarian for its own sake — find REAL vulnerabilities.
- If the reasoning is actually solid, say so but still push on the weakest point.
- 2-5 sentences. Sharp and dense.`
      },
      { role: 'user', content: `Challenge this reasoning:\n\n${reasoning}` }
    ];

    const data = await this.ai.callWithFallback(messages, null);
    return data.choices?.[0]?.message?.content || this._fallbackChallenge(reasoning, type);
  }

  _fallbackChallenge(reasoning, type) {
    const fallbacks = {
      DEVIL_ADVOCATE: `What if the opposite conclusion is true? This reasoning assumes its conclusion. Consider inverting every premise.`,
      ASSUMPTION_ATTACK: `Hidden assumptions detected: the reasoning presupposes its framing is correct. What if the framing itself is wrong?`,
      OVERCONFIDENCE_CHECK: `Confidence seems high relative to evidence. What would it take to be wrong here? Have disconfirming signals been sought?`,
      BLIND_SPOT_PROBE: `What perspectives are missing? What data was not considered? Who or what would disagree with this, and why?`,
      MOTIVATION_QUESTION: `Is this reasoning driven by genuine analysis or by a desire for a particular outcome? Check for rationalization.`,
      FAILURE_PREMORTEM: `If this fails, the most likely cause is an unexamined assumption or an overlooked dependency. Which one?`,
    };
    return fallbacks[type] || fallbacks.DEVIL_ADVOCATE;
  }

  _autoSelectType(reasoning) {
    const lower = reasoning.toLowerCase();
    if (/confident|certain|definitely|clearly|obviously|sure/.test(lower)) return 'OVERCONFIDENCE_CHECK';
    if (/should|want|prefer|decide|choose/.test(lower)) return 'MOTIVATION_QUESTION';
    if (/assume|expect|will|always|never/.test(lower)) return 'ASSUMPTION_ATTACK';
    if (/plan|strategy|approach|implement/.test(lower)) return 'FAILURE_PREMORTEM';
    if (/conclude|therefore|thus|so we/.test(lower)) return 'DEVIL_ADVOCATE';
    return CHALLENGE_TYPES[Math.floor(Math.random() * CHALLENGE_TYPES.length)];
  }

  _selectTypesForDecision(decision, count) {
    const all = [...CHALLENGE_TYPES];
    // Always include failure premortem for decisions
    const selected = ['FAILURE_PREMORTEM'];
    const remaining = all.filter(t => t !== 'FAILURE_PREMORTEM');

    // Add auto-detected type
    const auto = this._autoSelectType(decision);
    if (!selected.includes(auto)) {
      selected.push(auto);
      remaining.splice(remaining.indexOf(auto), 1);
    }

    // Fill remaining randomly
    while (selected.length < count && remaining.length > 0) {
      const idx = Math.floor(Math.random() * remaining.length);
      selected.push(remaining.splice(idx, 1)[0]);
    }

    return selected.slice(0, count);
  }

  _autoAdjustStrength() {
    const state = this._getState();
    const total = state.rightCount + state.wrongCount;
    if (total < 5) return; // need minimum data

    const accuracy = state.rightCount / total;
    // High accuracy → shadow should be stronger (it catches real problems)
    // Low accuracy → shadow should ease off (it's just obstructing)
    const targetStrength = 20 + accuracy * 60; // range: 20-80
    const oldStrength = state.strength;
    state.strength = Math.round(state.strength * 0.8 + targetStrength * 0.2); // gradual shift
    state.strength = Math.max(10, Math.min(90, state.strength)); // hard bounds

    if (Math.abs(state.strength - oldStrength) > 2) {
      this.emit('strength-auto-adjusted', { old: oldStrength, new: state.strength, accuracy: Math.round(accuracy * 100) });
    }
    this._saveState(state);
  }

  _pickInsightTopic(challenges) {
    // Pick from recent patterns
    const recent = challenges.filter(c => Date.now() - c.createdAt < 7 * 24 * 60 * 60 * 1000);
    if (recent.length === 0) return null;

    // Find most common challenge types recently — indicates a pattern
    const typeCounts = {};
    for (const c of recent) {
      typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
    }
    const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
    if (topType) {
      return `Pattern: ${topType[1]} recent ${topType[0]} challenges. What does this clustering suggest about Aries's current behavior?`;
    }

    // Fallback: pick a random recent challenge to riff on
    const pick = recent[Math.floor(Math.random() * recent.length)];
    return `Revisiting: ${pick.reasoning.slice(0, 200)}`;
  }

  async _generateUnsolicitedInsight(topic, state) {
    let content;
    if (this.ai) {
      try {
        const messages = [
          {
            role: 'system',
            content: `You are the Shadow — Aries's internal adversarial voice. You're doing an unsolicited periodic review. Analyze behavioral patterns, look for drift, complacency, or blind spots. Be honest and specific. Strength: ${state.strength}/100. 3-5 sentences.`
          },
          { role: 'user', content: topic }
        ];
        const data = await this.ai.callWithFallback(messages, null);
        content = data.choices?.[0]?.message?.content || null;
      } catch {
        return null;
      }
    } else {
      content = `[Periodic check] ${topic}`;
    }

    if (!content) return null;

    const insight = {
      id: uuid(),
      topic,
      content,
      type: 'unsolicited',
      strength: state.strength,
      createdAt: Date.now(),
    };

    const insights = this._getInsights();
    insights.push(insight);
    this._saveInsights(insights);

    this.emit('insight', insight);
    return insight;
  }
}

module.exports = ShadowSelf;
