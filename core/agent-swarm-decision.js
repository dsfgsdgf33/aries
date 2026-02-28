// ============================================================================
// Aries Agent Swarm Decision-Making — core/agent-swarm-decision.js
// Democratic decision-making across multiple agents
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'swarm-decisions');

class AgentSwarmDecision {
  constructor(opts) {
    this.refs = opts || {};
    this.sessions = {};
    this._ensureDir();
    this._loadHistory();
  }

  _ensureDir() {
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  }

  _loadHistory() {
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
      for (const f of files.slice(-50)) { // load last 50
        try {
          const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
          this.sessions[data.id] = data;
        } catch (e) {}
      }
    } catch (e) {}
  }

  _save(session) {
    try {
      fs.writeFileSync(path.join(DATA_DIR, session.id + '.json'), JSON.stringify(session, null, 2));
    } catch (e) {}
  }

  // Start a new swarm decision session
  start(question, agentIds) {
    const id = 'swarm-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const session = {
      id,
      question,
      agents: agentIds || [],
      status: 'gathering', // gathering | debating | voting | complete
      answers: {},      // agentId -> { answer, reasoning }
      debate: [],        // [{ round, agentId, message, timestamp }]
      votes: {},         // agentId -> votedForAgentId
      consensus: null,
      confidence: 0,
      dissent: [],
      debateRound: 0,
      maxDebateRounds: 3,
      createdAt: Date.now(),
      completedAt: null
    };
    this.sessions[id] = session;
    this._save(session);
    return session;
  }

  // Agent submits their initial answer
  submitAnswer(sessionId, agentId, answer, reasoning) {
    const s = this.sessions[sessionId];
    if (!s) return { error: 'Session not found' };
    if (s.status !== 'gathering') return { error: 'Session not in gathering phase' };
    s.answers[agentId] = { answer, reasoning, timestamp: Date.now() };
    // Auto-advance to debate when all agents answered
    if (s.agents.length > 0 && Object.keys(s.answers).length >= s.agents.length) {
      s.status = 'debating';
    }
    this._save(s);
    return { success: true, session: s };
  }

  // Agent submits a debate message
  submitDebate(sessionId, agentId, message) {
    const s = this.sessions[sessionId];
    if (!s) return { error: 'Session not found' };
    if (s.status !== 'debating') return { error: 'Session not in debate phase' };
    s.debate.push({ round: s.debateRound, agentId, message, timestamp: Date.now() });
    // Check if all agents have spoken this round
    const agentsThisRound = new Set(s.debate.filter(d => d.round === s.debateRound).map(d => d.agentId));
    if (s.agents.length > 0 && agentsThisRound.size >= s.agents.length) {
      s.debateRound++;
      if (s.debateRound >= s.maxDebateRounds) {
        s.status = 'voting';
      }
    }
    this._save(s);
    return { success: true, session: s };
  }

  // Agent casts their vote (can't vote for self)
  submitVote(sessionId, agentId, votedFor) {
    const s = this.sessions[sessionId];
    if (!s) return { error: 'Session not found' };
    if (s.status !== 'voting') return { error: 'Session not in voting phase' };
    if (agentId === votedFor) return { error: 'Cannot vote for yourself' };
    s.votes[agentId] = votedFor;
    // Check if all voted
    if (s.agents.length > 0 && Object.keys(s.votes).length >= s.agents.length) {
      this._calculateConsensus(s);
    }
    this._save(s);
    return { success: true, session: s };
  }

  // Force advance phase
  advancePhase(sessionId) {
    const s = this.sessions[sessionId];
    if (!s) return { error: 'Session not found' };
    if (s.status === 'gathering') s.status = 'debating';
    else if (s.status === 'debating') s.status = 'voting';
    else if (s.status === 'voting') this._calculateConsensus(s);
    this._save(s);
    return { success: true, session: s };
  }

  _calculateConsensus(s) {
    // Count votes per agent
    const voteCounts = {};
    for (const [voter, votedFor] of Object.entries(s.votes)) {
      voteCounts[votedFor] = (voteCounts[votedFor] || 0) + 1;
    }
    // Find winner
    let maxVotes = 0;
    let winner = null;
    for (const [agentId, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) { maxVotes = count; winner = agentId; }
    }
    const totalVoters = Object.keys(s.votes).length;
    s.consensus = winner ? {
      winnerId: winner,
      winnerAnswer: s.answers[winner]?.answer || 'No answer',
      winnerReasoning: s.answers[winner]?.reasoning || '',
      voteCount: maxVotes,
      totalVotes: totalVoters
    } : null;
    s.confidence = totalVoters > 0 ? maxVotes / totalVoters : 0;
    // Dissent log
    s.dissent = [];
    for (const [agentId, data] of Object.entries(s.answers)) {
      if (agentId !== winner) {
        s.dissent.push({ agentId, answer: data.answer, reasoning: data.reasoning, votesReceived: voteCounts[agentId] || 0 });
      }
    }
    s.status = 'complete';
    s.completedAt = Date.now();
  }

  getSession(id) { return this.sessions[id] || null; }

  getHistory(limit) {
    const all = Object.values(this.sessions).sort((a, b) => b.createdAt - a.createdAt);
    return all.slice(0, limit || 20);
  }

  getVoteDistribution(sessionId) {
    const s = this.sessions[sessionId];
    if (!s) return {};
    const dist = {};
    for (const votedFor of Object.values(s.votes)) {
      dist[votedFor] = (dist[votedFor] || 0) + 1;
    }
    return dist;
  }

  // Register API routes
  registerRoutes(addRoute) {
    const self = this;

    addRoute('POST', '/api/swarm-intel/start', async (req, res, json, body) => {
      const data = JSON.parse(body);
      if (!data.question) return json(res, 400, { error: 'Missing question' });
      const session = self.start(data.question, data.agents || []);
      json(res, 200, session);
    });

    addRoute('GET', '/api/swarm-intel/history', async (req, res, json) => {
      json(res, 200, self.getHistory());
    });

    addRoute('GET', '/api/swarm-intel/', async (req, res, json) => {
      const url = require('url').parse(req.url);
      const parts = url.pathname.split('/');
      const id = parts[parts.length - 1];
      if (!id || id === 'history') return json(res, 400, { error: 'Missing session id' });
      const session = self.getSession(id);
      if (!session) return json(res, 404, { error: 'Session not found' });
      json(res, 200, session);
    }, { prefix: true });

    addRoute('POST', '/api/swarm-intel/answer', async (req, res, json, body) => {
      const data = JSON.parse(body);
      if (!data.sessionId || !data.agentId) return json(res, 400, { error: 'Missing sessionId or agentId' });
      const result = self.submitAnswer(data.sessionId, data.agentId, data.answer, data.reasoning);
      json(res, result.error ? 400 : 200, result);
    });

    addRoute('POST', '/api/swarm-intel/debate', async (req, res, json, body) => {
      const data = JSON.parse(body);
      if (!data.sessionId || !data.agentId) return json(res, 400, { error: 'Missing sessionId or agentId' });
      const result = self.submitDebate(data.sessionId, data.agentId, data.message);
      json(res, result.error ? 400 : 200, result);
    });

    addRoute('POST', '/api/swarm-intel/vote', async (req, res, json, body) => {
      const data = JSON.parse(body);
      if (!data.sessionId || !data.agentId) return json(res, 400, { error: 'Missing sessionId or agentId' });
      const result = self.submitVote(data.sessionId, data.agentId, data.votedFor);
      json(res, result.error ? 400 : 200, result);
    });

    addRoute('POST', '/api/swarm-intel/advance', async (req, res, json, body) => {
      const data = JSON.parse(body);
      if (!data.sessionId) return json(res, 400, { error: 'Missing sessionId' });
      const result = self.advancePhase(data.sessionId);
      json(res, result.error ? 400 : 200, result);
    });
  }
}

module.exports = AgentSwarmDecision;
