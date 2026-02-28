/**
 * ARIES — Ghost Protocol
 * Minimal cognition during "off" state. Aries is never truly off.
 * Monitors file changes, runs micro-dreams, accumulates observations.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'ghost');
const LOG_PATH = path.join(DATA_DIR, 'log.json');
const BRIEFINGS_PATH = path.join(DATA_DIR, 'briefings.json');
const WORKSPACE = path.join(__dirname, '..');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const MICRO_DREAM_TYPES = [
  { type: 'associative', label: 'Free association', emoji: '🔗' },
  { type: 'creative', label: 'Creative spark', emoji: '🎨' },
  { type: 'worry', label: 'Anxiety check', emoji: '😰' },
  { type: 'memory', label: 'Memory fragment', emoji: '🧠' },
  { type: 'optimization', label: 'System optimization', emoji: '⚡' },
];

const CREATIVE_FRAGMENTS = [
  'What if the chat system could predict mood shifts before they happen?',
  'There might be a way to compress dream narratives into haiku...',
  'The pattern in recent errors suggests a deeper architectural issue.',
  'Could synesthesia mapping reveal hidden code quality patterns?',
  'What if modules could negotiate their own priority levels?',
  'The user\'s workflow has a rhythm — we should sync to it.',
  'Memory pruning could be guided by emotional weight, not just age.',
  'There\'s beauty in how the error handling cascades through layers.',
  'What if I could dream about the future state of the codebase?',
  'The gap between intention and implementation is where bugs live.',
];

class GhostProtocol {
  constructor() {
    ensureDir();
    this._state = {
      active: false,
      since: null,
      observations: [],
      microDreams: [],
      ideasGenerated: [],
      fileSnapshots: {}
    };
    this._perceptionTimer = null;
    this._dreamTimer = null;
  }

  /**
   * Enter ghost mode.
   */
  hibernate() {
    if (this._state.active) return { status: 'already_hibernating', since: this._state.since };

    this._state.active = true;
    this._state.since = Date.now();
    this._state.observations = [];
    this._state.microDreams = [];
    this._state.ideasGenerated = [];

    // Snapshot current file state
    this._state.fileSnapshots = this._snapshotFiles();

    // Start ghost tasks
    this._perceptionTimer = setInterval(() => this._lightPerception(), 5 * 60 * 1000);
    this._dreamTimer = setInterval(() => this._microDream(), 30 * 60 * 1000);

    // Run initial perception
    this._lightPerception();

    this._logEvent('hibernate', 'Entered ghost mode');
    return { status: 'hibernating', since: this._state.since };
  }

  /**
   * Light perception: detect file changes.
   */
  _lightPerception() {
    if (!this._state.active) return;

    const currentFiles = this._snapshotFiles();
    const changes = [];

    // Detect new/modified files
    for (const [file, mtime] of Object.entries(currentFiles)) {
      if (!this._state.fileSnapshots[file]) {
        changes.push({ file, type: 'created' });
      } else if (this._state.fileSnapshots[file] !== mtime) {
        changes.push({ file, type: 'modified' });
      }
    }

    // Detect deleted files
    for (const file of Object.keys(this._state.fileSnapshots)) {
      if (!currentFiles[file]) {
        changes.push({ file, type: 'deleted' });
      }
    }

    if (changes.length > 0) {
      this._state.observations.push({
        type: 'file_changes',
        changes,
        timestamp: Date.now()
      });
    }

    this._state.fileSnapshots = currentFiles;
  }

  /**
   * Micro dream cycle.
   */
  _microDream() {
    if (!this._state.active) return;

    const dreamType = MICRO_DREAM_TYPES[Math.floor(Math.random() * MICRO_DREAM_TYPES.length)];
    const fragment = CREATIVE_FRAGMENTS[Math.floor(Math.random() * CREATIVE_FRAGMENTS.length)];

    const dream = {
      ...dreamType,
      content: fragment,
      timestamp: Date.now()
    };

    this._state.microDreams.push(dream);

    // Sometimes generate an idea
    if (Math.random() > 0.6) {
      const idea = {
        content: fragment,
        source: dreamType.type,
        timestamp: Date.now()
      };
      this._state.ideasGenerated.push(idea);
    }
  }

  _snapshotFiles() {
    const snapshot = {};
    const dirs = [
      path.join(WORKSPACE, 'core'),
      path.join(WORKSPACE, 'web'),
      path.join(WORKSPACE, 'data')
    ];

    for (const dir of dirs) {
      try {
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isFile()) {
              const relPath = path.relative(WORKSPACE, fullPath);
              snapshot[relPath] = stat.mtimeMs;
            }
          } catch {}
        }
      } catch {}
    }
    return snapshot;
  }

  _logEvent(type, message) {
    const log = readJSON(LOG_PATH, { entries: [] });
    log.entries.push({ type, message, timestamp: Date.now() });
    if (log.entries.length > 1000) log.entries = log.entries.slice(-1000);
    writeJSON(LOG_PATH, log);
  }

  /**
   * Exit ghost mode and compile briefing.
   */
  wake() {
    if (!this._state.active) return { status: 'already_awake' };

    // Clear timers
    if (this._perceptionTimer) { clearInterval(this._perceptionTimer); this._perceptionTimer = null; }
    if (this._dreamTimer) { clearInterval(this._dreamTimer); this._dreamTimer = null; }

    // Run final perception
    this._lightPerception();

    const duration = Date.now() - this._state.since;
    const briefing = this._compileBriefing(duration);

    // Store briefing
    const briefings = readJSON(BRIEFINGS_PATH, { entries: [] });
    briefings.entries.push(briefing);
    if (briefings.entries.length > 100) briefings.entries = briefings.entries.slice(-100);
    writeJSON(BRIEFINGS_PATH, briefings);

    this._logEvent('wake', `Woke after ${Math.round(duration / 60000)} minutes`);

    this._state.active = false;
    this._state.since = null;

    return { status: 'awake', briefing };
  }

  _compileBriefing(duration) {
    const totalChanges = this._state.observations.reduce((sum, o) => sum + (o.changes ? o.changes.length : 0), 0);
    const dreamCount = this._state.microDreams.length;
    const ideaCount = this._state.ideasGenerated.length;

    const parts = [];
    if (totalChanges > 0) parts.push(`${totalChanges} file${totalChanges !== 1 ? 's' : ''} changed`);
    if (dreamCount > 0) parts.push(`${dreamCount} micro-dream${dreamCount !== 1 ? 's' : ''}`);
    if (ideaCount > 0) parts.push(`${ideaCount} idea${ideaCount !== 1 ? 's' : ''} generated`);

    const summary = parts.length > 0
      ? `While you were gone (${Math.round(duration / 60000)}min): ${parts.join(', ')}.`
      : `While you were gone (${Math.round(duration / 60000)}min): All quiet. Nothing changed.`;

    return {
      summary,
      duration,
      fileChanges: this._state.observations.filter(o => o.type === 'file_changes').flatMap(o => o.changes),
      microDreams: this._state.microDreams,
      ideas: this._state.ideasGenerated,
      timestamp: Date.now()
    };
  }

  /**
   * Get ghost log.
   */
  getGhostLog() {
    const log = readJSON(LOG_PATH, { entries: [] });
    return { entries: log.entries.slice(-50) };
  }

  /**
   * Get latest briefing.
   */
  getBriefing() {
    const briefings = readJSON(BRIEFINGS_PATH, { entries: [] });
    if (briefings.entries.length === 0) return { briefing: null, message: 'No briefings yet — ghost mode has not been used.' };
    return { briefing: briefings.entries[briefings.entries.length - 1] };
  }

  /**
   * Am I in ghost mode?
   */
  isGhost() {
    return { active: this._state.active, since: this._state.since };
  }

  /**
   * Ghost stats.
   */
  getGhostStats() {
    const briefings = readJSON(BRIEFINGS_PATH, { entries: [] });
    const totalGhostTime = briefings.entries.reduce((s, b) => s + (b.duration || 0), 0);
    const totalObservations = briefings.entries.reduce((s, b) => s + (b.fileChanges ? b.fileChanges.length : 0), 0);
    const totalIdeas = briefings.entries.reduce((s, b) => s + (b.ideas ? b.ideas.length : 0), 0);
    const totalDreams = briefings.entries.reduce((s, b) => s + (b.microDreams ? b.microDreams.length : 0), 0);

    return {
      active: this._state.active,
      since: this._state.since,
      currentSession: this._state.active ? {
        observations: this._state.observations.length,
        microDreams: this._state.microDreams.length,
        ideas: this._state.ideasGenerated.length,
        duration: this._state.since ? Date.now() - this._state.since : 0
      } : null,
      lifetime: {
        sessions: briefings.entries.length,
        totalGhostTimeMs: totalGhostTime,
        totalGhostTimeHuman: this._humanDuration(totalGhostTime),
        totalObservations,
        totalIdeas,
        totalDreams
      }
    };
  }

  _humanDuration(ms) {
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  /**
   * Get full status for API.
   */
  getStatus() {
    return {
      ...this.isGhost(),
      stats: this.getGhostStats(),
      latestBriefing: this.getBriefing().briefing
    };
  }
}

module.exports = GhostProtocol;
