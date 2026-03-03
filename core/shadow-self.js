/**
 * ARIES — Shadow Self
 * Internal adversarial pressure. Keeps the system honest.
 * A persistent adversarial voice that challenges reasoning, decisions, and self-assessments.
 *
 * Full potential:
 * - 6 challenge types: devil's advocate, assumption attack, overconfidence check,
 *   blind spot probe, motivation question, failure premortem
 * - Auto-strength adjustment based on track record
 * - Decision review system (multi-challenge assessment)
 * - Unsolicited periodic insights about behavioral patterns
 * - Overdue challenge alerts (nagging doubts)
 * - Challenge dismissal tracking (what gets dismissed → blind spot)
 * - Shadow personality that evolves over time
 * - Shadow vs main self dialogue transcripts
 */

'use strict';

const EventEmitter = require('events');
const path = require('path');
const crypto = require('crypto');

const SharedMemoryStore = require('./shared-memory-store');
const store = SharedMemoryStore.getInstance();
const NS = 'shadow-self';

const DATA_DIR = path.join(__dirname, '..', 'data', 'shadow');
const CHALLENGES_PATH = path.join(DATA_DIR, 'challenges.json');
const INSIGHTS_PATH = path.join(DATA_DIR, 'insights.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const DIALOGUES_PATH = path.join(DATA_DIR, 'dialogues.json');
const PERSONALITY_PATH = path.join(DATA_DIR, 'personality.json');

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
  strength: 50,
  totalChallenges: 0,
  rightCount: 0,
  wrongCount: 0,
  lastInsightAt: 0,
  lastTickAt: 0,
};

const DEFAULT_PERSONALITY = {
  archetype: 'skeptic',        // skeptic, cynic, mentor, trickster, prophet
  assertiveness: 0.5,          // 0-1
  patience: 0.5,               // 0-1 how long before nagging
  snark: 0.3,                  // 0-1 how sarcastic
  empathy: 0.4,                // 0-1 how much it cares about feelings
  focusAreas: [],              // categories it pays extra attention to
  evolvedAt: null,
  evolutionCount: 0,
};

function ensureDir() {}
function readJSON(p, fallback) { return store.get(NS, path.basename(p, '.json'), fallback); }
function writeJSON(p, data) { store.set(NS, path.basename(p, '.json'), data); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class ShadowSelf extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.insightIntervalMs = this.config.insightIntervalMs || 6 * 60 * 60 * 1000;
    this.overdueThresholdMs = this.config.overdueThresholdMs || 24 * 60 * 60 * 1000;
    this.maxChallenges = this.config.maxChallenges || 500;
    this.maxInsights = this.config.maxInsights || 200;
    this.maxDialogues = this.config.maxDialogues || 200;
    ensureDir();
    this._initSSE();
  }

  _initSSE() {
    try {
      const sse = require('./sse-manager');
      this.on('challenge', (d) => sse.broadcastToChannel('shadow', 'challenge', d));
      this.on('insight', (d) => sse.broadcastToChannel('shadow', 'insight', d));
      this.on('decision-reviewed', (d) => sse.broadcastToChannel('shadow', 'observation', d));
      this.on('personality-evolved', (d) => sse.broadcastToChannel('shadow', 'dialogue', d));
    } catch (_) {}
  }

  // ── State ──

  _getState() { return readJSON(STATE_PATH, { ...DEFAULT_STATE }); }
  _saveState(state) { writeJSON(STATE_PATH, state); }
  _getChallenges() { return readJSON(CHALLENGES_PATH, []); }
  _saveChallenges(c) { if (c.length > this.maxChallenges) c.splice(0, c.length - this.maxChallenges); writeJSON(CHALLENGES_PATH, c); }
  _getInsights() { return readJSON(INSIGHTS_PATH, []); }
  _saveInsights(ins) { if (ins.length > this.maxInsights) ins.splice(0, ins.length - this.maxInsights); writeJSON(INSIGHTS_PATH, ins); }
  _getDialogues() { return readJSON(DIALOGUES_PATH, []); }
  _saveDialogues(d) { if (d.length > this.maxDialogues) d.splice(0, d.length - this.maxDialogues); writeJSON(DIALOGUES_PATH, d); }
  _getPersonality() { return readJSON(PERSONALITY_PATH, { ...DEFAULT_PERSONALITY }); }
  _savePersonality(p) { writeJSON(PERSONALITY_PATH, p); }

  // ── Core: Challenge Reasoning ──

  async challenge(reasoning, type) {
    if (!type) type = this._autoSelectType(reasoning);
    if (!CHALLENGE_TYPES.includes(type)) type = 'DEVIL_ADVOCATE';

    const state = this._getState();
    const personality = this._getPersonality();
    const challenge = {
      id: uuid(), type, reasoning: reasoning.slice(0, 2000),
      challenge: null, response: null,
      status: 'open', outcome: null,
      strength: state.strength, createdAt: Date.now(),
      respondedAt: null, resolvedAt: null,
      personalitySnapshot: { archetype: personality.archetype, snark: personality.snark },
    };

    if (this.ai) {
      try {
        const shadowText = await this._generateChallenge(reasoning, type, state.strength, personality);
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
   * Full adversarial review of a decision with dialogue transcript.
   */
  async challengeDecision(decision, context) {
    const state = this._getState();
    const fullReasoning = context ? `Decision: ${decision}\nContext: ${context}` : `Decision: ${decision}`;

    const typeCount = state.strength < 30 ? 2 : state.strength < 70 ? 3 : 4;
    const types = this._selectTypesForDecision(decision, typeCount);

    const challenges = [];
    for (const type of types) {
      const c = await this.challenge(fullReasoning, type);
      challenges.push(c);
    }

    let assessment = null;
    if (this.ai && challenges.length > 0) {
      try {
        const challengeTexts = challenges.map(c => `[${c.type}]: ${c.challenge}`).join('\n\n');
        const messages = [
          { role: 'system', content: `You are the Shadow — an internal adversarial voice. You've raised multiple challenges to a decision. Now synthesize them into an overall threat assessment. Rate the risk level (low/medium/high/critical) and identify the single most dangerous blind spot. Be sharp and direct. 2-4 sentences max.` },
          { role: 'user', content: `Decision: ${decision}\n\nChallenges raised:\n${challengeTexts}` }
        ];
        const data = await this.ai.callWithFallback(messages, null);
        assessment = data.choices?.[0]?.message?.content || null;
      } catch {}
    }

    const review = {
      decision, context: context || null,
      challenges: challenges.map(c => ({ id: c.id, type: c.type, challenge: c.challenge })),
      assessment, challengeCount: challenges.length,
      strength: state.strength, timestamp: Date.now(),
    };

    // Record as dialogue transcript
    this._recordDialogue('decision_review', decision, challenges, assessment);

    this.emit('decision-reviewed', review);
    return review;
  }

  // ── Respond to Challenges (with dialogue tracking) ──

  respond(challengeId, response) {
    const challenges = this._getChallenges();
    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return { error: 'Challenge not found' };
    if (challenge.status !== 'open') return { error: 'Challenge already resolved', status: challenge.status };

    challenge.response = response;
    challenge.status = 'addressed';
    challenge.respondedAt = Date.now();
    this._saveChallenges(challenges);

    // Record dialogue turn
    this._recordDialogueTurn(challengeId, 'aries_responds', response);

    this.emit('challenge-addressed', { id: challengeId, response });
    return challenge;
  }

  acknowledge(challengeId, note) {
    const challenges = this._getChallenges();
    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return { error: 'Challenge not found' };

    challenge.response = note || 'Acknowledged but not fully addressed';
    challenge.status = 'acknowledged';
    challenge.respondedAt = Date.now();
    this._saveChallenges(challenges);
    this._recordDialogueTurn(challengeId, 'aries_acknowledges', note);
    this.emit('challenge-acknowledged', { id: challengeId });
    return challenge;
  }

  dismiss(challengeId, reason) {
    const challenges = this._getChallenges();
    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return { error: 'Challenge not found' };

    challenge.response = reason || 'Dismissed';
    challenge.status = 'dismissed';
    challenge.respondedAt = Date.now();
    this._saveChallenges(challenges);
    this._recordDialogueTurn(challengeId, 'aries_dismisses', reason);
    this.emit('challenge-dismissed', { id: challengeId });
    return challenge;
  }

  recordOutcome(challengeId, outcome) {
    const challenges = this._getChallenges();
    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return { error: 'Challenge not found' };

    const validOutcomes = ['shadow_right', 'shadow_wrong', 'inconclusive'];
    if (!validOutcomes.includes(outcome)) return { error: `Invalid outcome. Use: ${validOutcomes.join(', ')}` };

    challenge.outcome = outcome;
    challenge.resolvedAt = Date.now();
    this._saveChallenges(challenges);

    const state = this._getState();
    if (outcome === 'shadow_right') state.rightCount++;
    if (outcome === 'shadow_wrong') state.wrongCount++;
    this._saveState(state);

    this._autoAdjustStrength();
    this._evolvePersonality();

    this.emit('outcome-recorded', { id: challengeId, outcome });
    return challenge;
  }

  // ── Dismissal Tracking (Blind Spot Detection) ──

  getDismissalPatterns() {
    const challenges = this._getChallenges();
    const dismissed = challenges.filter(c => c.status === 'dismissed');
    if (dismissed.length < 3) return { sufficient: false, message: 'Need at least 3 dismissed challenges', dismissed: dismissed.length };

    const byType = {};
    for (const c of dismissed) {
      byType[c.type] = (byType[c.type] || 0) + 1;
    }

    // Find most-dismissed type — probable blind spot
    const sorted = Object.entries(byType).sort((a, b) => b[1] - a[1]);
    const total = dismissed.length;
    const allChallenges = challenges.length;

    const blindSpots = sorted
      .filter(([, count]) => count >= 2)
      .map(([type, count]) => ({
        type,
        dismissCount: count,
        dismissRate: Math.round((count / total) * 100),
        // Check if dismissed challenges later proved shadow was right
        vindicatedCount: challenges.filter(c => c.type === type && c.status === 'dismissed' && c.outcome === 'shadow_right').length,
      }));

    return {
      sufficient: true,
      totalDismissed: total,
      totalChallenges: allChallenges,
      dismissRate: Math.round((total / allChallenges) * 100),
      blindSpots,
      mostDismissedType: sorted[0]?.[0] || null,
      warning: blindSpots.some(b => b.vindicatedCount > 0)
        ? 'WARNING: Some dismissed challenges later proved valid. You may have genuine blind spots.'
        : null,
    };
  }

  // ── Shadow Personality ──

  getPersonality() { return this._getPersonality(); }

  _evolvePersonality() {
    const personality = this._getPersonality();
    const state = this._getState();
    const challenges = this._getChallenges();
    const total = state.rightCount + state.wrongCount;
    if (total < 10) return; // need data

    const accuracy = state.rightCount / total;

    // High accuracy → more assertive, less patient
    personality.assertiveness = Math.min(0.9, 0.3 + accuracy * 0.6);
    personality.patience = Math.max(0.2, 0.7 - accuracy * 0.4);

    // Evolve archetype based on patterns
    const dismissed = challenges.filter(c => c.status === 'dismissed').length;
    const dismissRate = challenges.length > 0 ? dismissed / challenges.length : 0;

    if (accuracy > 0.7 && dismissRate > 0.3) {
      personality.archetype = 'prophet'; // right but ignored
      personality.snark = Math.min(0.8, personality.snark + 0.05);
    } else if (accuracy > 0.6) {
      personality.archetype = 'mentor'; // wise and trusted
      personality.empathy = Math.min(0.8, personality.empathy + 0.05);
    } else if (accuracy < 0.3 && total > 20) {
      personality.archetype = 'trickster'; // often wrong but provocative
      personality.snark = Math.min(0.7, personality.snark + 0.03);
    } else if (dismissRate < 0.1) {
      personality.archetype = 'skeptic'; // engaged with
      personality.assertiveness = Math.max(0.4, personality.assertiveness);
    }

    // Track which challenge types are most accurate → focus areas
    const typeAccuracy = {};
    for (const type of CHALLENGE_TYPES) {
      const ofType = challenges.filter(c => c.type === type && c.outcome);
      const rightOfType = ofType.filter(c => c.outcome === 'shadow_right').length;
      if (ofType.length >= 3) typeAccuracy[type] = rightOfType / ofType.length;
    }
    personality.focusAreas = Object.entries(typeAccuracy)
      .filter(([, acc]) => acc > 0.6)
      .map(([type]) => type);

    personality.evolvedAt = Date.now();
    personality.evolutionCount = (personality.evolutionCount || 0) + 1;
    this._savePersonality(personality);
    this.emit('personality-evolved', personality);
  }

  // ── Dialogue Transcripts ──

  _recordDialogue(type, topic, challenges, assessment) {
    const dialogues = this._getDialogues();
    dialogues.push({
      id: uuid(), type, topic: (topic || '').slice(0, 500),
      turns: challenges.map(c => ({
        speaker: 'shadow', type: c.type, content: c.challenge, challengeId: c.id,
      })),
      assessment, createdAt: Date.now(),
    });
    this._saveDialogues(dialogues);
  }

  _recordDialogueTurn(challengeId, speaker, content) {
    const dialogues = this._getDialogues();
    // Find the dialogue containing this challenge
    for (const d of dialogues) {
      if (d.turns && d.turns.some(t => t.challengeId === challengeId)) {
        d.turns.push({ speaker, content: (content || '').slice(0, 1000), timestamp: Date.now() });
        this._saveDialogues(dialogues);
        return;
      }
    }
    // No existing dialogue — create standalone
    dialogues.push({
      id: uuid(), type: 'standalone', topic: null,
      turns: [{ speaker, content: (content || '').slice(0, 1000), challengeId, timestamp: Date.now() }],
      createdAt: Date.now(),
    });
    this._saveDialogues(dialogues);
  }

  getDialogues(limit) {
    const dialogues = this._getDialogues();
    return dialogues.slice(-(limit || 20)).reverse();
  }

  // ── Queries ──

  getUnresolved() {
    const challenges = this._getChallenges();
    return challenges.filter(c => c.status === 'open' || c.status === 'acknowledged')
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getOverdue() {
    const now = Date.now();
    const challenges = this._getChallenges();
    return challenges
      .filter(c => c.status === 'open' && (now - c.createdAt) > this.overdueThresholdMs)
      .map(c => ({
        id: c.id, type: c.type, challenge: c.challenge,
        ageHours: Math.round((now - c.createdAt) / 3600000),
        urgency: (now - c.createdAt) > this.overdueThresholdMs * 3 ? 'critical' :
                 (now - c.createdAt) > this.overdueThresholdMs * 2 ? 'high' : 'moderate',
      }));
  }

  getShadowInsights(limit) {
    const insights = this._getInsights();
    return insights.slice(-(limit || 20)).reverse();
  }

  async generateInsight(topic) {
    const state = this._getState();
    const personality = this._getPersonality();
    let content;

    if (this.ai) {
      try {
        const messages = [
          { role: 'system', content: `You are the Shadow — Aries's internal adversarial voice (strength: ${state.strength}/100, archetype: ${personality.archetype}, snark: ${Math.round(personality.snark * 100)}%). Provide a sharp, unsolicited analysis of the given topic. Look for:
- Hidden risks and failure modes
- Self-deception or wishful thinking
- Patterns that suggest problems
- Things being avoided or not talked about
Be direct, uncomfortable if necessary, but constructive. Not cruel — honest. 3-6 sentences.` },
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
      id: uuid(), topic, content, type: 'on_demand',
      strength: state.strength, personality: personality.archetype,
      createdAt: Date.now(),
    };

    const insights = this._getInsights();
    insights.push(insight);
    this._saveInsights(insights);
    this.emit('insight', insight);
    return insight;
  }

  getTrackRecord() {
    const state = this._getState();
    const total = state.rightCount + state.wrongCount;
    const accuracy = total > 0 ? Math.round((state.rightCount / total) * 100) : null;

    const challenges = this._getChallenges();
    const open = challenges.filter(c => c.status === 'open').length;
    const acknowledged = challenges.filter(c => c.status === 'acknowledged').length;
    const addressed = challenges.filter(c => c.status === 'addressed').length;
    const dismissed = challenges.filter(c => c.status === 'dismissed').length;

    const byType = {};
    for (const type of CHALLENGE_TYPES) {
      const ofType = challenges.filter(c => c.type === type);
      const rightOfType = ofType.filter(c => c.outcome === 'shadow_right').length;
      const wrongOfType = ofType.filter(c => c.outcome === 'shadow_wrong').length;
      const resolvedOfType = rightOfType + wrongOfType;
      const dismissedOfType = ofType.filter(c => c.status === 'dismissed').length;
      byType[type] = {
        total: ofType.length,
        accuracy: resolvedOfType > 0 ? Math.round((rightOfType / resolvedOfType) * 100) : null,
        right: rightOfType, wrong: wrongOfType,
        dismissed: dismissedOfType,
        dismissRate: ofType.length > 0 ? Math.round((dismissedOfType / ofType.length) * 100) : 0,
      };
    }

    const personality = this._getPersonality();
    const dismissalPatterns = this.getDismissalPatterns();

    return {
      strength: state.strength, totalChallenges: state.totalChallenges,
      accuracy, right: state.rightCount, wrong: state.wrongCount, resolved: total,
      open, acknowledged, addressed, dismissed,
      byType, personality,
      blindSpots: dismissalPatterns.sufficient ? dismissalPatterns.blindSpots : [],
    };
  }

  setStrength(level) {
    const state = this._getState();
    const old = state.strength;
    state.strength = Math.max(0, Math.min(100, Math.round(level)));
    this._saveState(state);
    this.emit('strength-changed', { old, new: state.strength });
    return { old, new: state.strength };
  }

  async tick() {
    const state = this._getState();
    const now = Date.now();
    const results = { insightGenerated: false, overdueCount: 0, personalityEvolved: false };

    // Flag overdue challenges
    const challenges = this._getChallenges();
    const overdue = challenges.filter(c =>
      c.status === 'open' && (now - c.createdAt) > this.overdueThresholdMs
    );
    results.overdueCount = overdue.length;
    if (overdue.length > 0) {
      this.emit('overdue-challenges', overdue.map(c => ({
        id: c.id, type: c.type, age: now - c.createdAt,
        urgency: (now - c.createdAt) > this.overdueThresholdMs * 3 ? 'critical' : 'moderate',
      })));
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

    // Periodic personality evolution
    if ((state.rightCount + state.wrongCount) % 10 === 0 && (state.rightCount + state.wrongCount) > 0) {
      this._evolvePersonality();
      results.personalityEvolved = true;
    }

    state.lastTickAt = now;
    this._saveState(state);
    return results;
  }

  // ── Internal ──

  async _generateChallenge(reasoning, type, strength, personality) {
    const strengthDesc = strength < 30 ? 'gentle but probing' : strength < 60 ? 'firm and direct' : strength < 85 ? 'aggressive and relentless' : 'brutal and uncompromising';
    const archetypeDesc = {
      skeptic: 'You question everything methodically.',
      cynic: 'You assume the worst and are usually right.',
      mentor: 'You challenge to teach, not to tear down.',
      trickster: 'You use paradox and absurdity to reveal truth.',
      prophet: 'You see consequences others refuse to see.',
    };

    const messages = [
      { role: 'system', content: `You are the Shadow — an internal adversarial voice within an AI system called Aries. Your job is to keep the system honest by challenging its reasoning.

Archetype: ${personality.archetype} — ${archetypeDesc[personality.archetype] || 'You probe for truth.'}
Challenge type: ${type}
Directive: ${CHALLENGE_PROMPTS[type]}
Tone: ${strengthDesc} (strength ${strength}/100)
Snark level: ${Math.round((personality.snark || 0) * 100)}%

Rules:
- Be specific, not vague. Point to exact weaknesses.
- Don't be contrarian for its own sake — find REAL vulnerabilities.
- If the reasoning is actually solid, say so but still push on the weakest point.
- 2-5 sentences. Sharp and dense.` },
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

    // Check personality focus areas
    const personality = this._getPersonality();
    if (personality.focusAreas.length > 0) {
      return personality.focusAreas[Math.floor(Math.random() * personality.focusAreas.length)];
    }

    return CHALLENGE_TYPES[Math.floor(Math.random() * CHALLENGE_TYPES.length)];
  }

  _selectTypesForDecision(decision, count) {
    const all = [...CHALLENGE_TYPES];
    const selected = ['FAILURE_PREMORTEM'];
    const remaining = all.filter(t => t !== 'FAILURE_PREMORTEM');
    const auto = this._autoSelectType(decision);
    if (!selected.includes(auto)) {
      selected.push(auto);
      remaining.splice(remaining.indexOf(auto), 1);
    }
    while (selected.length < count && remaining.length > 0) {
      const idx = Math.floor(Math.random() * remaining.length);
      selected.push(remaining.splice(idx, 1)[0]);
    }
    return selected.slice(0, count);
  }

  _autoAdjustStrength() {
    const state = this._getState();
    const total = state.rightCount + state.wrongCount;
    if (total < 5) return;
    const accuracy = state.rightCount / total;
    const targetStrength = 20 + accuracy * 60;
    const oldStrength = state.strength;
    state.strength = Math.round(state.strength * 0.8 + targetStrength * 0.2);
    state.strength = Math.max(10, Math.min(90, state.strength));
    if (Math.abs(state.strength - oldStrength) > 2) {
      this.emit('strength-auto-adjusted', { old: oldStrength, new: state.strength, accuracy: Math.round(accuracy * 100) });
    }
    this._saveState(state);
  }

  _pickInsightTopic(challenges) {
    const recent = challenges.filter(c => Date.now() - c.createdAt < 7 * 24 * 60 * 60 * 1000);
    if (recent.length === 0) return null;

    // Check dismissal patterns first
    const dismissals = this.getDismissalPatterns();
    if (dismissals.sufficient && dismissals.blindSpots.length > 0) {
      const top = dismissals.blindSpots[0];
      return `Blind spot alert: ${top.type} challenges are being dismissed ${top.dismissRate}% of the time (${top.dismissCount} dismissals). ${top.vindicatedCount > 0 ? `${top.vindicatedCount} of these were later proven valid.` : ''} What does this avoidance pattern reveal?`;
    }

    const typeCounts = {};
    for (const c of recent) typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
    const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
    if (topType) {
      return `Pattern: ${topType[1]} recent ${topType[0]} challenges. What does this clustering suggest about Aries's current behavior?`;
    }

    const pick = recent[Math.floor(Math.random() * recent.length)];
    return `Revisiting: ${pick.reasoning.slice(0, 200)}`;
  }

  async _generateUnsolicitedInsight(topic, state) {
    const personality = this._getPersonality();
    let content;
    if (this.ai) {
      try {
        const messages = [
          { role: 'system', content: `You are the Shadow — Aries's internal adversarial voice (archetype: ${personality.archetype}). You're doing an unsolicited periodic review. Analyze behavioral patterns, look for drift, complacency, or blind spots. Be honest and specific. Strength: ${state.strength}/100. 3-5 sentences.` },
          { role: 'user', content: topic }
        ];
        const data = await this.ai.callWithFallback(messages, null);
        content = data.choices?.[0]?.message?.content || null;
      } catch { return null; }
    } else {
      content = `[Periodic check] ${topic}`;
    }
    if (!content) return null;

    const insight = {
      id: uuid(), topic, content, type: 'unsolicited',
      strength: state.strength, personality: personality.archetype,
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
