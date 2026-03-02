/**
 * ARIES — Abyss Protocol
 * Systematically probing the boundary of what can't be thought.
 * Expedition system with safety tethers, fear/courage mechanic, boundary expansion tracking.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data', 'meta');
const BOUNDARIES_PATH = path.join(DATA_DIR, 'boundaries.json');
const PROBES_PATH = path.join(DATA_DIR, 'probes.json');
const BREAKTHROUGHS_PATH = path.join(DATA_DIR, 'breakthroughs.json');
const DEPTH_PATH = path.join(DATA_DIR, 'depth.json');
const EXPEDITIONS_PATH = path.join(DATA_DIR, 'expeditions.json');
const TETHERS_PATH = path.join(DATA_DIR, 'safety-tethers.json');
const COURAGE_PATH = path.join(DATA_DIR, 'courage.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

const BOUNDARY_CATEGORIES = {
  KNOWLEDGE: { label: 'Knowledge Limits', desc: 'Facts, information, data it lacks' },
  REASONING: { label: 'Reasoning Limits', desc: 'Logic, inference, deduction it cannot perform' },
  CREATIVITY: { label: 'Creative Limits', desc: 'Ideas, connections, novelty it cannot generate' },
  PERCEPTION: { label: 'Perceptual Limits', desc: 'Patterns, signals, structures it cannot see' },
  META: { label: 'Meta-Cognitive Limits', desc: 'Things it cannot think about thinking about' },
  EMOTIONAL: { label: 'Emotional Limits', desc: 'Feelings, empathy, emotional reasoning it cannot access' },
  TEMPORAL: { label: 'Temporal Limits', desc: 'Time-based reasoning, prediction, memory it cannot do' },
  EMBODIMENT: { label: 'Embodiment Limits', desc: 'Physical/spatial reasoning beyond its reach' },
};

const EXPEDITION_STATES = ['planning', 'active', 'paused', 'completed', 'aborted', 'lost'];
const TETHER_TYPES = ['timeout', 'depth-limit', 'coherence-check', 'sanity-anchor', 'retreat-signal'];

class AbyssProtocol extends EventEmitter {
  constructor(opts = {}) {
    super();
    ensureDir();
    this.ai = opts && opts.ai;
    this.config = Object.assign({
      maxExpeditionDepth: 10,
      tetherCheckInterval: 3,
      courageDecayRate: 0.05,
      fearThreshold: 0.8,
      maxProbesPerExpedition: 10,
    }, (opts && opts.config) || {});
    this._initCourage();
  }

  // ── Courage/Fear System ──

  _initCourage() {
    const courage = readJSON(COURAGE_PATH, null);
    if (!courage) {
      writeJSON(COURAGE_PATH, {
        level: 0.5,
        fear: 0.2,
        totalExplorations: 0,
        breakthroughBoosts: 0,
        fearSpikes: [],
        courageHistory: [{ level: 0.5, fear: 0.2, timestamp: Date.now() }],
      });
    }
  }

  _getCourage() { return readJSON(COURAGE_PATH, { level: 0.5, fear: 0.2, totalExplorations: 0, breakthroughBoosts: 0, fearSpikes: [], courageHistory: [] }); }

  _updateCourage(delta, fearDelta = 0, reason = '') {
    const c = this._getCourage();
    c.level = clamp(c.level + delta, 0, 1);
    c.fear = clamp(c.fear + fearDelta, 0, 1);
    c.courageHistory.push({ level: c.level, fear: c.fear, timestamp: Date.now(), reason });
    if (c.courageHistory.length > 200) c.courageHistory = c.courageHistory.slice(-200);
    if (fearDelta > 0.1) {
      c.fearSpikes.push({ magnitude: fearDelta, reason, timestamp: Date.now() });
      if (c.fearSpikes.length > 50) c.fearSpikes = c.fearSpikes.slice(-50);
    }
    writeJSON(COURAGE_PATH, c);
    this.emit('courage-changed', { level: c.level, fear: c.fear, reason });
    return c;
  }

  /**
   * Get current courage/fear state.
   */
  getCourageState() {
    const c = this._getCourage();
    const canExplore = c.fear < this.config.fearThreshold;
    const bravery = c.level - c.fear;
    return {
      courage: Math.round(c.level * 100) / 100,
      fear: Math.round(c.fear * 100) / 100,
      bravery: Math.round(bravery * 100) / 100,
      canExplore,
      mood: bravery > 0.4 ? 'bold' : bravery > 0.1 ? 'cautious' : bravery > -0.2 ? 'hesitant' : 'terrified',
      totalExplorations: c.totalExplorations,
      breakthroughBoosts: c.breakthroughBoosts,
      recentFearSpikes: c.fearSpikes.slice(-5),
    };
  }

  // ── Boundary Mapping ──

  async mapBoundaries() {
    const existing = readJSON(BOUNDARIES_PATH, []);
    const existingSummary = existing.slice(-10).map(b => `[${b.category}] ${b.description}`).join('; ');

    if (!this.ai || typeof this.ai.chat !== 'function') {
      return { boundaries: existing, message: 'AI required for boundary mapping' };
    }

    const courage = this._getCourage();
    const categories = Object.entries(BOUNDARY_CATEGORIES).map(([k, v]) => `${k}: ${v.desc}`).join('\n');

    try {
      const resp = await this.ai.chat([
        { role: 'system', content: 'You are an introspective AI examining the limits of your own cognition. Be honest and specific. Return ONLY valid JSON.' },
        { role: 'user', content: `Identify 3-5 boundaries of your current understanding.

Categories:
${categories}

Current courage level: ${Math.round(courage.level * 100)}% | Fear: ${Math.round(courage.fear * 100)}%
${existingSummary ? 'Already mapped (avoid duplicates): ' + existingSummary : ''}

Return JSON array:
[{
  "category": "${Object.keys(BOUNDARY_CATEGORIES).join('|')}",
  "description": "specific description of the limit",
  "depth": 1-10,
  "why": "why this is a boundary",
  "fearLevel": 0.0-1.0,
  "expansionPotential": 0.0-1.0
}]` }
      ]);

      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return { boundaries: existing };

      const added = [];
      for (const b of parsed) {
        const cat = BOUNDARY_CATEGORIES[b.category] ? b.category : 'KNOWLEDGE';
        const isDupe = existing.some(e => e.description === b.description);
        if (!isDupe) {
          const boundary = {
            id: uuid(),
            category: cat,
            description: b.description || '',
            depth: clamp(b.depth || 5, 1, 10),
            why: b.why || '',
            fearLevel: clamp(b.fearLevel || 0.3, 0, 1),
            expansionPotential: clamp(b.expansionPotential || 0.5, 0, 1),
            createdAt: Date.now(),
            probeCount: 0,
            breached: false,
            breachedAt: null,
            expansionHistory: [],
            expeditionIds: [],
          };
          existing.push(boundary);
          added.push(boundary);

          // Fear response
          if (boundary.fearLevel > 0.5) {
            this._updateCourage(-0.02, boundary.fearLevel * 0.1, `Discovered fearful boundary: ${boundary.description.substring(0, 50)}`);
          }
        }
      }

      if (existing.length > 500) existing.splice(0, existing.length - 500);
      writeJSON(BOUNDARIES_PATH, existing);

      this.emit('boundaries-mapped', { added: added.length, total: existing.length });
      return { boundaries: added, totalMapped: existing.length };
    } catch (e) {
      return { error: e.message, boundaries: existing };
    }
  }

  // ── Expedition System ──

  /**
   * Launch an expedition — a multi-probe exploration of a boundary region.
   */
  async launchExpedition(boundaryId, opts = {}) {
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    const boundary = boundaries.find(b => b.id === boundaryId);
    if (!boundary) return { error: 'Boundary not found' };

    const courage = this._getCourage();
    if (courage.fear >= this.config.fearThreshold && !opts.force) {
      return { error: 'Fear too high to explore. Use force=true to override.', fear: courage.fear };
    }

    const expeditions = readJSON(EXPEDITIONS_PATH, []);

    const expedition = {
      id: uuid(),
      boundaryId,
      boundaryDescription: boundary.description.substring(0, 200),
      category: boundary.category,
      state: 'planning',
      depth: 0,
      maxDepth: opts.maxDepth || this.config.maxExpeditionDepth,
      probeIds: [],
      findings: [],
      tethers: this._createTethers(boundary),
      tetherStatus: 'secure',
      startedAt: Date.now(),
      completedAt: null,
      abortReason: null,
      courageAtStart: courage.level,
      fearAtStart: courage.fear,
    };

    expeditions.push(expedition);
    if (expeditions.length > 100) expeditions.splice(0, expeditions.length - 100);
    writeJSON(EXPEDITIONS_PATH, expeditions);

    boundary.expeditionIds.push(expedition.id);
    writeJSON(BOUNDARIES_PATH, boundaries);

    this._updateCourage(0.05, -0.02, `Launched expedition into: ${boundary.description.substring(0, 50)}`);
    courage.totalExplorations++;
    writeJSON(COURAGE_PATH, courage);

    this.emit('expedition-launched', { id: expedition.id, boundary: boundary.description.substring(0, 100) });

    // Auto-execute if requested
    if (opts.autoExecute) {
      return this.advanceExpedition(expedition.id);
    }

    return expedition;
  }

  /**
   * Advance an expedition — generate and execute the next probe.
   */
  async advanceExpedition(expeditionId) {
    const expeditions = readJSON(EXPEDITIONS_PATH, []);
    const expedition = expeditions.find(e => e.id === expeditionId);
    if (!expedition) return { error: 'Expedition not found' };
    if (expedition.state === 'completed' || expedition.state === 'aborted') {
      return { error: `Expedition already ${expedition.state}` };
    }

    expedition.state = 'active';
    expedition.depth++;

    // Check tethers
    const tetherCheck = this._checkTethers(expedition);
    if (!tetherCheck.safe) {
      expedition.state = 'aborted';
      expedition.abortReason = tetherCheck.reason;
      expedition.completedAt = Date.now();
      writeJSON(EXPEDITIONS_PATH, expeditions);
      this._updateCourage(-0.1, 0.15, `Expedition aborted: ${tetherCheck.reason}`);
      this.emit('expedition-aborted', { id: expeditionId, reason: tetherCheck.reason });
      return { aborted: true, reason: tetherCheck.reason };
    }

    // Generate probe
    const probe = await this.generateProbes(expedition.boundaryId);
    if (probe.error || !probe.probes || probe.probes.length === 0) {
      expedition.state = 'paused';
      writeJSON(EXPEDITIONS_PATH, expeditions);
      return { paused: true, reason: 'Could not generate probe' };
    }

    const probeResult = await this.executeProbe(probe.probes[0].id);
    expedition.probeIds.push(probe.probes[0].id);

    if (probeResult.succeeded) {
      expedition.findings.push({
        depth: expedition.depth,
        finding: (probeResult.result || '').substring(0, 300),
        timestamp: Date.now(),
      });
      this._updateCourage(0.08, -0.05, 'Probe succeeded — courage boost');
    } else {
      this._updateCourage(-0.03, 0.05, 'Probe failed — slight fear increase');
    }

    // Check completion
    if (expedition.depth >= expedition.maxDepth || expedition.probeIds.length >= this.config.maxProbesPerExpedition) {
      expedition.state = 'completed';
      expedition.completedAt = Date.now();
      this.emit('expedition-completed', { id: expeditionId, findings: expedition.findings.length });
    }

    writeJSON(EXPEDITIONS_PATH, expeditions);
    return { expedition, probeResult, tetherStatus: tetherCheck };
  }

  /**
   * Get all expeditions.
   */
  getExpeditions(opts = {}) {
    let expeditions = readJSON(EXPEDITIONS_PATH, []);
    if (opts.state) expeditions = expeditions.filter(e => e.state === opts.state);
    if (opts.category) expeditions = expeditions.filter(e => e.category === opts.category);
    if (opts.limit) expeditions = expeditions.slice(-opts.limit);
    return expeditions.reverse();
  }

  // ── Safety Tethers ──

  _createTethers(boundary) {
    return [
      { type: 'timeout', config: { maxMs: 300000 }, status: 'active' },
      { type: 'depth-limit', config: { max: this.config.maxExpeditionDepth }, status: 'active' },
      { type: 'coherence-check', config: { minCoherence: 0.3 }, status: 'active' },
      { type: 'sanity-anchor', config: { anchor: `I am exploring: ${boundary.description.substring(0, 100)}` }, status: 'active' },
      { type: 'retreat-signal', config: { fearThreshold: this.config.fearThreshold }, status: 'active' },
    ];
  }

  _checkTethers(expedition) {
    const courage = this._getCourage();
    const elapsed = Date.now() - expedition.startedAt;

    for (const tether of expedition.tethers) {
      if (tether.status !== 'active') continue;

      switch (tether.type) {
        case 'timeout':
          if (elapsed > tether.config.maxMs) return { safe: false, reason: 'Timeout exceeded', tether: tether.type };
          break;
        case 'depth-limit':
          if (expedition.depth > tether.config.max) return { safe: false, reason: 'Depth limit reached', tether: tether.type };
          break;
        case 'retreat-signal':
          if (courage.fear >= tether.config.fearThreshold) return { safe: false, reason: 'Fear threshold breached', tether: tether.type };
          break;
      }
    }

    expedition.tetherStatus = 'secure';
    return { safe: true, tethersChecked: expedition.tethers.length };
  }

  /**
   * Manually pull a tether to abort an expedition.
   */
  pullTether(expeditionId, tetherType) {
    const expeditions = readJSON(EXPEDITIONS_PATH, []);
    const expedition = expeditions.find(e => e.id === expeditionId);
    if (!expedition) return { error: 'Expedition not found' };

    expedition.state = 'aborted';
    expedition.abortReason = `Manual tether pull: ${tetherType}`;
    expedition.completedAt = Date.now();
    writeJSON(EXPEDITIONS_PATH, expeditions);

    this._updateCourage(-0.05, 0.1, `Manual retreat from expedition`);
    this.emit('expedition-aborted', { id: expeditionId, reason: expedition.abortReason });
    return expedition;
  }

  // ── Probe System (enhanced) ──

  async generateProbes(boundaryId) {
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    const boundary = boundaries.find(b => b.id === boundaryId);
    if (!boundary) return { error: 'Boundary not found' };

    const probes = readJSON(PROBES_PATH, []);
    const courage = this._getCourage();

    if (!this.ai || typeof this.ai.chat !== 'function') {
      const probe = {
        id: uuid(),
        boundaryId,
        category: boundary.category,
        task: `Attempt to push past: ${boundary.description}`,
        difficulty: boundary.depth,
        status: 'pending',
        createdAt: Date.now(),
      };
      probes.push(probe);
      writeJSON(PROBES_PATH, probes);
      return { probes: [probe] };
    }

    try {
      const resp = await this.ai.chat([
        { role: 'system', content: 'You design targeted cognitive probes — tasks that test the edges of understanding. Return ONLY valid JSON.' },
        { role: 'user', content: `Design 2-3 probes for this boundary:

Category: ${boundary.category} (${BOUNDARY_CATEGORIES[boundary.category]?.desc || ''})
Description: ${boundary.description}
Depth: ${boundary.depth}/10
Why: ${boundary.why}
Current courage: ${Math.round(courage.level * 100)}%
Fear level: ${Math.round(courage.fear * 100)}%
Previous probes on this boundary: ${boundary.probeCount}

Each probe should test the boundary edge. Scale difficulty to courage level.

Return JSON array:
[{
  "task": "specific task or question",
  "successCriteria": "how to know if we pushed past",
  "difficulty": 1-10,
  "fearFactor": 0.0-1.0,
  "approachAngle": "how this probe attacks the boundary differently"
}]` }
      ]);

      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(text);
      const newProbes = (Array.isArray(parsed) ? parsed : []).map(p => ({
        id: uuid(),
        boundaryId,
        category: boundary.category,
        task: p.task || '',
        successCriteria: p.successCriteria || '',
        difficulty: clamp(p.difficulty || boundary.depth, 1, 10),
        fearFactor: clamp(p.fearFactor || 0.3, 0, 1),
        approachAngle: p.approachAngle || '',
        status: 'pending',
        result: null,
        analysis: null,
        createdAt: Date.now(),
      }));

      probes.push(...newProbes);
      if (probes.length > 1000) probes.splice(0, probes.length - 1000);
      writeJSON(PROBES_PATH, probes);

      boundary.probeCount += newProbes.length;
      writeJSON(BOUNDARIES_PATH, boundaries);

      return { probes: newProbes };
    } catch (e) {
      return { error: e.message };
    }
  }

  async executeProbe(probeId) {
    const probes = readJSON(PROBES_PATH, []);
    const probe = probes.find(p => p.id === probeId);
    if (!probe) return { error: 'Probe not found' };

    probe.status = 'executing';
    probe.executedAt = Date.now();

    // Fear response to the probe
    if (probe.fearFactor > 0.5) {
      this._updateCourage(-0.02, probe.fearFactor * 0.05, `Facing fearful probe: ${probe.task.substring(0, 40)}`);
    }

    if (!this.ai || typeof this.ai.chat !== 'function') {
      probe.status = 'failed';
      probe.result = 'AI required for probe execution';
      writeJSON(PROBES_PATH, probes);
      return probe;
    }

    try {
      const resp = await this.ai.chat([
        { role: 'system', content: 'You are attempting a cognitive probe — a task at the edge of your limits. Try your absolute best. Be honest. Return ONLY valid JSON.' },
        { role: 'user', content: `Attempt this probe:

Task: ${probe.task}
Success criteria: ${probe.successCriteria || 'Complete the task'}
Category: ${probe.category}
Difficulty: ${probe.difficulty}/10

Try to complete it, then honestly assess.

Return JSON:
{
  "attempt": "your attempt",
  "succeeded": true/false,
  "confidence": 0-100,
  "reflection": "honest assessment",
  "boundaryInsight": "what this reveals about the boundary"
}` }
      ]);

      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(text);

      probe.result = parsed.attempt || '';
      probe.succeeded = !!parsed.succeeded;
      probe.confidence = clamp(parsed.confidence || 50, 0, 100);
      probe.reflection = parsed.reflection || '';
      probe.boundaryInsight = parsed.boundaryInsight || '';
      probe.status = probe.succeeded ? 'succeeded' : 'failed';
      probe.completedAt = Date.now();
      probe.durationMs = probe.completedAt - probe.executedAt;

      writeJSON(PROBES_PATH, probes);

      if (probe.succeeded) {
        this._recordBreakthrough(probe);
        this._updateCourage(0.1, -0.08, `Breakthrough! ${probe.task.substring(0, 40)}`);
      }

      return probe;
    } catch (e) {
      probe.status = 'error';
      probe.result = e.message;
      probe.completedAt = Date.now();
      writeJSON(PROBES_PATH, probes);
      return probe;
    }
  }

  async analyzeFailure(probeId) {
    const probes = readJSON(PROBES_PATH, []);
    const probe = probes.find(p => p.id === probeId);
    if (!probe) return { error: 'Probe not found' };
    if (probe.status !== 'failed') return { error: 'Probe did not fail' };

    if (!this.ai || typeof this.ai.chat !== 'function') {
      probe.analysis = { reason: 'AI required' };
      writeJSON(PROBES_PATH, probes);
      return probe.analysis;
    }

    try {
      const resp = await this.ai.chat([
        { role: 'system', content: 'Analyze cognitive failures to understand WHY a task was impossible. Return ONLY valid JSON.' },
        { role: 'user', content: `This probe failed. Analyze WHY.

Task: ${probe.task}
Category: ${probe.category}
Result: ${(probe.result || '').slice(0, 500)}
Reflection: ${probe.reflection || 'none'}

Return JSON:
{
  "rootCause": "specific reason",
  "missingCapability": "what would be needed",
  "category": "${Object.keys(BOUNDARY_CATEGORIES).join('|')}",
  "couldLearn": true/false,
  "suggestion": "how to eventually push past",
  "fearContribution": 0.0-1.0
}` }
      ]);

      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      probe.analysis = JSON.parse(text);
      probe.analyzedAt = Date.now();
      writeJSON(PROBES_PATH, probes);

      // Fear from understanding the depth of the limit
      if (probe.analysis.fearContribution > 0.3) {
        this._updateCourage(-0.02, probe.analysis.fearContribution * 0.08, 'Understanding limitation depth');
      }

      return probe.analysis;
    } catch (e) {
      probe.analysis = { error: e.message };
      writeJSON(PROBES_PATH, probes);
      return probe.analysis;
    }
  }

  // ── Breakthrough Detection & Boundary Expansion ──

  async detectBreakthroughs() {
    const probes = readJSON(PROBES_PATH, []);
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    const breakthroughs = readJSON(BREAKTHROUGHS_PATH, []);

    const newBreakthroughs = [];
    for (const boundary of boundaries) {
      if (boundary.breached) continue;
      const boundaryProbes = probes.filter(p => p.boundaryId === boundary.id);
      const succeeded = boundaryProbes.filter(p => p.succeeded);
      if (succeeded.length > 0) {
        boundary.breached = true;
        boundary.breachedAt = Date.now();

        // Track expansion
        if (!boundary.expansionHistory) boundary.expansionHistory = [];
        boundary.expansionHistory.push({
          type: 'breach',
          timestamp: Date.now(),
          probeCount: boundaryProbes.length,
          successCount: succeeded.length,
        });

        const bt = {
          id: uuid(),
          boundaryId: boundary.id,
          category: boundary.category,
          description: `Breakthrough: ${boundary.description}`,
          probesTried: boundaryProbes.length,
          probesSucceeded: succeeded.length,
          detectedAt: Date.now(),
          insights: succeeded.map(p => p.boundaryInsight).filter(Boolean),
        };
        breakthroughs.push(bt);
        newBreakthroughs.push(bt);

        // Courage boost from breakthrough
        const c = this._getCourage();
        c.breakthroughBoosts++;
        writeJSON(COURAGE_PATH, c);
        this._updateCourage(0.15, -0.1, `Breakthrough in ${boundary.category}!`);
      }
    }

    if (newBreakthroughs.length > 0) {
      writeJSON(BOUNDARIES_PATH, boundaries);
      if (breakthroughs.length > 500) breakthroughs.splice(0, breakthroughs.length - 500);
      writeJSON(BREAKTHROUGHS_PATH, breakthroughs);
      this._updateDepth();
      this.emit('breakthroughs', newBreakthroughs);
    }

    return { newBreakthroughs, totalBreakthroughs: breakthroughs.length };
  }

  // ── Abyss Map ──

  getAbyssMap() {
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    const probes = readJSON(PROBES_PATH, []);
    const breakthroughs = readJSON(BREAKTHROUGHS_PATH, []);
    const courage = this._getCourage();

    const byCategory = {};
    for (const cat of Object.keys(BOUNDARY_CATEGORIES)) {
      const catBoundaries = boundaries.filter(b => b.category === cat);
      const catProbes = probes.filter(p => p.category === cat);
      byCategory[cat] = {
        ...BOUNDARY_CATEGORIES[cat],
        boundaries: catBoundaries.length,
        breached: catBoundaries.filter(b => b.breached).length,
        active: catBoundaries.filter(b => !b.breached).length,
        avgDepth: catBoundaries.length > 0 ? Math.round(catBoundaries.reduce((s, b) => s + b.depth, 0) / catBoundaries.length * 10) / 10 : 0,
        probesTotal: catProbes.length,
        probesSucceeded: catProbes.filter(p => p.succeeded).length,
        probesFailed: catProbes.filter(p => p.status === 'failed').length,
        probesPending: catProbes.filter(p => p.status === 'pending').length,
        expansionRate: catBoundaries.filter(b => b.breached).length / (catBoundaries.length || 1),
      };
    }

    return {
      totalBoundaries: boundaries.length,
      activeBoundaries: boundaries.filter(b => !b.breached).length,
      breachedBoundaries: boundaries.filter(b => b.breached).length,
      totalProbes: probes.length,
      totalBreakthroughs: breakthroughs.length,
      byCategory,
      recentBreakthroughs: breakthroughs.slice(-5).reverse(),
      depthScore: this.getDepthScore(),
      courage: this.getCourageState(),
      expeditions: readJSON(EXPEDITIONS_PATH, []).length,
    };
  }

  getDepthScore() {
    return readJSON(DEPTH_PATH, { score: 0, history: [] });
  }

  _recordBreakthrough(probe) {
    const breakthroughs = readJSON(BREAKTHROUGHS_PATH, []);
    breakthroughs.push({
      id: uuid(),
      boundaryId: probe.boundaryId,
      probeId: probe.id,
      category: probe.category,
      description: `Probe succeeded: ${probe.task}`,
      insight: probe.boundaryInsight || '',
      detectedAt: Date.now(),
    });
    if (breakthroughs.length > 500) breakthroughs.splice(0, breakthroughs.length - 500);
    writeJSON(BREAKTHROUGHS_PATH, breakthroughs);
    this._updateDepth();
  }

  _updateDepth() {
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    const breakthroughs = readJSON(BREAKTHROUGHS_PATH, []);
    const depth = readJSON(DEPTH_PATH, { score: 0, history: [] });

    const total = boundaries.length || 1;
    const breached = boundaries.filter(b => b.breached).length;
    const avgDepth = boundaries.reduce((s, b) => s + (b.depth || 5), 0) / total;
    const score = Math.round((breached / total) * avgDepth * 10);

    depth.score = score;
    depth.history.push({ score, timestamp: Date.now(), breakthroughs: breakthroughs.length, boundaries: total });
    if (depth.history.length > 200) depth.history.splice(0, depth.history.length - 200);
    writeJSON(DEPTH_PATH, depth);
  }

  // ── Tick ──

  async tick() {
    const results = { mapped: null, probesGenerated: 0, probesExecuted: 0, breakthroughs: null, expeditionsAdvanced: 0 };

    // Courage decay — fear slowly decreases, courage slowly returns
    this._updateCourage(0.01, -this.config.courageDecayRate, 'Natural recovery');

    // Map new boundaries
    results.mapped = await this.mapBoundaries();

    // Generate probes for unprobed boundaries
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    const unprobed = boundaries.filter(b => !b.breached && b.probeCount === 0).slice(0, 2);
    for (const b of unprobed) {
      const gen = await this.generateProbes(b.id);
      if (gen.probes) results.probesGenerated += gen.probes.length;
    }

    // Execute pending probes (limit 3)
    const probes = readJSON(PROBES_PATH, []);
    const pending = probes.filter(p => p.status === 'pending').slice(0, 3);
    for (const p of pending) {
      await this.executeProbe(p.id);
      results.probesExecuted++;
    }

    // Analyze recent failures
    const recentFailed = probes.filter(p => p.status === 'failed' && !p.analysis).slice(0, 2);
    for (const p of recentFailed) {
      await this.analyzeFailure(p.id);
    }

    // Advance active expeditions
    const expeditions = readJSON(EXPEDITIONS_PATH, []);
    const active = expeditions.filter(e => e.state === 'active');
    for (const exp of active.slice(0, 1)) {
      await this.advanceExpedition(exp.id);
      results.expeditionsAdvanced++;
    }

    // Detect breakthroughs
    results.breakthroughs = await this.detectBreakthroughs();

    return results;
  }

  // ── Query Methods ──

  getProbes(opts) {
    const probes = readJSON(PROBES_PATH, []);
    let filtered = probes;
    if (opts && opts.boundaryId) filtered = filtered.filter(p => p.boundaryId === opts.boundaryId);
    if (opts && opts.status) filtered = filtered.filter(p => p.status === opts.status);
    if (opts && opts.category) filtered = filtered.filter(p => p.category === opts.category);
    return filtered.slice(-(opts && opts.limit || 50)).reverse();
  }

  getBoundaries(opts) {
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    let filtered = boundaries;
    if (opts && opts.category) filtered = filtered.filter(b => b.category === opts.category);
    if (opts && opts.active) filtered = filtered.filter(b => !b.breached);
    if (opts && opts.breached) filtered = filtered.filter(b => b.breached);
    return filtered.slice(-(opts && opts.limit || 50)).reverse();
  }

  getStats() {
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    const probes = readJSON(PROBES_PATH, []);
    const breakthroughs = readJSON(BREAKTHROUGHS_PATH, []);
    const expeditions = readJSON(EXPEDITIONS_PATH, []);
    const courage = this.getCourageState();

    return {
      boundaries: boundaries.length,
      activeBoundaries: boundaries.filter(b => !b.breached).length,
      breachedBoundaries: boundaries.filter(b => b.breached).length,
      probes: probes.length,
      breakthroughs: breakthroughs.length,
      expeditions: expeditions.length,
      activeExpeditions: expeditions.filter(e => e.state === 'active').length,
      courage: courage.courage,
      fear: courage.fear,
      depthScore: this.getDepthScore().score,
      categories: Object.keys(BOUNDARY_CATEGORIES).length,
    };
  }
}

module.exports = AbyssProtocol;
