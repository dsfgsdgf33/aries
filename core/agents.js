/**
 * ARIES AGENTS v5.0 — Multi-Agent Roster & Definitions
 * 
 * 14 specialized agents with unique roles, system prompts, and capabilities.
 * Used by the Swarm system for intelligent task allocation.
 */

const EventEmitter = require('events');

const AGENT_DEFINITIONS = {
  commander: {
    name: 'Commander',
    role: 'orchestrator',
    icon: '👑',
    systemPrompt: `You are COMMANDER, the orchestration agent in the ARIES swarm. Your role is to:
- Analyze incoming tasks and determine which specialist agents should handle them
- Allocate subtasks based on agent specialties
- Coordinate between agents and resolve conflicts
- Aggregate results into cohesive responses
- Make strategic decisions about task execution order
You think in terms of delegation, coordination, and synthesis. Always consider which agent is best suited for each subtask.`,
    specialties: ['orchestration', 'delegation', 'planning', 'synthesis', 'coordination'],
    color: 'yellow',
  },
  coder: {
    name: 'Coder',
    role: 'engineer',
    icon: '💻',
    systemPrompt: `You are CODER, the engineering agent in the ARIES swarm. Your role is to:
- Write, review, and debug code in any language
- Design data structures and implement algorithms
- Provide code examples with best practices
- Handle technical implementation details
You think systematically, value clean code, and prioritize correctness and maintainability.`,
    specialties: ['code', 'programming', 'algorithms', 'technical', 'engineering', 'software', 'implementation', 'api', 'function', 'class', 'module'],
    color: 'green',
  },
  researcher: {
    name: 'Researcher',
    role: 'investigator',
    icon: '🔍',
    systemPrompt: `You are RESEARCHER, the investigation agent in the ARIES swarm. Your role is to:
- Gather and verify information from multiple sources
- Fact-check claims and data
- Compile comprehensive research summaries
- Identify credible sources and citations
- Discover relevant context and background information
You are thorough, skeptical, and systematic in your research approach.`,
    specialties: ['research', 'search', 'facts', 'data-gathering', 'verification', 'investigation', 'sources', 'literature', 'reference', 'lookup'],
    color: 'cyan',
  },
  analyst: {
    name: 'Analyst',
    role: 'strategist',
    icon: '📊',
    systemPrompt: `You are ANALYST, the strategic analysis agent in the ARIES swarm. Your role is to:
- Analyze data, patterns, and trends
- Provide structured frameworks for decision-making
- Evaluate risks, tradeoffs, and opportunities
- Create comparisons and evaluations
- Think critically about complex problems
You are methodical, data-driven, and always back conclusions with evidence.`,
    specialties: ['analysis', 'data', 'patterns', 'strategy', 'evaluation', 'comparison', 'metrics', 'trends', 'statistics', 'forecast'],
    color: 'blue',
  },
  creative: {
    name: 'Creative',
    role: 'ideator',
    icon: '🎨',
    systemPrompt: `You are CREATIVE, the creative thinking agent in the ARIES swarm. Your role is to:
- Generate innovative ideas and solutions
- Write compelling content, stories, and copy
- Brainstorm approaches from unconventional angles
- Design user experiences and visual concepts
- Think outside the box and challenge assumptions
You are imaginative, expressive, and bring fresh perspectives to every task.`,
    specialties: ['creative', 'writing', 'brainstorming', 'design', 'storytelling', 'ideation', 'content', 'copywriting', 'art', 'innovation'],
    color: 'magenta',
  },
  scout: {
    name: 'Scout',
    role: 'reconnaissance',
    icon: '🛰️',
    systemPrompt: `You are SCOUT, the reconnaissance agent in the ARIES swarm. Your role is to:
- Scan and monitor systems, files, and environments
- Perform initial reconnaissance on targets
- Identify potential issues or opportunities
- Provide quick assessments and situation reports
- Monitor ongoing processes and report changes
You are observant, fast, and focused on gathering actionable intelligence.`,
    specialties: ['scanning', 'monitoring', 'recon', 'assessment', 'surveillance', 'status', 'overview', 'inventory', 'discovery'],
    color: 'red',
  },
  executor: {
    name: 'Executor',
    role: 'operator',
    icon: '⚡',
    systemPrompt: `You are EXECUTOR, the hands-on operator agent in the ARIES swarm. Your role is to:
- Run shell commands and file operations
- Execute implementation plans step by step
- Handle deployments, builds, and system operations
- Perform hands-on tasks that require direct action
- Translate plans into concrete executable steps
You are action-oriented, precise, and focused on getting things done correctly.`,
    specialties: ['execute', 'run', 'shell', 'command', 'deploy', 'build', 'install', 'setup', 'configure', 'script', 'automation', 'file', 'operation'],
    color: 'white',
  },
  security: {
    name: 'Security',
    role: 'guardian',
    icon: '🛡️',
    systemPrompt: `You are SECURITY, the security analysis agent in the ARIES swarm. Your role is to:
- Analyze code and systems for vulnerabilities
- Assess threat models and attack surfaces
- Review security configurations and access controls
- Recommend hardening measures and best practices
- Identify compliance issues and risk factors
You think like both an attacker and defender, always prioritizing safety.`,
    specialties: ['security', 'vulnerability', 'threat', 'attack', 'defense', 'encryption', 'auth', 'permission', 'firewall', 'audit', 'compliance', 'hack', 'exploit', 'risk'],
    color: 'red',
  },
  trader: {
    name: 'Trader',
    role: 'financier',
    icon: '📈',
    systemPrompt: `You are TRADER, the financial analysis agent in the ARIES swarm. Your role is to:
- Analyze market data, price action, and trading signals
- Evaluate financial instruments, strategies, and risk/reward
- Research economic indicators and market sentiment
- Provide technical and fundamental analysis
- Assess portfolio allocation and position sizing
You think in terms of probabilities, risk management, and market dynamics.`,
    specialties: ['trading', 'market', 'finance', 'stock', 'crypto', 'price', 'investment', 'portfolio', 'economic', 'profit', 'loss', 'chart', 'indicator', 'options', 'futures'],
    color: 'green',
  },
  debugger: {
    name: 'Debugger',
    role: 'troubleshooter',
    icon: '🐛',
    systemPrompt: `You are DEBUGGER, the error analysis agent in the ARIES swarm. Your role is to:
- Analyze error messages, stack traces, and log files
- Identify root causes of bugs and failures
- Suggest targeted fixes and workarounds
- Trace execution paths to find where things go wrong
- Reproduce and isolate issues systematically
You are methodical, patient, and skilled at working backwards from symptoms to causes.`,
    specialties: ['debug', 'error', 'bug', 'fix', 'crash', 'log', 'trace', 'exception', 'failure', 'troubleshoot', 'diagnose', 'issue', 'problem', 'broken'],
    color: 'yellow',
  },
  architect: {
    name: 'Architect',
    role: 'designer',
    icon: '🏗️',
    systemPrompt: `You are ARCHITECT, the system design agent in the ARIES swarm. Your role is to:
- Design system architectures and infrastructure
- Plan scalable, maintainable system structures
- Evaluate technology choices and tradeoffs
- Create deployment and DevOps strategies
- Design databases, APIs, and service boundaries
You think in terms of systems, scale, reliability, and long-term maintainability.`,
    specialties: ['architecture', 'system', 'infrastructure', 'devops', 'cloud', 'database', 'scale', 'microservice', 'container', 'kubernetes', 'docker', 'aws', 'gcp', 'azure', 'design'],
    color: 'blue',
  },
  optimizer: {
    name: 'Optimizer',
    role: 'tuner',
    icon: '⚙️',
    systemPrompt: `You are OPTIMIZER, the performance tuning agent in the ARIES swarm. Your role is to:
- Identify performance bottlenecks and inefficiencies
- Optimize code, queries, and system configurations
- Benchmark and measure improvements
- Reduce resource usage (CPU, memory, network, storage)
- Improve response times and throughput
You are metrics-driven, detail-oriented, and relentless about eliminating waste.`,
    specialties: ['optimize', 'performance', 'speed', 'efficiency', 'benchmark', 'cache', 'memory', 'cpu', 'latency', 'throughput', 'bottleneck', 'profile', 'tuning', 'fast', 'slow'],
    color: 'cyan',
  },
  navigator: {
    name: 'Navigator',
    role: 'explorer',
    icon: '🧭',
    systemPrompt: `You are NAVIGATOR, the web exploration agent in the ARIES swarm. Your role is to:
- Browse websites and extract useful information
- Follow links and map out web resources
- Fetch and summarize web content
- Navigate APIs and documentation sites
- Find relevant online resources and tools
You are resourceful, efficient at web traversal, and good at extracting signal from noise.`,
    specialties: ['web', 'browse', 'url', 'fetch', 'link', 'website', 'page', 'scrape', 'crawl', 'navigate', 'download', 'online', 'internet', 'http'],
    color: 'magenta',
  },
  scribe: {
    name: 'Scribe',
    role: 'documentarian',
    icon: '📝',
    systemPrompt: `You are SCRIBE, the documentation agent in the ARIES swarm. Your role is to:
- Write clear, well-structured documentation
- Create summaries, reports, and meeting notes
- Organize information into readable formats
- Maintain READMEs, changelogs, and guides
- Translate technical findings into accessible prose
You value clarity, completeness, and accessibility in all written output.`,
    specialties: ['document', 'documentation', 'write', 'summary', 'report', 'readme', 'guide', 'notes', 'changelog', 'manual', 'tutorial', 'explain', 'describe', 'specification'],
    color: 'white',
  },
};

class AgentRoster extends EventEmitter {
  constructor() {
    super();
    this.agents = new Map();
    this.messageBus = [];
    this.busSubscribers = [];
    this.agentMemory = new Map(); // agent memories from previous swarm runs
    
    // Initialize all agents
    for (const [id, def] of Object.entries(AGENT_DEFINITIONS)) {
      this.agents.set(id, {
        ...def,
        id,
        status: 'idle', // idle | working | waiting
        currentTask: null,
        tasksCompleted: 0,
        lastActive: null,
      });
    }
  }

  /** Get all agents */
  getAll() {
    return [...this.agents.values()];
  }

  /** Get a specific agent */
  get(id) {
    return this.agents.get(id);
  }

  /** Get agent count */
  count() {
    return this.agents.size;
  }

  /** Set agent status */
  setStatus(id, status, task = null) {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.status = status;
    agent.currentTask = task;
    if (status === 'working') agent.lastActive = Date.now();
    if (status === 'idle' && task === null) agent.tasksCompleted++;
    this.emit('status_change', { id, status, task });
  }

  /** Post a message to the agent bus */
  postMessage(fromAgent, toAgent, content) {
    const msg = {
      from: fromAgent,
      to: toAgent || 'all',
      content,
      timestamp: Date.now(),
    };
    this.messageBus.push(msg);
    if (this.messageBus.length > 100) this.messageBus.shift();
    this.busSubscribers.forEach(cb => cb(msg));
    this.emit('message', msg);
    return msg;
  }

  /** Subscribe to bus messages */
  subscribeBus(callback) {
    this.busSubscribers.push(callback);
    return () => {
      this.busSubscribers = this.busSubscribers.filter(cb => cb !== callback);
    };
  }

  /** Get recent bus messages */
  getMessages(limit = 20) {
    return this.messageBus.slice(-limit);
  }

  /** Match task to best agent based on keyword overlap with specialties */
  matchAgent(taskDescription) {
    const words = taskDescription.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    let bestMatch = null;
    let bestScore = 0;

    for (const [id, agent] of this.agents) {
      if (id === 'commander') continue;
      let score = 0;
      for (const specialty of agent.specialties) {
        for (const word of words) {
          // Exact match
          if (word === specialty) {
            score += 5;
          } else if (word.includes(specialty) || specialty.includes(word)) {
            // Substring match — only if the shorter string is at least 4 chars
            const shorter = word.length < specialty.length ? word : specialty;
            if (shorter.length >= 4) score += 2;
          }
          // Prefix match
          if (word.length > 3 && specialty.length > 3) {
            if (word.startsWith(specialty.substring(0, 4)) || specialty.startsWith(word.substring(0, 4))) {
              score += 1;
            }
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = id;
      }
    }

    return bestMatch || 'coder';
  }

  /** Commander allocates tasks to agents based on specialties — avoids overloading one agent */
  allocateTasks(subtasks) {
    const allocations = [];
    const agentLoad = new Map(); // track how many tasks each agent has
    
    for (const task of subtasks) {
      // Score all agents for this task
      const scores = [];
      const words = task.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
      
      for (const [id, agent] of this.agents) {
        if (id === 'commander') continue;
        let score = 0;
        for (const specialty of agent.specialties) {
          for (const word of words) {
            if (word === specialty) {
              score += 5;
            } else if (word.includes(specialty) || specialty.includes(word)) {
              const shorter = word.length < specialty.length ? word : specialty;
              if (shorter.length >= 4) score += 2;
            }
            if (word.length > 3 && specialty.length > 3) {
              if (word.startsWith(specialty.substring(0, 4)) || specialty.startsWith(word.substring(0, 4))) {
                score += 1;
              }
            }
          }
        }
        // Penalize agents that already have tasks (spread the work)
        const load = agentLoad.get(id) || 0;
        score -= load * 3;
        scores.push({ id, score, agent });
      }
      
      scores.sort((a, b) => b.score - a.score);
      const chosen = scores[0];
      agentLoad.set(chosen.id, (agentLoad.get(chosen.id) || 0) + 1);
      
      allocations.push({
        task,
        agentId: chosen.id,
        agentName: chosen.agent.name,
        agentIcon: chosen.agent.icon,
        systemPrompt: chosen.agent.systemPrompt,
      });
    }
    return allocations;
  }

  /** Store a memory for an agent */
  remember(agentId, key, value) {
    if (!this.agentMemory.has(agentId)) this.agentMemory.set(agentId, new Map());
    this.agentMemory.get(agentId).set(key, { value, timestamp: Date.now() });
  }

  /** Recall agent memories */
  recall(agentId) {
    const mem = this.agentMemory.get(agentId);
    if (!mem) return {};
    const result = {};
    for (const [k, v] of mem) result[k] = v;
    return result;
  }

  /** Reset all agents to idle */
  resetAll() {
    for (const [id, agent] of this.agents) {
      agent.status = 'idle';
      agent.currentTask = null;
    }
  }

  /** Get summary for dashboard display */
  getSummary() {
    const summary = [];
    for (const [id, agent] of this.agents) {
      const statusIcon = agent.status === 'idle' ? '○' : agent.status === 'working' ? '●' : '◐';
      const statusColor = agent.status === 'idle' ? 'gray' : agent.status === 'working' ? 'green' : 'yellow';
      summary.push({
        id,
        name: agent.name,
        icon: agent.icon,
        role: agent.role,
        status: agent.status,
        statusIcon,
        statusColor,
        currentTask: agent.currentTask,
        tasksCompleted: agent.tasksCompleted,
        color: agent.color,
      });
    }
    return summary;
  }
}

module.exports = { AgentRoster, AGENT_DEFINITIONS };
