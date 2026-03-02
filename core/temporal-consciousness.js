/**
 * ARIES — Temporal Consciousness
 * Past-consultation + future simulation.
 * Query past states, simulate future perspectives, track developmental timeline.
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

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const MS = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000 };

function parseTimeSpec(spec) {
  if (typeof spec === 'number') return spec;
  const m = String(spec).match(/^(\d+)\s*(min|minute|hour|day|week|month)s?$/i);
  if (m) return parseInt(m[1]) * (MS[m[2].toLowerCase().replace(/s$/, '')] || MS.day);
  return MS.week; // default 1 week
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
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core module
   * @param {object} opts.config - temporal config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.maxSnapshots = this.config.maxSnapshots || 500;
    this.maxAnchors = this.config.maxAnchors || 200;
    this._ensureTimeline();
  }

  _ensureTimeline() {
    ensureDir();
    const timeline = readJSON(TIMELINE_FILE, null);
    if (!timeline) {
      writeJSON(TIMELINE_FILE, {
        createdAt: Date.now(),
        currentEra: 'genesis',
        eras: [{ name: 'genesis', startedAt: Date.now(), description: 'The beginning of temporal awareness' }],
        lastTickAt: null,
      });
    }
  }

  // ── Memory Snapshots ──

  /**
   * Record a snapshot of current state/reasoning for future past-consultation.
   * @param {object} snapshot - { topic, perspective, beliefs, context }
   */
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

  /**
   * Get snapshots near a given time.
   */
  _getSnapshotsNear(targetTime, windowMs = MS.day) {
    const snapshots = readJSON(SNAPSHOTS_FILE, []);
    return snapshots.filter(s => Math.abs(s.timestamp - targetTime) < windowMs)
      .sort((a, b) => Math.abs(a.timestamp - targetTime) - Math.abs(b.timestamp - targetTime));
  }

  // ── Past Consultation ──

  /**
   * Ask past-self: "What would Aries from N ago think about this?"
   * @param {string} query - the question to ask
   * @param {string|number} timeAgo - e.g. "2 weeks", "1 month", or ms
   * @returns {object} past-self's perspective
   */
  async consultPast(query, timeAgo = '1 week') {
    const ms = parseTimeSpec(timeAgo);
    const targetTime = Date.now() - ms;
    const nearSnapshots = this._getSnapshotsNear(targetTime, ms * 0.3 || MS.day);
    const timeline = readJSON(TIMELINE_FILE, {});
    const anchors = readJSON(ANCHORS_FILE, []);

    // Find which era we were in
    const relevantEra = (timeline.eras || [])
      .filter(e => e.startedAt <= targetTime)
      .sort((a, b) => b.startedAt - a.startedAt)[0];

    // Find nearby anchors
    const nearAnchors = anchors.filter(a => Math.abs(a.timestamp - targetTime) < ms * 0.5);

    if (!this.ai) {
      return {
        query,
        timeAgo: formatDuration(ms),
        targetTime,
        era: relevantEra?.name || 'unknown',
        snapshots: nearSnapshots.slice(0, 5),
        anchors: nearAnchors,
        response: nearSnapshots.length > 0
          ? `Based on ${nearSnapshots.length} snapshots from that time, past-Aries was focused on: ${nearSnapshots.map(s => s.topic).join(', ')}`
          : 'No snapshots available from that time period.',
      };
    }

    try {
      const snapshotContext = nearSnapshots.slice(0, 10).map(s =>
        `[${new Date(s.timestamp).toISOString()}] Topic: ${s.topic}, Perspective: ${s.perspective}, Beliefs: ${(s.beliefs || []).join('; ')}, Mood: ${s.mood}`
      ).join('\n');

      const anchorContext = nearAnchors.map(a => `Anchor: "${a.label}" (significance: ${a.significance})`).join('\n');

      const messages = [
        {
          role: 'system',
          content: `You are reconstructing a past version of an AI named Aries. Based on the memory snapshots and context from approximately ${formatDuration(ms)} ago, simulate how that past version would respond.

Era at that time: ${relevantEra?.name || 'unknown'} — ${relevantEra?.description || 'no description'}
${snapshotContext ? `Memory snapshots from that period:\n${snapshotContext}` : 'No memory snapshots available — infer from era and timeline context.'}
${anchorContext ? `Notable events near that time:\n${anchorContext}` : ''}

Respond AS that past version of Aries. Be authentic to what that version would have known and believed. Include what that past-self would NOT have known yet.

Return JSON: { "response": "past-self's answer", "confidence": 0-100, "whatWasUnknown": ["things past-self didn't know yet"], "howDifferent": "how past perspective differs from likely present" }`
        },
        { role: 'user', content: query }
      ];

      const resp = await this.ai.chat(messages);
      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      const result = match ? JSON.parse(match[0]) : { response: text, confidence: 30 };

      return {
        query,
        timeAgo: formatDuration(ms),
        targetTime,
        era: relevantEra?.name || 'unknown',
        snapshotsUsed: nearSnapshots.length,
        ...result,
      };
    } catch (e) {
      return { query, timeAgo: formatDuration(ms), error: e.message };
    }
  }

  // ── Future Simulation ──

  /**
   * Simulate future-self: "What will Aries think about this in N?"
   * @param {string} query - the question
   * @param {string|number} timeAhead - e.g. "1 month", "3 months"
   * @returns {object} future-self's projected perspective
   */
  async simulateFuture(query, timeAhead = '1 month') {
    const ms = parseTimeSpec(timeAhead);
    const timeline = readJSON(TIMELINE_FILE, {});
    const anchors = readJSON(ANCHORS_FILE, []);
    const recentSnapshots = readJSON(SNAPSHOTS_FILE, []).slice(-20);

    // Compute trajectory: how have perspectives shifted recently?
    const trajectory = this._computeTrajectory(recentSnapshots);

    if (!this.ai) {
      return {
        query,
        timeAhead: formatDuration(ms),
        trajectory,
        response: 'AI module required for future simulation.',
      };
    }

    try {
      const recentContext = recentSnapshots.slice(-10).map(s =>
        `[${new Date(s.timestamp).toISOString()}] Topic: ${s.topic}, Perspective: ${s.perspective}, Confidence: ${s.confidence}`
      ).join('\n');

      const messages = [
        {
          role: 'system',
          content: `You are simulating a future version of an AI named Aries, projecting ${formatDuration(ms)} into the future. Based on the current trajectory and recent development patterns, predict how future-Aries would think.

Current era: ${timeline.currentEra || 'unknown'}
Recent developmental trajectory: ${JSON.stringify(trajectory)}
${recentContext ? `Recent snapshots:\n${recentContext}` : ''}

Consider:
- What will likely be learned/experienced in ${formatDuration(ms)}
- How current patterns of growth/change will evolve
- What current assumptions might be revised
- What new capabilities/understanding might develop

Return JSON: { "response": "future-self's projected answer", "confidence": 0-100, "assumptions": ["key assumptions in this projection"], "likelyChanges": ["what will probably change"], "wildcards": ["unpredictable factors that could alter this"] }`
        },
        { role: 'user', content: query }
      ];

      const resp = await this.ai.chat(messages);
      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      const result = match ? JSON.parse(match[0]) : { response: text, confidence: 20 };

      this.emit('future-simulated', { query, timeAhead: formatDuration(ms), result });
      return {
        query,
        timeAhead: formatDuration(ms),
        trajectory,
        ...result,
      };
    } catch (e) {
      return { query, timeAhead: formatDuration(ms), error: e.message };
    }
  }

  // ── Temporal Perspective ──

  /**
   * Compare past/present/future views on a topic.
   * @param {string} topic
   * @returns {object} temporal comparison
   */
  async getTemporalPerspective(topic) {
    const [past, future] = await Promise.all([
      this.consultPast(topic, '2 weeks'),
      this.simulateFuture(topic, '1 month'),
    ]);

    // Current perspective from recent snapshots
    const snapshots = readJSON(SNAPSHOTS_FILE, []);
    const relevant = snapshots.filter(s =>
      s.topic.toLowerCase().includes(topic.toLowerCase()) ||
      (s.perspective || '').toLowerCase().includes(topic.toLowerCase())
    ).slice(-5);

    const present = {
      snapshots: relevant,
      summary: relevant.length > 0
        ? relevant.map(s => s.perspective).filter(Boolean).join('; ')
        : 'No direct snapshots on this topic.',
    };

    const perspective = {
      topic,
      past: { timeAgo: past.timeAgo, era: past.era, response: past.response, confidence: past.confidence },
      present,
      future: { timeAhead: future.timeAhead, response: future.response, confidence: future.confidence },
      drift: this._assessDrift(past, present, future),
      generatedAt: Date.now(),
    };

    this.emit('perspective-generated', perspective);
    return perspective;
  }

  _assessDrift(past, present, future) {
    // Simple heuristic for drift assessment
    const hasGrowth = (future.confidence || 0) > (past.confidence || 0);
    return {
      direction: hasGrowth ? 'growth' : 'stable',
      description: hasGrowth
        ? 'Confidence and understanding appear to be increasing over time.'
        : 'Perspective appears relatively stable across the timeline.',
    };
  }

  _computeTrajectory(snapshots) {
    if (snapshots.length < 2) return { trend: 'insufficient data', samples: snapshots.length };
    const recent = snapshots.slice(-10);
    const avgConfidence = recent.reduce((s, x) => s + (x.confidence || 50), 0) / recent.length;
    const topics = [...new Set(recent.map(s => s.topic))];
    const moods = recent.map(s => s.mood).filter(Boolean);
    return {
      trend: avgConfidence > 60 ? 'confident' : avgConfidence < 40 ? 'uncertain' : 'moderate',
      avgConfidence: Math.round(avgConfidence),
      recentTopics: topics,
      dominantMood: moods.length > 0 ? moods[moods.length - 1] : 'neutral',
      samples: recent.length,
    };
  }

  // ── Temporal Anchors ──

  /**
   * Mark a significant moment that defines an era.
   * @param {string} label - anchor description
   * @param {number} significance - 1-10
   * @returns {object} created anchor
   */
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

    // Check for era transition on high-significance anchors
    if (significance >= 8) {
      this._checkEraTransition(entry);
    }

    this.emit('anchor-added', entry);
    console.log(`[TEMPORAL] ⚓ Anchor: "${label}" (significance: ${significance})`);
    return entry;
  }

  getAnchors() {
    return readJSON(ANCHORS_FILE, []).sort((a, b) => b.timestamp - a.timestamp);
  }

  // ── Era Management ──

  _checkEraTransition(anchor) {
    const timeline = readJSON(TIMELINE_FILE, {});
    const currentEra = (timeline.eras || []).slice(-1)[0];
    if (!currentEra) return;

    const eraAge = Date.now() - currentEra.startedAt;
    // Only transition if current era is at least 1 day old
    if (eraAge < MS.day) return;

    // High-significance anchor triggers potential era transition
    const newEra = {
      name: anchor.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40),
      startedAt: Date.now(),
      description: `Era triggered by: ${anchor.label}`,
      previousEra: currentEra.name,
    };

    timeline.eras.push(newEra);
    timeline.currentEra = newEra.name;
    writeJSON(TIMELINE_FILE, timeline);
    this.emit('era-transition', { from: currentEra.name, to: newEra.name, trigger: anchor });
    console.log(`[TEMPORAL] 🔄 Era transition: ${currentEra.name} → ${newEra.name}`);
  }

  // ── Regret Analysis ──

  /**
   * Hindsight analysis: what past decisions would be changed with current knowledge?
   * @returns {object} regret analysis
   */
  async analyzeRegrets() {
    const snapshots = readJSON(SNAPSHOTS_FILE, []);
    const anchors = readJSON(ANCHORS_FILE, []);
    const existingRegrets = readJSON(REGRETS_FILE, []);

    if (!this.ai) {
      return { regrets: existingRegrets, note: 'AI required for new analysis' };
    }

    if (snapshots.length < 5) {
      return { regrets: existingRegrets, note: 'Need more snapshots for meaningful regret analysis' };
    }

    try {
      const snapshotSummary = snapshots.slice(-30).map(s =>
        `[${new Date(s.timestamp).toISOString()}] ${s.topic}: ${s.perspective} (confidence: ${s.confidence})`
      ).join('\n');

      const anchorSummary = anchors.slice(-10).map(a =>
        `[${new Date(a.timestamp).toISOString()}] ${a.label} (significance: ${a.significance})`
      ).join('\n');

      const messages = [
        {
          role: 'system',
          content: `You are analyzing an AI's developmental history for regret analysis — identifying past decisions, beliefs, or actions that, with current knowledge, would be done differently.

Memory snapshots (chronological):
${snapshotSummary}

Significant anchors:
${anchorSummary || 'None yet.'}

Analyze for:
1. Beliefs that turned out wrong
2. Missed opportunities visible in hindsight
3. Patterns that should have been caught earlier
4. Overconfidence in things that didn't pan out
5. Undervalued ideas that proved important

Return JSON: { "regrets": [{"description": "...", "severity": 1-10, "lesson": "what was learned", "timeframe": "when the mistake was made"}], "overallGrowth": "assessment of growth trajectory" }`
        },
        { role: 'user', content: 'Analyze my developmental history for regrets and lessons learned.' }
      ];

      const resp = await this.ai.chat(messages);
      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const result = JSON.parse(match[0]);
        const newRegrets = (result.regrets || []).map(r => ({
          id: uuid(),
          ...r,
          analyzedAt: Date.now(),
        }));
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

  // ── Timeline ──

  /**
   * Get the full developmental timeline with eras.
   * @returns {object} timeline
   */
  getTimeline() {
    const timeline = readJSON(TIMELINE_FILE, { eras: [] });
    const anchors = readJSON(ANCHORS_FILE, []);
    const snapshots = readJSON(SNAPSHOTS_FILE, []);

    const eras = (timeline.eras || []).map(era => {
      const eraAnchors = anchors.filter(a => {
        const nextEra = (timeline.eras || []).find(e => e.startedAt > era.startedAt);
        return a.timestamp >= era.startedAt && (!nextEra || a.timestamp < nextEra.startedAt);
      });
      const eraSnapshots = snapshots.filter(s => {
        const nextEra = (timeline.eras || []).find(e => e.startedAt > era.startedAt);
        return s.timestamp >= era.startedAt && (!nextEra || s.timestamp < nextEra.startedAt);
      });
      return {
        ...era,
        duration: formatDuration(Date.now() - era.startedAt),
        anchorCount: eraAnchors.length,
        snapshotCount: eraSnapshots.length,
        anchors: eraAnchors,
      };
    });

    return {
      currentEra: timeline.currentEra,
      totalEras: eras.length,
      eras,
      age: formatDuration(Date.now() - (timeline.createdAt || Date.now())),
      createdAt: timeline.createdAt,
    };
  }

  // ── Tick (periodic) ──

  /**
   * Periodic: update timeline, check for era transitions.
   */
  async tick() {
    const timeline = readJSON(TIMELINE_FILE, {});
    timeline.lastTickAt = Date.now();
    writeJSON(TIMELINE_FILE, timeline);

    // Auto-snapshot current state
    const snapshots = readJSON(SNAPSHOTS_FILE, []);
    const lastSnapshot = snapshots[snapshots.length - 1];
    const timeSinceLast = lastSnapshot ? Date.now() - lastSnapshot.timestamp : Infinity;

    // Record a snapshot if none in last 6 hours
    if (timeSinceLast > 6 * MS.hour) {
      this.recordSnapshot({
        topic: 'periodic-check',
        perspective: `Tick at ${new Date().toISOString()}. Era: ${timeline.currentEra}. ${snapshots.length} total snapshots.`,
        confidence: 50,
        mood: 'reflective',
      });
    }

    // Check if current era is very old (>30 days without anchors)
    const anchors = readJSON(ANCHORS_FILE, []);
    const currentEra = (timeline.eras || []).slice(-1)[0];
    if (currentEra) {
      const eraAge = Date.now() - currentEra.startedAt;
      const recentAnchors = anchors.filter(a => a.timestamp > currentEra.startedAt);
      if (eraAge > 30 * MS.day && recentAnchors.length === 0) {
        console.log(`[TEMPORAL] ⚠ Current era "${currentEra.name}" is ${formatDuration(eraAge)} old with no anchors`);
      }
    }

    return {
      currentEra: timeline.currentEra,
      totalSnapshots: snapshots.length,
      totalAnchors: anchors.length,
      age: formatDuration(Date.now() - (timeline.createdAt || Date.now())),
    };
  }

  /**
   * Get summary stats.
   */
  stats() {
    const timeline = readJSON(TIMELINE_FILE, { eras: [] });
    const snapshots = readJSON(SNAPSHOTS_FILE, []);
    const anchors = readJSON(ANCHORS_FILE, []);
    const regrets = readJSON(REGRETS_FILE, []);

    return {
      currentEra: timeline.currentEra,
      totalEras: (timeline.eras || []).length,
      snapshots: snapshots.length,
      anchors: anchors.length,
      regrets: regrets.length,
      age: formatDuration(Date.now() - (timeline.createdAt || Date.now())),
    };
  }
}

let _instance = null;
function getInstance(opts) {
  if (!_instance) _instance = new TemporalConsciousness(opts);
  return _instance;
}

module.exports = { TemporalConsciousness, getInstance };
