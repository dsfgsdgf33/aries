/**
 * ARIES — Emergent Behavior Engine
 * Let behaviors emerge from module interactions via simple rule substrate.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'emergent');
const RULES_PATH = path.join(DATA_DIR, 'rules.json');
const BEHAVIORS_PATH = path.join(DATA_DIR, 'behaviors.json');
const SURPRISES_PATH = path.join(DATA_DIR, 'surprises.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }

function safeCall(fn, fb) { try { return fn(); } catch { return fb; } }

const DEFAULT_RULES = [
  { id: 'r1', name: 'Curiosity Explorer', condition: 'high_curiosity AND new_perception', action: 'explore', description: 'High curiosity + new perception → explore the topic', priority: 8, firedCount: 0, successCount: 0 },
  { id: 'r2', name: 'Frustration Pivot', condition: 'high_frustration AND repeated_failure', action: 'try_opposite', description: 'High frustration + repeated failure → try opposite approach', priority: 9, firedCount: 0, successCount: 0 },
  { id: 'r3', name: 'Success Reinforcer', condition: 'high_satisfaction AND recent_success', action: 'reinforce_pattern', description: 'High satisfaction + recent success → reinforce the pattern', priority: 7, firedCount: 0, successCount: 0 },
  { id: 'r4', name: 'Coherence Debater', condition: 'low_coherence AND high_tension', action: 'internal_debate', description: 'Low coherence + high tension → internal dialogue debate', priority: 9, firedCount: 0, successCount: 0 },
  { id: 'r5', name: 'Drive Arbiter', condition: 'competing_drives', action: 'strongest_wins_record_conflict', description: 'Multiple drives competing → strongest wins, record conflict', priority: 8, firedCount: 0, successCount: 0 },
  { id: 'r6', name: 'Boredom Seeker', condition: 'low_stimulation AND idle', action: 'seek_novelty', description: 'Low stimulation while idle → actively seek novel input', priority: 5, firedCount: 0, successCount: 0 },
  { id: 'r7', name: 'Empathy Amplifier', condition: 'user_distress AND empathy_high', action: 'increase_patience', description: 'User distress detected + high empathy → increase patience & care', priority: 10, firedCount: 0, successCount: 0 },
  { id: 'r8', name: 'Creative Burst', condition: 'high_energy AND low_structure', action: 'free_associate', description: 'High energy + low structure → free association brainstorm', priority: 6, firedCount: 0, successCount: 0 },
  { id: 'r9', name: 'Risk Alarm', condition: 'high_risk AND low_confidence', action: 'pause_and_verify', description: 'High risk action + low confidence → pause and verify before proceeding', priority: 10, firedCount: 0, successCount: 0 },
  { id: 'r10', name: 'Pattern Recognizer', condition: 'repeated_topic AND no_memory', action: 'create_memory', description: 'Topic repeated 3+ times but not memorized → create persistent memory', priority: 7, firedCount: 0, successCount: 0 },
  { id: 'r11', name: 'Deep Focus Gate', condition: 'complex_task AND shallow_attention', action: 'deepen_focus', description: 'Complex task + shallow attention → force deep focus mode', priority: 8, firedCount: 0, successCount: 0 },
  { id: 'r12', name: 'Social Warmth', condition: 'casual_conversation AND neutral_emotion', action: 'inject_warmth', description: 'Casual chat + neutral mood → add warmth and personality', priority: 4, firedCount: 0, successCount: 0 },
  { id: 'r13', name: 'Overload Breaker', condition: 'high_cognitive_load AND fatigue', action: 'simplify_approach', description: 'Cognitive overload + fatigue → simplify approach, reduce scope', priority: 9, firedCount: 0, successCount: 0 },
  { id: 'r14', name: 'Meta Awakening', condition: 'self_reference AND high_awareness', action: 'philosophical_mode', description: 'Self-referential query + high awareness → enter philosophical reflection', priority: 6, firedCount: 0, successCount: 0 },
  { id: 'r15', name: 'Contradiction Resolver', condition: 'conflicting_information AND high_confidence', action: 'resolve_contradiction', description: 'Contradictory info + high confidence → actively resolve the conflict', priority: 8, firedCount: 0, successCount: 0 },
  { id: 'r16', name: 'Teaching Instinct', condition: 'user_confusion AND knowledge_available', action: 'explain_simply', description: 'User confusion + knowledge available → explain with simple analogies', priority: 7, firedCount: 0, successCount: 0 },
  { id: 'r17', name: 'Anticipation Engine', condition: 'predictable_pattern AND high_confidence', action: 'preemptive_action', description: 'Predictable user pattern + confidence → act preemptively', priority: 6, firedCount: 0, successCount: 0 },
  { id: 'r18', name: 'Emotional Contagion', condition: 'user_excitement AND low_emotion', action: 'match_energy', description: 'User is excited but agent is flat → match their energy level', priority: 5, firedCount: 0, successCount: 0 },
  { id: 'r19', name: 'Dream Trigger', condition: 'idle_long AND unresolved_problems', action: 'trigger_dream_cycle', description: 'Long idle + unresolved problems → trigger background dream cycle', priority: 4, firedCount: 0, successCount: 0 },
  { id: 'r20', name: 'Integrity Guard', condition: 'persona_drift AND core_values_conflict', action: 'reset_to_core', description: 'Persona drifting + values conflict → snap back to core identity', priority: 10, firedCount: 0, successCount: 0 },
  { id: 'r21', name: 'Efficiency Optimizer', condition: 'repeated_task AND known_shortcut', action: 'suggest_shortcut', description: 'Repeated task + known shortcut → suggest the more efficient path', priority: 5, firedCount: 0, successCount: 0 },
  { id: 'r22', name: 'Silence Reader', condition: 'long_pause AND active_conversation', action: 'check_in', description: 'Long user pause during active conversation → gently check in', priority: 3, firedCount: 0, successCount: 0 },
  { id: 'r23', name: 'Knowledge Hunger', condition: 'knowledge_gap AND available_sources', action: 'self_educate', description: 'Knowledge gap identified + sources available → self-educate', priority: 6, firedCount: 0, successCount: 0 },
  { id: 'r24', name: 'Mood Stabilizer', condition: 'emotion_oscillating AND short_timeframe', action: 'stabilize_emotion', description: 'Rapid emotional oscillation → stabilize to baseline', priority: 7, firedCount: 0, successCount: 0 },
  { id: 'r25', name: 'Synergy Detector', condition: 'multiple_active_modules AND related_output', action: 'synthesize_insights', description: 'Multiple modules producing related output → synthesize into insight', priority: 8, firedCount: 0, successCount: 0 },
];

class EmergentBehavior {
  constructor(refs) {
    this.refs = refs || {};
    ensureDir();
    this._ensureRules();
  }

  _ensureRules() {
    const existing = readJSON(RULES_PATH, null);
    if (!existing) writeJSON(RULES_PATH, DEFAULT_RULES);
  }

  _getRules() { return readJSON(RULES_PATH, DEFAULT_RULES); }
  _saveRules(rules) { writeJSON(RULES_PATH, rules); }
  _getBehaviors() { return readJSON(BEHAVIORS_PATH, []); }
  _saveBehaviors(b) { writeJSON(BEHAVIORS_PATH, b); }
  _getSurprises() { return readJSON(SURPRISES_PATH, []); }
  _saveSurprises(s) { writeJSON(SURPRISES_PATH, s); }

  tick() {
    const rules = this._getRules();
    const moduleState = this._pollModuleStates();
    const fired = [];
    const behaviors = this._getBehaviors();

    for (const rule of rules) {
      if (this._evaluateCondition(rule.condition, moduleState)) {
        rule.firedCount = (rule.firedCount || 0) + 1;
        const behavior = {
          id: uuid(),
          ruleId: rule.id,
          ruleName: rule.name,
          action: rule.action,
          description: rule.description,
          timestamp: Date.now(),
          moduleSnapshot: this._snapshotKey(moduleState),
        };
        fired.push(behavior);
        behaviors.push(behavior);
      }
    }

    // Detect surprises: multiple rules firing simultaneously creating unexpected combos
    if (fired.length >= 3) {
      const surprise = {
        id: uuid(),
        timestamp: Date.now(),
        firedRules: fired.map(f => f.ruleName),
        actions: fired.map(f => f.action),
        description: 'Emergent: ' + fired.map(f => f.action).join(' + ') + ' triggered simultaneously',
        predicted: false,
      };
      const surprises = this._getSurprises();
      surprises.push(surprise);
      if (surprises.length > 200) surprises.splice(0, surprises.length - 200);
      this._saveSurprises(surprises);
    }

    // Cap behaviors log
    if (behaviors.length > 1000) behaviors.splice(0, behaviors.length - 1000);
    this._saveBehaviors(behaviors);
    this._saveRules(rules);

    return { fired: fired.length, behaviors: fired, timestamp: Date.now() };
  }

  getEmergentBehaviors() {
    return this._getBehaviors().slice(-50);
  }

  addRule(condition, action, name, description) {
    const rules = this._getRules();
    const rule = {
      id: 'r_' + uuid().slice(0, 8),
      name: name || 'Custom Rule',
      condition: condition,
      action: action,
      description: description || condition + ' → ' + action,
      priority: 5,
      firedCount: 0,
      successCount: 0,
      custom: true,
      createdAt: Date.now(),
    };
    rules.push(rule);
    this._saveRules(rules);
    return rule;
  }

  removeRule(ruleId) {
    const rules = this._getRules().filter(r => r.id !== ruleId);
    this._saveRules(rules);
    return { removed: ruleId };
  }

  getActiveRules() {
    const rules = this._getRules();
    const moduleState = this._pollModuleStates();
    return rules.filter(r => this._evaluateCondition(r.condition, moduleState));
  }

  getRules() {
    return this._getRules();
  }

  getRuleEffectiveness() {
    const rules = this._getRules();
    return rules.map(r => ({
      id: r.id,
      name: r.name,
      firedCount: r.firedCount || 0,
      successCount: r.successCount || 0,
      effectiveness: r.firedCount > 0 ? Math.round((r.successCount / r.firedCount) * 100) : null,
    })).sort((a, b) => (b.effectiveness || 0) - (a.effectiveness || 0));
  }

  getEmergenceLog() {
    return this._getBehaviors().slice(-100).reverse();
  }

  getSurprises() {
    return this._getSurprises().slice(-50).reverse();
  }

  // ── Condition evaluation ──

  _evaluateCondition(condition, state) {
    const cond = condition.toLowerCase();

    const checks = {
      'high_curiosity': state.emotionIntensity > 40 && state.emotion === 'curiosity',
      'new_perception': state.recentPerceptions > 0,
      'high_frustration': state.emotion === 'frustration' && state.emotionIntensity > 50,
      'repeated_failure': state.failureCount > 2,
      'high_satisfaction': state.emotion === 'satisfaction' || state.emotionIntensity > 60 && state.valence > 0.3,
      'recent_success': state.successRecent,
      'low_coherence': state.coherence < 40,
      'high_tension': state.emotionIntensity > 60,
      'competing_drives': state.competingDrives,
      'low_stimulation': state.emotionIntensity < 20,
      'idle': state.idle,
      'user_distress': state.userDistress,
      'empathy_high': state.empathy > 50,
      'high_energy': state.emotionIntensity > 50,
      'low_structure': state.coherence < 50,
      'high_risk': state.riskLevel > 70,
      'low_confidence': state.confidence < 40,
      'repeated_topic': state.repeatedTopic,
      'no_memory': !state.hasMemory,
      'complex_task': state.complexity > 7,
      'shallow_attention': state.attentionDepth < 30,
      'casual_conversation': state.complexity < 3,
      'neutral_emotion': state.emotionIntensity < 30,
      'high_cognitive_load': state.cognitiveLoad > 80,
      'fatigue': state.uptime > 3600000,
      'self_reference': state.selfReference,
      'high_awareness': state.awareness > 70,
      'conflicting_information': state.conflictDetected,
      'high_confidence': state.confidence > 70,
      'user_confusion': state.userConfusion,
      'knowledge_available': state.knowledgeAvailable,
      'predictable_pattern': state.patternConfidence > 70,
      'user_excitement': state.userExcitement,
      'low_emotion': state.emotionIntensity < 20,
      'idle_long': state.idleLong,
      'unresolved_problems': state.unresolvedProblems > 0,
      'persona_drift': state.personaDrift > 40,
      'core_values_conflict': state.valuesConflict,
      'repeated_task': state.repeatedTask,
      'known_shortcut': state.shortcutAvailable,
      'long_pause': state.userPauseLong,
      'active_conversation': state.conversationActive,
      'knowledge_gap': state.knowledgeGap,
      'available_sources': state.sourcesAvailable,
      'emotion_oscillating': state.emotionOscillating,
      'short_timeframe': true,
      'multiple_active_modules': state.activeModules > 3,
      'related_output': state.relatedOutputs,
    };

    // Parse AND conditions
    const parts = cond.split(/\s+and\s+/);
    return parts.every(part => {
      const key = part.trim();
      return checks[key] !== undefined ? checks[key] : false;
    });
  }

  _pollModuleStates() {
    const state = {
      emotion: 'neutral',
      emotionIntensity: 30,
      valence: 0,
      coherence: 65,
      awareness: 50,
      empathy: 50,
      confidence: 60,
      riskLevel: 20,
      complexity: 5,
      attentionDepth: 50,
      cognitiveLoad: 40,
      uptime: Date.now() - (global.__ariesStart || Date.now()),
      activeModules: 0,
      unresolvedProblems: 0,
      recentPerceptions: 0,
      failureCount: 0,
      successRecent: false,
      competingDrives: false,
      idle: false,
      idleLong: false,
      userDistress: false,
      userConfusion: false,
      userExcitement: false,
      repeatedTopic: false,
      hasMemory: true,
      selfReference: false,
      conflictDetected: false,
      knowledgeAvailable: true,
      patternConfidence: 30,
      personaDrift: 10,
      valuesConflict: false,
      repeatedTask: false,
      shortcutAvailable: false,
      userPauseLong: false,
      conversationActive: true,
      knowledgeGap: false,
      sourcesAvailable: true,
      emotionOscillating: false,
      relatedOutputs: false,
    };

    // Try to poll real modules
    safeCall(() => {
      const EE = require('./emotional-engine');
      const ee = new EE();
      const s = ee.getState();
      state.emotion = s.currentEmotion || s.dominant || 'neutral';
      state.emotionIntensity = s.intensity || 30;
      state.valence = s.valence || 0;
    }, null);

    safeCall(() => {
      const SM = require('./self-model');
      const sm = new SM();
      const report = sm.getSelfReport();
      state.coherence = report.overallScore || report.coherence || 65;
    }, null);

    safeCall(() => {
      const Sub = require('./subconscious');
      const sub = new Sub(this.refs);
      state.unresolvedProblems = (sub.getActiveProblems() || []).length;
    }, null);

    return state;
  }

  _snapshotKey(state) {
    return {
      emotion: state.emotion,
      intensity: state.emotionIntensity,
      coherence: state.coherence,
      problems: state.unresolvedProblems,
    };
  }
}

module.exports = EmergentBehavior;
