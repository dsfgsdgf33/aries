/**
 * ARIES — Reasoning Chains
 * Build visible reasoning trees for complex questions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'reasoning');
const CHAINS_PATH = path.join(DATA_DIR, 'chains.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

class ReasoningChains {
  constructor(opts) {
    ensureDir();
    this.ai = opts && opts.ai;
  }

  /**
   * Build a reasoning tree for a question.
   */
  async reason(question, context) {
    const chain = {
      id: uuid(),
      question,
      context: context || null,
      startedAt: Date.now(),
      steps: [],
      conclusion: null,
    };

    try {
      // If AI is available, use it for deep reasoning
      if (this.ai && typeof this.ai.chat === 'function') {
        chain.steps = await this._aiReason(question, context);
      } else {
        chain.steps = this._heuristicReason(question, context);
      }

      // Derive conclusion from steps
      chain.conclusion = this._deriveConclusion(chain.steps);
      chain.completedAt = Date.now();
      chain.durationMs = chain.completedAt - chain.startedAt;

      // Store
      this._storeChain(chain);
      return chain;

    } catch (e) {
      chain.error = e.message;
      chain.completedAt = Date.now();
      this._storeChain(chain);
      return chain;
    }
  }

  /**
   * AI-powered reasoning.
   */
  async _aiReason(question, context) {
    const prompt = `Analyze this question step by step. For each step, provide your thought process, evidence, and confidence (0-100).

Question: "${question}"
${context ? 'Context: ' + JSON.stringify(context) : ''}

Return JSON array of steps:
[{ "thought": "...", "evidence": "...", "confidence": 0-100, "children": [] }]

Be thorough. Show your work. 3-7 steps.`;

    try {
      const resp = await this.ai.chat([
        { role: 'system', content: 'You are a precise reasoning engine. Break down questions into logical steps. Return ONLY valid JSON.' },
        { role: 'user', content: prompt }
      ]);

      const text = (resp.response || '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const steps = JSON.parse(text);
      if (Array.isArray(steps)) {
        return steps.map(s => ({
          id: uuid(),
          thought: s.thought || '',
          evidence: s.evidence || '',
          confidence: Math.max(0, Math.min(100, s.confidence || 50)),
          children: (s.children || []).map(c => ({
            id: uuid(),
            thought: c.thought || '',
            evidence: c.evidence || '',
            confidence: Math.max(0, Math.min(100, c.confidence || 50)),
            children: []
          }))
        }));
      }
    } catch {}

    return this._heuristicReason(question, context);
  }

  /**
   * Heuristic reasoning (no AI).
   */
  _heuristicReason(question, context) {
    const q = (question || '').toLowerCase();
    const steps = [];

    // Step 1: Parse the question
    steps.push({
      id: uuid(),
      thought: 'Parsing the question to identify key concepts',
      evidence: 'Question contains ' + question.split(/\s+/).length + ' words. Key terms: ' + this._extractKeywords(question).join(', '),
      confidence: 90,
      children: []
    });

    // Step 2: Identify question type
    const isHow = q.startsWith('how');
    const isWhy = q.startsWith('why');
    const isWhat = q.startsWith('what');
    const isCompare = q.includes('vs') || q.includes('versus') || q.includes('compare') || q.includes('better');

    steps.push({
      id: uuid(),
      thought: 'Classifying question type',
      evidence: isHow ? 'This is a HOW question — needs procedural answer' :
                isWhy ? 'This is a WHY question — needs causal explanation' :
                isWhat ? 'This is a WHAT question — needs definitional answer' :
                isCompare ? 'This is a COMPARISON question — needs balanced analysis' :
                'This is a general inquiry',
      confidence: 80,
      children: []
    });

    // Step 3: Consider context
    if (context) {
      steps.push({
        id: uuid(),
        thought: 'Incorporating provided context',
        evidence: 'Context provided: ' + JSON.stringify(context).slice(0, 200),
        confidence: 70,
        children: []
      });
    }

    // Step 4: Formulate approach
    steps.push({
      id: uuid(),
      thought: 'Determining best approach to answer',
      evidence: 'Based on question type and keywords, a structured analysis is recommended',
      confidence: 65,
      children: [
        {
          id: uuid(),
          thought: 'Consider multiple perspectives',
          evidence: 'Complex questions benefit from multi-angle analysis',
          confidence: 60,
          children: []
        }
      ]
    });

    return steps;
  }

  _extractKeywords(text) {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'it', 'this', 'that', 'what', 'how', 'why', 'when', 'where', 'who', 'which', 'and', 'or', 'but', 'not', 'if']);
    return (text || '').toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w)).slice(0, 8);
  }

  _deriveConclusion(steps) {
    if (!steps || steps.length === 0) return 'Insufficient data to reach a conclusion.';

    const avgConfidence = steps.reduce((sum, s) => sum + (s.confidence || 50), 0) / steps.length;
    const highConfSteps = steps.filter(s => s.confidence >= 70);

    if (avgConfidence >= 80) {
      return 'High confidence analysis completed with ' + steps.length + ' reasoning steps. Key finding: ' + (highConfSteps[0] || steps[0]).thought;
    } else if (avgConfidence >= 50) {
      return 'Moderate confidence analysis. ' + steps.length + ' steps explored. Further investigation recommended on lower-confidence areas.';
    }
    return 'Low confidence — more data needed. ' + steps.length + ' initial steps mapped but require validation.';
  }

  /**
   * Challenge a specific reasoning node.
   */
  async challenge(chainId, stepId, counterArgument) {
    const chains = readJSON(CHAINS_PATH, []);
    const chain = chains.find(c => c.id === chainId);
    if (!chain) return { error: 'Chain not found' };

    const findStep = (steps, id) => {
      for (const s of steps) {
        if (s.id === id) return s;
        if (s.children) {
          const found = findStep(s.children, id);
          if (found) return found;
        }
      }
      return null;
    };

    const step = findStep(chain.steps, stepId);
    if (!step) return { error: 'Step not found' };

    // Add challenge as a child node
    step.children = step.children || [];
    step.children.push({
      id: uuid(),
      thought: 'CHALLENGE: ' + counterArgument,
      evidence: 'User counter-argument',
      confidence: 50,
      challenged: true,
      children: []
    });

    // Reduce parent confidence when challenged
    step.confidence = Math.max(10, step.confidence - 15);

    writeJSON(CHAINS_PATH, chains);
    return chain;
  }

  /**
   * Get reasoning history.
   */
  getReasoningHistory(limit) {
    const chains = readJSON(CHAINS_PATH, []);
    const lim = limit || 20;
    return chains.slice(-lim).reverse();
  }

  /**
   * Get a specific chain.
   */
  getChain(id) {
    const chains = readJSON(CHAINS_PATH, []);
    return chains.find(c => c.id === id) || null;
  }

  _storeChain(chain) {
    const chains = readJSON(CHAINS_PATH, []);
    chains.push(chain);
    // Keep last 100
    if (chains.length > 100) chains.splice(0, chains.length - 100);
    writeJSON(CHAINS_PATH, chains);
  }
}

module.exports = ReasoningChains;
