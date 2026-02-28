/**
 * ARIES — Generational Memory
 * Export/import the complete essence of an Aries instance.
 * DNA packages contain personality, knowledge, skills, emotions, dreams, and evolution history.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'dna');
const CURRENT_PATH = path.join(DATA_DIR, 'current.json');
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');
const BASE_DATA_DIR = path.join(__dirname, '..', 'data');

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

function hashData(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

class GenerationalMemory {
  constructor(opts) {
    this.ai = opts && opts.ai;
    ensureDir(DATA_DIR);
    ensureDir(EXPORTS_DIR);
    this._ensureCurrent();
  }

  _ensureCurrent() {
    if (!fs.existsSync(CURRENT_PATH)) {
      const initial = {
        instanceId: uuid(),
        generation: 1,
        createdAt: Date.now(),
        lastExportAt: null,
        lastImportAt: null,
        parentId: null,
        mutations: [],
        snapshot: null,
      };
      writeJSON(CURRENT_PATH, initial);
    }
  }

  /**
   * Export DNA — comprehensive essence of this instance
   */
  exportDNA() {
    const current = readJSON(CURRENT_PATH, {});

    // Gather all the data that makes up this instance's "DNA"
    const dna = {
      personality: this._gatherPersonality(),
      knowledge: this._gatherKnowledge(),
      skills: this._gatherSkills(),
      emotions: this._gatherEmotions(),
      dreams: this._gatherDreams(),
      userModel: this._gatherUserModel(),
      evolution: this._gatherEvolution(),
    };

    const dnaPackage = {
      version: '1.0.0',
      exportedAt: Date.now(),
      instanceId: current.instanceId,
      generation: current.generation,
      personalityHash: hashData(dna.personality),
      dna,
    };

    // Save export
    const exportFile = path.join(EXPORTS_DIR, `gen-${current.generation}-${Date.now()}.json`);
    writeJSON(exportFile, dnaPackage);

    // Update current state
    current.lastExportAt = Date.now();
    current.snapshot = hashData(dna);
    writeJSON(CURRENT_PATH, current);

    return dnaPackage;
  }

  /**
   * Import DNA — bootstrap from another instance's export
   */
  importDNA(dnaPackage) {
    if (!dnaPackage || !dnaPackage.dna) return { error: 'Invalid DNA package — missing dna field' };
    if (!dnaPackage.version) return { error: 'Invalid DNA package — missing version' };

    const current = readJSON(CURRENT_PATH, {});
    const dna = dnaPackage.dna;

    // Apply personality
    if (dna.personality) this._applyPersonality(dna.personality);

    // Apply knowledge
    if (dna.knowledge) this._applyKnowledge(dna.knowledge);

    // Apply skills
    if (dna.skills) this._applySkills(dna.skills);

    // Apply emotions
    if (dna.emotions) this._applyEmotions(dna.emotions);

    // Apply dream weights
    if (dna.dreams) this._applyDreams(dna.dreams);

    // Apply user model
    if (dna.userModel) this._applyUserModel(dna.userModel);

    // Update generation
    const newGeneration = (dnaPackage.generation || 1) + 1;
    current.generation = newGeneration;
    current.lastImportAt = Date.now();
    current.parentId = dnaPackage.instanceId;
    current.mutations = [];
    current.snapshot = hashData(dna);
    writeJSON(CURRENT_PATH, current);

    return {
      success: true,
      generation: newGeneration,
      parentId: dnaPackage.instanceId,
      importedAt: current.lastImportAt,
      applied: {
        personality: !!dna.personality,
        knowledge: !!dna.knowledge,
        skills: !!dna.skills,
        emotions: !!dna.emotions,
        dreams: !!dna.dreams,
        userModel: !!dna.userModel,
      },
    };
  }

  /**
   * Get current DNA status
   */
  getDNAStatus() {
    const current = readJSON(CURRENT_PATH, {});
    const currentDNA = {
      personality: this._gatherPersonality(),
      knowledge: this._gatherKnowledge(),
      skills: this._gatherSkills(),
      emotions: this._gatherEmotions(),
      dreams: this._gatherDreams(),
    };
    const currentHash = hashData(currentDNA);
    const drift = current.snapshot ? (currentHash !== current.snapshot) : false;

    // Count export files
    let exportCount = 0;
    try {
      exportCount = fs.readdirSync(EXPORTS_DIR).filter(f => f.endsWith('.json')).length;
    } catch {}

    return {
      instanceId: current.instanceId,
      generation: current.generation,
      createdAt: current.createdAt,
      lastExportAt: current.lastExportAt,
      lastImportAt: current.lastImportAt,
      parentId: current.parentId,
      drift,
      currentHash,
      snapshotHash: current.snapshot,
      totalExports: exportCount,
      mutationCount: (current.mutations || []).length,
    };
  }

  /**
   * Get mutations since last DNA export
   */
  getMutations() {
    const current = readJSON(CURRENT_PATH, {});
    const mutations = current.mutations || [];

    // Also detect live mutations by comparing current state to snapshot
    const liveMutations = [];
    const lastExport = current.lastExportAt || current.createdAt;

    // Check dream stats changes
    const dreamStats = readJSON(path.join(BASE_DATA_DIR, 'dreams', 'stats.json'), {});
    if (dreamStats.totalCycles > 0) {
      liveMutations.push({
        type: 'dreams',
        description: `${dreamStats.totalCycles || 0} dream cycles since creation`,
        timestamp: Date.now(),
      });
    }

    // Check knowledge growth
    const wiki = readJSON(path.join(BASE_DATA_DIR, 'knowledge', 'wiki.json'), []);
    if (wiki.length > 0) {
      liveMutations.push({
        type: 'knowledge',
        description: `${wiki.length} knowledge entries accumulated`,
        timestamp: Date.now(),
      });
    }

    // Check emotion patterns
    const moods = readJSON(path.join(BASE_DATA_DIR, 'emotions', 'mood-log.json'), []);
    if (moods.length > 0) {
      liveMutations.push({
        type: 'emotions',
        description: `${moods.length} mood entries recorded`,
        timestamp: Date.now(),
      });
    }

    return {
      stored: mutations,
      live: liveMutations,
      total: mutations.length + liveMutations.length,
      sinceExport: current.lastExportAt ? new Date(current.lastExportAt).toISOString() : 'never exported',
    };
  }

  /**
   * Record a mutation
   */
  recordMutation(type, description) {
    const current = readJSON(CURRENT_PATH, {});
    if (!current.mutations) current.mutations = [];
    current.mutations.push({
      id: uuid(),
      type,
      description,
      timestamp: Date.now(),
    });
    // Keep last 100 mutations
    if (current.mutations.length > 100) current.mutations = current.mutations.slice(-100);
    writeJSON(CURRENT_PATH, current);
  }

  // ═══════════════════════════════════════
  //  GATHER — collect data for DNA export
  // ═══════════════════════════════════════

  _gatherPersonality() {
    // Gather from various sources
    const config = readJSON(path.join(BASE_DATA_DIR, '..', 'config.json'), {});
    const personas = readJSON(path.join(BASE_DATA_DIR, 'personas.json'), []);

    return {
      systemPromptSummary: (config.systemPrompt || '').slice(0, 500),
      personas: personas.map(p => ({ name: p.name, traits: p.traits || p.description })).slice(0, 10),
      voiceConfig: config.voice || null,
      temperaturePreference: config.temperature || 0.7,
      modelPreference: config.model || null,
    };
  }

  _gatherKnowledge() {
    const wiki = readJSON(path.join(BASE_DATA_DIR, 'knowledge', 'wiki.json'), []);
    // Distill — keep top entries by importance/recency
    const distilled = wiki
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))
      .slice(0, 50)
      .map(e => ({
        title: e.title || e.key,
        content: (e.content || e.value || '').slice(0, 300),
        category: e.category,
      }));

    return { entryCount: wiki.length, topEntries: distilled };
  }

  _gatherSkills() {
    const skills = readJSON(path.join(BASE_DATA_DIR, 'skills.json'), []);
    const tools = readJSON(path.join(BASE_DATA_DIR, 'tools.json'), []);

    return {
      skillCount: skills.length,
      skills: skills.map(s => ({ name: s.name, level: s.level || 1 })).slice(0, 30),
      toolCount: tools.length,
      tools: tools.map(t => t.name || t.id).slice(0, 30),
    };
  }

  _gatherEmotions() {
    const moods = readJSON(path.join(BASE_DATA_DIR, 'emotions', 'mood-log.json'), []);
    const recent = moods.slice(-50);

    // Compute baseline
    const baseline = {};
    for (const m of recent) {
      const mood = m.mood || m.emotion || 'neutral';
      baseline[mood] = (baseline[mood] || 0) + 1;
    }

    return {
      totalEntries: moods.length,
      baseline,
      recentMoods: recent.slice(-10).map(m => ({ mood: m.mood || m.emotion, ts: m.timestamp })),
    };
  }

  _gatherDreams() {
    const stats = readJSON(path.join(BASE_DATA_DIR, 'dreams', 'stats.json'), {});
    const effectiveness = stats.dreamEffectiveness || {};

    return {
      totalCycles: stats.totalCycles || 0,
      effectiveness,
      proposalsGenerated: stats.proposalsGenerated || 0,
      proposalsApproved: stats.proposalsApproved || 0,
      proposalsBuilt: stats.proposalsBuilt || 0,
    };
  }

  _gatherUserModel() {
    const crossMem = readJSON(path.join(BASE_DATA_DIR, 'cross-memory', 'sessions.json'), []);
    const chatHistory = readJSON(path.join(BASE_DATA_DIR, 'chat-history.json'), []);

    // Extract patterns from chat history
    let topicFreq = {};
    for (const msg of chatHistory.slice(-100)) {
      if (msg.role !== 'user') continue;
      const words = (msg.content || '').toLowerCase().split(/\s+/).filter(w => w.length > 5);
      for (const w of words) topicFreq[w] = (topicFreq[w] || 0) + 1;
    }
    const topTopics = Object.entries(topicFreq).sort((a, b) => b[1] - a[1]).slice(0, 20).map(e => e[0]);

    return {
      sessionCount: crossMem.length,
      topTopics,
      conversationCount: chatHistory.length,
    };
  }

  _gatherEvolution() {
    const current = readJSON(CURRENT_PATH, {});
    return {
      generation: current.generation,
      mutations: (current.mutations || []).slice(-20),
      parentId: current.parentId,
    };
  }

  // ═══════════════════════════════════════
  //  APPLY — restore data from DNA import
  // ═══════════════════════════════════════

  _applyPersonality(personality) {
    // We don't overwrite the config, just record the DNA for reference
    this.recordMutation('personality', 'Imported personality traits from DNA');
  }

  _applyKnowledge(knowledge) {
    if (knowledge.topEntries && knowledge.topEntries.length > 0) {
      const wikiPath = path.join(BASE_DATA_DIR, 'knowledge', 'wiki.json');
      const existing = readJSON(wikiPath, []);
      let added = 0;
      for (const entry of knowledge.topEntries) {
        const exists = existing.find(e => (e.title || e.key) === entry.title);
        if (!exists) {
          existing.push({
            title: entry.title,
            content: entry.content,
            category: entry.category,
            importance: 5,
            source: 'dna-import',
            createdAt: Date.now(),
          });
          added++;
        }
      }
      if (added > 0) {
        ensureDir(path.dirname(wikiPath));
        writeJSON(wikiPath, existing);
        this.recordMutation('knowledge', `Imported ${added} knowledge entries from DNA`);
      }
    }
  }

  _applySkills(skills) {
    this.recordMutation('skills', `Imported skill profile: ${skills.skillCount} skills, ${skills.toolCount} tools`);
  }

  _applyEmotions(emotions) {
    this.recordMutation('emotions', `Imported emotional baseline from DNA`);
  }

  _applyDreams(dreams) {
    if (dreams.effectiveness) {
      const statsPath = path.join(BASE_DATA_DIR, 'dreams', 'stats.json');
      const stats = readJSON(statsPath, {});
      stats.dreamEffectiveness = { ...stats.dreamEffectiveness, ...dreams.effectiveness };
      ensureDir(path.dirname(statsPath));
      writeJSON(statsPath, stats);
      this.recordMutation('dreams', 'Imported dream effectiveness weights from DNA');
    }
  }

  _applyUserModel(userModel) {
    this.recordMutation('userModel', `Imported user model: ${userModel.topTopics.length} topic preferences`);
  }
}

module.exports = GenerationalMemory;
