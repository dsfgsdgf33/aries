/**
 * ARIES — Skill Marketplace
 * Publish and discover AI-generated skills/plugins.
 * Local registry with future remote sync capability.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'marketplace');
const REGISTRY_PATH = path.join(DATA_DIR, 'registry.json');
const INSTALLED_PATH = path.join(DATA_DIR, 'installed.json');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const CATEGORIES = ['automation', 'analysis', 'integration', 'security', 'monitoring', 'content', 'trading', 'utility', 'ai', 'other'];

class SkillMarketplace {
  constructor(opts) {
    this.ai = opts && opts.ai;
    ensureDir();
  }

  /**
   * Publish a skill to the local registry
   */
  publish(skill) {
    if (!skill || !skill.name) return { error: 'Skill name is required' };

    const registry = readJSON(REGISTRY_PATH, []);

    // Check for duplicate name+version
    const exists = registry.find(s => s.name === skill.name && s.version === (skill.version || '1.0.0'));
    if (exists) return { error: 'Skill with this name and version already exists', existing: exists.id };

    const entry = {
      id: uuid(),
      name: skill.name,
      description: skill.description || '',
      author: skill.author || 'aries-local',
      version: skill.version || '1.0.0',
      code: skill.code || '',
      category: CATEGORIES.includes(skill.category) ? skill.category : 'other',
      downloads: 0,
      rating: 0,
      ratingCount: 0,
      dreamSource: skill.dreamSource || null,
      publishedAt: Date.now(),
      updatedAt: Date.now(),
      tags: skill.tags || [],
      size: (skill.code || '').length,
      installed: false,
    };

    registry.push(entry);
    writeJSON(REGISTRY_PATH, registry);
    return entry;
  }

  /**
   * Browse available skills
   */
  browse(category, query) {
    let registry = readJSON(REGISTRY_PATH, []);

    if (category && category !== 'all') {
      registry = registry.filter(s => s.category === category);
    }
    if (query) {
      const q = query.toLowerCase();
      registry = registry.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }

    return registry.sort((a, b) => b.downloads - a.downloads);
  }

  /**
   * Install a skill
   */
  install(skillId) {
    const registry = readJSON(REGISTRY_PATH, []);
    const skill = registry.find(s => s.id === skillId);
    if (!skill) return { error: 'Skill not found' };

    const installed = readJSON(INSTALLED_PATH, []);
    const alreadyInstalled = installed.find(s => s.id === skillId);
    if (alreadyInstalled) return { error: 'Skill already installed', skill: alreadyInstalled };

    // Mark as installed
    skill.downloads++;
    skill.installed = true;
    writeJSON(REGISTRY_PATH, registry);

    const installRecord = {
      id: skill.id,
      name: skill.name,
      version: skill.version,
      category: skill.category,
      installedAt: Date.now(),
      active: true,
    };
    installed.push(installRecord);
    writeJSON(INSTALLED_PATH, installed);

    return { success: true, skill: installRecord };
  }

  /**
   * Uninstall a skill
   */
  uninstall(skillId) {
    const installed = readJSON(INSTALLED_PATH, []);
    const idx = installed.findIndex(s => s.id === skillId);
    if (idx === -1) return { error: 'Skill not installed' };

    const removed = installed.splice(idx, 1)[0];
    writeJSON(INSTALLED_PATH, installed);

    // Update registry
    const registry = readJSON(REGISTRY_PATH, []);
    const regSkill = registry.find(s => s.id === skillId);
    if (regSkill) {
      regSkill.installed = false;
      writeJSON(REGISTRY_PATH, registry);
    }

    return { success: true, removed };
  }

  /**
   * Rate a skill
   */
  rate(skillId, rating) {
    if (rating < 1 || rating > 5) return { error: 'Rating must be 1-5' };

    const registry = readJSON(REGISTRY_PATH, []);
    const skill = registry.find(s => s.id === skillId);
    if (!skill) return { error: 'Skill not found' };

    // Simple running average
    const totalRating = skill.rating * skill.ratingCount + rating;
    skill.ratingCount++;
    skill.rating = Math.round((totalRating / skill.ratingCount) * 10) / 10;
    writeJSON(REGISTRY_PATH, registry);

    return { success: true, newRating: skill.rating, ratingCount: skill.ratingCount };
  }

  /**
   * Get skills published by this instance
   */
  getPublished() {
    const registry = readJSON(REGISTRY_PATH, []);
    return registry.filter(s => s.author === 'aries-local');
  }

  /**
   * Get installed skills
   */
  getInstalled() {
    return readJSON(INSTALLED_PATH, []);
  }

  /**
   * Get categories with counts
   */
  getCategories() {
    const registry = readJSON(REGISTRY_PATH, []);
    const counts = {};
    for (const cat of CATEGORIES) counts[cat] = 0;
    for (const s of registry) counts[s.category] = (counts[s.category] || 0) + 1;
    return { categories: CATEGORIES, counts };
  }

  /**
   * Get stats
   */
  getStats() {
    const registry = readJSON(REGISTRY_PATH, []);
    const installed = readJSON(INSTALLED_PATH, []);
    const totalDownloads = registry.reduce((s, r) => s + r.downloads, 0);
    const dreamGenerated = registry.filter(s => s.dreamSource).length;

    return {
      totalSkills: registry.length,
      installedCount: installed.length,
      totalDownloads,
      dreamGenerated,
      categories: this.getCategories(),
    };
  }
}

module.exports = SkillMarketplace;
