// ============================================================================
// Aries Cognitive Architecture Swap — core/cognitive-architectures.js
// Switch an agent's entire thinking framework on the fly
// ============================================================================

const fs = require('fs');
const path = require('path');

const ASSIGNMENTS_PATH = path.join(__dirname, '..', 'data', 'cognitive-assignments.json');
const CUSTOM_PATH = path.join(__dirname, '..', 'data', 'cognitive-custom.json');

const BUILT_IN = {
  scientist: {
    name: 'Scientific Method',
    steps: ['Observe', 'Hypothesize', 'Experiment', 'Analyze', 'Conclude'],
    prompt: 'Think like a scientist. First observe the problem, form a hypothesis, design an experiment to test it, analyze results, draw conclusions. Show your reasoning at each step.'
  },
  lawyer: {
    name: 'Legal Reasoning',
    steps: ['Precedent', 'Argument', 'Counter-argument', 'Ruling'],
    prompt: 'Think like a lawyer. Research precedent, build your argument with evidence, anticipate and address counter-arguments, deliver a ruling/recommendation.'
  },
  engineer: {
    name: 'Engineering Design',
    steps: ['Constraints', 'Design', 'Build', 'Test', 'Iterate'],
    prompt: 'Think like an engineer. Identify constraints and requirements, design a solution within those constraints, implement it, test against requirements, iterate on failures.'
  },
  philosopher: {
    name: 'Socratic Method',
    steps: ['Question', 'Examine', 'Challenge', 'Synthesize'],
    prompt: 'Think like a philosopher. Question assumptions, examine evidence from multiple perspectives, challenge your own conclusions, synthesize a deeper understanding.'
  },
  strategist: {
    name: 'Military Strategy',
    steps: ['Intel', 'Objective', 'Plan', 'Execute', 'Adapt'],
    prompt: 'Think like a military strategist. Gather intelligence, define clear objectives, plan your approach with contingencies, execute decisively, adapt to changing conditions.'
  },
  artist: {
    name: 'Creative Process',
    steps: ['Inspire', 'Explore', 'Create', 'Refine', 'Present'],
    prompt: 'Think like an artist. Draw inspiration from unexpected sources, explore wild ideas without judgment, create freely, refine with critical eye, present with confidence.'
  },
  detective: {
    name: 'Deductive Reasoning',
    steps: ['Clues', 'Suspects', 'Deduce', 'Verify', 'Solve'],
    prompt: 'Think like a detective. Gather all clues, identify suspects/possibilities, deduce through elimination, verify your theory, present your solution.'
  }
};

class CognitiveArchitectures {
  constructor() {
    this.assignments = this._loadJSON(ASSIGNMENTS_PATH, {});
    this.custom = this._loadJSON(CUSTOM_PATH, {});
  }

  _loadJSON(p, fallback) {
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {}
    return fallback;
  }

  _saveJSON(p, data) {
    try {
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, JSON.stringify(data, null, 2));
    } catch (e) {}
  }

  getAllArchitectures() {
    const all = { ...BUILT_IN };
    for (const [k, v] of Object.entries(this.custom)) {
      all[k] = v;
    }
    return all;
  }

  getArchitecture(key) {
    return BUILT_IN[key] || this.custom[key] || null;
  }

  // Apply architecture to an agent
  apply(agentId, architectureKey) {
    const arch = this.getArchitecture(architectureKey);
    if (!arch) return { error: 'Unknown architecture: ' + architectureKey };
    this.assignments[agentId] = { key: architectureKey, appliedAt: Date.now(), currentStep: 0 };
    this._saveJSON(ASSIGNMENTS_PATH, this.assignments);
    return { success: true, agentId, architecture: architectureKey, name: arch.name };
  }

  // Clear architecture from agent
  clear(agentId) {
    delete this.assignments[agentId];
    this._saveJSON(ASSIGNMENTS_PATH, this.assignments);
    return { success: true, agentId };
  }

  // Get active architecture for an agent
  getActive(agentId) {
    const a = this.assignments[agentId];
    if (!a) return null;
    const arch = this.getArchitecture(a.key);
    if (!arch) return null;
    return { ...arch, key: a.key, currentStep: a.currentStep || 0, appliedAt: a.appliedAt };
  }

  // Get all active assignments
  getAssignments() {
    const result = {};
    for (const [agentId, a] of Object.entries(this.assignments)) {
      const arch = this.getArchitecture(a.key);
      if (arch) result[agentId] = { ...a, name: arch.name, steps: arch.steps };
    }
    return result;
  }

  // Advance step for an agent
  advanceStep(agentId) {
    const a = this.assignments[agentId];
    if (!a) return;
    const arch = this.getArchitecture(a.key);
    if (!arch) return;
    a.currentStep = Math.min((a.currentStep || 0) + 1, arch.steps.length - 1);
    this._saveJSON(ASSIGNMENTS_PATH, this.assignments);
  }

  // Get prompt prefix for an agent (to inject into system prompt)
  getPromptPrefix(agentId) {
    const active = this.getActive(agentId);
    if (!active) return '';
    const stepInfo = active.steps.map((s, i) => (i === active.currentStep ? '→ ' : '  ') + (i + 1) + '. ' + s).join('\n');
    return '[COGNITIVE ARCHITECTURE: ' + active.name + ']\n' + active.prompt + '\n\nCurrent thinking steps:\n' + stepInfo + '\n\nYou are currently on step ' + (active.currentStep + 1) + ': ' + active.steps[active.currentStep] + '. Focus your response through this lens.\n\n';
  }

  // Create custom architecture
  createCustom(key, data) {
    if (BUILT_IN[key]) return { error: 'Cannot override built-in architecture' };
    if (!data.name || !data.steps || !data.prompt) return { error: 'Missing name, steps, or prompt' };
    this.custom[key] = { name: data.name, steps: data.steps, prompt: data.prompt, custom: true, createdAt: Date.now() };
    this._saveJSON(CUSTOM_PATH, this.custom);
    return { success: true, key };
  }

  // Delete custom architecture
  deleteCustom(key) {
    if (!this.custom[key]) return { error: 'Not found or is built-in' };
    delete this.custom[key];
    this._saveJSON(CUSTOM_PATH, this.custom);
    // Also clear any assignments using this
    for (const [agentId, a] of Object.entries(this.assignments)) {
      if (a.key === key) delete this.assignments[agentId];
    }
    this._saveJSON(ASSIGNMENTS_PATH, this.assignments);
    return { success: true };
  }

  // Register API routes
  registerRoutes(addRoute) {
    const self = this;

    addRoute('GET', '/api/cognitive/architectures', async (req, res, json) => {
      json(res, 200, self.getAllArchitectures());
    });

    addRoute('GET', '/api/cognitive/assignments', async (req, res, json) => {
      json(res, 200, self.getAssignments());
    });

    addRoute('POST', '/api/cognitive/apply', async (req, res, json, body) => {
      const data = JSON.parse(body);
      if (!data.agentId || !data.architecture) return json(res, 400, { error: 'Missing agentId or architecture' });
      const result = self.apply(data.agentId, data.architecture);
      json(res, result.error ? 400 : 200, result);
    });

    addRoute('DELETE', '/api/cognitive/clear/', async (req, res, json) => {
      const url = require('url').parse(req.url);
      const agentId = url.pathname.replace('/api/cognitive/clear/', '');
      if (!agentId) return json(res, 400, { error: 'Missing agentId' });
      json(res, 200, self.clear(agentId));
    }, { prefix: true });

    addRoute('POST', '/api/cognitive/custom', async (req, res, json, body) => {
      const data = JSON.parse(body);
      if (!data.key) return json(res, 400, { error: 'Missing key' });
      const result = self.createCustom(data.key, data);
      json(res, result.error ? 400 : 200, result);
    });

    addRoute('POST', '/api/cognitive/advance', async (req, res, json, body) => {
      const data = JSON.parse(body);
      if (!data.agentId) return json(res, 400, { error: 'Missing agentId' });
      self.advanceStep(data.agentId);
      json(res, 200, { success: true, active: self.getActive(data.agentId) });
    });
  }
}

module.exports = CognitiveArchitectures;
