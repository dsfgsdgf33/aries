/**
 * ARIES v5.0 — Plugin System v2
 * 
 * Features:
 * - Auto-discover plugins from plugins/ directory
 * - Lifecycle hooks: init, destroy, onMessage, onTask
 * - Plugin API with context injection
 * - Hot-reload support
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.join(__dirname, '..', 'plugins');
const plugins = new Map();

/**
 * Plugin API context passed to lifecycle hooks
 */
function createContext(plugin) {
  return {
    name: plugin.name,
    dataDir: path.join(__dirname, '..', 'data', 'plugins', plugin.name),
    log: (msg) => console.log(`[PLUGIN:${plugin.name}] ${msg}`),
    config: (() => { try { return require('./config').getAll(); } catch { return {}; } })(),
    getMemory: () => { try { return require('./memory'); } catch { return null; } },
    getTools: () => { try { return require('./tools'); } catch { return null; } },
  };
}

/**
 * Scan and load all plugins
 */
function loadAll() {
  // Destroy existing plugins first
  for (const [name, plugin] of plugins) {
    try { if (plugin.destroy) plugin.destroy(createContext(plugin)); } catch {}
  }
  plugins.clear();

  if (!fs.existsSync(PLUGIN_DIR)) {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    return [];
  }

  const files = fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.js'));
  const loaded = [];

  for (const file of files) {
    try {
      const fullPath = path.join(PLUGIN_DIR, file);
      delete require.cache[require.resolve(fullPath)];
      const plugin = require(fullPath);

      if (!plugin.name || !plugin.execute) continue;

      // Ensure plugin data dir
      const dataDir = path.join(__dirname, '..', 'data', 'plugins', plugin.name);
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

      plugins.set(plugin.name, {
        name: plugin.name,
        description: plugin.description || 'No description',
        version: plugin.version || '1.0.0',
        execute: plugin.execute,
        init: plugin.init || null,
        destroy: plugin.destroy || null,
        onMessage: plugin.onMessage || null,
        onTask: plugin.onTask || null,
      });

      // Call init hook
      if (plugin.init) {
        try { plugin.init(createContext(plugin)); } catch (e) {
          console.error(`[PLUGIN] ${plugin.name} init failed: ${e.message}`);
        }
      }

      loaded.push(plugin.name);
    } catch (e) {
      console.error(`[PLUGIN] Failed to load ${file}: ${e.message}`);
    }
  }

  return loaded;
}

/**
 * Reload a specific plugin
 */
function reload(name) {
  const plugin = plugins.get(name);
  if (plugin?.destroy) {
    try { plugin.destroy(createContext(plugin)); } catch {}
  }
  plugins.delete(name);

  const file = path.join(PLUGIN_DIR, `${name}.js`);
  if (!fs.existsSync(file)) return false;

  try {
    delete require.cache[require.resolve(file)];
    const p = require(file);
    if (!p.name || !p.execute) return false;

    plugins.set(p.name, {
      name: p.name, description: p.description || '', version: p.version || '1.0.0',
      execute: p.execute, init: p.init || null, destroy: p.destroy || null,
      onMessage: p.onMessage || null, onTask: p.onTask || null,
    });

    if (p.init) p.init(createContext(p));
    return true;
  } catch { return false; }
}

function getAll() { return [...plugins.values()]; }
function get(name) { return plugins.get(name) || null; }

async function execute(name, args) {
  const plugin = plugins.get(name);
  if (!plugin) return { success: false, output: `Unknown plugin: ${name}` };
  try {
    const result = await plugin.execute(args, createContext(plugin));
    return { success: true, output: String(result) };
  } catch (e) {
    return { success: false, output: e.message };
  }
}

/** Broadcast message to all plugins with onMessage hook */
async function broadcastMessage(message) {
  const results = [];
  for (const [name, plugin] of plugins) {
    if (plugin.onMessage) {
      try {
        const r = await plugin.onMessage(message, createContext(plugin));
        if (r) results.push({ plugin: name, result: r });
      } catch {}
    }
  }
  return results;
}

/** Broadcast task to all plugins with onTask hook */
async function broadcastTask(task) {
  const results = [];
  for (const [name, plugin] of plugins) {
    if (plugin.onTask) {
      try {
        const r = await plugin.onTask(task, createContext(plugin));
        if (r) results.push({ plugin: name, result: r });
      } catch {}
    }
  }
  return results;
}

function getToolDescriptions() {
  return getAll().map(p =>
    `<tool:plugin_${p.name}>args</tool:plugin_${p.name}> — [Plugin] ${p.description}`
  ).join('\n');
}

/** Destroy all plugins */
function destroyAll() {
  for (const [name, plugin] of plugins) {
    try { if (plugin.destroy) plugin.destroy(createContext(plugin)); } catch {}
  }
  plugins.clear();
}

module.exports = { loadAll, reload, getAll, get, execute, broadcastMessage, broadcastTask, getToolDescriptions, destroyAll };
