'use strict';

/**
 * @module plugin-sandbox
 * @description Drop-in plugin system — users put .js files in plugins/ folder, auto-loaded on boot.
 * Provides sandboxed API, hot-reload via fs.watch, and full lifecycle management.
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const PLUGINS_DIR = path.join(__dirname, 'plugins');
const DATA_DIR = path.join(__dirname, 'data', 'plugins');

class PluginSandbox extends EventEmitter {
  constructor() {
    super();
    this._plugins = new Map(); // name -> { meta, module, status, loadedAt, filePath }
    this._watcher = null;
    this._loaded = false;
  }

  async init() {
    if (this._loaded) return;
    this._loaded = true;
    await fs.promises.mkdir(PLUGINS_DIR, { recursive: true }).catch(() => {});
    await fs.promises.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  }

  /**
   * Create a sandboxed API object for a plugin.
   */
  _createSandboxApi(pluginName) {
    const pluginDataDir = path.join(DATA_DIR, pluginName);
    const emitter = this;

    return {
      registerHand: (handDef) => {
        emitter.emit('plugin-register-hand', { plugin: pluginName, hand: handDef });
      },
      registerTool: (toolDef) => {
        emitter.emit('plugin-register-tool', { plugin: pluginName, tool: toolDef });
      },
      registerRoute: (method, path, handler) => {
        emitter.emit('plugin-register-route', { plugin: pluginName, method, path, handler });
      },
      onEvent: (event, handler) => {
        emitter.on(`plugin-event:${event}`, handler);
      },
      log: (...args) => {
        const msg = `[plugin:${pluginName}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
        emitter.emit('plugin-log', { plugin: pluginName, message: msg });
      },
      config: {
        get: async (key) => {
          try {
            const cfgFile = path.join(pluginDataDir, 'config.json');
            const raw = await fs.promises.readFile(cfgFile, 'utf8');
            const data = JSON.parse(raw);
            return key ? data[key] : data;
          } catch { return key ? undefined : {}; }
        },
        set: async (key, value) => {
          await fs.promises.mkdir(pluginDataDir, { recursive: true }).catch(() => {});
          const cfgFile = path.join(pluginDataDir, 'config.json');
          let data = {};
          try { data = JSON.parse(await fs.promises.readFile(cfgFile, 'utf8')); } catch {}
          data[key] = value;
          await fs.promises.writeFile(cfgFile, JSON.stringify(data, null, 2), 'utf8');
        },
      },
      dataDir: pluginDataDir,
      readData: async (filename) => {
        try {
          return await fs.promises.readFile(path.join(pluginDataDir, filename), 'utf8');
        } catch { return null; }
      },
      writeData: async (filename, content) => {
        await fs.promises.mkdir(pluginDataDir, { recursive: true }).catch(() => {});
        await fs.promises.writeFile(path.join(pluginDataDir, filename), content, 'utf8');
      },
    };
  }

  /**
   * Validate a plugin module has required exports.
   */
  _validate(mod, filePath) {
    const errors = [];
    if (!mod.name || typeof mod.name !== 'string') errors.push('missing or invalid "name" export');
    if (typeof mod.init !== 'function') errors.push('missing "init" function');
    if (typeof mod.destroy !== 'function') errors.push('missing "destroy" function');
    return errors;
  }

  /**
   * Load a single plugin by filename.
   */
  async load(nameOrFile) {
    await this.init();
    const fileName = nameOrFile.endsWith('.js') ? nameOrFile : `${nameOrFile}.js`;
    const filePath = path.join(PLUGINS_DIR, fileName);

    try {
      await fs.promises.access(filePath);
    } catch {
      throw new Error(`Plugin file not found: ${filePath}`);
    }

    // Clear require cache for hot reload
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];

    let mod;
    try {
      mod = require(filePath);
    } catch (err) {
      throw new Error(`Failed to require plugin ${fileName}: ${err.message}`);
    }

    const errors = this._validate(mod, filePath);
    if (errors.length > 0) {
      throw new Error(`Plugin validation failed for ${fileName}: ${errors.join(', ')}`);
    }

    // Unload existing version if loaded
    if (this._plugins.has(mod.name)) {
      await this.unload(mod.name);
    }

    const api = this._createSandboxApi(mod.name);

    try {
      await mod.init(api);
    } catch (err) {
      throw new Error(`Plugin init failed for ${mod.name}: ${err.message}`);
    }

    this._plugins.set(mod.name, {
      meta: { name: mod.name, version: mod.version || '0.0.0', description: mod.description || '' },
      module: mod,
      api,
      status: 'running',
      loadedAt: new Date().toISOString(),
      filePath,
    });

    this.emit('plugin-loaded', { name: mod.name, version: mod.version });
    return this._plugins.get(mod.name).meta;
  }

  /**
   * Unload a plugin by name.
   */
  async unload(name) {
    const plugin = this._plugins.get(name);
    if (!plugin) throw new Error(`Plugin not loaded: ${name}`);

    try {
      await plugin.module.destroy();
    } catch (err) {
      this.emit('plugin-error', { name, error: `destroy failed: ${err.message}` });
    }

    // Clear require cache
    try {
      const resolved = require.resolve(plugin.filePath);
      delete require.cache[resolved];
    } catch {}

    this._plugins.delete(name);
    this.emit('plugin-unloaded', { name });
    return true;
  }

  /**
   * Reload a plugin (unload + load).
   */
  async reload(name) {
    const plugin = this._plugins.get(name);
    if (!plugin) throw new Error(`Plugin not loaded: ${name}`);
    const filePath = plugin.filePath;
    const fileName = path.basename(filePath);
    await this.unload(name);
    return this.load(fileName);
  }

  /**
   * Load all plugins from the plugins/ directory.
   */
  async loadAll() {
    await this.init();
    const results = { loaded: [], errors: [] };

    let files;
    try {
      files = await fs.promises.readdir(PLUGINS_DIR);
    } catch {
      return results;
    }

    const jsFiles = files.filter(f => f.endsWith('.js'));
    for (const file of jsFiles) {
      try {
        const meta = await this.load(file);
        results.loaded.push(meta);
      } catch (err) {
        results.errors.push({ file, error: err.message });
        this.emit('plugin-error', { file, error: err.message });
      }
    }

    return results;
  }

  /**
   * List all loaded plugins.
   */
  list() {
    return Array.from(this._plugins.values()).map(p => ({
      ...p.meta,
      status: p.status,
      loadedAt: p.loadedAt,
    }));
  }

  /**
   * Get a specific plugin's info.
   */
  getPlugin(name) {
    const p = this._plugins.get(name);
    if (!p) return null;
    return { ...p.meta, status: p.status, loadedAt: p.loadedAt };
  }

  /**
   * Start watching the plugins/ directory for changes (hot-reload).
   */
  startWatching() {
    if (this._watcher) return;
    try {
      this._watcher = fs.watch(PLUGINS_DIR, { persistent: false }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.js')) return;

        // Debounce
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(async () => {
          // Find if this file is already loaded
          for (const [name, plugin] of this._plugins) {
            if (path.basename(plugin.filePath) === filename) {
              try {
                await this.reload(name);
                this.emit('plugin-hot-reloaded', { name, file: filename });
              } catch (err) {
                this.emit('plugin-error', { file: filename, error: `hot-reload failed: ${err.message}` });
              }
              return;
            }
          }
          // New file — try to load it
          try {
            await this.load(filename);
          } catch {}
        }, 500);
      });
    } catch {}
  }

  stopWatching() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }

  /**
   * Shutdown: unload all plugins and stop watching.
   */
  async shutdown() {
    this.stopWatching();
    for (const name of Array.from(this._plugins.keys())) {
      try { await this.unload(name); } catch {}
    }
  }
}

let _instance = null;
function getInstance() {
  if (!_instance) _instance = new PluginSandbox();
  return _instance;
}

module.exports = { PluginSandbox, getInstance };
