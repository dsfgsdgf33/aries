/**
 * ARIES — World Model
 * Persistent, updating model of the entire environment.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'world');
const MODEL_PATH = path.join(DATA_DIR, 'model.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const WORKSPACE = path.join(__dirname, '..');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const IGNORE_DIRS = new Set(['node_modules', '.git', 'data', '.next', 'dist', 'build', 'coverage']);

class WorldModel {
  constructor() {
    ensureDir();
    this._scanTimer = null;
  }

  scan() {
    const files = {};
    const modules = {};
    const apis = [];

    this._walkDir(WORKSPACE, files, 0);

    // Build dependency map
    for (const [fp, info] of Object.entries(files)) {
      if (!fp.endsWith('.js') && !fp.endsWith('.mjs')) continue;
      try {
        const content = fs.readFileSync(fp, 'utf8');
        const deps = [];
        const requireMatches = content.matchAll(/require\(['"]([^'"]+)['"]\)/g);
        for (const m of requireMatches) deps.push(m[1]);
        const importMatches = content.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g);
        for (const m of importMatches) deps.push(m[1]);
        info.dependencies = deps;

        // Detect API routes
        const routeMatches = content.matchAll(/(?:pathname\s*===\s*['"]([^'"]+)['"]|\.(?:get|post|put|delete)\s*\(\s*['"]([^'"]+)['"])/g);
        for (const m of routeMatches) {
          const route = m[1] || m[2];
          if (route && route.startsWith('/api')) apis.push({ route, handler: path.basename(fp) });
        }
      } catch { /* skip unreadable */ }
    }

    // Build dependents
    for (const [fp, info] of Object.entries(files)) {
      if (!info.dependencies) continue;
      for (const dep of info.dependencies) {
        if (dep.startsWith('.')) {
          const resolved = this._resolveDep(fp, dep);
          if (resolved && files[resolved]) {
            if (!files[resolved].dependents) files[resolved].dependents = [];
            files[resolved].dependents.push(path.basename(fp));
          }
        }
      }
    }

    // Module health
    const coreDir = path.join(WORKSPACE, 'core');
    if (fs.existsSync(coreDir)) {
      try {
        const coreFiles = fs.readdirSync(coreDir).filter(f => f.endsWith('.js'));
        for (const f of coreFiles) {
          const name = f.replace('.js', '');
          const fp = path.join(coreDir, f);
          const info = files[fp] || {};
          modules[name] = {
            name,
            path: fp,
            connections: (info.dependencies || []).length + (info.dependents || []).length,
            health: 'ok'
          };
        }
      } catch { /* */ }
    }

    // System state
    const system = {
      memory: { total: os.totalmem(), free: os.freemem(), usedPct: Math.round((1 - os.freemem() / os.totalmem()) * 100) },
      platform: os.platform(),
      uptime: os.uptime(),
      cpus: os.cpus().length
    };

    const model = { files, modules, apis, system, lastScan: Date.now() };
    
    // Save history
    const history = readJSON(HISTORY_PATH, []);
    history.push({ timestamp: Date.now(), fileCount: Object.keys(files).length, moduleCount: Object.keys(modules).length, apiCount: apis.length });
    if (history.length > 500) history.splice(0, history.length - 500);
    writeJSON(HISTORY_PATH, history);
    writeJSON(MODEL_PATH, model);
    return { scanned: Object.keys(files).length, modules: Object.keys(modules).length, apis: apis.length, timestamp: model.lastScan };
  }

  getMap() {
    return readJSON(MODEL_PATH, { files: {}, modules: {}, apis: [], system: {}, lastScan: null });
  }

  getFileRelations(filePath) {
    const model = this.getMap();
    const abs = path.isAbsolute(filePath) ? filePath : path.join(WORKSPACE, filePath);
    const info = model.files[abs];
    if (!info) return { error: 'File not found in model. Run scan first.' };
    return { path: abs, dependencies: info.dependencies || [], dependents: info.dependents || [], size: info.size, lastModified: info.lastModified };
  }

  getFragile() {
    const model = this.getMap();
    return Object.entries(model.files)
      .filter(([, info]) => (info.dependents || []).length >= 3)
      .map(([fp, info]) => ({ path: path.relative(WORKSPACE, fp), dependents: info.dependents.length, deps: info.dependents }))
      .sort((a, b) => b.dependents - a.dependents);
  }

  getRobust() {
    const model = this.getMap();
    return Object.entries(model.files)
      .filter(([, info]) => (info.dependencies || []).length >= 2 && (info.dependents || []).length >= 1)
      .map(([fp, info]) => ({ path: path.relative(WORKSPACE, fp), connections: (info.dependencies || []).length + (info.dependents || []).length }))
      .sort((a, b) => b.connections - a.connections)
      .slice(0, 20);
  }

  getStale() {
    const model = this.getMap();
    const threshold = Date.now() - (14 * 24 * 60 * 60 * 1000);
    return Object.entries(model.files)
      .filter(([, info]) => info.lastModified && info.lastModified < threshold)
      .map(([fp, info]) => ({ path: path.relative(WORKSPACE, fp), lastModified: info.lastModified, daysStale: Math.round((Date.now() - info.lastModified) / (24 * 60 * 60 * 1000)) }))
      .sort((a, b) => a.lastModified - b.lastModified)
      .slice(0, 50);
  }

  getHotspots() {
    const history = readJSON(HISTORY_PATH, []);
    // Hotspots based on file modification recency — recently modified files that keep changing
    const model = this.getMap();
    const now = Date.now();
    const recent = 7 * 24 * 60 * 60 * 1000;
    return Object.entries(model.files)
      .filter(([, info]) => info.lastModified && (now - info.lastModified) < recent)
      .map(([fp, info]) => ({ path: path.relative(WORKSPACE, fp), lastModified: info.lastModified, size: info.size, hoursAgo: Math.round((now - info.lastModified) / 3600000) }))
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, 30);
  }

  getDependencyTree(modulePath) {
    const model = this.getMap();
    const abs = path.isAbsolute(modulePath) ? modulePath : path.join(WORKSPACE, modulePath);
    const visited = new Set();
    const tree = this._buildTree(abs, model.files, visited, 0);
    return tree;
  }

  getChangeSummary(since) {
    const model = this.getMap();
    const threshold = since || (Date.now() - 24 * 60 * 60 * 1000);
    const changed = Object.entries(model.files)
      .filter(([, info]) => info.lastModified && info.lastModified > threshold)
      .map(([fp, info]) => ({ path: path.relative(WORKSPACE, fp), lastModified: info.lastModified }))
      .sort((a, b) => b.lastModified - a.lastModified);
    return { since: threshold, changed, count: changed.length };
  }

  getMinimap() {
    const model = this.getMap();
    const dirs = {};
    for (const fp of Object.keys(model.files)) {
      const rel = path.relative(WORKSPACE, fp);
      const dir = path.dirname(rel).split(path.sep)[0] || '.';
      if (!dirs[dir]) dirs[dir] = { files: 0, totalSize: 0 };
      dirs[dir].files++;
      dirs[dir].totalSize += model.files[fp].size || 0;
    }
    return {
      directories: Object.entries(dirs).map(([name, info]) => ({ name, ...info })).sort((a, b) => b.files - a.files),
      totalFiles: Object.keys(model.files).length,
      totalModules: Object.keys(model.modules || {}).length,
      totalApis: (model.apis || []).length,
      lastScan: model.lastScan,
      system: model.system
    };
  }

  _walkDir(dir, files, depth) {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this._walkDir(fp, files, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fp);
          files[fp] = { path: path.relative(WORKSPACE, fp), size: stat.size, lastModified: stat.mtimeMs, dependencies: [], dependents: [] };
        } catch { /* skip */ }
      }
    }
  }

  _resolveDep(from, dep) {
    const dir = path.dirname(from);
    const candidates = [
      path.resolve(dir, dep),
      path.resolve(dir, dep + '.js'),
      path.resolve(dir, dep, 'index.js')
    ];
    for (const c of candidates) { if (fs.existsSync(c)) return c; }
    return null;
  }

  _buildTree(fp, files, visited, depth) {
    if (depth > 8 || visited.has(fp)) return { path: path.relative(WORKSPACE, fp), circular: visited.has(fp) };
    visited.add(fp);
    const info = files[fp];
    const children = [];
    if (info && info.dependencies) {
      for (const dep of info.dependencies) {
        if (dep.startsWith('.')) {
          const resolved = this._resolveDep(fp, dep);
          if (resolved) children.push(this._buildTree(resolved, files, new Set(visited), depth + 1));
        }
      }
    }
    return { path: path.relative(WORKSPACE, fp), children };
  }
}

module.exports = WorldModel;
