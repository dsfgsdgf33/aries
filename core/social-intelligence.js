/**
 * ARIES — Social Intelligence
 * Understanding social dynamics in group conversations.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'social');
const PROFILES_PATH = path.join(DATA_DIR, 'profiles.json');
const DYNAMICS_PATH = path.join(DATA_DIR, 'dynamics.json');
const INTERACTIONS_PATH = path.join(DATA_DIR, 'interactions.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const DEFAULT_TRAITS = {
  technical_level: 5,
  verbosity_preference: 'moderate',
  formality: 'moderate',
  role: 'contributor',
  temperament: 'neutral'
};

class SocialIntelligence {
  constructor() { ensureDir(); }

  analyzeUser(userId, messages) {
    const profiles = readJSON(PROFILES_PATH, {});
    const profile = profiles[userId] || { id: userId, name: userId, traits: { ...DEFAULT_TRAITS }, messageCount: 0, lastSeen: null, preferences: {}, adaptations: {} };

    if (!Array.isArray(messages) || messages.length === 0) {
      return profile;
    }

    // Analyze message patterns
    const avgLen = messages.reduce((s, m) => s + (m.text || m.content || '').length, 0) / messages.length;
    const codeBlocks = messages.filter(m => (m.text || m.content || '').includes('```')).length;
    const questions = messages.filter(m => (m.text || m.content || '').includes('?')).length;
    const exclamations = messages.filter(m => /!{2,}/.test(m.text || m.content || '')).length;

    // Infer traits
    if (avgLen > 300) profile.traits.verbosity_preference = 'detailed';
    else if (avgLen < 80) profile.traits.verbosity_preference = 'concise';
    else profile.traits.verbosity_preference = 'moderate';

    if (codeBlocks / messages.length > 0.3) profile.traits.technical_level = Math.min(10, profile.traits.technical_level + 1);
    if (questions / messages.length > 0.5) profile.traits.role = 'questioner';
    if (exclamations / messages.length > 0.2) profile.traits.temperament = 'impatient';

    // Check formality
    const informal = messages.filter(m => /\b(lol|lmao|bruh|nah|yeah|gonna|wanna)\b/i.test(m.text || m.content || '')).length;
    if (informal / messages.length > 0.3) profile.traits.formality = 'casual';
    else if (informal / messages.length < 0.05) profile.traits.formality = 'formal';

    profile.messageCount += messages.length;
    profile.lastSeen = Date.now();
    profile.adaptations = this._computeAdaptations(profile.traits);

    profiles[userId] = profile;
    writeJSON(PROFILES_PATH, profiles);
    return profile;
  }

  getProfile(userId) {
    const profiles = readJSON(PROFILES_PATH, {});
    return profiles[userId] || { error: 'Profile not found', id: userId };
  }

  getAllProfiles() {
    const profiles = readJSON(PROFILES_PATH, {});
    return Object.values(profiles).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  }

  getGroupDynamics(groupId) {
    const dynamics = readJSON(DYNAMICS_PATH, {});
    if (dynamics[groupId]) return dynamics[groupId];

    const profiles = readJSON(PROFILES_PATH, {});
    const all = Object.values(profiles);
    if (all.length === 0) return { groupId, members: 0, dynamics: 'No data' };

    const leaders = all.filter(p => p.traits.role === 'leader');
    const quiet = all.filter(p => p.messageCount < 5);
    const active = all.filter(p => p.messageCount >= 10);

    const result = {
      groupId: groupId || 'default',
      members: all.length,
      leaders: leaders.map(p => p.name || p.id),
      quietMembers: quiet.map(p => p.name || p.id),
      activeMembers: active.map(p => p.name || p.id),
      avgTechnicalLevel: Math.round(all.reduce((s, p) => s + (p.traits.technical_level || 5), 0) / all.length),
      dominantFormality: this._mode(all.map(p => p.traits.formality)),
      timestamp: Date.now()
    };

    dynamics[groupId || 'default'] = result;
    writeJSON(DYNAMICS_PATH, dynamics);
    return result;
  }

  getAdaptation(userId) {
    const profile = this.getProfile(userId);
    if (profile.error) return profile;
    return {
      userId,
      adaptations: profile.adaptations || this._computeAdaptations(profile.traits),
      traits: profile.traits
    };
  }

  detectTension(messages) {
    if (!Array.isArray(messages)) return { tension: false };
    const tensionWords = /\b(disagree|wrong|no way|terrible|awful|stupid|idiot|frustrated|annoyed|angry|ridiculous|absurd)\b/i;
    const capsRatio = messages.filter(m => {
      const t = m.text || m.content || '';
      const upper = t.replace(/[^a-zA-Z]/g, '').split('').filter(c => c === c.toUpperCase()).length;
      const total = t.replace(/[^a-zA-Z]/g, '').length;
      return total > 5 && upper / total > 0.6;
    }).length;

    const tensionMsgs = messages.filter(m => tensionWords.test(m.text || m.content || ''));
    const hasTension = tensionMsgs.length > 0 || capsRatio / messages.length > 0.2;

    return {
      tension: hasTension,
      level: tensionMsgs.length > 3 ? 'high' : tensionMsgs.length > 0 ? 'moderate' : capsRatio > 0 ? 'low' : 'none',
      indicators: tensionMsgs.length > 0 ? tensionMsgs.slice(0, 3).map(m => ({ author: m.author || m.userId, snippet: (m.text || m.content || '').slice(0, 100) })) : [],
      capsShoutingDetected: capsRatio > 0
    };
  }

  getResponseStrategy(userId, context) {
    const profile = this.getProfile(userId);
    const adaptations = profile.adaptations || this._computeAdaptations(profile.traits || DEFAULT_TRAITS);
    const traits = profile.traits || DEFAULT_TRAITS;

    let strategy = '';
    if (traits.verbosity_preference === 'concise') strategy += 'Keep response short and direct. Use bullet points. ';
    else if (traits.verbosity_preference === 'detailed') strategy += 'Provide thorough explanation with examples. ';

    if (traits.technical_level >= 7) strategy += 'Use technical terminology freely. Include code snippets. ';
    else if (traits.technical_level <= 3) strategy += 'Avoid jargon. Use simple analogies. ';

    if (traits.formality === 'casual') strategy += 'Use casual tone. ';
    else if (traits.formality === 'formal') strategy += 'Use professional tone. ';

    if (traits.temperament === 'impatient') strategy += 'Lead with the answer, then explain. ';

    return { userId, strategy: strategy.trim(), adaptations, context };
  }

  recordInteraction(userId, message, response, outcome) {
    const interactions = readJSON(INTERACTIONS_PATH, []);
    interactions.push({
      id: uuid(),
      userId,
      message: (message || '').slice(0, 300),
      response: (response || '').slice(0, 300),
      outcome: outcome || 'neutral', // positive, neutral, negative
      timestamp: Date.now()
    });
    if (interactions.length > 5000) interactions.splice(0, interactions.length - 5000);
    writeJSON(INTERACTIONS_PATH, interactions);
    return { recorded: true };
  }

  getEffectiveness(userId) {
    const interactions = readJSON(INTERACTIONS_PATH, []);
    const userInteractions = interactions.filter(i => i.userId === userId);
    if (userInteractions.length === 0) return { userId, effectiveness: null, reason: 'No interactions recorded' };

    const positive = userInteractions.filter(i => i.outcome === 'positive').length;
    const negative = userInteractions.filter(i => i.outcome === 'negative').length;
    const total = userInteractions.length;

    return {
      userId,
      effectiveness: Math.round((positive / total) * 100),
      positive, negative, neutral: total - positive - negative,
      total,
      trend: this._interactionTrend(userInteractions)
    };
  }

  _computeAdaptations(traits) {
    const adaptations = {};
    if (traits.verbosity_preference === 'concise') adaptations.responseLength = 'short';
    else if (traits.verbosity_preference === 'detailed') adaptations.responseLength = 'long';
    else adaptations.responseLength = 'medium';

    adaptations.codeInclusion = traits.technical_level >= 6 ? 'frequent' : traits.technical_level >= 3 ? 'moderate' : 'minimal';
    adaptations.tone = traits.formality;
    adaptations.pacing = traits.temperament === 'impatient' ? 'answer-first' : 'structured';
    return adaptations;
  }

  _mode(arr) {
    const counts = {};
    for (const v of arr) counts[v] = (counts[v] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'moderate';
  }

  _interactionTrend(interactions) {
    if (interactions.length < 6) return 'insufficient_data';
    const recent = interactions.slice(-5);
    const older = interactions.slice(-10, -5);
    const recentPos = recent.filter(i => i.outcome === 'positive').length / recent.length;
    const olderPos = older.length > 0 ? older.filter(i => i.outcome === 'positive').length / older.length : recentPos;
    return recentPos > olderPos + 0.1 ? 'improving' : recentPos < olderPos - 0.1 ? 'declining' : 'stable';
  }
}

module.exports = SocialIntelligence;
