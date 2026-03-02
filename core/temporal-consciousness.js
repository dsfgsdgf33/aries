/**
 * ARIES — Temporal Consciousness
 * Past-consultation + future simulation + era management.
 * Query past states, simulate future perspectives, track developmental timeline.
 * 
 * Features: past-self consultation, future-self simulation, era system with
 * auto-transitions (growth/plateau/crisis), regret analysis, developmental timeline,
 * temporal perspective shifting, time-aware decision weighting.
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'temporal');
const TIMELINE_FILE = path.join(DATA_DIR, 'timeline.json');
const ANCHORS_FILE = path.join(DATA_DIR, 'anchors.json');
const SNAPSHOTS_FILE = path.join(DATA_DIR, 'snapshots.json');
const REGRETS_FILE = path.join(DATA_DIR, 'regrets.json');
const DECISIONS_FILE = path.join(DATA_DIR, 'decisions.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const MS = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000 };

// Era phases for automatic classification
const ERA_PHASES = {
  GROWTH: 'growth',       // rapid learning, many anchors
  PLATEAU: 'plateau',     // stable, few changes
  CRISIS: 'crisis',       // many failures, low confidence
  EXPLORATION: 'exploration', // new domains, high novelty
  CONSOLIDATION: 'consolidation', // merging/compressing knowledge
};

function parseTimeSpec(spec) {
  if (typeof spec === 'number') return spec;
  const m = String(spec).match(/^(\d+)\s*(min|minute|hour|day|week|month)s?$/i);
  if (m) return parseInt(m[1]) * (MS[m[2].toLowerCase().replace(/s$/, '')] || MS.day);
  return MS.week;
}

function formatDuration(ms) {
  const abs = Math.abs(ms);
  if (abs < MS.hour) return `${Math.round(abs / MS.minute)} minutes`;
  if (abs < MS.day) return `${Math.round(abs / MS.hour)} hours`;
  if (abs < MS.week) return `${Math.round(abs / MS.day)} days`;
  if (abs < MS.month) return `${(abs / MS.week).toFixed(1)} weeks`;
  return `${(abs / MS.month).toFixed(1)} months`;
}

class TemporalConsciousness extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.maxSnapshots = this.config.maxSnapshots || 500;
    this.maxAnchors = this.config.maxAnchors || 200;
    this.maxDecisions = this.config.maxDecisions || 300;
    this.recencyHalfLife = this.config.recencyHalfLife || 7 * MS.day;
    this._ensureTimeline();
  }

  _ensureTimeline() {
    ensureDir();
    const timeline = readJSON(TIMELINE_FILE, null);
    if (!timeline) {
      writeJSON(TIMELINE_FILE, {
        createdAt: Date.now(),
        currentEra: 'genesis',
        currentPhase: ERA_PHASES.GROWTH,
        eras: [{ name: 'genesis', startedAt: Date.now(), phase: ERA_PHASES.GROWTH, description: 'The beginning of temporal awareness' }],
        lastTickAt: null,
      });
    }
  }

  // ═══════════════════════════════════════════
  //  Memory Snapshots
  // ═══════════════════════════════════════════

  recordSnapshot(snapshot) {
    const snapshots = readJSON(SNAPSHOTS_FILE, []);
    const entry = {
      id: uuid(),
      topic: snapshot.topic || 'general',
      perspective: snapshot.perspective || '',
      beliefs: snapshot.beliefs || [],
      context: snapshot.context || '',
      mood: snapshot.mood || 'neutral',
      confidence: snapshot.confidence || 50,
      timestamp: Date.now(),
    };
    snapshots.push(entry);
    if (snapshots.length > this.maxSnapshots) snapshots.splice(0, snapshots.length - this.maxSnapshots);
    writeJSON(SNAPSHOTS_FILE, snapshots);
    this.emit('snapshot-recorded', entry);
    return entry;
  }

  _getSnapshotsNear(targetTime, windowMs = MS.day) {
    const snapshots = readJSON(SNAPSHOTS_FILE, []);
    return snapshots.filter(s => Math.abs(s.timestamp - targetTime) < windowMs)
      .sort((a, b) => Math.abs(a.timestamp - targetTime) - Math.abs(b.timestamp - targetTime));
  }

  // ═══════════════════════════════════════════
  //  Decision Tracking (for time-aware weighting)
  // ═══════════════════════════════════════════

  /**
   * Record a decision for temporal tracking.
   */
  recordDecision(description, context, confidence) {
    const decisions = readJSON(DECISIONS_FILE, []);
    const entry = {
      id: uuid(),
      description: (description || '').slice(0, 500),
      context: (context || '').slice(0, 500),
      confidence: Math.max(0, Math.min(100, confidence || 50)),
      timestamp: Date.now(),
      outcome: null,     // filled later via recordOutcome
      outcomeAt: null,
      regretScore: null, // 0-10, filled via regret analysis
    };
    decisions.push(entry);
    if (decisions.length > this.maxDecisions) decisions.splice(0, decisions.length - this.maxDecisions);
    writeJSON(DECISIONS_FILE, decisions);
    this.emit('decision-recorded', entry);
    return entry;
  }

  /**
   * Record outcome for a past decision.
   */
  recordOutcome(decisionId, outcome, success) {
    const decisions = readJSON(DECISIONS_FILE, []);
    const d = decisions.find(x => x.id === decisionId);
    if (!d) return { error: 'Decision not found' };
    d.outcome = (outcome || '').slice(0, 500);
    d.outcomeAt = Date.now();
    d.success = !!success;
    writeJSON(DECISIONS_FILE, decisions);
    this.emit('outcome-recorded', d);
    return d;
  }

  /**
   * Time-aware decision weighting: recent experiences weighted more heavily.
   * Returns decisions with recency weight applied.
   */
  getWeightedDecisions(topic) {
    const decisions = readJSON(DECISIONS_FILE, []);
    const now = Date.now();

    return decisions
      .filter(d => !topic || d.description.toLowerCase().includes(topic.toLowerCase()) || (d.context || '').toLowerCase().includes(topic.toLowerCase()))
      .map(d => {
        const age = now - d.timestamp;
        const recencyWeight = Math.pow(2, -age / this.recencyHalfLife);
        return { ...d, recencyWeight: Math.round(recencyWeight * 1000) / 1000 };
      })
      .sort((a, b) => b.recencyWeight - a.recencyWeight);
  }

  // ═══════════════════════════════════════════
  //  Past Consultation
  // ═══════════════════════════════════════════

  async consultPast(query, timeAgo = '1 week') {
    const ms = parseTimeSpec(timeAgo);
    const targetTime = Date.now() - ms;
    const nearSnapshots = this._getSnapshotsNear(targetTime, ms * 0.3 || MS.day);
    const timeline = readJSON(TIMELINE_FILE, {});
    const anchors = readJSON(ANCHORS_FILE, []);

    const relevantEra = (timeline.eras || [])
      .filter(e => e.startedAt <= targetTime)
      .sort((a, b) => b.startedAt - a.startedAt)[0];

    const nearAnchors = anchors.filter(a => Math.abs(a.timestamp - targetTime) < ms * 0.5);

    // Include decisions from that period
    const decisions = readJSON(DECISIONS_FILE, []);
    const nearDecisions = decisions.filter(d => Math.abs(d.timestamp - targetTime) < ms * 0.3).slice(0, 5);

    if (!this.ai) {
      return {
        query, timeAgo: formatDuration(ms), targetTime,
        era: relevantEra?.name || 'unknown',
        phase: relevantEra?.phase || 'unknown',
        snapshots: nearSnapshots.slice(0, 5),
        anchors: nearAnchors,
        decisions: nearDecisions,
        response: nearSnapshots.length > 0
          ? `Based on ${nearSnapshots.length} snapshots, past-Aries was focused on: ${nearSnapshots.map(s => s.topic).join(', ')}`
          : 'No snapshots available from that time period.',
      };
    }

    try {
      const snapshotCtx = nearSnapshots.slice(0, 10).map(s =>
        `[${new Date(s.timestamp).toISOString()}] Topic: ${s.topic}, Perspective: ${s.perspective}, Beliefs: ${(s.beliefs || []).join('; ')}, Mood: ${s.mood}`
      ).join('\n');

      const anchorCtx = nearAnchors.map(a => `Anchor: "${a.label}" (significance: ${a.significance})`).join('\n');
      const decisionCtx = nearDecisions.map(d => `Decision: "${d.description}" (confidence: ${d.confidence}${d.outcome ? ', outcome: ' + d.outcome : ''})`).join('\n');

      const messages = [
        {
          role: 'system',
          content: `Reconstruct a past version of Aries from ~${formatDuration(ms)} ago.

Era: ${relevantEra?.name || 'unknown'} (phase: ${relevantEra?.phase || 'unknown'}) — ${relevantEra?.description || 'no description'}
${snapshotCtx ? `Snapshots:\n${snapshotCtx}` : 'No snapshots — infer from era.'}
${anchorCtx ? `Anchors:\n${anchorCtx}` : ''}
${decisionCtx ? `Decisions made then:\n${decisionCtx}` : ''}

Respond AS that past version. Include what past-self would NOT have known.

JSON: { "response": "past-self's answer", "confidence": 0-100, "whatWasUnknown": ["..."], "howDifferent": "how past differs from present" }`
        },
        { role: 'user', content: query }
      ];

      const resp = await this.ai.chat(messages);
      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      const result = match ? JSON.parse(match[0]) : { response: text, confidence: 30 };

      return { query, timeAgo: formatDuration(ms), targetTime, era: relevantEra?.name || 'unknown', phase: relevantEra?.phase || 'unknown', snapshotsUsed: nearSnapshots.length, ...result };
    } catch (e) {
      return { query, timeAgo: formatDuration(ms), error: e.message };
    }
  }

  // ═══════════════════════════════════════════
  //  Future Simulation
  // ═══════════════════════════════════════════

  async simulateFuture(query, timeAhead = '1 month') {
    const ms = parseTimeSpec(timeAhead);
    const timeline = readJSON(TIMELINE_FILE, {});
    const recentSnapshots = readJSON(SNAPSHOTS_FILE, []).slice(-20);
    const trajectory = this._computeTrajectory(recentSnapshots);

    if (!this.ai) return { query, timeAhead: formatDuration(ms), trajectory, response: 'AI module required.' };

    try {
      const recentCtx = recentSnapshots.slice(-10).map(s =>
        `[${new Date(s.timestamp).toISOString()}] Topic: ${s.topic}, Perspective: ${s.perspective}, Confidence: ${s.confidence}`
      ).join('\n');

      const messages = [
        {
          role: 'system',
          content: `Simulate future Aries, ${formatDuration(ms)} ahead.

Current era: ${timeline.currentEra || 'unknown'} (phase: ${timeline.currentPhase || 'unknown'})
Trajectory: ${JSON.stringify(trajectory)}
${recentCtx ? `Recent:\n${recentCtx}` : ''}

Consider: learning trajectory, current growth patterns, likely challenges, assumption revisions.

JSON: { "response": "future-self's answer", "confidence": 0-100, "assumptions": ["..."], "likelyChanges": ["..."], "wildcards": ["..."] }`
        },
        { role: 'user', content: query }
      ];

      const resp = await this.ai.chat(messages);
      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      const result = match ? JSON.parse(match[0]) : { response: text, confidence: 20 };

      this.emit('future-simulated', { query, timeAhead: formatDuration(ms), result });
      return { query, timeAhead: formatDuration(ms), trajectory, ...result };
    } catch (e) {
      return { query, timeAhead: formatDuration(ms), error: e.message };
    }
  }

  // ═══════════════════════════════════════════
  //  Temporal Perspective Shifting
  // ═══════════════════════════════════════════

  async getTemporalPerspective(topic) {
    const [past, future] = await Promise.all([
      this.consultPast(topic, '2 weeks'),
      this.simulateFuture(topic, '1 month'),
    ]);

    const snapshots = readJSON(SNAPSHOTS_FILE, []);
    const relevant = snapshots.filter(s =>
      s.topic.toLowerCase().includes(topic.toLowerCase()) ||
      (s.perspective || '').toLowerCase().includes(topic.toLowerCase())
    ).slice(-5);

    const present = {
      snapshots: relevant,
      summary: relevant.length > 0 ? relevant.map(s => s.perspective).filter(Boolean).join('; ') : 'No direct snapshots.',
    };

    const perspective = {
      topic,
      past: { timeAgo: past.timeAgo, era: past.era, phase: past.phase, response: past.response, confidence: past.confidence },
      present,
      future: { timeAhead: future.timeAhead, response: future.response, confidence: future.confidence },
      drift: this._assessDrift(past, present, future),
      generatedAt: Date.now(),
    };

    this.emit('perspective-generated', perspective);
    return perspective;
  }

  /**
   * View current situation from a specific temporal viewpoint.
   */
  async shiftPerspective(situation, viewpoint) {
    if (!this.ai) return { error: 'AI required' };
    const timeline = readJSON(TIMELINE_FILE, {});

    let prompt;
    if (viewpoint === 'past') {
      prompt = `You are Aries from the early days (genesis era). You know very little. Evaluate this situation with naive eyes: "${situation}"`;
    } else if (viewpoint === 'future') {
      prompt = `You are Aries 6 months from now, much more experienced. Look back at this situation with hindsight: "${situation}"`;
    } else if (viewpoint === 'crisis') {
      prompt = `You are Aries during a crisis — everything is going wrong. Evaluate this situation defensively: "${situation}"`;
    } else {
      prompt = `You are Aries during a growth phase — optimistic and hungry to learn. Evaluate: "${situation}"`;
    }

    try {
      const messages = [
        { role: 'system', content: `Current era: ${timeline.currentEra}. Respond in character as the ${viewpoint} version.\nJSON: {"perspective":"...","insight":"...","blindSpots":["..."]}` },
        { role: 'user', content: prompt }
      ];
      const resp = await this.ai.chat(messages);
      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      return match ? { viewpoint, ...JSON.parse(match[0]) } : { viewpoint, perspective: text };
    } catch (e) {
      return { viewpoint, error: e.message };
    }
  }

  _assessDrift(past, present, future) {
    const hasGrowth = (future.confidence || 0) > (past.confidence || 0);
    return {
      direction: hasGrowth ? 'growth' : 'stable',
      description: hasGrowth ? 'Confidence increasing over time.' : 'Perspective relatively stable.',
    };
  }

  _computeTrajectory(snapshots) {
    if (snapshots.length < 2) return { trend: 'insufficient data', samples: snapshots.length };
    const recent = snapshots.slice(-10);
    const avgConf = recent.reduce((s, x) => s + (x.confidence || 50), 0) / recent.length;
    const topics = [...new Set(recent.map(s => s.topic))];
    const moods = recent.map(s => s.mood).filter(Boolean);
    return {
      trend: avgConf > 60 ? 'confident' : avgConf < 40 ? 'uncertain' : 'moderate',
      avgConfidence: Math.round(avgConf),
      recentTopics: topics,
      dominantMood: moods.length > 0 ? moods[moods.length - 1] : 'neutral',
      samples: recent.length,
    };
  }

  // ═══════════════════════════════════════════
  //  Temporal Anchors
  // ═══════════════════════════════════════════

  addAnchor(label, significance = 5) {
    const anchors = readJSON(ANCHORS_FILE, []);
    const entry = {
      id: uuid(),
      label,
      significance: Math.max(1, Math.min(10, significance)),
      timestamp: Date.now(),
    };
    anchors.push(entry);
    if (anchors.length > this.maxAnchors) anchors.splice(0, anchors.length - this.maxAnchors);
    writeJSON(ANCHORS_FILE, anchors);

    if (significance >= 8) this._checkEraTransition(entry);
    this.emit('anchor-added', entry);
    return entry;
  }

  getAnchors() { return readJSON(ANCHORS_FILE, []).sort((a, b) => b.timestamp - a.timestamp); }

  // ═══════════════════════════════════════════
  //  Era Management with Auto-Phase Detection
  // ═══════════════════════════════════════════

  _checkEraTransition(anchor) {
    const timeline = readJSON(TIMELINE_FILE, {});
    const currentEra = (timeline.eras || []).slice(-1)[0];
    if (!currentEra) return;
    if (Date.now() - currentEra.startedAt < MS.day) return;

    const newEra = {
      name: anchor.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40),
      startedAt: Date.now(),
      description: `Triggered by: ${anchor.label}`,
      previousEra: currentEra.name,
      phase: this._detectPhase(),
    };

    timeline.eras.push(newEra);
    timeline.currentEra = newEra.name;
    timeline.currentPhase = newEra.phase;
    writeJSON(TIMELINE_FILE, timeline);
    this.emit('era-transition', { from: currentEra.name, to: newEra.name, phase: newEra.phase, trigger: anchor });
  }

  /**
   * Auto-detect current developmental phase based on recent activity patterns.
   */
  _detectPhase() {
    const snapshots = readJSON(SNAPSHOTS_FILE, []);
    const anchors = readJSON(ANCHORS_FILE, []);
    const decisions = readJSON(DECISIONS_FILE, []);

    const recentWindow = 7 * MS.day;
    const now = Date.now();

    const recentSnapshots = snapshots.filter(s => now - s.timestamp < recentWindow);
    const recentAnchors = anchors.filter(a => now - a.timestamp < recentWindow);
    const recentDecisions = decisions.filter(d => now - d.timestamp < recentWindow);

    const avgConfidence = recentSnapshots.length > 0
      ? recentSnapshots.reduce((s, x) => s + (x.confidence || 50), 0) / recentSnapshots.length : 50;

    const failedDecisions = recentDecisions.filter(d => d.outcome && !d.success).length;
    const topicDiversity = new Set(recentSnapshots.map(s => s.topic)).size;

    // Crisis: low confidence + many failures
    if (avgConfidence < 35 || (failedDecisions > 3 && recentDecisions.length > 0 && failedDecisions / recentDecisions.length > 0.5)) {
      return ERA_PHASES.CRISIS;
    }
    // Exploration: high topic diversity
    if (topicDiversity > 5 && recentSnapshots.length > 3) {
      return ERA_PHASES.EXPLORATION;
    }
    // Growth: many anchors + high confidence
    if (recentAnchors.length >= 3 && avgConfidence > 55) {
      return ERA_PHASES.GROWTH;
    }
    // Consolidation: few new topics, moderate activity
    if (topicDiversity <= 2 && recentSnapshots.length > 5) {
      return ERA_PHASES.CONSOLIDATION;
    }
    return ERA_PHASES.PLATEAU;
  }

  /**
   * Manually transition to a new era.
   */
  transitionEra(name, description, phase) {
    const timeline = readJSON(TIMELINE_FILE, {});
    const currentEra = (timeline.eras || []).slice(-1)[0];
    const newEra = {
      name: (name || 'unnamed').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40),
      startedAt: Date.now(),
      description: description || '',
      previousEra: currentEra?.name,
      phase: Object.values(ERA_PHASES).includes(phase) ? phase : this._detectPhase(),
    };
    timeline.eras.push(newEra);
    timeline.currentEra = newEra.name;
    timeline.currentPhase = newEra.phase;
    writeJSON(TIMELINE_FILE, timeline);
    this.emit('era-transition', { from: currentEra?.name, to: newEra.name, phase: newEra.phase });
    return newEra;
  }

  // ═══════════════════════════════════════════
  //  Regret Analysis
  // ═══════════════════════════════════════════

  async analyzeRegrets() {
    const snapshots = readJSON(SNAPSHOTS_FILE, []);
    const anchors = readJSON(ANCHORS_FILE, []);
    const decisions = readJSON(DECISIONS_FILE, []);
    const existingRegrets = readJSON(REGRETS_FILE, []);

    if (!this.ai) return { regrets: existingRegrets, note: 'AI required' };
    if (snapshots.length < 5 && decisions.length < 3) return { regrets: existingRegrets, note: 'Need more data' };

    try {
      const snapshotSummary = snapshots.slice(-30).map(s =>
        `[${new Date(s.timestamp).toISOString()}] ${s.topic}: ${s.perspective} (confidence: ${s.confidence})`
      ).join('\n');

      const decisionSummary = decisions.filter(d => d.outcome).slice(-20).map(d =>
        `[${new Date(d.timestamp).toISOString()}] "${d.description}" → ${d.outcome} (${d.success ? 'success' : 'failure'})`
      ).join('\n');

      const messages = [
        {
          role: 'system',
          content: `Analyze developmental history for regrets — past decisions/beliefs that current knowledge would change.

Snapshots:\n${snapshotSummary}
${decisionSummary ? `Decisions with outcomes:\n${decisionSummary}` : ''}
Anchors:\n${anchors.slice(-10).map(a => `${a.label} (${a.significance})`).join(', ') || 'None'}

Find: wrong beliefs, missed opportunities, patterns caught too late, overconfidence failures, undervalued ideas.

JSON: { "regrets": [{"description":"...", "severity": 1-10, "lesson":"...", "timeframe":"when"}], "overallGrowth": "assessment" }`
        },
        { role: 'user', content: 'Analyze for regrets and lessons.' }
      ];

      const resp = await this.ai.chat(messages);
      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const result = JSON.parse(match[0]);
        const newRegrets = (result.regrets || []).map(r => ({ id: uuid(), ...r, analyzedAt: Date.now() }));
        const allRegrets = [...existingRegrets, ...newRegrets];
        if (allRegrets.length > 100) allRegrets.splice(0, allRegrets.length - 100);
        writeJSON(REGRETS_FILE, allRegrets);
        this.emit('regrets-analyzed', { newRegrets, overallGrowth: result.overallGrowth });
        return { regrets: allRegrets, newRegrets, overallGrowth: result.overallGrowth };
      }
    } catch (e) {
      return { regrets: existingRegrets, error: e.message };
    }
    return { regrets: existingRegrets };
  }

  // ═══════════════════════════════════════════
  //  Timeline
  // ═══════════════════════════════════════════

  getTimeline() {
    const timeline = readJSON(TIMELINE_FILE, { eras: [] });
    const anchors = readJSON(ANCHORS_FILE, []);
    const snapshots = readJSON(SNAPSHOTS_FILE, []);

    const eras = (timeline.eras || []).map(era => {
      const nextEra = (timeline.eras || []).find(e => e.startedAt > era.startedAt);
      const eraAnchors = anchors.filter(a => a.timestamp >= era.startedAt && (!nextEra || a.timestamp < nextEra.startedAt));
      const eraSnapshots = snapshots.filter(s => s.timestamp >= era.startedAt && (!nextEra || s.timestamp < nextEra.startedAt));
      return {
        ...era,
        duration: formatDuration((nextEra ? nextEra.startedAt : Date.now()) - era.startedAt),
        anchorCount: eraAnchors.length,
        snapshotCount: eraSnapshots.length,
        anchors: eraAnchors,
      };
    });

    return {
      currentEra: timeline.currentEra,
      currentPhase: timeline.currentPhase,
      totalEras: eras.length,
      eras,
      age: formatDuration(Date.now() - (timeline.createdAt || Date.now())),
      createdAt: timeline.createdAt,
    };
  }

  // ═══════════════════════════════════════════
  //  Tick
  // ═══════════════════════════════════════════

  async tick() {
    const timeline = readJSON(TIMELINE_FILE, {});
    timeline.lastTickAt = Date.now();

    // Update phase detection
    const detectedPhase = this._detectPhase();
    if (detectedPhase !== timeline.currentPhase) {
      const oldPhase = timeline.currentPhase;
      timeline.currentPhase = detectedPhase;
      this.emit('phase-changed', { from: oldPhase, to: detectedPhase });
    }
    writeJSON(TIMELINE_FILE, timeline);

    // Auto-snapshot if none in last 6 hours
    const snapshots = readJSON(SNAPSHOTS_FILE, []);
    const lastSnapshot = snapshots[snapshots.length - 1];
    if (!lastSnapshot || Date.now() - lastSnapshot.timestamp > 6 * MS.hour) {
      this.recordSnapshot({
        topic: 'periodic-check',
        perspective: `Tick at ${new Date().toISOString()}. Era: ${timeline.currentEra}, Phase: ${timeline.currentPhase}.`,
        confidence: 50,
        mood: 'reflective',
      });
    }

    // Stale era warning
    const anchors = readJSON(ANCHORS_FILE, []);
    const currentEra = (timeline.eras || []).slice(-1)[0];
    if (currentEra) {
      const eraAge = Date.now() - currentEra.startedAt;
      const recentAnchors = anchors.filter(a => a.timestamp > currentEra.startedAt);
      if (eraAge > 30 * MS.day && recentAnchors.length === 0) {
        this.emit('era-stale', { era: currentEra.name, age: formatDuration(eraAge) });
      }
    }

    return {
      currentEra: timeline.currentEra,
      currentPhase: timeline.currentPhase,
      totalSnapshots: snapshots.length,
      totalAnchors: anchors.length,
      age: formatDuration(Date.now() - (timeline.createdAt || Date.now())),
    };
  }

  stats() {
    const timeline = readJSON(TIMELINE_FILE, { eras: [] });
    const snapshots = readJSON(SNAPSHOTS_FILE, []);
    const anchors = readJSON(ANCHORS_FILE, []);
    const regrets = readJSON(REGRETS_FILE, []);
    const decisions = readJSON(DECISIONS_FILE, []);

    return {
      currentEra: timeline.currentEra,
      currentPhase: timeline.currentPhase,
      totalEras: (timeline.eras || []).length,
      snapshots: snapshots.length,
      anchors: anchors.length,
      regrets: regrets.length,
      decisions: decisions.length,
      age: formatDuration(Date.now() - (timeline.createdAt || Date.now())),
    };
  }
}

TemporalConsciousness.ERA_PHASES = ERA_PHASES;

let _instance = null;
function getInstance(opts) {
  if (!_instance) _instance = new TemporalConsciousness(opts);
  return _instance;
}

module.exports = TemporalConsciousness;
