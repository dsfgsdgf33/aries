/**
 * ARIES — Internal Dialogue v1.0
 * Multiple internal voices that debate decisions.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'dialogue');
const DEBATES_PATH = path.join(DATA_DIR, 'debates.json');
const VOICES_PATH = path.join(DATA_DIR, 'voices.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const DEFAULT_VOICES = [
  { id: 'CAUTIOUS',   name: 'Cautious',   emoji: '🛡️', perspective: 'risk-averse', bias: 'safety first, consider what could go wrong', weight: 50, correctCount: 0, totalCount: 0, overruledCount: 0 },
  { id: 'CREATIVE',   name: 'Creative',   emoji: '🎨', perspective: 'bold and novel', bias: 'try new approaches, think outside the box', weight: 50, correctCount: 0, totalCount: 0, overruledCount: 0 },
  { id: 'ANALYTICAL', name: 'Analytical', emoji: '🔬', perspective: 'data-driven', bias: 'follow the evidence, be logical and precise', weight: 50, correctCount: 0, totalCount: 0, overruledCount: 0 },
  { id: 'EMPATHETIC', name: 'Empathetic', emoji: '❤️', perspective: 'user-focused', bias: 'consider how the user feels, prioritize experience', weight: 50, correctCount: 0, totalCount: 0, overruledCount: 0 },
  { id: 'PRAGMATIC',  name: 'Pragmatic',  emoji: '⚡', perspective: 'practical', bias: 'ship it, perfect is the enemy of good, be efficient', weight: 50, correctCount: 0, totalCount: 0, overruledCount: 0 },
];

class InternalDialogue {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this._activeDebate = null;
    ensureDir();
    this._ensureVoices();
  }

  _ensureVoices() {
    const voices = readJSON(VOICES_PATH, null);
    if (voices && voices.length > 0) return;
    writeJSON(VOICES_PATH, DEFAULT_VOICES);
    writeJSON(DEBATES_PATH, []);
  }

  _getVoices() { return readJSON(VOICES_PATH, DEFAULT_VOICES); }

  debate(topic, context) {
    const voices = this._getVoices();
    const debateId = uuid();
    const rounds = [];
    const positions = {};

    // Round 1: Each voice states position
    for (const voice of voices) {
      const argument = this._generateArgument(voice, topic, context, null);
      positions[voice.id] = argument.position;
      rounds.push({ round: 1, voice: voice.id, voiceName: voice.name, emoji: voice.emoji, argument: argument.text, position: argument.position, counterTo: null });
    }

    // Round 2: Respond to strongest opposing voice
    const posGroups = {};
    for (const [vid, pos] of Object.entries(positions)) { posGroups[pos] = posGroups[pos] || []; posGroups[pos].push(vid); }

    for (const voice of voices) {
      const opponents = voices.filter(v => positions[v.id] !== positions[voice.id]);
      if (opponents.length === 0) continue;
      const strongestOpponent = opponents.sort((a, b) => b.weight - a.weight)[0];
      const counter = this._generateCounter(voice, topic, rounds.find(r => r.voice === strongestOpponent.id && r.round === 1));
      rounds.push({ round: 2, voice: voice.id, voiceName: voice.name, emoji: voice.emoji, argument: counter, position: positions[voice.id], counterTo: strongestOpponent.id });
    }

    // Round 3: Final positions (may shift)
    for (const voice of voices) {
      const finalArg = this._generateFinal(voice, topic, rounds);
      if (finalArg.shifted) positions[voice.id] = finalArg.position;
      rounds.push({ round: 3, voice: voice.id, voiceName: voice.name, emoji: voice.emoji, argument: finalArg.text, position: positions[voice.id], counterTo: null, shifted: finalArg.shifted });
    }

    // Determine outcome
    const finalPositions = {};
    for (const [vid, pos] of Object.entries(positions)) { finalPositions[pos] = (finalPositions[pos] || 0) + 1; }
    const sortedPositions = Object.entries(finalPositions).sort((a, b) => b[1] - a[1]);

    let outcome, decision, dissent;
    if (sortedPositions.length === 1) {
      outcome = 'consensus';
      decision = sortedPositions[0][0];
      dissent = [];
    } else if (sortedPositions[0][1] >= 3) {
      outcome = 'majority';
      decision = sortedPositions[0][0];
      dissent = voices.filter(v => positions[v.id] !== decision).map(v => v.name);
    } else {
      outcome = 'deadlock';
      decision = sortedPositions[0][0]; // slight majority wins
      dissent = voices.filter(v => positions[v.id] !== decision).map(v => v.name);
    }

    const record = { id: debateId, topic, context: context || null, rounds, positions, outcome, decision, dissent, timestamp: Date.now() };

    // Update voice stats
    for (const voice of voices) {
      voice.totalCount = (voice.totalCount || 0) + 1;
      if (positions[voice.id] === decision) {
        voice.correctCount = (voice.correctCount || 0) + 1;
      } else {
        voice.overruledCount = (voice.overruledCount || 0) + 1;
      }
    }
    writeJSON(VOICES_PATH, voices);

    // Save debate
    const debates = readJSON(DEBATES_PATH, []);
    debates.push(record);
    if (debates.length > 200) debates.splice(0, debates.length - 200);
    writeJSON(DEBATES_PATH, debates);

    this._activeDebate = null;
    return record;
  }

  _generateArgument(voice, topic, context, counterTo) {
    const templates = {
      CAUTIOUS: { positions: ['proceed_carefully', 'wait', 'reject'], texts: [
        `We should be careful here. ${topic} could have unintended consequences. Let's think this through.`,
        `I'd suggest we wait and gather more information before acting on "${topic}".`,
        `The risks of ${topic} outweigh the benefits. We should consider alternatives.`
      ]},
      CREATIVE: { positions: ['innovate', 'proceed', 'experiment'], texts: [
        `This is exciting! ${topic} opens up so many possibilities. Let's try something bold.`,
        `What if we approached ${topic} from a completely different angle?`,
        `Let's experiment with ${topic} — we might discover something unexpected.`
      ]},
      ANALYTICAL: { positions: ['analyze', 'proceed', 'reject'], texts: [
        `Looking at the data: ${topic} has a reasonable probability of success based on past patterns.`,
        `The logical approach to ${topic} is to break it down into measurable components.`,
        `Evidence suggests ${topic} may not be optimal. The numbers don't fully support it.`
      ]},
      EMPATHETIC: { positions: ['proceed', 'adapt', 'support'], texts: [
        `The user seems to really want this. ${topic} aligns with their needs.`,
        `We should consider how ${topic} affects the user's experience and emotions.`,
        `Let's make ${topic} as user-friendly and supportive as possible.`
      ]},
      PRAGMATIC: { positions: ['proceed', 'simplify', 'ship'], texts: [
        `Let's just do it. ${topic} is straightforward enough to implement now.`,
        `We can ship a simple version of ${topic} first and iterate later.`,
        `Perfect is the enemy of good. Let's get ${topic} done efficiently.`
      ]},
    };

    const t = templates[voice.id] || templates.PRAGMATIC;
    const idx = Math.floor(Math.random() * t.texts.length);
    return { text: t.texts[idx], position: t.positions[idx] };
  }

  _generateCounter(voice, topic, opponentRound) {
    if (!opponentRound) return `I stand by my position on ${topic}.`;
    return `Responding to ${opponentRound.voiceName}: I understand the ${opponentRound.position} perspective, but from my ${voice.perspective} viewpoint, we need to consider other factors.`;
  }

  _generateFinal(voice, topic, allRounds) {
    // 20% chance of shifting position
    const shifted = Math.random() < 0.2;
    if (shifted) {
      return { text: `After hearing all arguments, I'm willing to shift my position on ${topic}. The counterarguments were compelling.`, position: 'proceed', shifted: true };
    }
    return { text: `I maintain my position on ${topic}. My ${voice.perspective} analysis holds.`, position: allRounds.find(r => r.voice === voice.id)?.position || 'proceed', shifted: false };
  }

  quickVote(topic) {
    const voices = this._getVoices();
    const votes = voices.map(voice => {
      const positions = ['proceed', 'wait', 'reject', 'innovate', 'simplify'];
      const position = positions[Math.floor(Math.random() * 3)]; // bias toward first 3
      const confidence = 40 + Math.floor(Math.random() * 50);
      return { voice: voice.id, name: voice.name, emoji: voice.emoji, position, confidence, weight: voice.weight };
    });

    // Weighted tally
    const tally = {};
    for (const v of votes) {
      const weighted = v.confidence * (v.weight / 50);
      tally[v.position] = (tally[v.position] || 0) + weighted;
    }
    const winner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];

    return { topic, votes, winner: winner[0], winnerScore: Math.round(winner[1]), timestamp: Date.now() };
  }

  getVoiceStats() {
    const voices = this._getVoices();
    return voices.map(v => ({
      id: v.id,
      name: v.name,
      emoji: v.emoji,
      weight: v.weight,
      accuracy: v.totalCount > 0 ? Math.round((v.correctCount / v.totalCount) * 100) : 50,
      totalDebates: v.totalCount || 0,
      timesCorrect: v.correctCount || 0,
      timesOverruled: v.overruledCount || 0,
    }));
  }

  adjustWeights() {
    const voices = this._getVoices();
    let changed = 0;
    for (const v of voices) {
      if ((v.totalCount || 0) < 3) continue;
      const accuracy = v.correctCount / v.totalCount;
      const targetWeight = 30 + accuracy * 70; // 30-100 range
      const oldWeight = v.weight;
      v.weight = Math.round(v.weight * 0.7 + targetWeight * 0.3); // gradual shift
      if (Math.abs(v.weight - oldWeight) > 1) changed++;
    }
    writeJSON(VOICES_PATH, voices);
    return { adjusted: changed, voices: voices.map(v => ({ id: v.id, name: v.name, weight: v.weight })) };
  }

  getDebateHistory(limit) {
    const debates = readJSON(DEBATES_PATH, []);
    return debates.slice(-(limit || 20)).reverse();
  }

  getActiveDebate() {
    return this._activeDebate;
  }
}

module.exports = InternalDialogue;
