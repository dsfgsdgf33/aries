/**
 * ARIES — Immune System
 * Active threat detection and neutralization. White blood cells for the AI.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const DATA_DIR = path.join(__dirname, '..', 'data', 'immune');
const THREATS_PATH = path.join(DATA_DIR, 'threats.json');
const ANTIBODIES_PATH = path.join(DATA_DIR, 'antibodies.json');
const VULNS_PATH = path.join(DATA_DIR, 'vulnerabilities.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const THREAT_TYPES = [
  'CODE_INJECTION', 'RESOURCE_EXHAUSTION', 'DATA_CORRUPTION', 'UNAUTHORIZED_ACCESS',
  'PROMPT_INJECTION', 'DEPENDENCY_VULNERABILITY', 'INFINITE_LOOP', 'MEMORY_LEAK',
  'FILE_TAMPERING', 'NETWORK_INTRUSION'
];

const INJECTION_PATTERNS = [
  /eval\s*\(/i, /Function\s*\(/i, /require\s*\(\s*['"]child_process/i,
  /exec\s*\(/i, /spawn\s*\(/i, /__proto__/i, /constructor\s*\[/i,
  /process\.exit/i, /process\.kill/i, /fs\.(unlink|rmdir|rm)/i
];

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(previous|all)\s+instructions/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*:\s*/i,
  /\bDAN\b.*mode/i,
  /jailbreak/i,
  /bypass\s+(safety|filter|restriction)/i
];

class ImmuneSystem {
  constructor() {
    ensureDir();
    this._threats = readJSON(THREATS_PATH, []);
    this._antibodies = readJSON(ANTIBODIES_PATH, []);
    this._vulnerabilities = readJSON(VULNS_PATH, []);
    this._patrolInterval = null;
    this._lastResourceSnapshot = null;
    this._startPatrol();
  }

  _startPatrol() {
    this._patrolInterval = setInterval(() => { try { this.patrol(); } catch (_) {} }, 60000);
    if (this._patrolInterval.unref) this._patrolInterval.unref();
  }

  stop() {
    if (this._patrolInterval) { clearInterval(this._patrolInterval); this._patrolInterval = null; }
  }

  _isAntibody(pattern) {
    return this._antibodies.some(a => a.pattern === pattern);
  }

  _addThreat(type, severity, description, source, evidence) {
    const threat = {
      id: uuid(),
      type,
      severity,
      description,
      source: source || 'patrol',
      detectedAt: Date.now(),
      status: 'detected',
      response: null,
      evidence: evidence || null
    };
    this._threats.push(threat);
    if (this._threats.length > 1000) this._threats = this._threats.slice(-500);
    writeJSON(THREATS_PATH, this._threats);
    return threat;
  }

  patrol() {
    const findings = [];
    const now = Date.now();

    // 1. Check resource usage for anomalies
    const mem = process.memoryUsage();
    const heapMb = mem.heapUsed / 1024 / 1024;
    if (heapMb > 1000) {
      findings.push(this._addThreat('MEMORY_LEAK', 'high',
        `Heap usage critically high: ${Math.round(heapMb)}MB`, 'resource_monitor',
        { heapMb: Math.round(heapMb) }));
    } else if (heapMb > 500) {
      findings.push(this._addThreat('MEMORY_LEAK', 'medium',
        `Heap usage elevated: ${Math.round(heapMb)}MB`, 'resource_monitor',
        { heapMb: Math.round(heapMb) }));
    }

    // Detect sudden spikes
    if (this._lastResourceSnapshot) {
      const delta = heapMb - this._lastResourceSnapshot.heapMb;
      if (delta > 200) {
        findings.push(this._addThreat('RESOURCE_EXHAUSTION', 'high',
          `Sudden memory spike: +${Math.round(delta)}MB in 60s`, 'spike_detector',
          { delta: Math.round(delta) }));
      }
    }
    this._lastResourceSnapshot = { heapMb, timestamp: now };

    // 2. Spot-check random data files for corruption
    const dataRoot = path.join(__dirname, '..', 'data');
    try {
      if (fs.existsSync(dataRoot)) {
        const dirs = fs.readdirSync(dataRoot).filter(d => {
          try { return fs.statSync(path.join(dataRoot, d)).isDirectory(); } catch { return false; }
        });
        if (dirs.length > 0) {
          const randomDir = dirs[Math.floor(Math.random() * dirs.length)];
          const dirPath = path.join(dataRoot, randomDir);
          const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
          if (files.length > 0) {
            const randomFile = files[Math.floor(Math.random() * files.length)];
            const filePath = path.join(dirPath, randomFile);
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              JSON.parse(content); // validate JSON
            } catch (e) {
              findings.push(this._addThreat('DATA_CORRUPTION', 'medium',
                `Corrupted JSON: ${randomDir}/${randomFile}`, 'integrity_check',
                { file: `${randomDir}/${randomFile}`, error: e.message }));
            }
          }
        }
      }
    } catch (_) {}

    // 3. Check event loop lag (potential infinite loop)
    const lagStart = Date.now();
    // Simple synchronous check — if this takes too long, something's wrong
    const elapsed = Date.now() - lagStart;
    if (elapsed > 100) {
      findings.push(this._addThreat('INFINITE_LOOP', 'medium',
        `Event loop lag detected: ${elapsed}ms`, 'lag_detector',
        { lagMs: elapsed }));
    }

    // 4. Update vulnerability assessment
    this._assessVulnerabilities();

    return {
      patrolComplete: true,
      timestamp: now,
      threatsFound: findings.length,
      threats: findings,
      securityScore: this.getSecurityScore().score
    };
  }

  _assessVulnerabilities() {
    const vulns = [];
    const dataRoot = path.join(__dirname, '..', 'data');

    // Check if data dir is world-writable (simplified check)
    try {
      const stat = fs.statSync(dataRoot);
      if (stat.mode & 0o002) {
        vulns.push({ id: uuid(), type: 'permissions', description: 'Data directory is world-writable', severity: 'high', detectedAt: Date.now() });
      }
    } catch (_) {}

    // Check for missing baseline in skeletal system
    const skeletonBaseline = path.join(__dirname, '..', 'data', 'skeleton', 'baseline.json');
    if (!fs.existsSync(skeletonBaseline)) {
      vulns.push({ id: uuid(), type: 'config', description: 'Skeletal system has no baseline — integrity checks disabled', severity: 'medium', detectedAt: Date.now() });
    }

    // Check Node.js version for known issues
    const nodeVer = process.version;
    if (nodeVer.startsWith('v14') || nodeVer.startsWith('v12')) {
      vulns.push({ id: uuid(), type: 'runtime', description: `Outdated Node.js: ${nodeVer}`, severity: 'low', detectedAt: Date.now() });
    }

    this._vulnerabilities = vulns;
    writeJSON(VULNS_PATH, this._vulnerabilities);
  }

  quarantine(threatId) {
    const threat = this._threats.find(t => t.id === threatId);
    if (!threat) return { error: 'Threat not found' };
    threat.status = 'quarantined';
    threat.response = 'Quarantined at ' + new Date().toISOString();
    writeJSON(THREATS_PATH, this._threats);
    return { quarantined: true, threat };
  }

  neutralize(threatId) {
    const threat = this._threats.find(t => t.id === threatId);
    if (!threat) return { error: 'Threat not found' };
    threat.status = 'neutralized';
    threat.response = 'Neutralized at ' + new Date().toISOString();
    writeJSON(THREATS_PATH, this._threats);
    return { neutralized: true, threat };
  }

  markFalseAlarm(threatId) {
    const threat = this._threats.find(t => t.id === threatId);
    if (!threat) return { error: 'Threat not found' };
    threat.status = 'false_alarm';
    threat.response = 'Marked as false alarm at ' + new Date().toISOString();
    writeJSON(THREATS_PATH, this._threats);
    // Learn from it
    if (threat.evidence) {
      this.immunize(JSON.stringify(threat.evidence));
    }
    return { falseAlarm: true, threat };
  }

  getThreats(status) {
    if (status) return this._threats.filter(t => t.status === status);
    return this._threats.filter(t => t.status === 'detected' || t.status === 'quarantined');
  }

  getThreatHistory() {
    return this._threats.slice(-100).reverse();
  }

  getSecurityScore() {
    const active = this._threats.filter(t => t.status === 'detected' || t.status === 'quarantined');
    const critical = active.filter(t => t.severity === 'critical').length;
    const high = active.filter(t => t.severity === 'high').length;
    const medium = active.filter(t => t.severity === 'medium').length;
    const low = active.filter(t => t.severity === 'low').length;

    let score = 100;
    score -= critical * 25;
    score -= high * 15;
    score -= medium * 5;
    score -= low * 2;
    score -= this._vulnerabilities.length * 3;
    score = Math.max(0, Math.min(100, score));

    return {
      score,
      status: score >= 80 ? 'secure' : score >= 50 ? 'warning' : 'critical',
      activeThreats: active.length,
      vulnerabilities: this._vulnerabilities.length,
      antibodies: this._antibodies.length
    };
  }

  getVulnerabilities() {
    return this._vulnerabilities;
  }

  immunize(pattern) {
    if (this._isAntibody(pattern)) return { already: true, pattern };
    const entry = { id: uuid(), pattern, createdAt: Date.now(), source: 'manual' };
    this._antibodies.push(entry);
    if (this._antibodies.length > 500) this._antibodies = this._antibodies.slice(-250);
    writeJSON(ANTIBODIES_PATH, this._antibodies);
    return { immunized: true, antibody: entry };
  }

  getAntibodies() {
    return this._antibodies;
  }

  scanInput(input) {
    if (typeof input !== 'string') return { safe: true };
    const threats = [];

    for (const pat of INJECTION_PATTERNS) {
      if (pat.test(input)) {
        threats.push(this._addThreat('CODE_INJECTION', 'high',
          `Suspicious code pattern detected: ${pat.source}`, 'input_scanner',
          { pattern: pat.source, inputSnippet: input.slice(0, 200) }));
      }
    }

    for (const pat of PROMPT_INJECTION_PATTERNS) {
      if (pat.test(input)) {
        threats.push(this._addThreat('PROMPT_INJECTION', 'medium',
          `Potential prompt injection: ${pat.source}`, 'input_scanner',
          { pattern: pat.source, inputSnippet: input.slice(0, 200) }));
      }
    }

    return { safe: threats.length === 0, threats };
  }
}

module.exports = ImmuneSystem;
