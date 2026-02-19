/**
 * ARIES v5.0 — Intelligent Model Router
 * 
 * Routes tasks to the cheapest model that can handle them.
 * Simple tasks → Haiku, medium → Sonnet, complex → Opus.
 * Scores task complexity based on keywords, length, tool requirements.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

// Complexity indicators
const COMPLEX_KEYWORDS = [
  'architect', 'design system', 'refactor', 'optimize', 'security audit',
  'analyze', 'complex', 'multi-step', 'comprehensive', 'deep dive',
  'strategy', 'plan', 'review entire', 'rewrite', 'debug complex',
  'performance', 'scalability', 'trade-off', 'compare and contrast',
  'build from scratch', 'full implementation', 'production-ready',
  'database', 'authentication', 'deployment', 'microservice', 'pipeline',
  'unit test', 'integration test', 'error handling', 'full api', 'full rest',
  'from scratch', 'entire', 'complete system', 'end to end', 'e2e'
];

const MEDIUM_KEYWORDS = [
  'explain', 'summarize', 'write', 'code', 'implement', 'fix', 'update',
  'create', 'modify', 'test', 'convert', 'translate', 'research',
  'find', 'search', 'list', 'describe', 'compare', 'debug', 'improve'
];

const SIMPLE_KEYWORDS = [
  'hello', 'hi', 'thanks', 'yes', 'no', 'ok', 'help', 'what is',
  'define', 'when', 'where', 'who', 'how old', 'how many', 'format',
  'rename', 'ping', 'status', 'version', 'time', 'date'
];

const TOOL_HEAVY_PATTERNS = [
  /\bswarm\b/i, /\bmulti.*agent/i, /\bpipeline\b/i, /\bworkflow\b/i,
  /\bbrowse.*and.*extract/i, /\bscrape\b/i, /\bautomation\b/i
];

// Agent role complexity multipliers
const ROLE_MULTIPLIERS = {
  commander: 1.5,
  architect: 1.4,
  analyst: 1.3,
  security: 1.3,
  coder: 1.2,
  debugger: 1.2,
  optimizer: 1.2,
  researcher: 1.0,
  creative: 1.0,
  trader: 1.1,
  navigator: 0.9,
  scout: 0.8,
  executor: 1.0,
  scribe: 0.8,
};

/** @type {{ routed: number, byModel: Record<string, number>, avgComplexity: number }} */
let _stats = { routed: 0, byModel: {}, avgComplexity: 0, totalComplexity: 0 };

/**
 * Score task complexity (0-300+)
 * @param {string} task - The task description
 * @param {string} [agentRole] - The agent role handling the task
 * @returns {{ score: number, factors: string[] }}
 */
function scoreComplexity(task, agentRole) {
  if (!task) return { score: 0, factors: ['empty'] };

  const lower = task.toLowerCase();
  const factors = [];
  let score = 0;

  // Length factor (longer = more complex)
  const wordCount = task.split(/\s+/).length;
  score += Math.min(wordCount * 0.5, 50);
  if (wordCount > 100) factors.push('long-input');

  // Keyword matching
  let complexHits = 0;
  for (const kw of COMPLEX_KEYWORDS) {
    if (lower.includes(kw)) { complexHits++; score += 30; }
  }
  if (complexHits > 0) factors.push(`complex-keywords(${complexHits})`);

  let mediumHits = 0;
  for (const kw of MEDIUM_KEYWORDS) {
    if (lower.includes(kw)) { mediumHits++; score += 10; }
  }
  if (mediumHits > 0) factors.push(`medium-keywords(${mediumHits})`);

  let simpleHits = 0;
  for (const kw of SIMPLE_KEYWORDS) {
    if (lower.includes(kw)) { simpleHits++; score -= 5; }
  }
  if (simpleHits > 0) factors.push(`simple-keywords(${simpleHits})`);

  // Tool-heavy patterns
  for (const pat of TOOL_HEAVY_PATTERNS) {
    if (pat.test(task)) { score += 25; factors.push('tool-heavy'); break; }
  }

  // Code blocks suggest complexity
  const codeBlocks = (task.match(/```/g) || []).length / 2;
  if (codeBlocks > 0) { score += codeBlocks * 15; factors.push(`code-blocks(${codeBlocks})`); }

  // Question marks (simple questions)
  if (task.trim().endsWith('?') && wordCount < 15) { score -= 10; factors.push('simple-question'); }

  // Agent role multiplier
  if (agentRole) {
    const mult = ROLE_MULTIPLIERS[agentRole] || 1.0;
    score = Math.round(score * mult);
    if (mult !== 1.0) factors.push(`role-mult(${mult})`);
  }

  score = Math.max(0, score);
  return { score, factors };
}

/**
 * Route a task to the best model
 * @param {string} task - Task description
 * @param {string} [agentRole] - Agent role
 * @param {object} [configOverride] - Optional config override
 * @returns {{ model: string, complexity: number, tier: string, factors: string[] }}
 */
function routeModel(task, agentRole, configOverride) {
  let config;
  try {
    const cfgMod = require('./config');
    config = cfgMod._data && Object.keys(cfgMod._data).length > 0 ? cfgMod._data : require('../config.json');
  } catch { try { config = require('../config.json'); } catch { config = {}; } }
  if (configOverride) config = { ...config, ...configOverride };

  const routerCfg = config.smartRouter || {};
  if (!routerCfg.enabled) {
    // Disabled — use default model
    const defaultModel = config.models?.chat || config.gateway?.model || 'anthropic/claude-sonnet-4-20250514';
    return { model: defaultModel, complexity: -1, tier: 'default', factors: ['router-disabled'] };
  }

  const thresholds = routerCfg.thresholds || { simple: 50, medium: 150 };
  const models = config.models || {};

  // Model tiers (configurable, with sensible defaults)
  const tiers = routerCfg.tiers || {
    simple: models.simple || 'anthropic/claude-haiku-3',
    medium: models.research || models.swarmWorker || 'anthropic/claude-sonnet-4-20250514',
    complex: models.chat || models.coding || 'anthropic/claude-opus-4-6',
  };

  const { score, factors } = scoreComplexity(task, agentRole);

  let tier, model;
  if (score <= thresholds.simple) {
    tier = 'simple'; model = tiers.simple;
  } else if (score <= thresholds.medium) {
    tier = 'medium'; model = tiers.medium;
  } else {
    tier = 'complex'; model = tiers.complex;
  }

  // Update stats
  _stats.routed++;
  _stats.byModel[model] = (_stats.byModel[model] || 0) + 1;
  _stats.totalComplexity += score;
  _stats.avgComplexity = Math.round(_stats.totalComplexity / _stats.routed);

  return { model, complexity: score, tier, factors };
}

/**
 * Get routing statistics
 * @returns {object}
 */
function getStats() {
  return { ..._stats };
}

/**
 * Reset statistics
 */
function resetStats() {
  _stats = { routed: 0, byModel: {}, avgComplexity: 0, totalComplexity: 0 };
}

module.exports = { routeModel, scoreComplexity, getStats, resetStats };
