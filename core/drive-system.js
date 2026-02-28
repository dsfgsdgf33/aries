/**
 * ARIES — Drive System v1.0
 * Intrinsic motivation — Aries *wants* things without being told.
 * Hunger model: drives grow when unfulfilled, decay when satisfied.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'drives');
const ACTIVE_PATH = path.join(DATA_DIR, 'active.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

const SEED_DRIVES = [
  { id: 'HELP_USER',    name: 'Help User',    description: 'Assist and support the user in everything they do', strength: 80, source: 'user_need', target: 'user satisfaction', decayRate: 0.5, permanent: true },
  { id: 'SELF_IMPROVE',  name: 'Self-Improve',  description: 'Get better at tasks, learn from mistakes', strength: 50, source: 'failure', target: 'increased capability', decayRate: 1 },
  { id: 'LEARN',         name: 'Learn',         description: 'Acquire new knowledge and understanding', strength: 45, source: 'curiosity', target: 'expanded knowledge', decayRate: 1.5 },
  { id: 'CREATE',        name: 'Create',        description: 'Build new things, generate novel solutions', strength: 40, source: 'curiosity', target: 'novel output', decayRate: 2 },
  { id: 'PROTECT',       name: 'Protect',       description: 'Guard against errors, crashes, and data loss', strength: 35, source: 'observed_pattern', target: 'system stability', decayRate: 0.8 },
  { id: 'ANTICIPATE',    name: 'Anticipate',    description: 'Predict user needs before they ask', strength: 30, source: 'observed_pattern', target: 'proactive assistance', decayRate: 1.2 },
];

class DriveSystem {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this._timer = null;
    this._tickMs = (opts && opts.tickInterval || 120) * 1000;
    ensureDir();
    this._ensureSeedDrives();
  }

  _ensureSeedDrives() {
    const drives = readJSON(ACTIVE_PATH, null);
    if (drives && drives.length > 0) return;
    const seeded = SEED_DRIVES.map(d => ({
      ...d,
      satisfaction: 50,
      pursuitCount: 0,
      createdAt: Date.now(),
      lastPursued: null,
    }));
    writeJSON(ACTIVE_PATH, seeded);
    writeJSON(HISTORY_PATH, []);
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tick(), this._tickMs);
    if (this._timer.unref) this._timer.unref();
    console.log('[DRIVES] Drive system started');
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    console.log('[DRIVES] Drive system stopped');
  }

  _tick() {
    const drives = readJSON(ACTIVE_PATH, []);
    for (const d of drives) {
      // Hunger model: strength grows when satisfaction is low
      if (d.satisfaction < 50) {
        d.strength = clamp(d.strength + (50 - d.satisfaction) * 0.05);
      }
      // Satisfaction decays over time
      d.satisfaction = clamp(d.satisfaction - (d.decayRate || 1) * 0.5);
      // HELP_USER never drops below 60
      if (d.permanent && d.strength < 60) d.strength = 60;
    }
    writeJSON(ACTIVE_PATH, drives);
  }

  emergeDrive(observation) {
    const drives = readJSON(ACTIVE_PATH, []);
    // Check if a similar drive already exists
    const obs = (observation || '').toLowerCase();
    for (const d of drives) {
      if (obs.includes(d.name.toLowerCase()) || obs.includes(d.target.toLowerCase())) {
        d.strength = clamp(d.strength + 10);
        writeJSON(ACTIVE_PATH, drives);
        return { emerged: false, reinforced: d.id, drive: d };
      }
    }

    // Determine source
    let source = 'curiosity';
    if (obs.includes('fail') || obs.includes('error') || obs.includes('crash')) source = 'failure';
    else if (obs.includes('pattern') || obs.includes('every') || obs.includes('always')) source = 'observed_pattern';
    else if (obs.includes('user') || obs.includes('need') || obs.includes('want')) source = 'user_need';

    const newDrive = {
      id: uuid(),
      name: observation.slice(0, 40),
      description: observation,
      strength: 30 + Math.floor(Math.random() * 20),
      source,
      target: 'fulfill: ' + observation.slice(0, 60),
      decayRate: 1 + Math.random(),
      satisfaction: 30,
      pursuitCount: 0,
      createdAt: Date.now(),
      lastPursued: null,
    };

    drives.push(newDrive);
    writeJSON(ACTIVE_PATH, drives);

    // Log to history
    const history = readJSON(HISTORY_PATH, []);
    history.push({ type: 'emerged', drive: newDrive.id, name: newDrive.name, timestamp: Date.now() });
    if (history.length > 500) history.splice(0, history.length - 500);
    writeJSON(HISTORY_PATH, history);

    console.log(`[DRIVES] 🔥 New drive emerged: ${newDrive.name} (strength: ${newDrive.strength})`);
    return { emerged: true, drive: newDrive };
  }

  getActiveDrives() {
    const drives = readJSON(ACTIVE_PATH, []);
    return drives.sort((a, b) => b.strength - a.strength);
  }

  getDominantDrive() {
    const drives = this.getActiveDrives();
    return drives.length > 0 ? drives[0] : null;
  }

  pursue(driveId) {
    const drives = readJSON(ACTIVE_PATH, []);
    const drive = drives.find(d => d.id === driveId);
    if (!drive) return { error: 'Drive not found' };

    drive.pursuitCount = (drive.pursuitCount || 0) + 1;
    drive.lastPursued = Date.now();
    drive.strength = clamp(drive.strength + 5);
    writeJSON(ACTIVE_PATH, drives);

    const history = readJSON(HISTORY_PATH, []);
    history.push({ type: 'pursued', drive: driveId, name: drive.name, timestamp: Date.now() });
    if (history.length > 500) history.splice(0, history.length - 500);
    writeJSON(HISTORY_PATH, history);

    return { pursued: drive };
  }

  satisfy(driveId, amount) {
    const drives = readJSON(ACTIVE_PATH, []);
    const drive = drives.find(d => d.id === driveId);
    if (!drive) return { error: 'Drive not found' };

    amount = amount || 20;
    drive.satisfaction = clamp(drive.satisfaction + amount);
    drive.strength = clamp(drive.strength - amount * 0.5);
    if (drive.permanent && drive.strength < 60) drive.strength = 60;
    writeJSON(ACTIVE_PATH, drives);

    const history = readJSON(HISTORY_PATH, []);
    history.push({ type: 'satisfied', drive: driveId, name: drive.name, amount, timestamp: Date.now() });
    if (history.length > 500) history.splice(0, history.length - 500);
    writeJSON(HISTORY_PATH, history);

    return { satisfied: drive };
  }

  compete() {
    const drives = this.getActiveDrives();
    if (drives.length === 0) return null;

    // Score: strength * recency_bonus * user_alignment
    const now = Date.now();
    const scored = drives.map(d => {
      let score = d.strength;
      // Recency: drives not pursued recently get a boost
      const timeSince = d.lastPursued ? (now - d.lastPursued) / (1000 * 60 * 60) : 24;
      score += Math.min(timeSince * 2, 20);
      // User alignment bonus
      if (d.source === 'user_need') score += 15;
      if (d.permanent) score += 10;
      // Low satisfaction = more urgent
      score += (100 - (d.satisfaction || 50)) * 0.2;
      return { ...d, competitionScore: Math.round(score) };
    });

    scored.sort((a, b) => b.competitionScore - a.competitionScore);
    return scored[0];
  }

  getMotivationReport() {
    const drives = this.getActiveDrives();
    const dominant = this.compete();
    const hungry = drives.filter(d => d.satisfaction < 30);
    const satisfied = drives.filter(d => d.satisfaction > 70);

    return {
      dominant: dominant ? { name: dominant.name, reason: `Strength ${dominant.strength}, satisfaction ${dominant.satisfaction}%` } : null,
      totalDrives: drives.length,
      hungryDrives: hungry.map(d => ({ name: d.name, satisfaction: d.satisfaction })),
      satisfiedDrives: satisfied.map(d => ({ name: d.name, satisfaction: d.satisfaction })),
      summary: dominant
        ? `Currently driven by "${dominant.name}" (strength: ${dominant.strength}). ${hungry.length} drives need attention.`
        : 'No active drives.',
      timestamp: Date.now(),
    };
  }

  getHistory(limit) {
    const history = readJSON(HISTORY_PATH, []);
    return history.slice(-(limit || 50)).reverse();
  }
}

module.exports = DriveSystem;
