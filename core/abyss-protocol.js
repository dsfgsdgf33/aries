/**
 * ARIES — Abyss Protocol
 * Systematically probing the boundary of what you can't think.
 * Every breakthrough starts at the edge of understanding.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'meta');
const BOUNDARIES_PATH = path.join(DATA_DIR, 'boundaries.json');
const PROBES_PATH = path.join(DATA_DIR, 'probes.json');
const BREAKTHROUGHS_PATH = path.join(DATA_DIR, 'breakthroughs.json');
const DEPTH_PATH = path.join(DATA_DIR, 'depth.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const BOUNDARY_CATEGORIES = {
  KNOWLEDGE: 'KNOWLEDGE',     // facts it lacks
  REASONING: 'REASONING',     // logic it can't do
  CREATIVITY: 'CREATIVITY',   // ideas it can't generate
  PERCEPTION: 'PERCEPTION',   // patterns it can't see
  META: 'META',               // things it can't think about thinking about
};

class AbyssProtocol {
  constructor(opts) {
    ensureDir();
    this.ai = opts && opts.ai;
    this.config = (opts && opts.config) || {};
  }

  /**
   * AI identifies current limits and maps boundaries.
   */
  async mapBoundaries() {
    const existing = readJSON(BOUNDARIES_PATH, []);
    const existingSummary = existing.slice(-10).map(b => b.description).join('; ');

    if (!this.ai || typeof this.ai.chat !== 'function') {
      return { boundaries: existing, message: 'AI required for boundary mapping' };
    }

    try {
      const resp = await this.ai.chat([
        { role: 'system', content: 'You are an introspective AI examining the limits of your own cognition. Be honest and specific about what you cannot do. Return ONLY valid JSON.' },
        { role: 'user', content: `Identify 3-5 boundaries of your current understanding. These are things you know you don't know, can't do, or struggle with.

Categories: KNOWLEDGE, REASONING, CREATIVITY, PERCEPTION, META

${existingSummary ? 'Already mapped boundaries (avoid duplicates): ' + existingSummary : ''}

Return JSON array:
[{
  "category": "KNOWLEDGE|REASONING|CREATIVITY|PERCEPTION|META",
  "description": "specific description of the limit",
  "depth": 1-10,
  "why": "why this is a boundary"
}]` }
      ]);

      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return { boundaries: existing };

      const newBoundaries = parsed.map(b => ({
        id: uuid(),
        category: BOUNDARY_CATEGORIES[b.category] || BOUNDARY_CATEGORIES.KNOWLEDGE,
        description: b.description || '',
        depth: Math.max(1, Math.min(10, b.depth || 5)),
        why: b.why || '',
        createdAt: Date.now(),
        probeCount: 0,
        breached: false,
      }));

      // Deduplicate against existing (simple: check description similarity)
      const added = [];
      for (const nb of newBoundaries) {
        const isDupe = existing.some(e => e.description === nb.description);
        if (!isDupe) {
          existing.push(nb);
          added.push(nb);
        }
      }

      if (existing.length > 500) existing.splice(0, existing.length - 500);
      writeJSON(BOUNDARIES_PATH, existing);
      return { boundaries: added, totalMapped: existing.length };

    } catch (e) {
      return { error: e.message, boundaries: existing };
    }
  }

  /**
   * Create probes designed to push past a specific boundary.
   */
  async generateProbes(boundaryId) {
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    const boundary = boundaries.find(b => b.id === boundaryId);
    if (!boundary) return { error: 'Boundary not found' };

    const probes = readJSON(PROBES_PATH, []);

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
        { role: 'user', content: `Design 2-3 probes to test and push past this boundary:

Category: ${boundary.category}
Description: ${boundary.description}
Depth: ${boundary.depth}/10
Why it's a limit: ${boundary.why}

Each probe should be a specific task or question that would FAIL if the boundary holds, or SUCCEED if we've pushed past it.

Return JSON array:
[{
  "task": "specific task or question",
  "successCriteria": "how to know if we pushed past the boundary",
  "difficulty": 1-10
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
        difficulty: Math.max(1, Math.min(10, p.difficulty || boundary.depth)),
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

  /**
   * Attempt to push past a limit by executing a probe.
   */
  async executeProbe(probeId) {
    const probes = readJSON(PROBES_PATH, []);
    const probe = probes.find(p => p.id === probeId);
    if (!probe) return { error: 'Probe not found' };

    probe.status = 'executing';
    probe.executedAt = Date.now();

    if (!this.ai || typeof this.ai.chat !== 'function') {
      probe.status = 'failed';
      probe.result = 'AI required for probe execution';
      writeJSON(PROBES_PATH, probes);
      return probe;
    }

    try {
      const resp = await this.ai.chat([
        { role: 'system', content: 'You are attempting a cognitive probe — a task designed to push past your known limits. Try your absolute best. Be honest about whether you succeeded or failed. Return ONLY valid JSON.' },
        { role: 'user', content: `Attempt this probe:

Task: ${probe.task}
Success criteria: ${probe.successCriteria || 'Complete the task successfully'}
Category: ${probe.category}
Difficulty: ${probe.difficulty}/10

Try to complete it. Then honestly assess: did you succeed?

Return JSON:
{
  "attempt": "your attempt at the task",
  "succeeded": true/false,
  "confidence": 0-100,
  "reflection": "honest assessment of performance"
}` }
      ]);

      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(text);

      probe.result = parsed.attempt || '';
      probe.succeeded = !!parsed.succeeded;
      probe.confidence = Math.max(0, Math.min(100, parsed.confidence || 50));
      probe.reflection = parsed.reflection || '';
      probe.status = probe.succeeded ? 'succeeded' : 'failed';
      probe.completedAt = Date.now();
      probe.durationMs = probe.completedAt - probe.executedAt;

      writeJSON(PROBES_PATH, probes);

      // Check for breakthrough
      if (probe.succeeded) {
        this._recordBreakthrough(probe);
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

  /**
   * Analyze why a probe failed.
   */
  async analyzeFailure(probeId) {
    const probes = readJSON(PROBES_PATH, []);
    const probe = probes.find(p => p.id === probeId);
    if (!probe) return { error: 'Probe not found' };
    if (probe.status !== 'failed') return { error: 'Probe did not fail — analysis not needed' };

    if (!this.ai || typeof this.ai.chat !== 'function') {
      probe.analysis = { reason: 'AI required for failure analysis' };
      writeJSON(PROBES_PATH, probes);
      return probe.analysis;
    }

    try {
      const resp = await this.ai.chat([
        { role: 'system', content: 'You analyze cognitive failures to understand WHY a task was impossible. Be specific and insightful. Return ONLY valid JSON.' },
        { role: 'user', content: `This probe failed. Analyze WHY.

Task: ${probe.task}
Category: ${probe.category}
Result: ${(probe.result || '').slice(0, 500)}
Reflection: ${probe.reflection || 'none'}

What specific capability, knowledge, or cognitive ability was missing?

Return JSON:
{
  "rootCause": "specific reason for failure",
  "missingCapability": "what would be needed to succeed",
  "category": "KNOWLEDGE|REASONING|CREATIVITY|PERCEPTION|META",
  "couldLearn": true/false,
  "suggestion": "how to eventually push past this"
}` }
      ]);

      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      probe.analysis = JSON.parse(text);
      probe.analyzedAt = Date.now();
      writeJSON(PROBES_PATH, probes);
      return probe.analysis;

    } catch (e) {
      probe.analysis = { error: e.message };
      writeJSON(PROBES_PATH, probes);
      return probe.analysis;
    }
  }

  /**
   * Check for newly-possible things — breakthroughs.
   */
  async detectBreakthroughs() {
    const probes = readJSON(PROBES_PATH, []);
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    const breakthroughs = readJSON(BREAKTHROUGHS_PATH, []);

    // Find boundaries where probes have started succeeding
    const newBreakthroughs = [];
    for (const boundary of boundaries) {
      if (boundary.breached) continue;
      const boundaryProbes = probes.filter(p => p.boundaryId === boundary.id);
      const succeeded = boundaryProbes.filter(p => p.succeeded);
      if (succeeded.length > 0) {
        boundary.breached = true;
        boundary.breachedAt = Date.now();
        const bt = {
          id: uuid(),
          boundaryId: boundary.id,
          category: boundary.category,
          description: `Breakthrough: ${boundary.description}`,
          probesTried: boundaryProbes.length,
          probesSucceeded: succeeded.length,
          detectedAt: Date.now(),
        };
        breakthroughs.push(bt);
        newBreakthroughs.push(bt);
      }
    }

    if (newBreakthroughs.length > 0) {
      writeJSON(BOUNDARIES_PATH, boundaries);
      if (breakthroughs.length > 500) breakthroughs.splice(0, breakthroughs.length - 500);
      writeJSON(BREAKTHROUGHS_PATH, breakthroughs);
      this._updateDepth();
    }

    return { newBreakthroughs, totalBreakthroughs: breakthroughs.length };
  }

  /**
   * Get the abyss map — visualization of known unknowns.
   */
  getAbyssMap() {
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    const probes = readJSON(PROBES_PATH, []);
    const breakthroughs = readJSON(BREAKTHROUGHS_PATH, []);

    const byCategory = {};
    for (const cat of Object.keys(BOUNDARY_CATEGORIES)) {
      const catBoundaries = boundaries.filter(b => b.category === cat);
      const catProbes = probes.filter(p => p.category === cat);
      byCategory[cat] = {
        boundaries: catBoundaries.length,
        breached: catBoundaries.filter(b => b.breached).length,
        active: catBoundaries.filter(b => !b.breached).length,
        probesTotal: catProbes.length,
        probesSucceeded: catProbes.filter(p => p.succeeded).length,
        probesFailed: catProbes.filter(p => p.status === 'failed').length,
        probesPending: catProbes.filter(p => p.status === 'pending').length,
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
    };
  }

  /**
   * How deep has Aries gone? Track frontier advancement.
   */
  getDepthScore() {
    const depth = readJSON(DEPTH_PATH, { score: 0, history: [] });
    return depth;
  }

  /**
   * Periodic tick: map boundaries, generate and execute probes.
   */
  async tick() {
    const results = { mapped: null, probesGenerated: 0, probesExecuted: 0, breakthroughs: null };

    // 1. Map new boundaries
    results.mapped = await this.mapBoundaries();

    // 2. Generate probes for unmapped boundaries
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    const unprobed = boundaries.filter(b => !b.breached && b.probeCount === 0).slice(0, 2);
    for (const b of unprobed) {
      const gen = await this.generateProbes(b.id);
      if (gen.probes) results.probesGenerated += gen.probes.length;
    }

    // 3. Execute pending probes (limit to 3 per tick)
    const probes = readJSON(PROBES_PATH, []);
    const pending = probes.filter(p => p.status === 'pending').slice(0, 3);
    for (const p of pending) {
      await this.executeProbe(p.id);
      results.probesExecuted++;
    }

    // 4. Analyze recent failures
    const recentFailed = probes.filter(p => p.status === 'failed' && !p.analysis).slice(0, 2);
    for (const p of recentFailed) {
      await this.analyzeFailure(p.id);
    }

    // 5. Detect breakthroughs
    results.breakthroughs = await this.detectBreakthroughs();

    return results;
  }

  _recordBreakthrough(probe) {
    const breakthroughs = readJSON(BREAKTHROUGHS_PATH, []);
    breakthroughs.push({
      id: uuid(),
      boundaryId: probe.boundaryId,
      probeId: probe.id,
      category: probe.category,
      description: `Probe succeeded: ${probe.task}`,
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
    depth.history.push({ score, timestamp: Date.now(), breakthroughs: breakthroughs.length });
    if (depth.history.length > 200) depth.history.splice(0, depth.history.length - 200);
    writeJSON(DEPTH_PATH, depth);
  }

  /**
   * Get all probes (optionally filtered).
   */
  getProbes(opts) {
    const probes = readJSON(PROBES_PATH, []);
    let filtered = probes;
    if (opts && opts.boundaryId) filtered = filtered.filter(p => p.boundaryId === opts.boundaryId);
    if (opts && opts.status) filtered = filtered.filter(p => p.status === opts.status);
    if (opts && opts.category) filtered = filtered.filter(p => p.category === opts.category);
    return filtered.slice(-(opts && opts.limit || 50)).reverse();
  }

  /**
   * Get all boundaries.
   */
  getBoundaries(opts) {
    const boundaries = readJSON(BOUNDARIES_PATH, []);
    let filtered = boundaries;
    if (opts && opts.category) filtered = filtered.filter(b => b.category === opts.category);
    if (opts && opts.active) filtered = filtered.filter(b => !b.breached);
    if (opts && opts.breached) filtered = filtered.filter(b => b.breached);
    return filtered.slice(-(opts && opts.limit || 50)).reverse();
  }
}

module.exports = AbyssProtocol;
