/**
 * ARIES — Controlled Chaos
 * Intentional disorder to build antifragility.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'chaos');
const EXPERIMENTS_PATH = path.join(DATA_DIR, 'experiments.json');
const VULNS_PATH = path.join(DATA_DIR, 'vulnerabilities.json');

const EXPERIMENT_TYPES = ['DISABLE_MODULE', 'CORRUPT_INPUT', 'STRESS_TEST', 'AMNESIA', 'DELAY'];
const MODULES = [
  'emotion-engine', 'creativity-engine', 'self-model', 'agent-dreams',
  'inner-monologue', 'subconscious', 'genuine-uncertainty', 'knowledge-distiller',
  'cognitive-debt', 'narrative-identity', 'cognitive-weather', 'micro-experiments',
];

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

class ControlledChaos {
  constructor() { ensureDir(); }

  runExperiment(type) {
    type = type || pick(EXPERIMENT_TYPES);
    if (!EXPERIMENT_TYPES.includes(type)) return { error: 'Invalid type. Valid: ' + EXPERIMENT_TYPES.join(', ') };

    const target = pick(MODULES);
    const startedAt = Date.now();
    let impact = 'none';
    let recovery = 'auto';
    let lessons = '';
    let duration = 0;

    switch (type) {
      case 'DISABLE_MODULE': {
        // Simulate disabling - check if module file exists
        const modPath = path.join(__dirname, target + '.js');
        const exists = fs.existsSync(modPath);
        duration = 100 + Math.random() * 500;
        if (!exists) {
          impact = 'none';
          lessons = `Module ${target} not found — system unaffected. Dead reference?`;
        } else {
          // Simulate by trying to require and checking for graceful error handling
          try {
            const mod = require('./' + target);
            impact = 'minor';
            recovery = 'auto';
            lessons = `Module ${target} loaded successfully. Would need dependency tracking to test cascade effects.`;
          } catch (e) {
            impact = 'major';
            recovery = 'manual';
            lessons = `Module ${target} failed to load: ${e.message}. No graceful fallback.`;
          }
        }
        break;
      }
      case 'CORRUPT_INPUT': {
        duration = 50 + Math.random() * 200;
        const corruptInputs = [null, undefined, '', '{"broken json', 42, [], { evil: '<script>' }, NaN, Infinity];
        const testInput = pick(corruptInputs);
        try {
          JSON.parse(JSON.stringify(testInput));
          impact = 'none';
          lessons = `Input corruption (${JSON.stringify(testInput)}) handled by JSON serialization layer.`;
        } catch {
          impact = 'minor';
          lessons = `Input corruption caused serialization error. Needs input validation.`;
        }
        recovery = 'auto';
        break;
      }
      case 'STRESS_TEST': {
        const iterations = 1000;
        const start = Date.now();
        let failures = 0;
        for (let i = 0; i < iterations; i++) {
          try { JSON.parse(JSON.stringify({ i, data: 'x'.repeat(100) })); }
          catch { failures++; }
        }
        duration = Date.now() - start;
        impact = failures > 0 ? 'minor' : 'none';
        recovery = 'auto';
        lessons = `${iterations} rapid operations in ${duration}ms. ${failures} failures. ${duration > 1000 ? 'SLOW — potential bottleneck.' : 'Performance acceptable.'}`;
        break;
      }
      case 'AMNESIA': {
        // Simulate cache wipe by checking if data directories exist and can be recreated
        const testDir = path.join(DATA_DIR, 'amnesia-test-' + Date.now());
        try {
          fs.mkdirSync(testDir, { recursive: true });
          fs.writeFileSync(path.join(testDir, 'test.json'), '{"test":true}');
          const recovered = JSON.parse(fs.readFileSync(path.join(testDir, 'test.json'), 'utf8'));
          fs.unlinkSync(path.join(testDir, 'test.json'));
          fs.rmdirSync(testDir);
          impact = 'none';
          recovery = 'auto';
          lessons = 'Data directory creation and recovery works. File system resilient.';
          duration = 50;
        } catch (e) {
          impact = 'major';
          recovery = 'manual';
          lessons = `File system recovery failed: ${e.message}`;
          duration = 100;
        }
        break;
      }
      case 'DELAY': {
        duration = 200 + Math.random() * 800;
        impact = duration > 500 ? 'minor' : 'none';
        recovery = 'auto';
        lessons = `Simulated ${Math.round(duration)}ms latency. ${duration > 500 ? 'Would degrade UX. Consider async loading.' : 'Within acceptable range.'}`;
        break;
      }
    }

    const experiment = {
      id: uuid(),
      type,
      target,
      startedAt,
      duration: Math.round(duration),
      impact,
      recovery,
      lessons,
    };

    const experiments = readJSON(EXPERIMENTS_PATH, []);
    experiments.push(experiment);
    if (experiments.length > 500) experiments.splice(0, experiments.length - 500);
    writeJSON(EXPERIMENTS_PATH, experiments);

    // Track vulnerabilities
    if (impact === 'major' || impact === 'critical') {
      const vulns = readJSON(VULNS_PATH, []);
      vulns.push({ module: target, type, impact, lessons, detectedAt: Date.now() });
      writeJSON(VULNS_PATH, vulns);
    }

    return experiment;
  }

  getResults() {
    return readJSON(EXPERIMENTS_PATH, []).reverse();
  }

  getVulnerabilities() {
    return readJSON(VULNS_PATH, []);
  }

  getAntifragileScore() {
    const experiments = readJSON(EXPERIMENTS_PATH, []);
    if (experiments.length === 0) return { score: 50, message: 'No experiments run yet. Score is baseline.', experiments: 0 };

    const total = experiments.length;
    const noneCount = experiments.filter(e => e.impact === 'none').length;
    const minorCount = experiments.filter(e => e.impact === 'minor').length;
    const majorCount = experiments.filter(e => e.impact === 'major').length;
    const criticalCount = experiments.filter(e => e.impact === 'critical').length;
    const autoRecovery = experiments.filter(e => e.recovery === 'auto').length;

    const impactScore = Math.round(((noneCount * 1 + minorCount * 0.7 + majorCount * 0.2 + criticalCount * 0) / total) * 60);
    const recoveryScore = Math.round((autoRecovery / total) * 40);
    const score = Math.min(100, impactScore + recoveryScore);

    return {
      score,
      experiments: total,
      breakdown: { none: noneCount, minor: minorCount, major: majorCount, critical: criticalCount },
      autoRecoveryRate: Math.round(autoRecovery / total * 100),
      message: score >= 80 ? 'Highly resilient' : score >= 60 ? 'Moderately resilient' : score >= 40 ? 'Fragile — needs hardening' : 'Very fragile — critical vulnerabilities',
    };
  }

  getRecommendations() {
    const vulns = readJSON(VULNS_PATH, []);
    const experiments = readJSON(EXPERIMENTS_PATH, []);
    const recs = [];

    // Group vulnerabilities by module
    const byModule = {};
    for (const v of vulns) {
      if (!byModule[v.module]) byModule[v.module] = [];
      byModule[v.module].push(v);
    }

    for (const [mod, issues] of Object.entries(byModule)) {
      recs.push({
        module: mod,
        issues: issues.length,
        recommendation: `Module "${mod}" failed ${issues.length} chaos test(s). Add error handling and graceful degradation.`,
        priority: issues.length > 3 ? 'high' : issues.length > 1 ? 'medium' : 'low',
      });
    }

    // Check for untested modules
    const testedModules = new Set(experiments.map(e => e.target));
    const untested = MODULES.filter(m => !testedModules.has(m));
    if (untested.length > 0) {
      recs.push({
        module: 'system',
        issues: untested.length,
        recommendation: `${untested.length} modules never chaos-tested: ${untested.join(', ')}`,
        priority: 'medium',
      });
    }

    return recs;
  }
}

module.exports = ControlledChaos;
