/**
 * ARIES — Plugin Marketplace v1.0
 * 
 * Enhanced plugin system with marketplace, hot-reload, isolation,
 * dependency resolution, and full API endpoints.
 * 
 * Extends core/plugin-loader.js — does not replace it.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

const PLUGIN_DIR = path.join(__dirname, '..', 'plugins');
const DATA_DIR = path.join(__dirname, '..', 'data');
const PLUGIN_DATA_DIR = path.join(DATA_DIR, 'plugins');
const REGISTRY_FILE = path.join(DATA_DIR, 'plugin-registry.json');
const STATE_FILE = path.join(DATA_DIR, 'plugin-marketplace-state.json');

// Parse metadata from header comment block: /** @name Foo \n @version 1.0 ... */
function parseHeaderMeta(code) {
  const match = code.match(/\/\*\*([\s\S]*?)\*\//);
  if (!match) return null;
  const meta = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const m = line.match(/@(\w+)\s+(.*)/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim();
      if (key === 'requires') {
        meta.requires = val.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        meta[key] = val;
      }
    }
  }
  return meta.name ? meta : null;
}

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function saveJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function download(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Aries-PluginMarketplace/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

class PluginMarketplace extends EventEmitter {
  constructor() {
    super();
    this.plugins = new Map();       // name -> { meta, module, status, filePath, context }
    this.state = loadJson(STATE_FILE, { disabled: [] });
    this.watcher = null;
    this.pluginLoader = null;       // reference to existing plugin-loader
    this._debounceTimers = new Map();
  }

  // ── Lifecycle ──────────────────────────────────────────────

  start(app, pluginLoader) {
    this.pluginLoader = pluginLoader;
    ensureDir(PLUGIN_DIR);
    ensureDir(PLUGIN_DATA_DIR);
    this._ensureRegistry();
    this.loadAll();
    this._startWatcher();
    if (app) this._registerRoutes(app);
    console.log(`[MARKETPLACE] Started — ${this.plugins.size} plugins loaded`);
  }

  stop() {
    if (this.watcher) { this.watcher.close(); this.watcher = null; }
    for (const [, p] of this.plugins) {
      this._stopPlugin(p);
    }
    this.plugins.clear();
    console.log('[MARKETPLACE] Stopped');
  }

  // ── Load all plugins with dependency resolution ────────────

  loadAll() {
    const files = fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.js'));
    const metas = new Map();

    // Phase 1: discover & validate
    for (const file of files) {
      const filePath = path.join(PLUGIN_DIR, file);
      try {
        const code = fs.readFileSync(filePath, 'utf8');
        const headerMeta = parseHeaderMeta(code);

        // Temporarily load to get exports metadata
        delete require.cache[require.resolve(filePath)];
        const mod = require(filePath);

        const meta = {
          name: (mod.name || (headerMeta && headerMeta.name) || path.basename(file, '.js')),
          version: mod.version || (headerMeta && headerMeta.version) || '1.0.0',
          author: mod.author || (headerMeta && headerMeta.author) || 'unknown',
          description: mod.description || (headerMeta && headerMeta.description) || '',
          category: mod.category || (headerMeta && headerMeta.category) || 'general',
          requires: mod.requires || (headerMeta && headerMeta.requires) || [],
          routes: mod.routes || [],
          tabs: mod.tabs || [],
          commands: mod.commands || [],
        };

        metas.set(meta.name, { meta, mod, filePath, file });
      } catch (e) {
        console.error(`[MARKETPLACE] Discover failed ${file}: ${e.message}`);
      }
    }

    // Phase 2: topological sort by dependencies
    const order = this._resolveDeps(metas);

    // Phase 3: load & register & start
    for (const name of order) {
      const entry = metas.get(name);
      if (!entry) continue;
      if (this.state.disabled.includes(name)) {
        this.plugins.set(name, { meta: entry.meta, module: entry.mod, status: 'disabled', filePath: entry.filePath, context: null });
        continue;
      }
      this._activatePlugin(entry.meta, entry.mod, entry.filePath);
    }
  }

  _resolveDeps(metas) {
    const resolved = [];
    const seen = new Set();
    const visiting = new Set();

    const visit = (name) => {
      if (seen.has(name)) return;
      if (visiting.has(name)) { resolved.push(name); seen.add(name); return; } // circular — just load
      visiting.add(name);
      const entry = metas.get(name);
      if (entry) {
        for (const dep of entry.meta.requires) {
          visit(dep);
        }
      }
      seen.add(name);
      resolved.push(name);
    };

    for (const name of metas.keys()) visit(name);
    return resolved;
  }

  // ── Plugin activation / deactivation ───────────────────────

  _createContext(meta) {
    const dataDir = path.join(PLUGIN_DATA_DIR, meta.name);
    ensureDir(dataDir);
    return Object.freeze({
      name: meta.name,
      dataDir,
      log: (msg) => console.log(`[PLUGIN:${meta.name}] ${msg}`),
      config: this._getPluginConfig(meta.name),
      saveConfig: (cfg) => this._savePluginConfig(meta.name, cfg),
      getPlugin: (name) => {
        const p = this.plugins.get(name);
        // Isolation: only expose public API, not internals
        if (!p || p.status !== 'active') return null;
        return { name: p.meta.name, version: p.meta.version, status: p.status };
      },
    });
  }

  _activatePlugin(meta, mod, filePath) {
    const ctx = this._createContext(meta);
    const entry = { meta, module: mod, status: 'active', filePath, context: ctx };

    // Call init/start
    try {
      if (mod.init) mod.init(ctx);
      if (mod.start) mod.start(ctx);
    } catch (e) {
      console.error(`[MARKETPLACE] Start failed ${meta.name}: ${e.message}`);
      entry.status = 'error';
    }

    this.plugins.set(meta.name, entry);
    this.emit('plugin:loaded', meta.name);
  }

  _stopPlugin(entry) {
    if (!entry || entry.status !== 'active') return;
    try {
      if (entry.module.destroy) entry.module.destroy(entry.context);
      if (entry.module.stop) entry.module.stop(entry.context);
    } catch {}
    entry.status = 'stopped';
  }

  // ── Hot-reload via fs.watch ────────────────────────────────

  _startWatcher() {
    try {
      this.watcher = fs.watch(PLUGIN_DIR, (eventType, filename) => {
        if (!filename || !filename.endsWith('.js')) return;
        // Debounce
        if (this._debounceTimers.has(filename)) clearTimeout(this._debounceTimers.get(filename));
        this._debounceTimers.set(filename, setTimeout(() => {
          this._debounceTimers.delete(filename);
          this._handleFileChange(filename);
        }, 500));
      });
    } catch (e) {
      console.error(`[MARKETPLACE] Watcher failed: ${e.message}`);
    }
  }

  _handleFileChange(filename) {
    const filePath = path.join(PLUGIN_DIR, filename);
    const baseName = path.basename(filename, '.js');

    // Find existing plugin by file path
    let existingName = null;
    for (const [name, p] of this.plugins) {
      if (path.basename(p.filePath) === filename) { existingName = name; break; }
    }

    if (!fs.existsSync(filePath)) {
      // File deleted
      if (existingName) {
        this._stopPlugin(this.plugins.get(existingName));
        this.plugins.delete(existingName);
        console.log(`[MARKETPLACE] Unloaded deleted plugin: ${existingName}`);
        // Also reload in legacy loader
        if (this.pluginLoader) try { this.pluginLoader.reload(existingName); } catch {}
      }
      return;
    }

    // Reload
    try {
      const code = fs.readFileSync(filePath, 'utf8');
      const headerMeta = parseHeaderMeta(code);
      delete require.cache[require.resolve(filePath)];
      const mod = require(filePath);

      const meta = {
        name: mod.name || (headerMeta && headerMeta.name) || baseName,
        version: mod.version || (headerMeta && headerMeta.version) || '1.0.0',
        author: mod.author || (headerMeta && headerMeta.author) || 'unknown',
        description: mod.description || (headerMeta && headerMeta.description) || '',
        category: mod.category || (headerMeta && headerMeta.category) || 'general',
        requires: mod.requires || (headerMeta && headerMeta.requires) || [],
        routes: mod.routes || [],
        tabs: mod.tabs || [],
        commands: mod.commands || [],
      };

      // Stop old version
      if (existingName) this._stopPlugin(this.plugins.get(existingName));

      if (this.state.disabled.includes(meta.name)) {
        this.plugins.set(meta.name, { meta, module: mod, status: 'disabled', filePath, context: null });
      } else {
        this._activatePlugin(meta, mod, filePath);
      }

      console.log(`[MARKETPLACE] Hot-reloaded: ${meta.name}`);

      // Sync with legacy loader
      if (this.pluginLoader) try { this.pluginLoader.reload(meta.name); } catch {}
    } catch (e) {
      console.error(`[MARKETPLACE] Hot-reload failed ${filename}: ${e.message}`);
    }
  }

  // ── Plugin config ──────────────────────────────────────────

  _getPluginConfig(name) {
    const file = path.join(PLUGIN_DATA_DIR, name, 'config.json');
    return loadJson(file, {});
  }

  _savePluginConfig(name, config) {
    const file = path.join(PLUGIN_DATA_DIR, name, 'config.json');
    ensureDir(path.dirname(file));
    saveJson(file, config);
  }

  // ── Registry ───────────────────────────────────────────────

  _ensureRegistry() {
    if (!fs.existsSync(REGISTRY_FILE)) {
      saveJson(REGISTRY_FILE, {
        lastUpdated: new Date().toISOString(),
        plugins: [
          {
            name: 'example-plugin',
            version: '1.0.0',
            author: 'Aries',
            description: 'Example plugin template',
            category: 'utility',
            url: null,
            installed: true
          }
        ]
      });
    }
  }

  getRegistry() {
    return loadJson(REGISTRY_FILE, { plugins: [] });
  }

  // ── Install from URL or code ───────────────────────────────

  async installPlugin({ url, code, name }) {
    let pluginCode;

    if (url) {
      pluginCode = await download(url);
    } else if (code) {
      pluginCode = code;
    } else {
      throw new Error('Provide url or code');
    }

    // Validate: must be parseable JS
    try { new Function(pluginCode); } catch (e) {
      throw new Error(`Invalid JS: ${e.message}`);
    }

    // Extract name from code
    const headerMeta = parseHeaderMeta(pluginCode);
    const pluginName = name || (headerMeta && headerMeta.name) || `plugin-${Date.now()}`;
    const filename = pluginName.replace(/[^a-zA-Z0-9_-]/g, '-') + '.js';
    const filePath = path.join(PLUGIN_DIR, filename);

    fs.writeFileSync(filePath, pluginCode);
    console.log(`[MARKETPLACE] Installed ${pluginName} → ${filename}`);

    // Hot-reload watcher will pick it up, but also load immediately
    this._handleFileChange(filename);

    return { name: pluginName, file: filename };
  }

  // ── Enable / Disable ──────────────────────────────────────

  enablePlugin(name) {
    this.state.disabled = this.state.disabled.filter(n => n !== name);
    saveJson(STATE_FILE, this.state);

    const entry = this.plugins.get(name);
    if (entry && entry.status === 'disabled') {
      this._activatePlugin(entry.meta, entry.module, entry.filePath);
    }
    return true;
  }

  disablePlugin(name) {
    if (!this.state.disabled.includes(name)) this.state.disabled.push(name);
    saveJson(STATE_FILE, this.state);

    const entry = this.plugins.get(name);
    if (entry && entry.status === 'active') {
      this._stopPlugin(entry);
      entry.status = 'disabled';
    }
    return true;
  }

  // ── Delete ─────────────────────────────────────────────────

  deletePlugin(name) {
    const entry = this.plugins.get(name);
    if (!entry) return false;

    this._stopPlugin(entry);
    this.plugins.delete(name);

    // Remove file
    try { fs.unlinkSync(entry.filePath); } catch {}

    // Clean from disabled list
    this.state.disabled = this.state.disabled.filter(n => n !== name);
    saveJson(STATE_FILE, this.state);

    return true;
  }

  // ── Query methods ──────────────────────────────────────────

  listInstalled() {
    const list = [];
    for (const [name, p] of this.plugins) {
      list.push({
        name: p.meta.name,
        version: p.meta.version,
        author: p.meta.author,
        description: p.meta.description,
        category: p.meta.category,
        status: p.status,
        requires: p.meta.requires,
        routes: (p.meta.routes || []).map(r => ({ method: r.method, path: r.path })),
        tabs: (p.meta.tabs || []).map(t => t.name || t.id || 'tab'),
        commands: (p.meta.commands || []).map(c => c.name || c.command || c),
      });
    }
    return list;
  }

  getPluginRoutes() {
    const routes = [];
    for (const [, p] of this.plugins) {
      if (p.status !== 'active' || !p.meta.routes) continue;
      for (const r of p.meta.routes) {
        routes.push({ ...r, plugin: p.meta.name, handler: r.handler });
      }
    }
    return routes;
  }

  getPluginTabs() {
    const tabs = [];
    for (const [, p] of this.plugins) {
      if (p.status !== 'active' || !p.meta.tabs) continue;
      for (const t of p.meta.tabs) {
        tabs.push({ ...t, plugin: p.meta.name });
      }
    }
    return tabs;
  }

  getPluginCommands() {
    const commands = [];
    for (const [, p] of this.plugins) {
      if (p.status !== 'active' || !p.meta.commands) continue;
      for (const c of p.meta.commands) {
        commands.push({ ...c, plugin: p.meta.name });
      }
    }
    return commands;
  }

  /** Execute a chat command from a plugin */
  async executeCommand(commandName, args, context) {
    for (const [, p] of this.plugins) {
      if (p.status !== 'active' || !p.meta.commands) continue;
      const cmd = p.meta.commands.find(c => (c.name || c.command) === commandName);
      if (cmd && cmd.handler) {
        return await cmd.handler(args, p.context, context);
      }
    }
    return null;
  }

  /** Execute a swarm task handler from plugins */
  async executeTask(taskType, taskData) {
    for (const [, p] of this.plugins) {
      if (p.status !== 'active') continue;
      const mod = p.module;
      if (mod.taskHandlers && mod.taskHandlers[taskType]) {
        return await mod.taskHandlers[taskType](taskData, p.context);
      }
      if (mod.onTask) {
        const result = await mod.onTask({ type: taskType, ...taskData }, p.context);
        if (result) return result;
      }
    }
    return null;
  }

  // ── Express route registration ─────────────────────────────

  _registerRoutes(app) {
    // Management API endpoints
    app.get('/api/manage/plugins', (req, res) => {
      res.json({ success: true, plugins: this.listInstalled() });
    });

    app.get('/api/manage/plugins/registry', (req, res) => {
      res.json({ success: true, registry: this.getRegistry() });
    });

    app.post('/api/manage/plugins/install', async (req, res) => {
      try {
        const result = await this.installPlugin(req.body || {});
        res.json({ success: true, ...result });
      } catch (e) {
        res.status(400).json({ success: false, error: e.message });
      }
    });

    app.post('/api/manage/plugins/enable/:name', (req, res) => {
      const name = req.params.name;
      if (!this.plugins.has(name)) return res.status(404).json({ success: false, error: 'Not found' });
      this.enablePlugin(name);
      res.json({ success: true, name, status: 'enabled' });
    });

    app.post('/api/manage/plugins/disable/:name', (req, res) => {
      const name = req.params.name;
      if (!this.plugins.has(name)) return res.status(404).json({ success: false, error: 'Not found' });
      this.disablePlugin(name);
      res.json({ success: true, name, status: 'disabled' });
    });

    app.delete('/api/manage/plugins/:name', (req, res) => {
      const name = req.params.name;
      if (!this.deletePlugin(name)) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, name, status: 'deleted' });
    });

    app.get('/api/manage/plugins/:name/config', (req, res) => {
      const name = req.params.name;
      if (!this.plugins.has(name)) return res.status(404).json({ success: false, error: 'Not found' });
      res.json({ success: true, name, config: this._getPluginConfig(name) });
    });

    app.put('/api/manage/plugins/:name/config', (req, res) => {
      const name = req.params.name;
      if (!this.plugins.has(name)) return res.status(404).json({ success: false, error: 'Not found' });
      this._savePluginConfig(name, req.body || {});
      res.json({ success: true, name, config: req.body });
    });

    // Mount plugin-defined routes
    this._mountPluginRoutes(app);
  }

  _mountPluginRoutes(app) {
    for (const route of this.getPluginRoutes()) {
      const method = (route.method || 'get').toLowerCase();
      const routePath = route.path;
      if (app[method] && route.handler) {
        app[method](routePath, (req, res) => {
          try {
            const plugin = this.plugins.get(route.plugin);
            route.handler(req, res, plugin ? plugin.context : null);
          } catch (e) {
            res.status(500).json({ error: e.message });
          }
        });
      }
    }
  }
}

module.exports = PluginMarketplace;
