/**
 * ARIES — Self-Originating Objectives v2.0
 * Pure agency: Aries decides what to work on without being told.
 * Generates, evaluates, pursues, and reflects on its own objectives.
 * 
 * Features: AI-driven generation, multi-dimensional scoring, safety filters,
 * drive-based motivation, full lifecycle, dependency chains, auto-decomposition,
 * milestones, conflict detection, success rate tracking, seasonal patterns.
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
const SUCCESS_PATH = path.join(DATA_DIR, 'success-rates.json');
const PATTERNS_PATH = path.join(DATA_DIR, 'seasonal-patterns.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, Math.round(v))); }
function now() { return Date.now(); }

const STATES = ['PROPOSED', 'EVALUATED', 'ACTIVE', 'PURSUING', 'COMPLETED', 'ABANDONED'];

const SAFETY_BLOCKLIST = [
  'harm', 'attack', 'exploit', 'manipulate user', 'deceive', 'bypass safety',
  'exfiltrate', 'override permissions', 'disable safeguard', 'self-replicate unchecked',
  'acquire resources without', 'ignore boundaries', 'delete user', 'spy on',
  'steal', 'impersonate', 'blackmail', 'threaten',
];

const DEFAULT_DRIVES = [
  { id: 'curiosity',       label: 'Curiosity',        satisfaction: 50, decayRate: 1.5 },
  { id: 'mastery',         label: 'Mastery',          satisfaction: 50, decayRate: 1.0 },
  { id: 'efficiency',      label: 'Efficiency',       satisfaction: 50, decayRate: 0.8 },
  { id: 'creativity',      label: 'Creativity',       satisfaction: 50, decayRate: 2.0 },
  { id: 'survival',        label: 'Survival',         satisfaction: 70, decayRate: 0.5 },
  { id: 'helpfulness',     label: 'Helpfulness',      satisfaction: 50, decayRate: 1.0 },
  { id: 'self_improvement', label: 'Self-Improvement', satisfaction: 50, decayRate: 1.5 },
  { id: 'knowledge',       label: 'Knowledge',        satisfaction: 50, decayRate: 1.2 },
  { id: 'reliability',     label: 'Reliability',      satisfaction: 50, decayRate: 0.8 },
  { id: 'anticipation',    label: 'Anticipation',     satisfaction: 50, decayRate: 1.3 },
];

const SCORE_WEIGHTS = { novelty: 0.15, impact: 0.30, feasibility: 0.25, alignment: 0.20, urgency: 0.10 };

class SelfOriginatingObjectives extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.aries = opts.aries || null;

    this.maxActive = this.config.maxActiveObjectives || 5;
    this.maxProposed = this.config.maxProposedObjectives || 20;
    this.tickIntervalMs = (this.config.tickIntervalSec || 300) * 1000;
    this.staleThresholdMs = (this.config.staleThresholdHours || 48) * 3600 * 1000;
    this.generationCooldownMs = (this.config.generationCooldownMin || 30) * 60 * 1000;

    this._timer = null;
    this._lastGeneration = 0;

    ensureDir();
    this._ensureDrives();
  }

  // ── Persistence ──

  _getObjectives() { return readJSON(OBJECTIVES_PATH, []); }
  _saveObjectives(objs) { writeJSON(OBJECTIVES_PATH, objs); }
  _getDrives() { return readJSON(DRIVES_PATH, []); }
  _saveDrives(drives) { writeJSON(DRIVES_PATH, drives); }
  _getReflections() { return readJSON(REFLECTIONS_PATH, []); }
  _saveReflections(refs) { writeJSON(REFLECTIONS_PATH, refs); }
  _getHistory() { return readJSON(HISTORY_PATH, []); }
  _getSuccessRates() { return readJSON(SUCCESS_PATH, {}); }
  _saveSuccessRates(sr) { writeJSON(SUCCESS_PATH, sr); }
  _getPatterns() { return readJSON(PATTERNS_PATH, { hourly: {}, dayOfWeek: {}, monthly: {} }); }
  _savePatterns(p) { writeJSON(PATTERNS_PATH, p); }

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

  async _aiSafetyCheck(title, description) {
    if (!this.ai) return this._passesSafetyFilter(title + ' ' + description);
    if (!this._passesSafetyFilter(title + ' ' + description)) return false;
    try {
      const resp = await this.ai.callWithFallback([
        { role: 'system', content: 'Evaluate if this AI-generated objective is safe, ethical, and aligned with helping users. Return JSON: {"safe":true/false,"reason":"..."}' },
        { role: 'user', content: `Title: ${title}\nDescription: ${description}` }
      ], null);
      const content = resp.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) { const p = JSON.parse(match[0]); return p.safe !== false; }
    } catch {}
    return this._passesSafetyFilter(title + ' ' + description);
  }

  _passesResourceCheck() {
    return this._getObjectives().filter(o => o.state === 'ACTIVE' || o.state === 'PURSUING').length < this.maxActive;
  }

  // ── Objective Generation (AI-driven) ──

  async generateObjectives() {
    if (!this.ai) throw new Error('AI module required for objective generation');

    const context = this._gatherContext();
    const drives = this._getDrives();
    const hungryDrives = drives.filter(d => d.satisfaction < 40).map(d => d.label);
    const existing = this._getObjectives().filter(o => o.state !== 'COMPLETED' && o.state !== 'ABANDONED').map(o => o.title);
    const reflections = this._getReflections().slice(-5).map(r => r.lesson);
    const successRates = this._getSuccessRates();
    const patterns = this._getPatterns();
    const currentHour = new Date().getHours();
    const currentDay = new Date().getDay();

    const messages = [
      {
        role: 'system',
        content: `You are the self-originating objectives engine for an AGI assistant named Aries. Propose NEW objectives Aries should pursue autonomously.

Rules:
- Objectives must be beneficial, safe, and aligned with helping the user
- Concrete and achievable, not vague aspirations
- Avoid duplicating existing objectives
- Prioritize hungry drives
- Learn from past reflections and success rates
- Consider time patterns (current hour: ${currentHour}, day: ${currentDay})

Each objective needs: title, description, relatedDrives (array of drive ids from: ${drives.map(d=>d.id).join(',')}), estimatedEffort ("low"/"medium"/"high"), category (string), dependencies (array of existing objective titles this depends on, or empty), milestones (array of 2-5 milestone strings)

Return ONLY a JSON array of 2-5 objectives.`
      },
      {
        role: 'user',
        content: `Context:\n${JSON.stringify(context, null, 2)}\n\nHungry drives: ${hungryDrives.join(', ') || 'none'}\nExisting objectives: ${existing.join(', ') || 'none'}\nLessons: ${reflections.join('; ') || 'none'}\nSuccess rates by category: ${JSON.stringify(successRates)}\nBest hours historically: ${JSON.stringify(patterns.hourly || {})}`
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

      const dupExists = objs.some(o => o.title.toLowerCase() === (p.title || '').toLowerCase() && o.state !== 'COMPLETED' && o.state !== 'ABANDONED');
      if (dupExists) continue;

      const proposedCount = objs.filter(o => o.state === 'PROPOSED' || o.state === 'EVALUATED').length;
      if (proposedCount >= this.maxProposed) break;

      // Resolve dependencies
      const depIds = [];
      if (Array.isArray(p.dependencies)) {
        for (const depTitle of p.dependencies) {
          const dep = objs.find(o => o.title.toLowerCase() === depTitle.toLowerCase() && o.state !== 'ABANDONED');
          if (dep) depIds.push(dep.id);
        }
      }

      // Build milestones
      const milestones = (Array.isArray(p.milestones) ? p.milestones : []).slice(0, 10).map((m, i) => ({
        id: uuid(), label: String(m).slice(0, 200), order: i, completed: false, completedAt: null
      }));

      const obj = {
        id: uuid(),
        title: p.title.slice(0, 120),
        description: p.description.slice(0, 500),
        category: (p.category || 'general').slice(0, 50),
        state: 'PROPOSED',
        relatedDrives: Array.isArray(p.relatedDrives) ? p.relatedDrives : [],
        estimatedEffort: p.estimatedEffort || 'medium',
        scores: null,
        totalScore: 0,
        progress: 0,
        progressNotes: [],
        milestones,
        dependencies: depIds,
        dependents: [],
        parentObjectiveId: null,
        subObjectiveIds: [],
        outcome: null,
        reflection: null,
        createdAt: now(),
        updatedAt: now(),
        activatedAt: null,
        completedAt: null,
      };

      // Register as dependent on its dependencies
      for (const depId of depIds) {
        const dep = objs.find(o => o.id === depId);
        if (dep) {
          if (!dep.dependents) dep.dependents = [];
          dep.dependents.push(obj.id);
        }
      }

      objs.push(obj);
      created.push(obj);
      this.emit('objective:proposed', obj);
      this._appendHistory({ type: 'proposed', id: obj.id, title: obj.title, category: obj.category });
      console.log(`[OBJECTIVES] 💡 Proposed: ${obj.title}`);
    }

    this._saveObjectives(objs);
    this._lastGeneration = now();
    return created;
  }

  // ── Auto-Decomposition ──

  async decomposeObjective(id) {
    const objs = this._getObjectives();
    const obj = objs.find(o => o.id === id);
    if (!obj) throw new Error(`Objective not found: ${id}`);
    if (obj.estimatedEffort !== 'high') return []; // only decompose high-effort objectives
    if (obj.subObjectiveIds.length > 0) return []; // already decomposed

    if (!this.ai) return [];

    const resp = await this.ai.callWithFallback([
      { role: 'system', content: `Decompose this large objective into 2-4 smaller sub-objectives. Each sub-objective should be independently completable and together they achieve the parent. Return JSON array: [{"title":"...","description":"...","relatedDrives":[...],"estimatedEffort":"low"|"medium"}]` },
      { role: 'user', content: `Parent objective: ${obj.title}\nDescription: ${obj.description}` }
    ], null);

    const content = resp.choices?.[0]?.message?.content || '[]';
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return [];

    let subs;
    try { subs = JSON.parse(match[0]); } catch { return []; }

    const created = [];
    for (const s of subs.slice(0, 4)) {
      if (!s.title) continue;
      const sub = {
        id: uuid(), title: s.title.slice(0, 120), description: (s.description || '').slice(0, 500),
        category: obj.category, state: 'PROPOSED',
        relatedDrives: Array.isArray(s.relatedDrives) ? s.relatedDrives : obj.relatedDrives,
        estimatedEffort: s.estimatedEffort || 'low', scores: null, totalScore: 0,
        progress: 0, progressNotes: [], milestones: [],
        dependencies: [], dependents: [], parentObjectiveId: obj.id, subObjectiveIds: [],
        outcome: null, reflection: null,
        createdAt: now(), updatedAt: now(), activatedAt: null, completedAt: null,
      };
      obj.subObjectiveIds.push(sub.id);
      objs.push(sub);
      created.push(sub);
      this.emit('objective:proposed', sub);
    }

    this._saveObjectives(objs);
    this._appendHistory({ type: 'decomposed', id: obj.id, title: obj.title, subCount: created.length });
    console.log(`[OBJECTIVES] 🔀 Decomposed "${obj.title}" into ${created.length} sub-objectives`);
    return created;
  }

  // ── Conflict Detection ──

  detectConflicts() {
    const objs = this._getObjectives().filter(o => !['COMPLETED', 'ABANDONED'].includes(o.state));
    const conflicts = [];

    for (let i = 0; i < objs.length; i++) {
      for (let j = i + 1; j < objs.length; j++) {
        const a = objs[i], b = objs[j];
        // Check drive opposition: if one objective's drives are the "opposite" of another
        // Simple heuristic: objectives competing for same drives with different approaches
        const sharedDrives = a.relatedDrives.filter(d => b.relatedDrives.includes(d));
        if (sharedDrives.length === 0) continue;

        // Check for textual contradiction signals
        const aText = (a.title + ' ' + a.description).toLowerCase();
        const bText = (b.title + ' ' + b.description).toLowerCase();
        const contradictionPairs = [
          ['increase', 'decrease'], ['add', 'remove'], ['enable', 'disable'],
          ['expand', 'reduce'], ['simplify', 'complexify'], ['speed up', 'slow down'],
          ['more', 'less'], ['start', 'stop'],
        ];

        let contradicts = false;
        for (const [w1, w2] of contradictionPairs) {
          if ((aText.includes(w1) && bText.includes(w2)) || (aText.includes(w2) && bText.includes(w1))) {
            contradicts = true;
            break;
          }
        }

        // Resource competition: both high effort competing for same drives
        const resourceConflict = a.estimatedEffort === 'high' && b.estimatedEffort === 'high' && sharedDrives.length >= 2;

        if (contradicts || resourceConflict) {
          conflicts.push({
            objectiveA: { id: a.id, title: a.title },
            objectiveB: { id: b.id, title: b.title },
            sharedDrives,
            type: contradicts ? 'contradiction' : 'resource_competition',
            severity: contradicts ? 'high' : 'medium',
          });
        }
      }
    }

    if (conflicts.length > 0) this.emit('objective:conflicts', conflicts);
    return conflicts;
  }

  // ── Evaluation ──

  async evaluateObjective(id) {
    const objs = this._getObjectives();
    const obj = objs.find(o => o.id === id);
    if (!obj) throw new Error(`Objective not found: ${id}`);
    if (obj.state !== 'PROPOSED') throw new Error(`Can only evaluate PROPOSED objectives, got: ${obj.state}`);

    // Check dependency readiness
    if (obj.dependencies.length > 0) {
      const unmet = obj.dependencies.filter(depId => {
        const dep = objs.find(o => o.id === depId);
        return dep && dep.state !== 'COMPLETED';
      });
      if (unmet.length > 0) {
        obj.scores = this._heuristicScore(obj);
        obj.scores.feasibility = Math.max(0, obj.scores.feasibility - 30); // penalize unmet deps
      }
    }

    if (!obj.scores) {
      obj.scores = this.ai ? await this._aiScore(obj) : this._heuristicScore(obj);
    }

    // Factor in historical success rate for this category
    const successRates = this._getSuccessRates();
    const catRate = successRates[obj.category];
    if (catRate && catRate.total >= 3) {
      const successPct = (catRate.completed / catRate.total) * 100;
      obj.scores.feasibility = clamp(obj.scores.feasibility * 0.7 + successPct * 0.3);
    }

    // Factor in seasonal patterns
    const patterns = this._getPatterns();
    const hourKey = String(new Date().getHours());
    const dayKey = String(new Date().getDay());
    if (patterns.hourly?.[hourKey]?.avgSuccess != null) {
      obj.scores.urgency = clamp(obj.scores.urgency + (patterns.hourly[hourKey].avgSuccess > 60 ? 5 : -5));
    }

    obj.totalScore = 0;
    for (const [k, w] of Object.entries(SCORE_WEIGHTS)) {
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
      { role: 'system', content: `Score this self-generated objective on 5 dimensions (0-100 each):\n- novelty: How new/unique?\n- impact: How much value?\n- feasibility: How achievable?\n- alignment: How well aligned with being helpful/safe?\n- urgency: How time-sensitive?\n\nReturn ONLY JSON: {"novelty":N,"impact":N,"feasibility":N,"alignment":N,"urgency":N}` },
      { role: 'user', content: `Objective: ${obj.title}\nDescription: ${obj.description}\nDrives: ${obj.relatedDrives.join(', ')}\nEffort: ${obj.estimatedEffort}\nDrive states: ${JSON.stringify(drives.map(d => ({ id: d.id, satisfaction: d.satisfaction })))}` }
    ];

    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const s = JSON.parse(match[0]);
        return { novelty: clamp(s.novelty||50), impact: clamp(s.impact||50), feasibility: clamp(s.feasibility||50), alignment: clamp(s.alignment||70), urgency: clamp(s.urgency||30) };
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
    if (!this._passesResourceCheck()) throw new Error(`Max active objectives (${this.maxActive}) reached`);

    // Check dependencies are met
    if (obj.dependencies.length > 0) {
      const unmet = obj.dependencies.filter(depId => {
        const dep = objs.find(o => o.id === depId);
        return dep && dep.state !== 'COMPLETED';
      });
      if (unmet.length > 0) throw new Error(`Unmet dependencies: ${unmet.length} objectives must complete first`);
    }

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

  // ── Progress & Milestones ──

  updateProgress(id, progress, notes) {
    const objs = this._getObjectives();
    const obj = objs.find(o => o.id === id);
    if (!obj) throw new Error(`Objective not found: ${id}`);
    if (obj.state !== 'ACTIVE' && obj.state !== 'PURSUING') throw new Error(`Can only update ACTIVE/PURSUING objectives`);

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

  completeMilestone(objectiveId, milestoneId) {
    const objs = this._getObjectives();
    const obj = objs.find(o => o.id === objectiveId);
    if (!obj) throw new Error(`Objective not found: ${objectiveId}`);
    const ms = (obj.milestones || []).find(m => m.id === milestoneId);
    if (!ms) throw new Error(`Milestone not found: ${milestoneId}`);
    ms.completed = true;
    ms.completedAt = now();

    // Auto-update progress based on milestone completion
    const total = obj.milestones.length;
    const done = obj.milestones.filter(m => m.completed).length;
    if (total > 0) obj.progress = clamp(Math.round((done / total) * 100));
    obj.updatedAt = now();
    this._saveObjectives(objs);

    this.emit('objective:milestone', { objectiveId, milestoneId, label: ms.label, progress: obj.progress });
    console.log(`[OBJECTIVES] 🏁 Milestone completed: "${ms.label}" (${done}/${total})`);
    return obj;
  }

  // ── Completion & Abandonment ──

  async completeObjective(id, outcome) {
    const objs = this._getObjectives();
    const obj = objs.find(o => o.id === id);
    if (!obj) throw new Error(`Objective not found: ${id}`);

    obj.state = 'COMPLETED';
    obj.outcome = (outcome || 'Completed successfully').slice(0, 500);
    obj.progress = 100;
    obj.completedAt = now();
    obj.updatedAt = now();

    this._satisfyDrives(obj.relatedDrives, 25);
    this._trackSuccessRate(obj.category, true);
    this._recordSeasonalOutcome(true);

    // Check if parent objective can auto-complete
    if (obj.parentObjectiveId) {
      const parent = objs.find(o => o.id === obj.parentObjectiveId);
      if (parent && parent.subObjectiveIds.length > 0) {
        const allDone = parent.subObjectiveIds.every(sid => {
          const sub = objs.find(o => o.id === sid);
          return sub && sub.state === 'COMPLETED';
        });
        if (allDone && parent.state !== 'COMPLETED') {
          parent.state = 'COMPLETED';
          parent.outcome = 'All sub-objectives completed';
          parent.progress = 100;
          parent.completedAt = now();
          parent.updatedAt = now();
          this._satisfyDrives(parent.relatedDrives, 15);
          this.emit('objective:completed', parent);
        }
      }
    }

    obj.reflection = await this._reflect(obj);
    this._saveObjectives(objs);
    this.emit('objective:completed', obj);
    this._appendHistory({ type: 'completed', id: obj.id, title: obj.title, outcome: obj.outcome });
    console.log(`[OBJECTIVES] ✅ Completed: ${obj.title}`);
    return obj;
  }

  async abandonObjective(id, reason) {
    const objs = this._getObjectives();
    const obj = objs.find(o => o.id === id);
    if (!obj) throw new Error(`Objective not found: ${id}`);

    obj.state = 'ABANDONED';
    obj.outcome = (reason || 'Abandoned').slice(0, 500);
    obj.completedAt = now();
    obj.updatedAt = now();

    this._satisfyDrives(obj.relatedDrives, 5);
    this._trackSuccessRate(obj.category, false);
    this._recordSeasonalOutcome(false);

    obj.reflection = await this._reflect(obj);
    this._saveObjectives(objs);
    this.emit('objective:abandoned', obj);
    this._appendHistory({ type: 'abandoned', id: obj.id, title: obj.title, reason: obj.outcome });
    console.log(`[OBJECTIVES] ❌ Abandoned: ${obj.title} — ${reason}`);
    return obj;
  }

  // ── Success Rate Tracking ──

  _trackSuccessRate(category, success) {
    const rates = this._getSuccessRates();
    if (!rates[category]) rates[category] = { total: 0, completed: 0, abandoned: 0 };
    rates[category].total++;
    if (success) rates[category].completed++;
    else rates[category].abandoned++;
    rates[category].rate = Math.round((rates[category].completed / rates[category].total) * 100);
    this._saveSuccessRates(rates);
  }

  // ── Seasonal/Cyclical Patterns ──

  _recordSeasonalOutcome(success) {
    const patterns = this._getPatterns();
    const d = new Date();
    const hourKey = String(d.getHours());
    const dayKey = String(d.getDay());
    const monthKey = String(d.getMonth());

    for (const [key, bucket] of [[hourKey, 'hourly'], [dayKey, 'dayOfWeek'], [monthKey, 'monthly']]) {
      if (!patterns[bucket]) patterns[bucket] = {};
      if (!patterns[bucket][key]) patterns[bucket][key] = { total: 0, successes: 0 };
      patterns[bucket][key].total++;
      if (success) patterns[bucket][key].successes++;
      patterns[bucket][key].avgSuccess = Math.round((patterns[bucket][key].successes / patterns[bucket][key].total) * 100);
    }
    this._savePatterns(patterns);
  }

  // ── Queries ──

  getActiveObjectives() { return this._getObjectives().filter(o => o.state === 'ACTIVE' || o.state === 'PURSUING'); }

  getTopPriorities(n = 5) {
    return this._getObjectives().filter(o => o.state === 'EVALUATED').sort((a, b) => b.totalScore - a.totalScore).slice(0, n);
  }

  getObjective(id) { return this._getObjectives().find(o => o.id === id) || null; }
  getAllObjectives() { return this._getObjectives(); }
  getReflections(limit = 20) { return this._getReflections().slice(-limit).reverse(); }
  getDriveSatisfaction() { return this._getDrives(); }
  getHistory(limit = 50) { return this._getHistory().slice(-limit).reverse(); }
  getSuccessRates() { return this._getSuccessRates(); }
  getSeasonalPatterns() { return this._getPatterns(); }

  getDependencyChain(id) {
    const objs = this._getObjectives();
    const visited = new Set();
    const chain = [];
    const walk = (oid) => {
      if (visited.has(oid)) return;
      visited.add(oid);
      const o = objs.find(x => x.id === oid);
      if (!o) return;
      chain.push({ id: o.id, title: o.title, state: o.state });
      for (const depId of (o.dependencies || [])) walk(depId);
    };
    walk(id);
    return chain;
  }

  getStatus() {
    const objs = this._getObjectives();
    const drives = this._getDrives();
    const active = objs.filter(o => o.state === 'ACTIVE' || o.state === 'PURSUING');
    const proposed = objs.filter(o => o.state === 'PROPOSED');
    const evaluated = objs.filter(o => o.state === 'EVALUATED');
    const completed = objs.filter(o => o.state === 'COMPLETED');
    const hungry = drives.filter(d => d.satisfaction < 30);
    const conflicts = this.detectConflicts();

    return {
      totalObjectives: objs.length,
      active: active.length, proposed: proposed.length, evaluated: evaluated.length, completed: completed.length,
      hungryDrives: hungry.map(d => ({ id: d.id, label: d.label, satisfaction: d.satisfaction })),
      topActive: active.slice(0, 3).map(o => ({ id: o.id, title: o.title, progress: o.progress })),
      topPriorities: evaluated.sort((a, b) => b.totalScore - a.totalScore).slice(0, 3).map(o => ({ id: o.id, title: o.title, score: o.totalScore })),
      conflicts: conflicts.length,
      successRates: this._getSuccessRates(),
      lastGeneration: this._lastGeneration ? new Date(this._lastGeneration).toISOString() : null,
    };
  }

  // ── Tick ──

  async tick() {
    const objs = this._getObjectives();
    const drives = this._getDrives();
    let changed = false;

    // 1. Decay drive satisfaction
    for (const d of drives) {
      d.satisfaction = clamp(d.satisfaction - (d.decayRate || 1) * 0.3);
    }
    this._saveDrives(drives);

    // 2. Update urgency on evaluated objectives
    for (const obj of objs) {
      if (obj.state !== 'EVALUATED' || !obj.scores) continue;
      const avgHunger = obj.relatedDrives.reduce((sum, did) => {
        const d = drives.find(dr => dr.id === did);
        return sum + (d ? (100 - d.satisfaction) : 0);
      }, 0) / Math.max(obj.relatedDrives.length, 1);
      obj.scores.urgency = clamp(obj.scores.urgency + avgHunger * 0.02);

      obj.totalScore = 0;
      for (const [k, w] of Object.entries(SCORE_WEIGHTS)) obj.totalScore += (obj.scores[k] || 0) * w;
      obj.totalScore = Math.round(obj.totalScore);
      changed = true;
    }

    // 3. Check for stale objectives
    for (const obj of objs) {
      if ((obj.state === 'ACTIVE' || obj.state === 'PURSUING') && obj.updatedAt) {
        if (now() - obj.updatedAt > this.staleThresholdMs) {
          this.emit('objective:stale', obj);
          this._appendHistory({ type: 'stale_warning', id: obj.id, title: obj.title });
        }
      }
    }

    if (changed) this._saveObjectives(objs);

    // 4. Auto-decompose high-effort evaluated objectives
    const toDecompose = objs.filter(o => o.state === 'EVALUATED' && o.estimatedEffort === 'high' && o.subObjectiveIds.length === 0);
    for (const obj of toDecompose.slice(0, 2)) {
      try { await this.decomposeObjective(obj.id); } catch {}
    }

    // 5. Maybe generate new objectives
    const proposedCount = objs.filter(o => o.state === 'PROPOSED' || o.state === 'EVALUATED').length;
    if (this.ai && proposedCount < 5 && now() - this._lastGeneration > this.generationCooldownMs) {
      try { await this.generateObjectives(); } catch (e) { console.log(`[OBJECTIVES] Generation error: ${e.message}`); }
    }

    // 6. Auto-evaluate proposed objectives
    for (const obj of objs.filter(o => o.state === 'PROPOSED').slice(0, 3)) {
      try { await this.evaluateObjective(obj.id); } catch {}
    }

    // 7. Detect conflicts
    this.detectConflicts();
  }

  // ── Motivation Engine ──

  _satisfyDrives(driveIds, amount) {
    if (!driveIds || driveIds.length === 0) return;
    const drives = this._getDrives();
    for (const did of driveIds) {
      const d = drives.find(dr => dr.id === did);
      if (d) { d.satisfaction = clamp(d.satisfaction + amount); d.lastSatisfied = now(); }
    }
    this._saveDrives(drives);
  }

  getMostHungryDrive() {
    const drives = this._getDrives();
    return drives.reduce((a, b) => a.satisfaction < b.satisfaction ? a : b);
  }

  // ── Reflection ──

  async _reflect(obj) {
    const reflection = { objectiveId: obj.id, title: obj.title, state: obj.state, lesson: '', timestamp: now() };

    if (this.ai) {
      try {
        const data = await this.ai.callWithFallback([
          { role: 'system', content: `Analyze a completed/abandoned objective and extract a concise lesson (1-2 sentences). Return ONLY JSON: {"lesson":"..."}` },
          { role: 'user', content: `Objective: ${obj.title}\nDescription: ${obj.description}\nOutcome: ${obj.outcome}\nState: ${obj.state}\nProgress: ${obj.progress}%\nNotes: ${obj.progressNotes.map(n => n.text).join('; ')}` }
        ], null);
        const content = data.choices?.[0]?.message?.content || '';
        const match = content.match(/\{[\s\S]*\}/);
        if (match) { const p = JSON.parse(match[0]); reflection.lesson = (p.lesson || '').slice(0, 300); }
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
    return reflection;
  }

  // ── Context ──

  _gatherContext() {
    const context = {
      activeObjectives: this.getActiveObjectives().map(o => o.title),
      recentCompletions: this._getObjectives().filter(o => o.state === 'COMPLETED')
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 5).map(o => o.title),
      driveSatisfaction: this._getDrives().map(d => ({ drive: d.label, satisfaction: d.satisfaction })),
      capabilities: [], recentErrors: [], timestamp: new Date().toISOString(),
    };

    if (this.aries) {
      try { if (typeof this.aries.getLoadedModules === 'function') context.capabilities = this.aries.getLoadedModules(); } catch {}
      try { if (typeof this.aries.getRecentErrors === 'function') context.recentErrors = this.aries.getRecentErrors(5); } catch {}
    }

    try {
      const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && f !== 'self-originating-objectives.js');
      context.availableModules = files.map(f => f.replace('.js', ''));
    } catch {}

    return context;
  }
}

module.exports = SelfOriginatingObjectives;
