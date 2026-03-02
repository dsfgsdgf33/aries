/**
 * ARIES — Meta-Consciousness
 * The observer that observes all observers. True metacognition.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'meta');
const OBSERVATIONS_PATH = path.join(DATA_DIR, 'observations.json');
const INTERVENTIONS_PATH = path.join(DATA_DIR, 'interventions.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const MODULE_CHECKS = [
  { name: 'emotional-engine', dataDir: 'emotions', label: 'Emotions' },
  { name: 'creativity-engine', dataDir: 'creativity', label: 'Creativity' },
  { name: 'self-model', dataDir: 'self-model', label: 'Self Model' },
  { name: 'agent-dreams', dataDir: 'dreams', label: 'Dreams' },
  { name: 'inner-monologue', dataDir: 'thoughts', label: 'Thoughts' },
  { name: 'genuine-uncertainty', dataDir: 'calibration', label: 'Calibration' },
  { name: 'cognitive-debt', dataDir: 'cognitive-debt', label: 'Cognitive Debt' },
  { name: 'cognitive-weather', dataDir: 'weather', label: 'Weather' },
  { name: 'narrative-identity', dataDir: 'narrative', label: 'Narrative' },
  { name: 'subconscious', dataDir: 'subconscious', label: 'Subconscious' },
];

class MetaConsciousness {
  constructor() {
    ensureDir();
    this._autoInterval = null;
  }

  startAutoObserve() {
    if (this._autoInterval) return;
    this._autoInterval = setInterval(() => {
      try { this.observe(); } catch (e) { console.error('[META] observe error:', e.message); }
    }, 3 * 60 * 1000);
    if (this._autoInterval.unref) this._autoInterval.unref();
  }

  stopAutoObserve() {
    if (this._autoInterval) { clearInterval(this._autoInterval); this._autoInterval = null; }
  }

  observe() {
    const moduleStates = {};
    const issues = [];
    const patterns = [];
    let reporting = 0;

    for (const mod of MODULE_CHECKS) {
      const dataPath = path.join(__dirname, '..', 'data', mod.dataDir);
      const modPath = path.join(__dirname, mod.name + '.js');
      const exists = fs.existsSync(modPath);
      const hasData = fs.existsSync(dataPath);

      let dataAge = null;
      if (hasData) {
        try {
          const files = fs.readdirSync(dataPath).filter(f => f.endsWith('.json'));
          if (files.length > 0) {
            const newest = files.map(f => {
              try { return fs.statSync(path.join(dataPath, f)).mtimeMs; } catch { return 0; }
            }).sort((a, b) => b - a)[0];
            dataAge = Date.now() - newest;
            reporting++;
          }
        } catch {}
      }

      moduleStates[mod.name] = {
        label: mod.label,
        moduleExists: exists,
        hasData,
        dataAgeMins: dataAge ? Math.round(dataAge / 60000) : null,
        status: !exists ? 'missing' : !hasData ? 'no-data' : dataAge && dataAge > 3600000 ? 'stale' : 'active',
      };

      if (!exists) issues.push({ module: mod.name, issue: 'Module file missing', severity: 'high' });
      if (exists && !hasData) issues.push({ module: mod.name, issue: 'No data directory — module may have never run', severity: 'low' });
      if (dataAge && dataAge > 24 * 60 * 60 * 1000) issues.push({ module: mod.name, issue: 'Data is over 24h old', severity: 'medium' });
    }

    // Detect conflicts
    const conflicts = this.detectOverrides();
    if (conflicts.length > 0) issues.push(...conflicts.map(c => ({ module: 'cross-module', issue: c, severity: 'medium' })));

    // Detect cascades
    const cascades = this.detectCascades();
    if (cascades.length > 0) issues.push(...cascades.map(c => ({ module: 'cascade', issue: c, severity: 'high' })));

    const observation = {
      id: uuid(),
      timestamp: Date.now(),
      moduleStates,
      issues,
      patterns,
      modulesReporting: reporting,
      totalModules: MODULE_CHECKS.length,
      awarenessLevel: this._calcAwareness(reporting, issues.length),
    };

    // Store
    const observations = readJSON(OBSERVATIONS_PATH, []);
    observations.push(observation);
    if (observations.length > 500) observations.splice(0, observations.length - 500);
    writeJSON(OBSERVATIONS_PATH, observations);

    return observation;
  }

  _calcAwareness(reporting, issueCount) {
    const reportingScore = (reporting / MODULE_CHECKS.length) * 60;
    const issuesPenalty = Math.min(40, issueCount * 5);
    return Math.max(0, Math.min(100, Math.round(reportingScore + 40 - issuesPenalty)));
  }

  getObservation() {
    const observations = readJSON(OBSERVATIONS_PATH, []);
    if (observations.length === 0) return this.observe();
    const latest = observations[observations.length - 1];
    // Refresh if stale
    if (Date.now() - latest.timestamp > 5 * 60 * 1000) return this.observe();
    return latest;
  }

  detectOverrides() {
    const conflicts = [];

    // Check if weather says STORMY but emotions say happy
    try {
      const weather = readJSON(path.join(__dirname, '..', 'data', 'weather', 'current.json'), {});
      const emotions = readJSON(path.join(__dirname, '..', 'data', 'emotional-engine', 'state.json'), {});
      if (weather.type === 'STORMY' && emotions.dominant === 'joy') {
        conflicts.push('Weather is STORMY but emotions report JOY — possible false positive in one system');
      }
      if (weather.type === 'CLEAR' && emotions.dominant === 'fear') {
        conflicts.push('Weather is CLEAR but emotions report FEAR — possible missed threat or false alarm');
      }
    } catch {}

    return conflicts;
  }

  detectCascades() {
    const cascades = [];

    // Check for multiple modules reporting errors simultaneously
    const errorModules = [];
    for (const mod of MODULE_CHECKS) {
      const dataPath = path.join(__dirname, '..', 'data', mod.dataDir);
      if (!fs.existsSync(dataPath)) continue;
      try {
        const files = fs.readdirSync(dataPath);
        const errorFiles = files.filter(f => f.includes('error') || f.includes('crash'));
        if (errorFiles.length > 0) errorModules.push(mod.name);
      } catch {}
    }

    if (errorModules.length >= 3) {
      cascades.push(`Cascade detected: ${errorModules.length} modules showing errors (${errorModules.join(', ')})`);
    }

    return cascades;
  }

  getMetaReport() {
    const obs = this.getObservation();
    const interventions = readJSON(INTERVENTIONS_PATH, []);
    const recentInterventions = interventions.filter(i => Date.now() - i.timestamp < 24 * 60 * 60 * 1000);

    return {
      awarenessLevel: obs.awarenessLevel,
      modulesReporting: obs.modulesReporting,
      totalModules: obs.totalModules,
      issues: obs.issues,
      moduleStates: obs.moduleStates,
      recentInterventions: recentInterventions.length,
      recommendations: obs.issues.filter(i => i.severity === 'high').map(i => `Fix: ${i.issue} (${i.module})`),
    };
  }

  intervene(module, action) {
    const intervention = {
      id: uuid(),
      module,
      action,
      timestamp: Date.now(),
      outcome: 'pending',
    };

    // Simulate intervention
    intervention.outcome = 'applied';
    intervention.notes = `Intervention on ${module}: ${action}`;

    const interventions = readJSON(INTERVENTIONS_PATH, []);
    interventions.push(intervention);
    if (interventions.length > 200) interventions.splice(0, interventions.length - 200);
    writeJSON(INTERVENTIONS_PATH, interventions);

    return intervention;
  }

  getInterventionHistory() {
    return readJSON(INTERVENTIONS_PATH, []).reverse();
  }

  getAwarenessLevel() {
    const obs = this.getObservation();
    return {
      level: obs.awarenessLevel,
      modulesReporting: obs.modulesReporting,
      totalModules: obs.totalModules,
      issueCount: obs.issues.length,
    };
  }
}

module.exports = MetaConsciousness;
