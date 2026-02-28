/**
 * ARIES — Context Theater
 * Full scene reconstruction for understanding complex situations.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'theater');
const SCENES_PATH = path.join(DATA_DIR, 'scenes.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function safeCall(fn, fb) { try { return fn(); } catch { return fb; } }

class ContextTheater {
  constructor(refs) {
    this.refs = refs || {};
    this._currentScene = null;
    ensureDir();
  }

  reconstructScene(context) {
    const ctx = context || {};
    const scene = {
      id: uuid(),
      timestamp: Date.now(),
      who: this._buildWho(ctx),
      what: this._buildWhat(ctx),
      when: this._buildWhen(ctx),
      where: this._buildWhere(ctx),
      why: this._buildWhy(ctx),
      how: this._buildHow(ctx),
      mood: this._deriveMood(ctx),
      stakes: this._deriveStakes(ctx),
      complexity: this._deriveComplexity(ctx),
      narrative: '',
    };

    scene.narrative = this._writeNarrative(scene);
    this._currentScene = scene;

    // Persist
    const scenes = readJSON(SCENES_PATH, []);
    scenes.push(scene);
    if (scenes.length > 500) scenes.splice(0, scenes.length - 500);
    writeJSON(SCENES_PATH, scenes);

    return scene;
  }

  getCurrentScene() {
    if (this._currentScene) return this._currentScene;
    const scenes = readJSON(SCENES_PATH, []);
    return scenes[scenes.length - 1] || this.reconstructScene({});
  }

  getSceneHistory(limit) {
    const scenes = readJSON(SCENES_PATH, []);
    const l = limit || 20;
    return scenes.slice(-l).reverse();
  }

  compareScenes(id1, id2) {
    const scenes = readJSON(SCENES_PATH, []);
    const s1 = scenes.find(s => s.id === id1);
    const s2 = scenes.find(s => s.id === id2);
    if (!s1 || !s2) return { error: 'Scene not found' };

    const changes = [];
    if (s1.mood !== s2.mood) changes.push({ field: 'mood', from: s1.mood, to: s2.mood });
    if (s1.stakes !== s2.stakes) changes.push({ field: 'stakes', from: s1.stakes, to: s2.stakes });
    if (s1.complexity !== s2.complexity) changes.push({ field: 'complexity', from: s1.complexity, to: s2.complexity });
    if (s1.who.persona !== s2.who.persona) changes.push({ field: 'persona', from: s1.who.persona, to: s2.who.persona });
    if (s1.what.task !== s2.what.task) changes.push({ field: 'task', from: s1.what.task, to: s2.what.task });

    return {
      scene1: { id: s1.id, timestamp: s1.timestamp, mood: s1.mood, stakes: s1.stakes },
      scene2: { id: s2.id, timestamp: s2.timestamp, mood: s2.mood, stakes: s2.stakes },
      changes,
      timeDelta: s2.timestamp - s1.timestamp,
      summary: changes.length === 0 ? 'Scenes are identical' : changes.length + ' change(s) detected',
    };
  }

  setStage(context) {
    return this.reconstructScene(context);
  }

  getResponseStyle() {
    const scene = this.getCurrentScene();
    const style = { tone: 'balanced', detail: 'moderate', speed: 'normal', formality: 'casual' };

    if (scene.stakes === 'high' || scene.stakes === 'critical') {
      style.tone = 'careful';
      style.detail = 'thorough';
      style.speed = 'deliberate';
    }
    if (scene.stakes === 'low') {
      style.tone = 'casual';
      style.detail = 'brief';
      style.speed = 'quick';
    }
    if (scene.complexity > 7) {
      style.detail = 'thorough';
      style.tone = 'methodical';
    }
    if (scene.mood === 'tense' || scene.mood === 'urgent') {
      style.speed = 'quick';
      style.tone = 'direct';
    }
    if (scene.mood === 'playful') {
      style.tone = 'fun';
      style.formality = 'informal';
    }

    return style;
  }

  // ── Scene builders ──

  _buildWho(ctx) {
    const persona = safeCall(() => {
      const PF = require('./persona-forking');
      const pf = new PF(this.refs);
      const p = pf.getCurrentPersona();
      return p ? p.name : 'default';
    }, 'default');

    const userState = safeCall(() => {
      const UE = require('./user-empathy');
      const ue = new UE(this.refs);
      const s = ue.getUserState();
      return s.mood || s.estimatedState || 'unknown';
    }, 'unknown');

    return {
      persona,
      userState,
      participants: ctx.participants || ['user', 'aries'],
      userContext: ctx.userContext || null,
    };
  }

  _buildWhat(ctx) {
    return {
      task: ctx.task || ctx.topic || 'general conversation',
      topic: ctx.topic || null,
      history: ctx.history || [],
      recentMessages: ctx.recentMessages || 0,
    };
  }

  _buildWhen(ctx) {
    const now = new Date();
    const rhythm = safeCall(() => {
      const CR = require('./cognitive-rhythms');
      const cr = new CR(this.refs);
      return cr.getCurrentRhythm();
    }, { mode: 'BALANCED' });

    return {
      time: now.toISOString(),
      hour: now.getHours(),
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
      urgency: ctx.urgency || 'normal',
      rhythm: rhythm.mode || 'BALANCED',
      timeOfDay: now.getHours() < 6 ? 'night' : now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening',
    };
  }

  _buildWhere(ctx) {
    return {
      platform: ctx.platform || 'web',
      environment: ctx.environment || 'workspace',
      channel: ctx.channel || 'direct',
    };
  }

  _buildWhy(ctx) {
    const drive = safeCall(() => {
      const BG = require('./behavioral-genetics');
      const bg = new BG(this.refs);
      const genome = bg.getGenome();
      if (genome && genome.genes) {
        const top = Object.entries(genome.genes).sort((a, b) => (b[1].value || 0) - (a[1].value || 0));
        return top[0] ? top[0][0] : 'exploration';
      }
      return 'exploration';
    }, 'exploration');

    return {
      drive,
      motivations: ctx.motivations || ['help user', 'learn', 'grow'],
      goals: ctx.goals || [],
      userIntent: ctx.userIntent || null,
    };
  }

  _buildHow(ctx) {
    return {
      constraints: ctx.constraints || [],
      tools: ctx.tools || ['chat', 'code', 'search', 'files'],
      approach: ctx.approach || 'adaptive',
    };
  }

  _deriveMood(ctx) {
    const emotion = safeCall(() => {
      const EE = require('./emotional-engine');
      const ee = new EE();
      const s = ee.getState();
      return { primary: s.currentEmotion || 'neutral', intensity: s.intensity || 30 };
    }, { primary: 'neutral', intensity: 30 });

    if (emotion.intensity > 70) return 'intense';
    if (emotion.primary === 'frustration') return 'tense';
    if (emotion.primary === 'curiosity') return 'exploratory';
    if (emotion.primary === 'joy' || emotion.primary === 'satisfaction') return 'playful';
    if (ctx.urgency === 'high') return 'urgent';
    return 'calm';
  }

  _deriveStakes(ctx) {
    if (ctx.stakes) return ctx.stakes;
    const task = (ctx.task || '').toLowerCase();
    if (task.includes('deploy') || task.includes('production') || task.includes('delete') || task.includes('security')) return 'high';
    if (task.includes('build') || task.includes('fix') || task.includes('debug')) return 'medium';
    return 'low';
  }

  _deriveComplexity(ctx) {
    if (ctx.complexity) return ctx.complexity;
    const task = (ctx.task || '');
    const words = task.split(/\s+/).length;
    if (words > 50) return 8;
    if (words > 20) return 6;
    if (words > 10) return 4;
    return 3;
  }

  _writeNarrative(scene) {
    const timeStr = scene.when.timeOfDay;
    const persona = scene.who.persona;
    const task = scene.what.task;
    const mood = scene.mood;
    const stakes = scene.stakes;

    return `It's ${timeStr}. ${persona} takes the stage. The scene: ${task}. ` +
      `The mood is ${mood}, stakes are ${stakes}. ` +
      `${scene.who.participants.length} participants, complexity ${scene.complexity}/10. ` +
      (stakes === 'high' ? 'Every word matters here.' :
       stakes === 'low' ? 'A relaxed exchange, room to breathe.' :
       'A typical scene — attentive but not anxious.');
  }
}

module.exports = ContextTheater;
