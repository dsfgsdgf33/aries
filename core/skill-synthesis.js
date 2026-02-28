/**
 * ARIES — Skill Synthesis
 * Track competency across skill areas with self-directed learning.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'skills');
const PROGRESS_PATH = path.join(DATA_DIR, 'progress.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

const DEFAULT_SKILLS = [
  { name: 'javascript', category: 'coding', icon: '🟨' },
  { name: 'python', category: 'coding', icon: '🐍' },
  { name: 'trading', category: 'finance', icon: '📈' },
  { name: 'research', category: 'intelligence', icon: '🔍' },
  { name: 'writing', category: 'creative', icon: '✍️' },
  { name: 'debugging', category: 'coding', icon: '🐛' },
  { name: 'architecture', category: 'coding', icon: '🏗️' },
  { name: 'testing', category: 'coding', icon: '🧪' },
  { name: 'security', category: 'coding', icon: '🛡️' },
  { name: 'ui-ux', category: 'creative', icon: '🎨' },
  { name: 'data-analysis', category: 'intelligence', icon: '📊' },
];

const PRACTICE_EXERCISES = {
  javascript: [
    { title: 'Implement a debounce function', difficulty: 'medium', description: 'Write a debounce function that delays invoking a function until after N ms have elapsed since the last call.' },
    { title: 'Build a simple event emitter', difficulty: 'medium', description: 'Create a class with on(), off(), and emit() methods.' },
    { title: 'Flatten a nested array', difficulty: 'easy', description: 'Write a function that flattens [1, [2, [3, 4]], 5] → [1, 2, 3, 4, 5].' },
    { title: 'Implement Promise.all', difficulty: 'hard', description: 'Write your own Promise.all that handles arrays of promises.' },
  ],
  python: [
    { title: 'Build a decorator for caching', difficulty: 'medium', description: 'Write a memoization decorator that caches function results.' },
    { title: 'Implement a simple web scraper', difficulty: 'medium', description: 'Parse HTML to extract all links from a page.' },
    { title: 'Create a CLI tool', difficulty: 'easy', description: 'Build a command-line tool that processes CSV files.' },
  ],
  debugging: [
    { title: 'Find the memory leak', difficulty: 'hard', description: 'Given a Node.js app that slowly consumes memory, identify and fix the leak.' },
    { title: 'Fix the race condition', difficulty: 'hard', description: 'Two async operations are producing inconsistent results. Find the race condition.' },
    { title: 'Debug the off-by-one', difficulty: 'easy', description: 'A pagination function shows duplicate items. Find the bug.' },
  ],
  architecture: [
    { title: 'Design a rate limiter', difficulty: 'medium', description: 'Design a rate limiting system that handles 1000 req/s with sliding window.' },
    { title: 'Design a plugin system', difficulty: 'hard', description: 'Architect a plugin system with lifecycle hooks, dependencies, and sandboxing.' },
  ],
  security: [
    { title: 'Audit an API for vulnerabilities', difficulty: 'medium', description: 'Review an Express API for common security issues (injection, auth bypass, etc).' },
    { title: 'Implement JWT auth', difficulty: 'medium', description: 'Build a complete JWT authentication flow with refresh tokens.' },
  ],
  research: [
    { title: 'Compare 3 competing technologies', difficulty: 'medium', description: 'Research and produce a comparison matrix for 3 tools in the same space.' },
    { title: 'Write a technical summary', difficulty: 'easy', description: 'Read a research paper and produce a 200-word summary with key takeaways.' },
  ],
  writing: [
    { title: 'Write API documentation', difficulty: 'medium', description: 'Document a REST API with endpoints, parameters, and examples.' },
    { title: 'Create a tutorial', difficulty: 'medium', description: 'Write a step-by-step tutorial for a technical concept.' },
  ],
  trading: [
    { title: 'Backtest a moving average strategy', difficulty: 'medium', description: 'Implement and backtest a simple moving average crossover strategy.' },
  ],
  'ui-ux': [
    { title: 'Design a dashboard layout', difficulty: 'medium', description: 'Create a responsive dashboard layout with CSS Grid.' },
  ],
  'data-analysis': [
    { title: 'Analyze a dataset', difficulty: 'medium', description: 'Given a CSV dataset, produce summary statistics and identify trends.' },
  ],
  testing: [
    { title: 'Write unit tests for a module', difficulty: 'easy', description: 'Write comprehensive tests for a utility module with edge cases.' },
  ],
};

class SkillSynthesis {
  constructor() {
    ensureDir();
    this._ensureDefaults();
  }

  _ensureDefaults() {
    const progress = readJSON(PROGRESS_PATH, null);
    if (progress) return;

    const skills = {};
    for (const s of DEFAULT_SKILLS) {
      skills[s.name] = {
        name: s.name,
        category: s.category,
        icon: s.icon,
        level: 0,
        experience: 0,
        lastPracticed: null,
        strengths: [],
        weaknesses: [],
        learningQueue: [],
        history: [],
      };
    }
    writeJSON(PROGRESS_PATH, skills);
  }

  /**
   * Record a skill practice with outcome.
   */
  recordPractice(skillName, outcome) {
    const skills = readJSON(PROGRESS_PATH, {});
    const skill = skills[skillName];
    if (!skill) return { error: 'Skill not found: ' + skillName };

    const success = outcome === 'success' || outcome === true;
    skill.experience = (skill.experience || 0) + 1;
    skill.lastPracticed = Date.now();

    // Track history
    skill.history = skill.history || [];
    skill.history.push({
      timestamp: Date.now(),
      outcome: success ? 'success' : 'failure',
    });
    if (skill.history.length > 100) skill.history = skill.history.slice(-100);

    // Level up on success
    if (success) {
      const gain = Math.max(1, Math.floor(10 - skill.level / 15));
      skill.level = Math.min(100, skill.level + gain);
    } else {
      // Small XP gain even on failure
      skill.level = Math.min(100, skill.level + 1);
    }

    writeJSON(PROGRESS_PATH, skills);
    return skill;
  }

  /**
   * Assess current skill level based on history.
   */
  assessSkill(skillName) {
    const skills = readJSON(PROGRESS_PATH, {});
    const skill = skills[skillName];
    if (!skill) return { error: 'Skill not found' };

    const history = skill.history || [];
    const recent = history.slice(-20);
    const successRate = recent.length > 0
      ? recent.filter(h => h.outcome === 'success').length / recent.length
      : 0;

    const daysSinceLastPractice = skill.lastPracticed
      ? Math.floor((Date.now() - skill.lastPracticed) / 86400000)
      : null;

    // Decay if not practiced recently
    let effectiveLevel = skill.level;
    if (daysSinceLastPractice !== null && daysSinceLastPractice > 14) {
      effectiveLevel = Math.max(0, skill.level - Math.floor(daysSinceLastPractice / 7));
    }

    return {
      ...skill,
      effectiveLevel,
      successRate: Math.round(successRate * 100),
      recentAttempts: recent.length,
      daysSinceLastPractice,
      status: effectiveLevel >= 80 ? 'expert' : effectiveLevel >= 50 ? 'proficient' : effectiveLevel >= 20 ? 'learning' : 'beginner',
    };
  }

  /**
   * Get weakest skills that need improvement.
   */
  getWeakest(limit) {
    const skills = readJSON(PROGRESS_PATH, {});
    return Object.values(skills)
      .sort((a, b) => (a.level || 0) - (b.level || 0))
      .slice(0, limit || 5)
      .map(s => this.assessSkill(s.name));
  }

  /**
   * Generate a practice exercise for a skill.
   */
  generatePractice(skillName) {
    const exercises = PRACTICE_EXERCISES[skillName] || PRACTICE_EXERCISES.javascript;
    const skill = this.assessSkill(skillName);

    // Pick exercise matching difficulty
    let pool;
    if (skill.effectiveLevel < 30) {
      pool = exercises.filter(e => e.difficulty === 'easy');
    } else if (skill.effectiveLevel < 70) {
      pool = exercises.filter(e => e.difficulty === 'medium');
    } else {
      pool = exercises.filter(e => e.difficulty === 'hard');
    }

    if (pool.length === 0) pool = exercises;
    const exercise = pool[Math.floor(Math.random() * pool.length)];

    return {
      skill: skillName,
      currentLevel: skill.effectiveLevel,
      exercise,
    };
  }

  /**
   * Level up a skill manually.
   */
  levelUp(skillName, amount) {
    const skills = readJSON(PROGRESS_PATH, {});
    const skill = skills[skillName];
    if (!skill) return { error: 'Skill not found' };

    skill.level = Math.min(100, skill.level + (amount || 5));
    skill.lastPracticed = Date.now();
    writeJSON(PROGRESS_PATH, skills);
    return skill;
  }

  /**
   * Get all skills.
   */
  getAll() {
    const skills = readJSON(PROGRESS_PATH, {});
    return Object.values(skills).map(s => this.assessSkill(s.name));
  }

  /**
   * Get a single skill.
   */
  getSkill(name) {
    return this.assessSkill(name);
  }
}

module.exports = SkillSynthesis;
