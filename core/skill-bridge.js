/**
 * ARIES v4.5 — OpenClaw Skill Compatibility + ClawhHub Integration
 * Bridge between OpenClaw ecosystem and Aries skill system.
 * Uses only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const BASE_DIR = path.join(__dirname, '..');
const SKILLS_DIR = path.join(BASE_DIR, 'skills');
const DATA_DIR = path.join(BASE_DIR, 'data');
const REGISTRY_FILE = path.join(DATA_DIR, 'skill-registry.json');

class SkillBridge extends EventEmitter {
  /**
   * @param {object} config
   * @param {object} [deps] - { ai, skillManager }
   */
  constructor(config, deps) {
    super();
    this.config = config || {};
    this.enabled = config.enabled !== false;
    this.clawHubUrl = config.clawHubUrl || 'https://clawhub.com';
    this.openClawSkillsPath = config.openClawSkillsPath || '';
    this.autoDiscover = config.autoDiscover !== false;
    this.ai = deps && deps.ai ? deps.ai : null;
    this.skillManager = deps && deps.skillManager ? deps.skillManager : null;
    this._registry = {};
    this._hubCache = { results: [], popular: [], categories: [], ts: 0 };
    this._ensureDirs();
    this._loadRegistry();
  }

  _ensureDirs() {
    try {
      if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) { /* ignore */ }
  }

  _loadRegistry() {
    try {
      if (fs.existsSync(REGISTRY_FILE)) {
        this._registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
      }
    } catch (e) { this._registry = {}; }
  }

  _saveRegistry() {
    try {
      fs.writeFileSync(REGISTRY_FILE, JSON.stringify(this._registry, null, 2));
    } catch (e) { /* ignore */ }
  }

  /**
   * HTTP GET helper
   * @param {string} urlStr
   * @returns {Promise<{statusCode: number, body: string}>}
   */
  _httpGet(urlStr) {
    return new Promise(function(resolve, reject) {
      try {
        var parsed = new URL(urlStr);
        var mod = parsed.protocol === 'https:' ? https : http;
        var req = mod.get(urlStr, { timeout: 15000, headers: { 'User-Agent': 'Aries/4.5' } }, function(res) {
          // Follow redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            resolve({ statusCode: res.statusCode, body: '', redirect: res.headers.location });
            res.resume();
            return;
          }
          var chunks = [];
          res.on('data', function(c) { chunks.push(c); });
          res.on('end', function() { resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
        });
        req.on('error', function(e) { reject(e); });
        req.on('timeout', function() { req.destroy(); reject(new Error('Timeout')); });
      } catch (e) { reject(e); }
    });
  }

  // ═══════════════════════════════════════════
  // ClawhHub API Integration
  // ═══════════════════════════════════════════

  /**
   * Search ClawhHub for skills
   * @param {string} query
   * @returns {Promise<Array>}
   */
  async searchHub(query) {
    try {
      var url = this.clawHubUrl + '/api/skills/search?q=' + encodeURIComponent(query || '');
      var resp = await this._httpGet(url);
      if (resp.statusCode === 200) {
        try {
          var data = JSON.parse(resp.body);
          var results = Array.isArray(data) ? data : (data.results || data.skills || []);
          this._hubCache.results = results;
          this._hubCache.ts = Date.now();
          return results;
        } catch (e) { /* fallback to scraping */ }
      }
      // Fallback: scrape the HTML page
      var htmlResp = await this._httpGet(this.clawHubUrl + '/search?q=' + encodeURIComponent(query || ''));
      return this._parseHubHtml(htmlResp.body || '');
    } catch (e) {
      return [];
    }
  }

  /**
   * Parse ClawhHub HTML for skill listings (fallback scraper)
   * @param {string} html
   * @returns {Array}
   */
  _parseHubHtml(html) {
    try {
      var results = [];
      // Try to find skill cards/links in HTML
      var skillPattern = /<a[^>]*href="\/skills?\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      var match;
      while ((match = skillPattern.exec(html)) !== null) {
        var id = match[1];
        var content = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (id && content) {
          results.push({
            name: id.replace(/-/g, ' '),
            id: id,
            description: content.substring(0, 200),
            author: 'unknown',
            version: '1.0.0',
            downloads: 0,
            url: this.clawHubUrl + '/skills/' + id
          });
        }
      }
      return results.slice(0, 50);
    } catch (e) { return []; }
  }

  /**
   * Get skill details from ClawhHub
   * @param {string} skillId
   * @returns {Promise<object|null>}
   */
  async getHubSkill(skillId) {
    try {
      var url = this.clawHubUrl + '/api/skills/' + encodeURIComponent(skillId);
      var resp = await this._httpGet(url);
      if (resp.statusCode === 200) {
        return JSON.parse(resp.body);
      }
      // Fallback: scrape skill page
      var htmlResp = await this._httpGet(this.clawHubUrl + '/skills/' + encodeURIComponent(skillId));
      var body = htmlResp.body || '';
      var titleMatch = body.match(/<h1[^>]*>(.*?)<\/h1>/i);
      var descMatch = body.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
      return {
        id: skillId,
        name: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : skillId,
        description: descMatch ? descMatch[1] : '',
        url: this.clawHubUrl + '/skills/' + skillId
      };
    } catch (e) { return null; }
  }

  /**
   * Install a skill from ClawhHub
   * @param {string} skillId
   * @returns {Promise<{installed: boolean, name?: string, error?: string}>}
   */
  async installFromHub(skillId) {
    try {
      var detail = await this.getHubSkill(skillId);
      if (!detail) return { installed: false, error: 'Skill not found on ClawhHub' };

      var gitUrl = detail.gitUrl || detail.repository || detail.url;
      if (!gitUrl) return { installed: false, error: 'No downloadable source found for this skill' };

      // Try git clone
      var dirName = skillId.replace(/[^a-zA-Z0-9_-]/g, '-');
      var targetDir = path.join(SKILLS_DIR, dirName);
      if (fs.existsSync(targetDir)) return { installed: false, error: 'Skill directory already exists' };

      try {
        var { execSync } = require('child_process');
        execSync('git clone "' + gitUrl + '" "' + targetDir + '"', { timeout: 30000 });
      } catch (e) {
        return { installed: false, error: 'Git clone failed: ' + e.message };
      }

      // Detect format and load
      var format = this._detectFormat(targetDir);
      if (format === 'openclaw') {
        this.convertOpenClawSkill(targetDir);
      }

      // Load via skill manager if available
      var loadResult = { loaded: false };
      if (this.skillManager) {
        loadResult = this.skillManager.loadSkill(targetDir);
      }

      // Register
      var name = detail.name || skillId;
      this._registry[name] = {
        source: 'clawhub',
        format: format,
        version: detail.version || '1.0.0',
        installedAt: new Date().toISOString(),
        lastUsed: null,
        hubId: skillId,
        path: targetDir
      };
      this._saveRegistry();

      this.emit('installed', { name: name, source: 'clawhub', skillId: skillId });
      return { installed: true, name: name, format: format };
    } catch (e) {
      return { installed: false, error: e.message };
    }
  }

  /**
   * List skill categories on ClawhHub
   * @returns {Promise<Array>}
   */
  async listHubCategories() {
    try {
      var url = this.clawHubUrl + '/api/skills/categories';
      var resp = await this._httpGet(url);
      if (resp.statusCode === 200) {
        var data = JSON.parse(resp.body);
        this._hubCache.categories = Array.isArray(data) ? data : (data.categories || []);
        return this._hubCache.categories;
      }
      return ['automation', 'development', 'data', 'communication', 'utilities', 'ai', 'devops'];
    } catch (e) {
      return ['automation', 'development', 'data', 'communication', 'utilities', 'ai', 'devops'];
    }
  }

  /**
   * Get popular/trending skills from ClawhHub
   * @returns {Promise<Array>}
   */
  async getPopular() {
    try {
      var url = this.clawHubUrl + '/api/skills/popular';
      var resp = await this._httpGet(url);
      if (resp.statusCode === 200) {
        var data = JSON.parse(resp.body);
        this._hubCache.popular = Array.isArray(data) ? data : (data.skills || []);
        return this._hubCache.popular;
      }
      // Fallback: search for popular
      return await this.searchHub('popular');
    } catch (e) {
      return [];
    }
  }

  // ═══════════════════════════════════════════
  // OpenClaw Skill Format Compatibility
  // ═══════════════════════════════════════════

  /**
   * Detect skill format
   * @param {string} skillDir
   * @returns {'openclaw'|'aries'|'unknown'}
   */
  _detectFormat(skillDir) {
    try {
      if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) return 'openclaw';
      if (fs.existsSync(path.join(skillDir, 'skill.json'))) return 'aries';
      return 'unknown';
    } catch (e) { return 'unknown'; }
  }

  /**
   * Convert OpenClaw skill to Aries format
   * @param {string} skillDir
   * @returns {{name: string, converted: boolean, error?: string}}
   */
  convertOpenClawSkill(skillDir) {
    try {
      var skillMdPath = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) {
        return { converted: false, error: 'No SKILL.md found' };
      }

      var content = fs.readFileSync(skillMdPath, 'utf8');

      // Parse SKILL.md for metadata
      var nameMatch = content.match(/^#\s+(.+)/m);
      var name = nameMatch ? nameMatch[1].trim() : path.basename(skillDir);

      // Extract description (first paragraph after title)
      var descMatch = content.match(/^#\s+.+\n+([^#\n][^\n]+)/m);
      var description = descMatch ? descMatch[1].trim() : '';

      // Extract commands (look for ## Commands or similar patterns)
      var commands = [];
      var cmdSection = content.match(/##\s*Commands?\s*\n([\s\S]*?)(?=\n##|\n$|$)/i);
      if (cmdSection) {
        var cmdMatches = cmdSection[1].match(/[-*]\s*`([^`]+)`/g);
        if (cmdMatches) {
          commands = cmdMatches.map(function(m) { return m.replace(/[-*]\s*`|`/g, '').trim(); });
        }
      }

      // Extract tool references
      var tools = [];
      var toolSection = content.match(/##\s*Tools?\s*\n([\s\S]*?)(?=\n##|\n$|$)/i);
      if (toolSection) {
        var toolMatches = toolSection[1].match(/[-*]\s*`([^`]+)`/g);
        if (toolMatches) {
          tools = toolMatches.map(function(m) { return m.replace(/[-*]\s*`|`/g, '').trim(); });
        }
      }

      // Find scripts
      var scripts = [];
      var scriptsDir = path.join(skillDir, 'scripts');
      if (fs.existsSync(scriptsDir)) {
        try {
          scripts = fs.readdirSync(scriptsDir).filter(function(f) {
            return f.endsWith('.sh') || f.endsWith('.ps1') || f.endsWith('.py') || f.endsWith('.js');
          });
        } catch (e) { /* ignore */ }
      }

      // Generate skill.json
      var manifest = {
        name: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        displayName: name,
        version: '1.0.0',
        description: description,
        author: 'OpenClaw Community',
        format: 'openclaw-converted',
        commands: commands,
        tools: tools,
        scripts: scripts,
        prompts: { context: content },
        config: {},
        source: { type: 'openclaw', originalPath: skillDir }
      };

      fs.writeFileSync(path.join(skillDir, 'skill.json'), JSON.stringify(manifest, null, 2));

      return { name: manifest.name, converted: true };
    } catch (e) {
      return { converted: false, error: e.message };
    }
  }

  /**
   * Load an OpenClaw-format skill directly
   * @param {string} skillDir
   * @returns {{name: string, loaded: boolean, context?: string, error?: string}}
   */
  loadOpenClawSkill(skillDir) {
    try {
      var skillMdPath = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) {
        return { loaded: false, error: 'No SKILL.md found' };
      }

      var content = fs.readFileSync(skillMdPath, 'utf8');
      var nameMatch = content.match(/^#\s+(.+)/m);
      var name = nameMatch ? nameMatch[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') : path.basename(skillDir);

      // Convert first if no skill.json
      if (!fs.existsSync(path.join(skillDir, 'skill.json'))) {
        this.convertOpenClawSkill(skillDir);
      }

      // Load via skill manager
      var loadResult = { loaded: false };
      if (this.skillManager) {
        loadResult = this.skillManager.loadSkill(skillDir);
      }

      // Register
      this._registry[name] = {
        source: 'openclaw-local',
        format: 'openclaw',
        version: '1.0.0',
        installedAt: new Date().toISOString(),
        lastUsed: null,
        path: skillDir,
        contextLength: content.length
      };
      this._saveRegistry();

      return { name: name, loaded: true, context: content };
    } catch (e) {
      return { loaded: false, error: e.message };
    }
  }

  // ═══════════════════════════════════════════
  // Local OpenClaw Skill Discovery
  // ═══════════════════════════════════════════

  /**
   * Discover skills in local OpenClaw installation
   * @returns {Array<{name: string, description: string, path: string, format: string}>}
   */
  discoverLocalSkills() {
    var results = [];
    try {
      var searchPaths = [this.openClawSkillsPath];
      // Also check common paths
      if (process.platform === 'win32') {
        var appData = process.env.APPDATA || '';
        if (appData) {
          searchPaths.push(path.join(appData, 'npm', 'node_modules', 'openclaw', 'skills'));
          searchPaths.push(path.join(appData, 'npm', 'node_modules', '@openclaw', 'cli', 'skills'));
        }
      }

      for (var i = 0; i < searchPaths.length; i++) {
        var searchPath = searchPaths[i];
        if (!searchPath || !fs.existsSync(searchPath)) continue;

        try {
          var entries = fs.readdirSync(searchPath, { withFileTypes: true });
          for (var j = 0; j < entries.length; j++) {
            var entry = entries[j];
            if (!entry.isDirectory()) continue;

            var skillDir = path.join(searchPath, entry.name);
            var format = this._detectFormat(skillDir);
            var description = '';

            if (format === 'openclaw') {
              try {
                var md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
                var descMatch = md.match(/^#\s+.+\n+([^#\n][^\n]+)/m);
                if (descMatch) description = descMatch[1].trim();
              } catch (e) { /* ignore */ }
            } else if (format === 'aries') {
              try {
                var manifest = JSON.parse(fs.readFileSync(path.join(skillDir, 'skill.json'), 'utf8'));
                description = manifest.description || '';
              } catch (e) { /* ignore */ }
            }

            var alreadyImported = this._registry[entry.name] && this._registry[entry.name].source === 'openclaw-local';
            results.push({
              name: entry.name,
              description: description,
              path: skillDir,
              format: format,
              imported: !!alreadyImported
            });
          }
        } catch (e) { /* ignore individual path errors */ }
      }
    } catch (e) { /* ignore */ }
    return results;
  }

  /**
   * Import an OpenClaw skill into Aries skills/ directory
   * @param {string} skillName
   * @returns {{imported: boolean, name?: string, error?: string}}
   */
  importLocalSkill(skillName) {
    try {
      var localSkills = this.discoverLocalSkills();
      var found = null;
      for (var i = 0; i < localSkills.length; i++) {
        if (localSkills[i].name === skillName) { found = localSkills[i]; break; }
      }
      if (!found) return { imported: false, error: 'Skill "' + skillName + '" not found in local OpenClaw installation' };

      var targetDir = path.join(SKILLS_DIR, skillName);
      if (fs.existsSync(targetDir)) return { imported: false, error: 'Skill directory already exists in Aries' };

      // Copy directory recursively
      this._copyDirSync(found.path, targetDir);

      // Convert if OpenClaw format
      if (found.format === 'openclaw') {
        this.convertOpenClawSkill(targetDir);
      }

      // Load via skill manager
      if (this.skillManager) {
        this.skillManager.loadSkill(targetDir);
      }

      // Register
      this._registry[skillName] = {
        source: 'openclaw-local',
        format: found.format,
        version: '1.0.0',
        installedAt: new Date().toISOString(),
        lastUsed: null,
        path: targetDir,
        originalPath: found.path
      };
      this._saveRegistry();

      this.emit('imported', { name: skillName, source: 'openclaw-local' });
      return { imported: true, name: skillName };
    } catch (e) {
      return { imported: false, error: e.message };
    }
  }

  /**
   * Recursive directory copy
   * @param {string} src
   * @param {string} dest
   */
  _copyDirSync(src, dest) {
    try {
      fs.mkdirSync(dest, { recursive: true });
      var entries = fs.readdirSync(src, { withFileTypes: true });
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var srcPath = path.join(src, entry.name);
        var destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          this._copyDirSync(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    } catch (e) { /* ignore */ }
  }

  // ═══════════════════════════════════════════
  // Skill Registry
  // ═══════════════════════════════════════════

  /**
   * Get full skill registry
   * @returns {object}
   */
  getRegistry() {
    return JSON.parse(JSON.stringify(this._registry));
  }

  /**
   * Get skill context (instructions) for AI injection
   * @param {string} skillName
   * @returns {string|null}
   */
  getSkillContext(skillName) {
    try {
      var reg = this._registry[skillName];
      if (!reg || !reg.path) return null;

      // Update last used
      reg.lastUsed = new Date().toISOString();
      this._saveRegistry();

      // Try SKILL.md first (OpenClaw format)
      var skillMdPath = path.join(reg.path, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        return fs.readFileSync(skillMdPath, 'utf8');
      }

      // Try skill.json prompts
      var manifestPath = path.join(reg.path, 'skill.json');
      if (fs.existsSync(manifestPath)) {
        var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.prompts && manifest.prompts.context) {
          return manifest.prompts.context;
        }
        return 'Skill: ' + (manifest.name || skillName) + '\nDescription: ' + (manifest.description || '') + '\nCommands: ' + (manifest.commands || []).join(', ');
      }

      return null;
    } catch (e) { return null; }
  }

  /**
   * Match a skill to a task description
   * @param {string} taskDescription
   * @returns {Array<{name: string, score: number, reason: string}>}
   */
  matchSkillForTask(taskDescription) {
    try {
      var results = [];
      var taskLower = (taskDescription || '').toLowerCase();
      var taskWords = taskLower.split(/\s+/);

      var entries = Object.entries(this._registry);
      for (var i = 0; i < entries.length; i++) {
        var name = entries[i][0];
        var reg = entries[i][1];
        var score = 0;
        var reasons = [];

        // Name match
        if (taskLower.includes(name)) {
          score += 5;
          reasons.push('name match');
        }

        // Try to get description
        var context = '';
        try {
          if (reg.path) {
            var manifestPath = path.join(reg.path, 'skill.json');
            if (fs.existsSync(manifestPath)) {
              var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              context = ((manifest.description || '') + ' ' + (manifest.commands || []).join(' ')).toLowerCase();
            }
            var skillMdPath = path.join(reg.path, 'SKILL.md');
            if (fs.existsSync(skillMdPath)) {
              context += ' ' + fs.readFileSync(skillMdPath, 'utf8').toLowerCase().substring(0, 500);
            }
          }
        } catch (e) { /* ignore */ }

        // Word overlap score
        for (var w = 0; w < taskWords.length; w++) {
          if (taskWords[w].length > 3 && context.includes(taskWords[w])) {
            score += 1;
            reasons.push('keyword: ' + taskWords[w]);
          }
        }

        if (score > 0) {
          results.push({ name: name, score: score, reason: reasons.join(', ') });
        }
      }

      results.sort(function(a, b) { return b.score - a.score; });
      return results.slice(0, 5);
    } catch (e) { return []; }
  }

  /**
   * Get list of all installed skills with metadata
   * @returns {Array}
   */
  listInstalledSkills() {
    try {
      var results = [];
      var entries = Object.entries(this._registry);
      for (var i = 0; i < entries.length; i++) {
        var name = entries[i][0];
        var reg = entries[i][1];
        var info = {
          name: name,
          source: reg.source || 'unknown',
          format: reg.format || 'unknown',
          version: reg.version || '1.0.0',
          installedAt: reg.installedAt || null,
          lastUsed: reg.lastUsed || null,
          path: reg.path || null
        };

        // Try to get extra details
        try {
          if (reg.path) {
            var manifestPath = path.join(reg.path, 'skill.json');
            if (fs.existsSync(manifestPath)) {
              var manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              info.description = manifest.description || '';
              info.author = manifest.author || '';
              info.commands = manifest.commands || [];
            }
          }
        } catch (e) { /* ignore */ }

        results.push(info);
      }
      return results;
    } catch (e) { return []; }
  }

  /**
   * Stop / cleanup
   */
  stop() {
    this._saveRegistry();
  }
}

module.exports = { SkillBridge };
