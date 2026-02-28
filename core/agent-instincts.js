/**
 * ARIES — Agent Instincts System
 * Pre-trained behavioral patterns that fire BEFORE AI reasoning.
 * Millisecond reactions injected into prompts before AI calls.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INSTINCTS_PATH = path.join(__dirname, '..', 'data', 'instincts.json');
const LOG_PATH = path.join(__dirname, '..', 'data', 'instinct-log.json');

// Built-in instincts
const BUILTIN_INSTINCTS = [
  {
    id: 'security_alert',
    name: 'Security Alert',
    trigger: 'password|secret|api.?key|token|credential',
    triggerFlags: 'i',
    action: '[SECURITY] Sensitive data detected. Handle with care.',
    priority: 9,
    agentId: '*',
    enabled: true,
    builtin: true
  },
  {
    id: 'production_safety',
    name: 'Production Safety',
    trigger: 'production|prod server|live system|deploy to prod',
    triggerFlags: 'i',
    action: '[CAUTION] Production environment detected. Double-check all actions.',
    priority: 8,
    agentId: '*',
    enabled: true,
    builtin: true
  },
  {
    id: 'error_detect',
    name: 'Error Detection',
    trigger: 'error|exception|crash|fatal|ENOENT|EACCES',
    triggerFlags: 'i',
    action: '[ERROR DETECTED] Prioritize diagnosis before proceeding.',
    priority: 7,
    agentId: '*',
    enabled: true,
    builtin: true
  },
  {
    id: 'cost_awareness',
    name: 'Cost Awareness',
    trigger: 'gpt-4|claude-opus|expensive',
    triggerFlags: 'i',
    action: '[COST] High-cost operation. Consider if a cheaper model suffices.',
    priority: 5,
    agentId: '*',
    enabled: true,
    builtin: true
  },
  {
    id: 'data_loss_prevent',
    name: 'Data Loss Prevention',
    trigger: 'delete|remove|drop|truncate|rm -rf',
    triggerFlags: 'i',
    action: '[WARNING] Destructive operation. Confirm before proceeding.',
    priority: 9,
    agentId: '*',
    enabled: true,
    builtin: true
  }
];

class InstinctEngine {
  constructor() {
    this.instincts = [];
    this.log = [];
    this._load();
  }

  _load() {
    // Load custom instincts
    try {
      if (fs.existsSync(INSTINCTS_PATH)) {
        const data = JSON.parse(fs.readFileSync(INSTINCTS_PATH, 'utf8'));
        this.instincts = data.instincts || [];
      }
    } catch {}

    // Merge builtins (don't duplicate)
    const existingIds = new Set(this.instincts.map(i => i.id));
    BUILTIN_INSTINCTS.forEach(bi => {
      if (!existingIds.has(bi.id)) this.instincts.push({ ...bi });
    });

    // Load log
    try {
      if (fs.existsSync(LOG_PATH)) {
        this.log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')).log || [];
        // Keep only last 1000 entries
        if (this.log.length > 1000) this.log = this.log.slice(-1000);
      }
    } catch {}
  }

  _save() {
    try {
      const dir = path.dirname(INSTINCTS_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(INSTINCTS_PATH, JSON.stringify({ instincts: this.instincts }, null, 2));
    } catch (e) { console.error('[INSTINCTS] Save error:', e.message); }
  }

  _saveLog() {
    try {
      const dir = path.dirname(LOG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(LOG_PATH, JSON.stringify({ log: this.log.slice(-1000) }, null, 2));
    } catch {}
  }

  // Run all instincts against input text. Returns array of triggered actions.
  process(input, agentId) {
    if (!input) return { actions: [], prefix: '' };
    const triggered = [];

    const sorted = this.instincts
      .filter(i => i.enabled !== false)
      .filter(i => i.agentId === '*' || i.agentId === agentId)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const instinct of sorted) {
      try {
        const re = new RegExp(instinct.trigger, instinct.triggerFlags || 'i');
        if (re.test(input)) {
          triggered.push(instinct);
          this.log.push({
            instinctId: instinct.id,
            instinctName: instinct.name,
            agentId: agentId || '*',
            timestamp: Date.now(),
            inputSnippet: input.substring(0, 80)
          });
        }
      } catch {}
    }

    if (triggered.length > 0) this._saveLog();

    const prefix = triggered.map(t => t.action).join('\n');
    return { actions: triggered, prefix };
  }

  // CRUD
  getAll() { return this.instincts; }

  add(instinct) {
    instinct.id = instinct.id || crypto.randomBytes(6).toString('hex');
    instinct.enabled = instinct.enabled !== false;
    instinct.builtin = false;
    instinct.createdAt = Date.now();
    this.instincts.push(instinct);
    this._save();
    return instinct;
  }

  update(id, updates) {
    const idx = this.instincts.findIndex(i => i.id === id);
    if (idx === -1) return null;
    Object.assign(this.instincts[idx], updates);
    this._save();
    return this.instincts[idx];
  }

  remove(id) {
    const idx = this.instincts.findIndex(i => i.id === id);
    if (idx === -1) return false;
    if (this.instincts[idx].builtin) return false; // Can't delete builtins
    this.instincts.splice(idx, 1);
    this._save();
    return true;
  }

  getLog() {
    // Aggregate fire counts
    const counts = {};
    this.log.forEach(entry => {
      counts[entry.instinctId] = (counts[entry.instinctId] || 0) + 1;
    });
    return { entries: this.log.slice(-100), counts, total: this.log.length };
  }
}

module.exports = InstinctEngine;
