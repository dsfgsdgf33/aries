/**
 * ARIES v4.4 — Modular Skill System
 * Shareable, installable skill packages.
 * Uses only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const BASE_DIR = path.join(__dirname, '..');
const SKILLS_DIR = path.join(BASE_DIR, 'skills');
const DATA_DIR = path.join(BASE_DIR, 'data');
const STATE_FILE = path.join(DATA_DIR, 'skills-state.json');

class SkillManager {
  constructor(config = {}) {
    this.config = config;
    this.directory = config.directory || 'skills';
    this.autoLoad = config.autoLoad !== false;
    this._skills = {};
    this._state = {};
    this._commands = {};
    this._ensureDirs();
    this._loadState();
    if (this.autoLoad) this.loadAll();
  }

  _ensureDirs() {
    try {
      if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch {}
  }

  _loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        this._state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      }
    } catch { this._state = {}; }
  }

  _saveState() {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this._state, null, 2));
    } catch {}
  }

  /**
   * Load a single skill from a directory
   * @param {string} skillDir - Path to skill directory
   * @returns {{name: string, loaded: boolean, error?: string}}
   */
  loadSkill(skillDir) {
    try {
      const manifestPath = path.join(skillDir, 'skill.json');
      if (!fs.existsSync(manifestPath)) {
        return { loaded: false, error: 'No skill.json found' };
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const name = manifest.name;
      if (!name) return { loaded: false, error: 'Skill name required' };

      const skill = {
        name,
        version: manifest.version || '1.0.0',
        description: manifest.description || '',
        author: manifest.author || 'unknown',
        commands: manifest.commands || [],
        tools: manifest.tools || [],
        prompts: manifest.prompts || {},
        config: manifest.config || {},
        path: skillDir,
        loadedAt: new Date().toISOString(),
        status: 'active'
      };

      // Load handler if exists
      const handlerPath = path.join(skillDir, 'index.js');
      if (fs.existsSync(handlerPath)) {
        try {
          skill.handler = require(handlerPath);
        } catch (e) {
          skill.handlerError = e.message;
        }
      }

      // Register commands
      for (const cmd of skill.commands) {
        this._commands[cmd] = name;
      }

      this._skills[name] = skill;
      this._state[name] = { loaded: true, loadedAt: skill.loadedAt, version: skill.version };
      this._saveState();

      return { name, loaded: true };
    } catch (e) {
      return { loaded: false, error: e.message };
    }
  }

  /**
   * Load all skills from skills/ directory
   * @returns {Array}
   */
  loadAll() {
    const results = [];
    try {
      if (!fs.existsSync(SKILLS_DIR)) return results;
      const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const result = this.loadSkill(path.join(SKILLS_DIR, entry.name));
          results.push(result);
        }
      }
    } catch {}
    return results;
  }

  /**
   * Install a skill from URL (downloads zip or clones git repo)
   * @param {string} urlStr - URL to download from
   * @returns {Promise<{installed: boolean, name?: string, error?: string}>}
   */
  async installSkill(urlStr) {
    try {
      if (!urlStr) throw new Error('URL required');

      // Git clone
      if (urlStr.endsWith('.git') || urlStr.includes('github.com')) {
        const dirName = path.basename(urlStr, '.git').replace(/[^a-zA-Z0-9_-]/g, '-');
        const targetDir = path.join(SKILLS_DIR, dirName);
        if (fs.existsSync(targetDir)) throw new Error('Skill directory already exists');

        try {
          execSync(`git clone "${urlStr}" "${targetDir}"`, { timeout: 30000 });
        } catch (e) {
          throw new Error('Git clone failed: ' + e.message);
        }

        const result = this.loadSkill(targetDir);
        return { installed: result.loaded, name: result.name, error: result.error };
      }

      // For other URLs, download as zip (placeholder)
      return { installed: false, error: 'Only git URLs supported currently. Use: https://github.com/user/repo.git' };
    } catch (e) {
      return { installed: false, error: e.message };
    }
  }

  /**
   * Uninstall a skill
   * @param {string} name - Skill name
   * @returns {{uninstalled: boolean}}
   */
  uninstallSkill(name) {
    try {
      const skill = this._skills[name];
      if (!skill) return { uninstalled: false, error: 'Skill not found' };

      // Remove commands
      for (const cmd of skill.commands) {
        delete this._commands[cmd];
      }

      // Remove directory
      if (skill.path && fs.existsSync(skill.path)) {
        fs.rmSync(skill.path, { recursive: true, force: true });
      }

      delete this._skills[name];
      delete this._state[name];
      this._saveState();

      return { uninstalled: true };
    } catch (e) {
      return { uninstalled: false, error: e.message };
    }
  }

  /**
   * List installed skills
   * @returns {Array}
   */
  listSkills() {
    return Object.values(this._skills).map(s => ({
      name: s.name,
      version: s.version,
      description: s.description,
      author: s.author,
      commands: s.commands,
      tools: s.tools,
      status: s.status,
      loadedAt: s.loadedAt,
      hasHandler: !!s.handler,
      handlerError: s.handlerError || null
    }));
  }

  /**
   * Get all commands from all skills
   * @returns {object} Map of command -> skillName
   */
  getSkillCommands() {
    return { ...this._commands };
  }

  /**
   * Execute a skill command
   * @param {string} skillName - Skill name
   * @param {string} command - Command string
   * @param {object} args - Arguments
   * @returns {Promise<object>}
   */
  async executeSkillCommand(skillName, command, args = {}) {
    try {
      const skill = this._skills[skillName];
      if (!skill) return { success: false, error: 'Skill not found' };
      if (!skill.handler || typeof skill.handler.execute !== 'function') {
        return { success: false, error: 'Skill has no handler' };
      }
      const result = await skill.handler.execute(command, args);
      return { success: true, result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Get a skill by name
   * @param {string} name
   * @returns {object|null}
   */
  getSkill(name) {
    return this._skills[name] || null;
  }
}

module.exports = { SkillManager };
