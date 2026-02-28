/**
 * ARIES — Module Creator
 * Analyzes codebase for gaps, duplicated logic, and missing utilities.
 * Autonomously proposes and creates new modules.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'modules');
const CREATED_PATH = path.join(DATA_DIR, 'created.json');
const CORE_DIR = path.join(__dirname);
const SRC_ROOT = path.join(__dirname, '..');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

class ModuleCreator {
  constructor(opts) {
    this.ai = opts && opts.ai;
    ensureDir();
  }

  /**
   * Scan codebase for gaps: duplicated logic, missing utilities, automation opportunities.
   */
  analyzeGaps() {
    const coreFiles = this._listCoreFiles();
    const analysis = {
      timestamp: Date.now(),
      filesScanned: coreFiles.length,
      duplicatedPatterns: [],
      missingUtilities: [],
      automationOpportunities: [],
      proposals: [],
    };

    const allContents = {};
    const functionMap = {};       // funcName -> [files]
    const requireMap = {};        // module -> [files]
    const patternCounts = {};     // code pattern -> count

    for (const file of coreFiles) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const basename = path.basename(file, '.js');
        allContents[basename] = content;

        // Track function declarations
        const funcMatches = content.matchAll(/(?:function\s+(\w+)|(\w+)\s*(?:=|:)\s*(?:async\s+)?function)/g);
        for (const m of funcMatches) {
          const name = m[1] || m[2];
          if (name && name.length > 3) {
            if (!functionMap[name]) functionMap[name] = [];
            functionMap[name].push(basename);
          }
        }

        // Track require() calls
        const reqMatches = content.matchAll(/require\(['"]([^'"]+)['"]\)/g);
        for (const m of reqMatches) {
          const mod = m[1];
          if (!requireMap[mod]) requireMap[mod] = [];
          requireMap[mod].push(basename);
        }

        // Common code patterns that suggest missing utilities
        const patterns = [
          { regex: /readJSON|JSON\.parse\(fs\.readFileSync/g, name: 'json-file-io' },
          { regex: /fs\.mkdirSync\([^)]+,\s*\{\s*recursive:\s*true\s*\}\)/g, name: 'ensure-dir' },
          { regex: /crypto\.randomUUID|crypto\.randomBytes/g, name: 'uuid-generation' },
          { regex: /new Date\(\)\.toISOString\(\)/g, name: 'date-formatting' },
          { regex: /\.sort\(\(a,\s*b\)\s*=>\s*b\.\w+\s*-\s*a\.\w+\)/g, name: 'sort-descending' },
        ];

        for (const p of patterns) {
          const matches = content.match(p.regex);
          if (matches) {
            patternCounts[p.name] = (patternCounts[p.name] || 0) + matches.length;
          }
        }
      } catch {}
    }

    // Find duplicated functions (same name in multiple files)
    for (const [func, files] of Object.entries(functionMap)) {
      if (files.length >= 3) {
        analysis.duplicatedPatterns.push({
          pattern: func,
          type: 'duplicated-function',
          files,
          count: files.length,
          suggestion: `Extract "${func}" into a shared utility module`,
        });
      }
    }

    // Find repeated code patterns suggesting missing utilities
    for (const [pattern, count] of Object.entries(patternCounts)) {
      if (count >= 5) {
        analysis.missingUtilities.push({
          pattern,
          occurrences: count,
          suggestion: `Create a shared utility for "${pattern}" — found ${count} times across codebase`,
        });
      }
    }

    // Check for files without error handling
    for (const [basename, content] of Object.entries(allContents)) {
      if (content.includes('async') && !content.includes('try') && !content.includes('.catch')) {
        analysis.automationOpportunities.push({
          file: basename + '.js',
          type: 'missing-error-handling',
          suggestion: 'Add error handling wrapper for async operations',
        });
      }
    }

    // Generate proposals
    if (analysis.duplicatedPatterns.length > 0) {
      analysis.proposals.push({
        name: 'shared-utils',
        type: 'utility',
        reason: `${analysis.duplicatedPatterns.length} duplicated patterns found across codebase`,
        functions: analysis.duplicatedPatterns.map(d => d.pattern),
        priority: 'medium',
      });
    }

    if (analysis.missingUtilities.length > 0) {
      analysis.proposals.push({
        name: 'common-helpers',
        type: 'utility',
        reason: `${analysis.missingUtilities.length} repeated code patterns could be centralized`,
        patterns: analysis.missingUtilities.map(u => u.pattern),
        priority: 'low',
      });
    }

    return analysis;
  }

  /**
   * Create a new module from a specification.
   * @param {object} spec — { name, description, exports: [{name, params, description}], type }
   */
  createModule(spec) {
    if (!spec || !spec.name) return { error: 'Module spec must include a name' };

    const safeName = spec.name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    const modulePath = path.join(CORE_DIR, safeName + '.js');

    // Don't overwrite existing modules
    if (fs.existsSync(modulePath)) {
      return { error: 'Module already exists: ' + safeName + '.js' };
    }

    // Generate module code
    const exports = spec.exports || [];
    const classExports = exports.map(e => {
      const params = (e.params || []).join(', ');
      return `  /**\n   * ${e.description || e.name}\n   */\n  ${e.name}(${params}) {\n    // TODO: implement\n    return { status: 'not-implemented' };\n  }`;
    }).join('\n\n');

    const className = safeName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');

    const code = `/**
 * ARIES — ${spec.description || className}
 * Auto-generated module by ModuleCreator.
 * Created: ${new Date().toISOString()}
 * Reason: ${spec.reason || 'Gap analysis'}
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', '${safeName}');
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

class ${className} {
  constructor(opts) {
    this.ai = opts && opts.ai;
    ensureDir();
  }

${classExports || '  // No exports defined yet'}
}

module.exports = ${className};
`;

    fs.writeFileSync(modulePath, code);

    // Track created module
    const created = readJSON(CREATED_PATH, []);
    const entry = {
      id: uuid(),
      name: safeName,
      className,
      path: modulePath,
      relativePath: 'core/' + safeName + '.js',
      description: spec.description || '',
      reason: spec.reason || 'Gap analysis',
      type: spec.type || 'utility',
      exports: exports.map(e => e.name),
      createdAt: Date.now(),
      date: new Date().toISOString(),
      usageCount: 0,
      integrated: false,
    };
    created.push(entry);
    writeJSON(CREATED_PATH, created);

    console.log('[MODULE-CREATOR] Created module: ' + safeName + '.js (' + exports.length + ' exports)');
    return entry;
  }

  /**
   * Wire a module into the system (add to feature-routes, etc.).
   */
  integrateModule(moduleName) {
    const created = readJSON(CREATED_PATH, []);
    const mod = created.find(m => m.name === moduleName || m.id === moduleName);
    if (!mod) return { error: 'Module not found in created modules' };

    // Mark as integrated
    mod.integrated = true;
    mod.integratedAt = Date.now();
    writeJSON(CREATED_PATH, created);

    return {
      module: mod,
      status: 'integrated',
      note: 'Module marked as integrated. API routes should be added to feature-routes.js manually or via dream cycle.',
    };
  }

  /**
   * Get list of all created modules.
   */
  getCreatedModules() {
    return readJSON(CREATED_PATH, []);
  }

  /**
   * Increment usage count for a module.
   */
  trackUsage(moduleName) {
    const created = readJSON(CREATED_PATH, []);
    const mod = created.find(m => m.name === moduleName || m.id === moduleName);
    if (mod) {
      mod.usageCount = (mod.usageCount || 0) + 1;
      mod.lastUsed = Date.now();
      writeJSON(CREATED_PATH, created);
    }
    return mod;
  }

  /**
   * Get module creation stats.
   */
  getStats() {
    const created = readJSON(CREATED_PATH, []);
    return {
      totalCreated: created.length,
      integrated: created.filter(m => m.integrated).length,
      totalUsage: created.reduce((s, m) => s + (m.usageCount || 0), 0),
      byType: created.reduce((acc, m) => { acc[m.type || 'utility'] = (acc[m.type || 'utility'] || 0) + 1; return acc; }, {}),
      modules: created,
    };
  }

  // ── Internal ──

  _listCoreFiles() {
    try {
      return fs.readdirSync(CORE_DIR)
        .filter(f => f.endsWith('.js'))
        .map(f => path.join(CORE_DIR, f));
    } catch { return []; }
  }
}

module.exports = ModuleCreator;
