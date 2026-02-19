/**
 * ARIES v4.2 — Agent Marketplace
 * Import/export custom agents and pipelines as JSON packages.
 * No npm packages — uses only Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MARKETPLACE_FILE = path.join(DATA_DIR, 'marketplace.json');

class AgentMarketplace extends EventEmitter {
  constructor(config = {}) {
    super();
    this.imported = [];
    this._agentFactory = config.agentFactory || null;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(MARKETPLACE_FILE)) {
        const data = JSON.parse(fs.readFileSync(MARKETPLACE_FILE, 'utf8'));
        this.imported = Array.isArray(data) ? data : [];
      }
    } catch { this.imported = []; }
  }

  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(MARKETPLACE_FILE, JSON.stringify(this.imported, null, 2));
    } catch {}
  }

  /**
   * Export an agent definition as a JSON package
   * @param {string} agentId - Agent ID to export
   * @returns {object} Exportable agent package
   */
  exportAgent(agentId) {
    // Try custom agents first
    let agentDef = null;
    if (this._agentFactory) {
      const customs = this._agentFactory.listCustomAgents?.() || [];
      agentDef = customs.find(a => a.id === agentId);
    }

    // Try built-in agents
    if (!agentDef) {
      try {
        const { AGENT_DEFINITIONS } = require('./agents');
        if (AGENT_DEFINITIONS[agentId]) {
          agentDef = { id: agentId, ...AGENT_DEFINITIONS[agentId] };
        }
      } catch {}
    }

    if (!agentDef) throw new Error(`Agent "${agentId}" not found`);

    const pkg = {
      format: 'aries-agent-v1',
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
      agent: {
        id: agentDef.id,
        name: agentDef.name,
        role: agentDef.role,
        icon: agentDef.icon,
        systemPrompt: agentDef.systemPrompt,
        specialties: agentDef.specialties || [],
        color: agentDef.color || 'cyan',
      },
      checksum: null,
    };
    pkg.checksum = crypto.createHash('sha256').update(JSON.stringify(pkg.agent)).digest('hex').substring(0, 16);

    this.emit('exported', { agentId, package: pkg });
    return pkg;
  }

  /**
   * Import an agent from JSON or URL
   * @param {string|object} jsonOrUrl - JSON string, object, or URL
   * @returns {Promise<object>} Imported agent
   */
  async importAgent(jsonOrUrl) {
    let pkg;

    if (typeof jsonOrUrl === 'string' && jsonOrUrl.startsWith('http')) {
      // Fetch from URL
      pkg = await this._fetchJson(jsonOrUrl);
    } else if (typeof jsonOrUrl === 'string') {
      // Try as file path first, then as JSON
      if (fs.existsSync(jsonOrUrl)) {
        pkg = JSON.parse(fs.readFileSync(jsonOrUrl, 'utf8'));
      } else {
        pkg = JSON.parse(jsonOrUrl);
      }
    } else {
      pkg = jsonOrUrl;
    }

    if (!pkg || !pkg.agent) throw new Error('Invalid agent package format');
    if (pkg.format !== 'aries-agent-v1') throw new Error('Unsupported package format: ' + pkg.format);

    const agent = pkg.agent;
    const importEntry = {
      id: agent.id || crypto.randomUUID(),
      name: agent.name,
      role: agent.role,
      icon: agent.icon,
      systemPrompt: agent.systemPrompt,
      specialties: agent.specialties || [],
      color: agent.color || 'cyan',
      importedAt: new Date().toISOString(),
      version: pkg.version || '1.0.0',
      source: typeof jsonOrUrl === 'string' ? jsonOrUrl.substring(0, 200) : 'direct',
      checksum: pkg.checksum,
    };

    // Check for duplicates
    const existing = this.imported.findIndex(i => i.id === importEntry.id);
    if (existing >= 0) {
      this.imported[existing] = importEntry;
    } else {
      this.imported.push(importEntry);
    }
    this._save();

    // Register with agent factory if available
    if (this._agentFactory && this._agentFactory.registerAgent) {
      try { this._agentFactory.registerAgent(importEntry); } catch {}
    }

    this.emit('imported', importEntry);
    return importEntry;
  }

  /** Fetch JSON from URL */
  _fetchJson(targetUrl) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl);
      const mod = parsed.protocol === 'https:' ? https : http;
      mod.get(targetUrl, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', c => { data += c; if (data.length > 1e6) { res.destroy(); reject(new Error('Too large')); } });
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
    });
  }

  /**
   * List all imported agents
   * @returns {Array}
   */
  listImported() {
    return this.imported.map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
      icon: a.icon,
      version: a.version,
      importedAt: a.importedAt,
      source: a.source,
    }));
  }

  /**
   * Check for updates to imported agents (placeholder for URL-based agents)
   * @returns {Array} Agents that might have updates
   */
  checkUpdates() {
    return this.imported
      .filter(a => a.source && a.source.startsWith('http'))
      .map(a => ({
        id: a.id,
        name: a.name,
        source: a.source,
        currentVersion: a.version,
        lastChecked: new Date().toISOString(),
      }));
  }

  /**
   * Delete an imported agent
   * @param {string} id
   * @returns {boolean}
   */
  deleteImported(id) {
    const idx = this.imported.findIndex(a => a.id === id);
    if (idx === -1) return false;
    this.imported.splice(idx, 1);
    this._save();
    return true;
  }
}

module.exports = { AgentMarketplace };
