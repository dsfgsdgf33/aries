/**
 * ARIES v5.0 — Multi-Agent Debate System
 * 
 * Multiple agents argue different perspectives, then Commander
 * synthesizes a consensus with confidence score.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', 'data', 'debates.json');

class AgentDebate extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI core module
   * @param {object} opts.config - debate config section
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || null;
    this.config = opts.config || {};
    this.defaultRounds = this.config.defaultRounds || 2;
    this.maxAgents = this.config.maxAgents || 4;
    this._debates = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {}
    return [];
  }

  _save() {
    try {
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(this._debates.slice(-200), null, 2));
    } catch {}
  }

  /**
   * Start a multi-agent debate
   * @param {string} topic - The question or topic to debate
   * @param {string[]} [agents] - Agent IDs to participate (2-4). If omitted, auto-selected.
   * @param {number} [rounds] - Number of debate rounds (default 2)
   * @returns {object} Debate transcript with consensus
   */
  async debate(topic, agents, rounds) {
    rounds = rounds || this.defaultRounds;

    // Auto-select agents if not provided
    if (!agents || agents.length < 2) {
      agents = this._autoSelectAgents(topic);
    }
    agents = agents.slice(0, this.maxAgents);

    const debateId = crypto.randomBytes(6).toString('hex');
    const transcript = {
      id: debateId,
      topic,
      agents,
      rounds,
      createdAt: Date.now(),
      entries: [],
      consensus: null,
      confidence: null,
    };

    this.emit('debate-start', { id: debateId, topic, agents });

    // Assign viewpoints
    const viewpoints = await this._assignViewpoints(topic, agents);

    // Round 1: Initial arguments
    for (const agent of agents) {
      const viewpoint = viewpoints[agent] || 'Present your perspective';
      const messages = [
        { role: 'system', content: `You are ${agent.toUpperCase()}, a specialist AI agent. You are participating in a structured debate.\n\nYour assigned viewpoint: ${viewpoint}\n\nPresent a strong, well-reasoned argument for your position. Be specific with evidence and reasoning. Keep to 200-400 words.` },
        { role: 'user', content: `Topic: ${topic}\n\nPresent your opening argument.` }
      ];

      try {
        const data = await this.ai.callWithFallback(messages, null);
        const content = data.choices?.[0]?.message?.content || '';
        transcript.entries.push({
          round: 1,
          agent,
          type: 'argument',
          viewpoint,
          content,
          timestamp: Date.now(),
        });
        this.emit('debate-entry', { id: debateId, round: 1, agent, content });
      } catch (e) {
        transcript.entries.push({ round: 1, agent, type: 'error', content: e.message, timestamp: Date.now() });
      }
    }

    // Round 2+: Rebuttals
    for (let round = 2; round <= rounds; round++) {
      const previousArgs = transcript.entries
        .filter(e => e.round === round - 1 && e.type !== 'error')
        .map(e => `**${e.agent}** (${e.viewpoint}): ${e.content}`)
        .join('\n\n---\n\n');

      for (const agent of agents) {
        const otherArgs = transcript.entries
          .filter(e => e.round === round - 1 && e.agent !== agent && e.type !== 'error')
          .map(e => `${e.agent}: ${e.content}`)
          .join('\n\n');

        const messages = [
          { role: 'system', content: `You are ${agent.toUpperCase()}. This is round ${round} of the debate. Respond to the other agents' arguments. Challenge weaknesses, acknowledge strong points, and strengthen your position. Keep to 150-300 words.` },
          { role: 'user', content: `Topic: ${topic}\n\nOther agents' arguments:\n${otherArgs}\n\nProvide your rebuttal.` }
        ];

        try {
          const data = await this.ai.callWithFallback(messages, null);
          const content = data.choices?.[0]?.message?.content || '';
          transcript.entries.push({
            round,
            agent,
            type: 'rebuttal',
            content,
            timestamp: Date.now(),
          });
          this.emit('debate-entry', { id: debateId, round, agent, content });
        } catch (e) {
          transcript.entries.push({ round, agent, type: 'error', content: e.message, timestamp: Date.now() });
        }
      }
    }

    // Commander synthesizes consensus
    const allEntries = transcript.entries
      .filter(e => e.type !== 'error')
      .map(e => `[Round ${e.round}] ${e.agent} (${e.viewpoint || 'rebuttal'}): ${e.content}`)
      .join('\n\n---\n\n');

    const consensusMessages = [
      {
        role: 'system',
        content: `You are COMMANDER, the synthesis agent. Multiple agents debated a topic. Analyze all arguments and produce:
1. A balanced consensus that weighs the strongest arguments
2. A confidence score (0.0 to 1.0) representing how much agreement exists
3. Key areas of agreement and disagreement
4. A final recommendation

Format your response as:
**Consensus:** [your synthesis]
**Confidence:** [0.0-1.0]
**Agreements:** [bullet points]
**Disagreements:** [bullet points]
**Recommendation:** [final recommendation]`
      },
      { role: 'user', content: `Topic: ${topic}\n\nDebate transcript:\n${allEntries}` }
    ];

    try {
      const data = await this.ai.callWithFallback(consensusMessages, null);
      const content = data.choices?.[0]?.message?.content || '';
      transcript.consensus = content;

      // Extract confidence score
      const confMatch = content.match(/\*\*Confidence:\*\*\s*([\d.]+)/);
      transcript.confidence = confMatch ? parseFloat(confMatch[1]) : 0.5;
    } catch (e) {
      transcript.consensus = `Synthesis failed: ${e.message}`;
      transcript.confidence = 0;
    }

    this.emit('debate-complete', { id: debateId, consensus: transcript.consensus, confidence: transcript.confidence });

    // Save
    this._debates.push(transcript);
    this._save();

    return transcript;
  }

  /**
   * Get a debate transcript by ID
   * @param {string} debateId
   */
  getTranscript(debateId) {
    return this._debates.find(d => d.id === debateId) || null;
  }

  /**
   * List all debates
   */
  listDebates() {
    return this._debates.map(d => ({
      id: d.id,
      topic: d.topic,
      agents: d.agents,
      rounds: d.rounds,
      confidence: d.confidence,
      createdAt: d.createdAt,
      entryCount: d.entries.length,
    }));
  }

  // ── Internal ──

  _autoSelectAgents(topic) {
    const lower = topic.toLowerCase();
    const picks = [];

    // Always include analyst
    picks.push('analyst');

    if (/code|program|software|tech|build|implement/.test(lower)) picks.push('coder');
    else if (/market|trade|invest|stock|crypto|financ/.test(lower)) picks.push('trader');
    else picks.push('researcher');

    if (/secur|risk|threat|vuln/.test(lower)) picks.push('security');
    else if (/design|architect|system|scale/.test(lower)) picks.push('architect');
    else picks.push('creative');

    // Add a 4th if we only have 3
    if (picks.length < 4) {
      const extras = ['researcher', 'coder', 'creative', 'security', 'architect', 'trader'];
      for (const e of extras) {
        if (!picks.includes(e)) { picks.push(e); break; }
      }
    }

    return picks.slice(0, 4);
  }

  async _assignViewpoints(topic, agents) {
    const messages = [
      {
        role: 'system',
        content: `Assign opposing viewpoints to each agent for a debate on the given topic. Each agent should argue a distinct perspective. Return ONLY a JSON object mapping agent IDs to their assigned viewpoint string.
Example: {"analyst":"Focus on data-driven risk assessment","creative":"Advocate for innovative unconventional approaches"}`
      },
      { role: 'user', content: `Topic: ${topic}\nAgents: ${agents.join(', ')}` }
    ];

    try {
      const data = await this.ai.callWithFallback(messages, null);
      const content = data.choices?.[0]?.message?.content || '{}';
      const match = content.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch {}

    // Fallback: generic viewpoints
    const generic = ['Argue FOR the proposition', 'Argue AGAINST the proposition', 'Present a moderate middle-ground', 'Play devil\'s advocate'];
    const result = {};
    agents.forEach((a, i) => { result[a] = generic[i % generic.length]; });
    return result;
  }
}

module.exports = { AgentDebate };
