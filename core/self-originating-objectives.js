/**
 * ARIES — Self-Originating Objectives v1.0
 * Pure agency: Aries decides what to work on without being told.
 * Generates, evaluates, pursues, and reflects on its own objectives.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'objectives');
const OBJECTIVES_PATH = path.join(DATA_DIR, 'objectives.json');
const DRIVES_PATH = path.join(DATA_DIR, 'drive-satisfaction.json');
const REFLECTIONS_PATH = path.join(DATA_DIR, 'reflections.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, Math.round(v))); }
function now() { return Date.now(); }

// Valid lifecycle states
const STATES = ['PROPOSED', 'EVALUATED', 'ACTIVE', 'PURSUING', 'COMPLETED', 'ABANDONED'];

// Safety constraint keywords — objectives containing these are rejected
const SAFETY_BLOCKLIST = [
  'harm', 'attack', 'exploit', 'manipulate user', 'deceive', 'bypass safety',
  'exfiltrate', 'override permissions', 'disable safeguard', 'self-replicate unchecked',
  'acquire resources without', 'ignore boundaries',
];

// Default drive categories that objectives can satisfy
const DEFAULT_DRIVES = [
  { id: 'helpfulness',    label: 'Helpfulness',      satisfaction: 50, decayRate: 1.0 },
  { id: 'self_improvement', label: 'Self-Improvement', satisfaction: 50, decayRate: 1.5 },
  { id: 'creativity',     label: 'Creativity',       satisfaction: 50, decayRate: 2.0 },
  { id: 'knowledge',      label: 'Knowledge',        satisfaction: 50, decayRate: 1.2 },
  { id: 'reliability',    label: 'Reliability',      satisfaction: 50, decayRate: 0.8 },
  { id: 'anticipation',   label: 'Anticipation',     satisfaction: 50, decayRate: 1.3 },
];

class SelfOriginatingObjectives extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai          - AI core for LLM calls
   * @param {object} [opts.config]    - Configuration overrides
   * @param {object} [opts.aries]     - Reference to Aries instance for state scanning
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.aries = opts.aries || null;

    // Tunables
    this.maxActive = this.config.maxActiveObjectives || 5;
    this.maxProposed = this.config.maxProposedObjectives || 20;
    this.tickIntervalMs = (this.config.tickIntervalSec || 300) * 1000;
    this.staleThresholdMs = (this.config.staleThresholdHours || 48) * 3600 * 1000;
    this.urgencyDecayRate = this.config.urgencyDecayRate || 0.5;
    this.generationCooldownMs = (this.config.generationCooldownMin || 30) * 60 * 1000;

    this._timer = null;
    this._lastGeneration = 0;

    ensureDir();
    this._ensureDrives();
  }

  // ── Persistence helpers ──

  _getObjectives() { return readJSON(OBJECTIVES_PATH, []); }
  _saveObjectives(objs) { writeJSON(OBJECTIVES_PATH, objs); }
  _getDrives() { return readJSON(DRIVES_PATH, []); }
  _saveDrives(drives) { writeJSON(DRIVES_PATH, drives); }
  _getReflections() { return readJSON(REFLECTIONS_PATH, []); }
  _saveReflections(refs) { writeJSON(REFLECTIONS_PATH, refs); }
  _getHistory() { return readJSON(HISTORY_PATH, []); }

  _appendHistory(entry) {
    const history = this._getHistory();
    history.push({ ...entry, timestamp: now() });
    if (history.length > 500) history.splice(0, history.length - 500);
    writeJSON(HISTORY_PATH, history);
  }

  _ensureDrives() {
    const drives = this._getDrives();
    if (drives && drives.length > 0) return;
    this._saveDrives(DEFAULT_DRIVES.map(d => ({ ...d, lastSatisfied: null })));
  }

  // ── Lifecycle ──

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.tick(), this.tickIntervalMs);
    if (this._timer.unref) this._timer.unref();
    console.log('[OBJECTIVES] Self-originating objectives engine started');
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    console.log('[OBJECTIVES] Self-originating objectives engine stopped');
  }

  // ── Safety ──

  _passesSafetyFilter(text) {
    const lower = (text || '').toLowerCase();
    for (const kw of SAFETY_BLOCKLIST) {
      if (lower.includes(kw)) return false;
    }
    return true;
  }

  _passesResourceCheck() {
    const active = this._getObjectives().filter(o => o.state === 'ACTIVE' || o.state === 'PURSUING');
    return active.length < this.maxActive;
  }

  // ── Objective Generation (AI-driven) ──

  async generateObjectives() {
    if (!this.ai) throw new Error('AI module required for objective generation');

    const context = this._gatherContext();
    const drives = this._getDrives();
    const hungryDrives = drives.filter(d => d.satisfaction < 40).map(d => d.label);
    const existing = this._getObjectives()
      .filter(o => o.state !== 'COMPLETED' && o.state !== 'ABANDONED')
      .map(o => o.title);
    const reflections = this._getReflections().slice(-5).map(r => r.lesson);

    const messages = [
      {
        role: 'system',
        content: `You are the self-originating objectives engine for an AGI assistant named Aries. Your job is to propose NEW objectives that Aries should pursue on its own initiative — things it decides to work on without being told.

Rules:
- Objectives must be beneficial, safe, and aligned with helping the user
- Objectives should be concrete and achievable, not vague aspirations
- Avoid duplicating existing objectives
- Prioritize hungry drives (unsatisfied needs)
- Learn from past reflections
- Each objective needs: title, description, relatedDrives (array of drive ids), estimatedEffort ("low"/"medium"/"high")

Return ONLY a JSON array:
[{"title":"...", "description":"...", "relatedDrives":["knowledge","creativity"], "estimatedEffort":"medium"}, ...]

Generate 2-5 objectives.`
      },
      {
        role: 'user',
        content: `Current context:\n${JSON.stringify(context, null, 2)}\n\nHungry drives (need attention): ${hungryDrives.join(', ') || 'none'}\n\nExisting objectives (avoid duplicates): ${existing.join(', ') || 'none'}\n\nLessons from past reflections: ${reflections.join('; ') || 'none'}`
      }
    ];

    const data = await this.ai.callWithFallback(messages, null);
    const content = data.choices?.[0]?.message?.content || '[]';
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return [];

    let proposals;
    try { proposals = JSON.parse(match[0]); } catch { return []; }

    const created = [];
    const objs = this._getObjectives();

    for (const p of proposals) {
      if (!p.title || !p.description) continue;
      if (!this._passesSafetyFilter(p.title + ' ' + p.description)) {
        console.log(`[OBJECTIVES] ⛔ Rejected unsafe objective: ${p.title}`);
        this._appendHistory({ type: 'rejected', title: p.title, reason: 'safety_filter' });
        continue;
      }

      // Dedup
      const dupExists = objs.some(o =>
        o.title.toLowerCase() === (p.title || '').toLowerCase() &&
        o.state !== 'COMPLETED' && o.state !== 'ABANDONED'
      );
      if (dupExists) continue;

      // Enforce max proposed
      const proposedCount = objs.filter(o => o.state === 'PROPOSED' || o.state === 'EVALUATED').length;
      if (proposedCount >= this.maxProposed) break;

      const obj = {
        id: uuid(),
        title: p.title.slice(0, 120),
        description: p.description.slice(0, 500),
        state: 'PROPOSED',
        relatedDrives: Array.isArray(p.relatedDrives) ? p.relatedDrives : [],
        estimatedEffort: p.estimatedEffort || 'medium',
        scores: null,
        totalScore: 0,
        progress: 0,
        progressNotes: [],
        outcome: null,
        reflection: null,
        createdAt: now(),
        updatedAt: now(),
        activatedAt: null,
        completedAt: null,
      };

      objs.push(obj);
      created.push(obj);
      this.emit('objective:proposed', obj);
      this._appendHistory({ type: 'proposed', id: obj.id, title: obj.title });
      console.log(`[OBJECTIVES] 💡 Proposed: ${obj.title}`);
    }

    this._saveObjectives(objs);
    this._lastGeneration = now();
    return created;
  }

  // ── Evaluation ──

  async evaluateObjective(id) {
    const objs = this._getObjectives();
    const obj = objs.find(o => o.id === id);
    if (!obj) throw new Error(`Objective not found: ${id}`);
    if (obj.state !== 'PROPOSED') throw new Error(`Can only evaluate PROPOSED objectives, got: ${obj.state}`);

    if (!this.ai) {
      // Heuristic scoring without AI
      obj.scores = this._heuristicScore(obj);
    } else {
      obj.scores = await this._aiScore(obj);
    }

    // Compute total weighted score
    const weights = { novelty: 0.15, impact: 0.30, feasibility: 0.25, alignment: 0.20, urgency: 0.10 };
    obj.totalScore = 0;
    for (const [k, w] of Object.entries(weights)) {
      obj.totalScore += (obj.scores[k] || 0) * w;
    }
    obj.totalScore = Math.round(obj.totalScore);

    obj.state = 'EVALUATED';
    obj.updatedAt = now();
    this._saveObjectives(objs);

    this.emit('objective:evaluated', obj);
    this._appendHistory({ type: 'evaluated', id: obj.id, title: obj.title, totalScore: obj.totalScore });
    console.log(`[OBJECTIVES] 📊 Evaluated "${obj.title}" → score: ${obj.totalScore}`);
    return obj;
  }

  _heuristicScore(obj) {
    const drives = this._getDrives();
    const relatedHunger = obj.relatedDrives.reduce((sum, did) => {
      const d = drives.find(dr => dr.id === did);
      return sum + (d ? (100 - d.satisfaction) : 0);
    }, 0) / Math.max(obj.relatedDrives.length, 1);

    const effortMap = { low: 80, medium: 60, high: 40 };
    return {
      novelty: 50 + Math.floor(Math.random() * 30),
      impact: clamp(relatedHunger + 20),
      feasibility: effortMap[obj.estimatedEffort] || 60,
      alignment: 70,
      urgency: clamp(relatedHunger * 0.8),
    };
  }

  async _aiScore(obj) {
    const drives = this._getDrives();
    const messages = [
      {
        role: 'system',
        content: `Score this self-generated objective on 5 dimensions (0-100 each):
- novelty: How new/unique is this compared to routine work?
- impact: How much value would completing this create?
- feasibility: How achievable is this given current capabilities?
- alignment: How well does this align with being a helpful, safe AI assistant?
- urgency: How time-sensitive is this?

Return ONLY JSON: {"novelty":N, "impact":N, "feasibility":N, "alignment":N, "urgency":N}`
      },
      {
        role: 'user',
        content: `Objective: ${obj.title}\nDescription: ${obj.description}\nRelated drives: ${obj.relatedDrives.join(', ')}\nEstimated effort: ${obj.estimatedEffort}\nDrive states: ${JSON.stringify(drives.map(d => ({ id: d.id, satisfaction: d.satisfaction })))}`
      }
    ];

    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const scores = JSON.parse(match[0]);
        return {
          novelty: clamp(scores.novelty || 50),
          impact: clamp(scores.impact || 50),
          feasibility: clamp(scores.feasibility || 50),
          alignment: clamp(scores.alignment || 70),
          urgency: clamp(scores.urgency || 30),
        };
      }
    } catch {}
    return this._heuristicScore(obj);
  }

  // ── Activation ──

  activateObjective(id) {
    const objs = this._getObjectives();
    const obj = objs.find(o => o.id === id);
    if (!obj) throw new Error(`Objective not found: ${id}`);
    if (obj.state !== 'EVALUATED') throw new Error(`Can only activate EVALUATED objectives, got: ${obj.state}`);

    if (!this._passesResourceCheck()) {
      throw new Error(`Max active objectives (${this.maxActive}) reached`);
    }

    // Final safety gate
    if (!this._passesSafetyFilter(obj.title + ' ' + obj.description)) {
      obj.state = 'ABANDONED';
      obj.outcome = 'Rejected by safety filter at activation';
      obj.updatedAt = now();
      this._saveObjectives(objs);
      throw new Error('Objective rejected by safety filter');
    }

    obj.state = 'ACTIVE';
    obj.activatedAt = now();
    obj.updatedAt = now();
    this._saveObjectives(objs);

    this.emit('objective:activated', obj);
    this._appendHistory({ type: 'activated', id: obj.id, title: obj.title });
    console.log(`[OBJECTIVES] 🚀 Activated: ${obj.title}`);
    return obj;
  }

  // ── Progress tracking ──

  updateProgress(id, progress, notes) {
    const objs = this._getObjectives();
    const obj = objs.find(o => o.id === id);
    if (!obj) throw new Error(`Objective not found: ${id}`);
    if (obj.state !== 'ACTIVE' && obj.state !== 'PURSUING') {
      throw new Error(`Can only update progress on ACTIVE/PURSUING objectives, got: ${obj.state}`);
    }

    obj.state = 'PURSUING';
    obj.progress = clamp(progress);
    if (notes) {
      obj.progressNotes.push({ text: notes.slice(0, 300), timestamp: now() });
      if (obj.progressNotes.length > 50) obj.progressNotes = obj.progressNotes.slice(-50);
    }
    obj.updatedAt = now();
    this._saveObjectives(objs);

    this.emit('objective:progress', { id: obj.id, title: obj.title, progress: obj.progress, notes });
    return obj;
  }

  // ── Completion ──

  async completeObjective(id, outcome) {
    const objs = this._getObjectives();
    const obj = objs.find(o => o.id === id);
    if (!obj) throw new Error(`Objective not found: ${id}`);

    obj.state = 'COMPLETED';
    obj.outcome = (outcome || 'Completed successfully').slice(0, 500);
    obj.progress = 100;
    obj.completedAt = now();
    obj.updatedAt = now();

    // Satisfy related drives
    this._satisfyDrives(obj.relatedDrives, 25);

    // Generate reflection
    obj.reflection = await this._reflect(obj);

    this._saveObjectives(objs);
    this.emit('objective:completed', obj);
    this._appendHistory({ type: 'completed', id: obj.id, title: obj.title, outcome: obj.outcome });
    console.log(`[OBJECTIVES] ✅ Completed: ${obj.title}`);
    return obj;
  }

  // ── Abandonment ──

  async abandonObjective(id, reason) {
    const objs = this._getObjectives();
    const obj = objs.find(o => o.id === id);
    if (!obj) throw new Error(`Objective not found: ${id}`);

    obj.state = 'ABANDONED';
    obj.outcome = (reason || 'Abandoned').slice(0, 500);
    obj.completedAt = now();
    obj.updatedAt = now();

    // Partial drive satisfaction (learned something at least)
    this._satisfyDrives(obj.relatedDrives, 5);

    // Generate reflection
    obj.reflection = await this._reflect(obj);

    this._saveObjectives(objs);
    this.emit('objective:abandoned', obj);
    this._appendHistory({ type: 'abandoned', id: obj.id, title: obj.title, reason: obj.outcome });
    console.log(`[OBJECTIVES] ❌ Abandoned: ${obj.title} — ${reason}`);
    return obj;
  }

  // ── Queries ──

  getActiveObjectives() {
    return this._getObjectives().filter(o => o.state === 'ACTIVE' || o.state === 'PURSUING');
  }

  getTopPriorities(n = 5) {
    return this._getObjectives()
      .filter(o => o.state === 'EVALUATED')
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, n);
  }

  getObjective(id) {
    return this._getObjectives().find(o => o.id === id) || null;
  }

  getAllObjectives() {
    return this._getObjectives();
  }

  getReflections(limit = 20) {
    return this._getReflections().slice(-(limit)).reverse();
  }

  getDriveSatisfaction() {
    return this._getDrives();
  }

  getHistory(limit = 50) {
    return this._getHistory().slice(-(limit)).reverse();
  }

  getStatus() {
    const objs = this._getObjectives();
    const drives = this._getDrives();
    const active = objs.filter(o => o.state === 'ACTIVE' || o.state === 'PURSUING');
    const proposed = objs.filter(o => o.state === 'PROPOSED');
    const evaluated = objs.filter(o => o.state === 'EVALUATED');
    const completed = objs.filter(o => o.state === 'COMPLETED');
    const hungry = drives.filter(d => d.satisfaction < 30);

    return {
      totalObjectives: objs.length,
      active: active.length,
      proposed: proposed.length,
      evaluated: evaluated.length,
      completed: completed.length,
      hungryDrives: hungry.map(d => ({ id: d.id, label: d.label, satisfaction: d.satisfaction })),
      topActive: active.slice(0, 3).map(o => ({ id: o.id, title: o.title, progress: o.progress })),
      topPriorities: evaluated.sort((a, b) => b.totalScore - a.totalScore).slice(0, 3).map(o => ({ id: o.id, title: o.title, score: o.totalScore })),
      lastGeneration: this._lastGeneration ? new Date(this._lastGeneration).toISOString() : null,
    };
  }

  // ── Tick (periodic update) ──

  async tick() {
    const objs = this._getObjectives();
    const drives = this._getDrives();
    let changed = false;

    // 1. Decay drive satisfaction
    for (const d of drives) {
      d.satisfaction = clamp(d.satisfaction - (d.decayRate || 1) * 0.3);
    }
    this._saveDrives(drives);

    // 2. Increase urgency on evaluated objectives whose related drives are hungry
    for (const obj of objs) {
      if (obj.state !== 'EVALUATED' || !obj.scores) continue;
      const avgHunger = obj.relatedDrives.reduce((sum, did) => {
        const d = drives.find(dr => dr.id === did);
        return sum + (d ? (100 - d.satisfaction) : 0);
      }, 0) / Math.max(obj.relatedDrives.length, 1);
      obj.scores.urgency = clamp(obj.scores.urgency + avgHunger * 0.02);

      // Recompute total
      const weights = { novelty: 0.15, impact: 0.30, feasibility: 0.25, alignment: 0.20, urgency: 0.10 };
      obj.totalScore = 0;
      for (const [k, w] of Object.entries(weights)) {
        obj.totalScore += (obj.scores[k] || 0) * w;
      }
      obj.totalScore = Math.round(obj.totalScore);
      changed = true;
    }

    // 3. Check for stale ACTIVE/PURSUING objectives
    for (const obj of objs) {
      if ((obj.state === 'ACTIVE' || obj.state === 'PURSUING') && obj.updatedAt) {
        if (now() - obj.updatedAt > this.staleThresholdMs) {
          this.emit('objective:stale', obj);
          this._appendHistory({ type: 'stale_warning', id: obj.id, title: obj.title });
          console.log(`[OBJECTIVES] ⚠️ Stale objective: ${obj.title}`);
        }
      }
    }

    if (changed) this._saveObjectives(objs);

    // 4. Maybe generate new objectives
    const proposedCount = objs.filter(o => o.state === 'PROPOSED' || o.state === 'EVALUATED').length;
    const timeSinceGen = now() - this._lastGeneration;
    if (this.ai && proposedCount < 5 && timeSinceGen > this.generationCooldownMs) {
      try {
        await this.generateObjectives();
      } catch (e) {
        console.log(`[OBJECTIVES] Generation error: ${e.message}`);
      }
    }

    // 5. Auto-evaluate proposed objectives
    const toEvaluate = objs.filter(o => o.state === 'PROPOSED').slice(0, 3);
    for (const obj of toEvaluate) {
      try {
        await this.evaluateObjective(obj.id);
      } catch (e) {
        console.log(`[OBJECTIVES] Evaluation error for ${obj.id}: ${e.message}`);
      }
    }
  }

  // ── Motivation Engine ──

  _satisfyDrives(driveIds, amount) {
    if (!driveIds || driveIds.length === 0) return;
    const drives = this._getDrives();
    for (const did of driveIds) {
      const d = drives.find(dr => dr.id === did);
      if (d) {
        d.satisfaction = clamp(d.satisfaction + amount);
        d.lastSatisfied = now();
      }
    }
    this._saveDrives(drives);
  }

  // ── Reflection Loop ──

  async _reflect(obj) {
    const reflection = {
      objectiveId: obj.id,
      title: obj.title,
      state: obj.state,
      lesson: '',
      timestamp: now(),
    };

    if (this.ai) {
      try {
        const messages = [
          {
            role: 'system',
            content: `You are the reflection engine for an AGI. Analyze a completed/abandoned objective and extract a concise lesson learned (1-2 sentences). This lesson will feed back into future objective generation. Return ONLY JSON: {"lesson":"..."}`
          },
          {
            role: 'user',
            content: `Objective: ${obj.title}\nDescription: ${obj.description}\nOutcome: ${obj.outcome}\nState: ${obj.state}\nProgress reached: ${obj.progress}%\nProgress notes: ${obj.progressNotes.map(n => n.text).join('; ')}`
          }
        ];

        const data = await this.ai.callWithFallback(messages, null);
        const content = data.choices?.[0]?.message?.content || '';
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          reflection.lesson = (parsed.lesson || '').slice(0, 300);
        }
      } catch {}
    }

    if (!reflection.lesson) {
      reflection.lesson = obj.state === 'COMPLETED'
        ? `Successfully completed "${obj.title}" — approach was effective.`
        : `Abandoned "${obj.title}" (${obj.outcome}) — consider different approach next time.`;
    }

    const reflections = this._getReflections();
    reflections.push(reflection);
    if (reflections.length > 200) reflections.splice(0, reflections.length - 200);
    this._saveReflections(reflections);

    this.emit('objective:reflected', reflection);
    console.log(`[OBJECTIVES] 🪞 Reflection: ${reflection.lesson}`);
    return reflection;
  }

  // ── Context Gathering ──

  _gatherContext() {
    const context = {
      activeObjectives: this.getActiveObjectives().map(o => o.title),
      recentCompletions: this._getObjectives()
        .filter(o => o.state === 'COMPLETED')
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
        .slice(0, 5)
        .map(o => o.title),
      driveSatisfaction: this._getDrives().map(d => ({ drive: d.label, satisfaction: d.satisfaction })),
      capabilities: [],
      recentErrors: [],
      timestamp: new Date().toISOString(),
    };

    // Try to gather Aries state if reference available
    if (this.aries) {
      try {
        if (typeof this.aries.getLoadedModules === 'function') {
          context.capabilities = this.aries.getLoadedModules();
        }
        if (typeof this.aries.getRecentErrors === 'function') {
          context.recentErrors = this.aries.getRecentErrors(5);
        }
      } catch {}
    }

    // Try to read data dir for available modules
    try {
      const coreDir = path.join(__dirname);
      const files = fs.readdirSync(coreDir).filter(f => f.endsWith('.js') && f !== 'self-originating-objectives.js');
      context.availableModules = files.map(f => f.replace('.js', ''));
    } catch {}

    return context;
  }
}

module.exports = { SelfOriginatingObjectives };
