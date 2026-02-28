/**
 * ARIES — Hive Mind Mode
 * Shared consciousness for groups of agents during collaborative tasks.
 * Real-time shared memory with EventEmitter-based notifications.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const HIVE_DIR = path.join(__dirname, '..', 'data', 'hive-sessions');

function ensureDir() {
  if (!fs.existsSync(HIVE_DIR)) fs.mkdirSync(HIVE_DIR, { recursive: true });
}

class HiveSession extends EventEmitter {
  constructor(opts) {
    super();
    this.id = opts.id || crypto.randomBytes(8).toString('hex');
    this.agents = opts.agents || [];
    this.goal = opts.goal || '';
    this.status = 'active';
    this.sharedMemory = {};
    this.messageLog = [];
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  write(key, value, fromAgent) {
    this.sharedMemory[key] = { value, updatedBy: fromAgent || 'system', updatedAt: Date.now() };
    this.updatedAt = Date.now();
    const entry = { type: 'write', key, value, agent: fromAgent, timestamp: Date.now() };
    this.messageLog.push(entry);
    this.emit('memory-update', entry);
    this.emit('key:' + key, value, fromAgent);
    return entry;
  }

  read(key) {
    const item = this.sharedMemory[key];
    return item ? item.value : undefined;
  }

  getMemory() {
    return Object.fromEntries(
      Object.entries(this.sharedMemory).map(([k, v]) => [k, v.value])
    );
  }

  getFullMemory() {
    return this.sharedMemory;
  }

  broadcast(message, fromAgent) {
    const entry = { type: 'broadcast', message, agent: fromAgent, timestamp: Date.now() };
    this.messageLog.push(entry);
    this.updatedAt = Date.now();
    this.emit('broadcast', entry);
    return entry;
  }

  // Get context injection string for an agent about to respond
  getContextInjection() {
    const memKeys = Object.keys(this.sharedMemory);
    if (memKeys.length === 0 && this.messageLog.length === 0) return '';
    let ctx = '\n[HIVE MIND — Shared Consciousness]\nGoal: ' + this.goal + '\nAgents: ' + this.agents.join(', ') + '\n';
    if (memKeys.length > 0) {
      ctx += 'Shared Memory:\n';
      memKeys.forEach(k => {
        const v = this.sharedMemory[k];
        ctx += '  ' + k + ' = ' + JSON.stringify(v.value) + ' (by ' + v.updatedBy + ')\n';
      });
    }
    // Last 10 broadcasts
    const broadcasts = this.messageLog.filter(m => m.type === 'broadcast').slice(-10);
    if (broadcasts.length > 0) {
      ctx += 'Recent broadcasts:\n';
      broadcasts.forEach(b => { ctx += '  [' + b.agent + '] ' + b.message + '\n'; });
    }
    return ctx;
  }

  toJSON() {
    return {
      id: this.id,
      agents: this.agents,
      goal: this.goal,
      status: this.status,
      sharedMemory: this.sharedMemory,
      messageLog: this.messageLog.slice(-100),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  save() {
    ensureDir();
    fs.writeFileSync(path.join(HIVE_DIR, this.id + '.json'), JSON.stringify(this.toJSON(), null, 2));
  }
}

// HiveMind manager
class HiveMind {
  constructor() {
    this.sessions = new Map();
    this._loadExisting();
  }

  _loadExisting() {
    ensureDir();
    try {
      fs.readdirSync(HIVE_DIR).filter(f => f.endsWith('.json')).forEach(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(HIVE_DIR, f), 'utf8'));
          const session = new HiveSession(data);
          session.sharedMemory = data.sharedMemory || {};
          session.messageLog = data.messageLog || [];
          session.status = data.status || 'active';
          this.sessions.set(session.id, session);
        } catch {}
      });
    } catch {}
  }

  start(agents, goal) {
    const session = new HiveSession({ agents, goal });
    session.broadcast('Hive session started. Goal: ' + goal, 'system');
    this.sessions.set(session.id, session);
    session.save();
    return session;
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  write(id, key, value, fromAgent) {
    const session = this.sessions.get(id);
    if (!session) return null;
    const result = session.write(key, value, fromAgent);
    session.save();
    return result;
  }

  getMemory(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    return session.getFullMemory();
  }

  end(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.status = 'ended';
    session.broadcast('Hive session ended.', 'system');
    session.save();
    this.sessions.delete(id);
    return true;
  }

  listActive() {
    return Array.from(this.sessions.values())
      .filter(s => s.status === 'active')
      .map(s => s.toJSON());
  }

  // Get context injection for an agent in any active hive
  getContextForAgent(agentId) {
    for (const session of this.sessions.values()) {
      if (session.status === 'active' && session.agents.includes(agentId)) {
        return session.getContextInjection();
      }
    }
    return '';
  }
}

module.exports = HiveMind;
