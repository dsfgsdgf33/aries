/**
 * ARIES — Subconscious Processor
 * Background processing that churns on problems, bubbling up insights.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'subconscious');
const PROBLEMS_PATH = path.join(DATA_DIR, 'problems.json');
const INSIGHTS_PATH = path.join(DATA_DIR, 'insights.json');

const MAX_ATTEMPTS = 20;
const APPROACHES = [
  'Reframe the problem from the user\'s perspective',
  'Look for analogies in unrelated domains',
  'Break into smaller sub-problems',
  'Consider the opposite — what if the problem is actually the solution?',
  'Think about what information is missing',
  'Challenge the assumptions baked into the problem statement',
  'Look for patterns from similar past problems',
  'Consider edge cases that might reveal the core issue',
  'Think about it from first principles',
  'What would a 10x simpler version of the solution look like?',
  'Who else has solved this? What can we learn?',
  'Sleep on it — approach with fresh eyes',
  'Map dependencies — what does this problem connect to?',
  'Invert: instead of solving X, prevent X from being a problem',
  'Timeshift: how would this be solved in 5 years? 50 years ago?',
];

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

class SubconsciousProcessor {
  constructor(opts) {
    this.ai = opts && opts.ai;
    this._interval = null;
    ensureDir();
  }

  /**
   * Start background processing (every 5 min).
   */
  startProcessing() {
    if (this._interval) return;
    this._interval = setInterval(async () => {
      try { await this.process(); } catch (e) { console.error('[SUBCONSCIOUS] Error:', e.message); }
    }, 5 * 60 * 1000);
    if (this._interval.unref) this._interval.unref();
    console.log('[SUBCONSCIOUS] Background processing started (every 5 min)');
  }

  stopProcessing() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }

  /**
   * Add a problem to the subconscious queue.
   */
  addProblem(description, context, priority) {
    const problems = readJSON(PROBLEMS_PATH, []);
    const problem = {
      id: uuid(),
      description,
      context: context || null,
      priority: Math.max(1, Math.min(10, priority || 5)),
      status: 'active', // active | solved | abandoned
      attempts: [],
      attemptCount: 0,
      createdAt: Date.now(),
      resolvedAt: null,
      resolution: null,
    };
    problems.push(problem);
    if (problems.length > 200) problems.splice(0, problems.length - 200);
    writeJSON(PROBLEMS_PATH, problems);
    return problem;
  }

  /**
   * Background processing cycle: pick highest priority problem, think about it.
   */
  async process() {
    const problems = readJSON(PROBLEMS_PATH, []);
    const active = problems.filter(p => p.status === 'active').sort((a, b) => b.priority - a.priority);
    
    if (active.length === 0) return { processed: false, reason: 'No active problems' };

    const problem = active[0];
    
    // Check max attempts
    if (problem.attemptCount >= MAX_ATTEMPTS) {
      problem.status = 'abandoned';
      problem.resolvedAt = Date.now();
      problem.resolution = `Abandoned after ${MAX_ATTEMPTS} attempts. Approaches tried: ${problem.attempts.map(a => a.approach).join('; ')}`;
      writeJSON(PROBLEMS_PATH, problems);
      return { processed: true, abandoned: problem.id };
    }

    // Pick a new approach (avoid repeats)
    const usedApproaches = problem.attempts.map(a => a.approach);
    const available = APPROACHES.filter(a => !usedApproaches.includes(a));
    const approach = available.length > 0 ? pick(available) : pick(APPROACHES);

    const attempt = {
      attemptNumber: problem.attemptCount + 1,
      approach,
      insight: null,
      timestamp: Date.now(),
    };

    // Use AI to generate insight if available
    if (this.ai && typeof this.ai.chat === 'function') {
      try {
        const prevAttempts = problem.attempts.slice(-3).map(a => `Approach: ${a.approach}\nResult: ${a.insight || 'No insight'}`).join('\n\n');
        const resp = await this.ai.chat([
          { role: 'system', content: 'You are a subconscious problem processor. You think about problems from new angles and occasionally have breakthrough insights. If you find a genuine insight, say it clearly. If not, describe what new perspective you considered. Be concise. Return JSON: { "insight": "the insight or null", "isBreakthrough": true/false, "thinking": "what you considered" }' },
          { role: 'user', content: `Problem: "${problem.description}"\nContext: ${JSON.stringify(problem.context)}\n\nApproach: ${approach}\n\n${prevAttempts ? 'Previous attempts:\n' + prevAttempts : ''}\n\nThink about this problem using the given approach.` }
        ]);
        const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        try {
          const result = JSON.parse(text);
          attempt.insight = result.thinking || result.insight;
          if (result.isBreakthrough && result.insight) {
            this._bubbleInsight(problem, result.insight);
          }
        } catch {
          attempt.insight = resp.response ? resp.response.slice(0, 500) : null;
        }
      } catch (e) {
        attempt.insight = 'Processing error: ' + e.message;
      }
    } else {
      // Without AI, generate heuristic-based thinking
      attempt.insight = `Considering: ${approach}. Applied to "${problem.description.slice(0, 100)}". This angle suggests looking at the problem from a different perspective. More processing needed.`;
    }

    problem.attempts.push(attempt);
    problem.attemptCount++;
    writeJSON(PROBLEMS_PATH, problems);

    console.log(`[SUBCONSCIOUS] Processed "${problem.description.slice(0, 50)}..." (attempt ${problem.attemptCount}/${MAX_ATTEMPTS})`);
    return { processed: true, problemId: problem.id, attempt };
  }

  /**
   * Bubble up an insight from subconscious processing.
   */
  _bubbleInsight(problem, insightText) {
    const insights = readJSON(INSIGHTS_PATH, []);
    const insight = {
      id: uuid(),
      problemId: problem.id,
      problemDescription: problem.description,
      insight: insightText,
      timestamp: Date.now(),
      applied: false,
    };
    insights.push(insight);
    if (insights.length > 200) insights.splice(0, insights.length - 200);
    writeJSON(INSIGHTS_PATH, insights);
    console.log(`[SUBCONSCIOUS] 💡 INSIGHT bubbled up: "${insightText.slice(0, 80)}..."`);
    return insight;
  }

  /**
   * Get all bubbled-up insights.
   */
  getInsights(limit) {
    const insights = readJSON(INSIGHTS_PATH, []);
    return insights.slice(-(limit || 50)).reverse();
  }

  /**
   * Get active problems being worked on.
   */
  getActiveProblems() {
    const problems = readJSON(PROBLEMS_PATH, []);
    return problems.filter(p => p.status === 'active').sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get all problems with optional status filter.
   */
  getProblems(status) {
    const problems = readJSON(PROBLEMS_PATH, []);
    if (status) return problems.filter(p => p.status === status);
    return problems.slice(-100).reverse();
  }

  /**
   * Get processing history for a specific problem.
   */
  getProcessingHistory(problemId) {
    const problems = readJSON(PROBLEMS_PATH, []);
    const problem = problems.find(p => p.id === problemId);
    if (!problem) return { error: 'Problem not found' };
    return problem;
  }

  /**
   * Mark a problem as solved.
   */
  solveProblem(problemId, resolution) {
    const problems = readJSON(PROBLEMS_PATH, []);
    const problem = problems.find(p => p.id === problemId);
    if (!problem) return { error: 'Problem not found' };
    problem.status = 'solved';
    problem.resolvedAt = Date.now();
    problem.resolution = resolution || 'Marked as solved';
    writeJSON(PROBLEMS_PATH, problems);
    return problem;
  }
}

module.exports = SubconsciousProcessor;
