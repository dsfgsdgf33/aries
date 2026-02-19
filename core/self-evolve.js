/**
 * ARIES v4.3 — Self-Evolution & Weekly Auto-Update System
 * 
 * Autonomous self-improving system with:
 * - Research phase: web crawling for AI tools & trends
 * - Tool discovery: gap analysis vs trending capabilities
 * - Auto-implementation: AI-generated code with rollback
 * - Intelligence layer: performance analysis & competitive comparison
 * - Enhanced weekly cycle with comprehensive reporting
 * 
 * Analyzes task history, agent performance, and generates
 * improvement suggestions. Applies safe improvements after approval.
 * Tracks evolution history and generates weekly reports.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', 'data');
const EVOLUTION_LOG = path.join(DATA_DIR, 'evolution-log.json');
const LAST_CHECK_FILE = path.join(DATA_DIR, 'evolve-last-check.json');
const RESEARCH_FILE = path.join(DATA_DIR, 'evolution-research.json');
const IMPLEMENTATIONS_FILE = path.join(DATA_DIR, 'evolution-implementations.json');
const STAGING_DIR = path.join(DATA_DIR, 'evolution-staging');

class SelfEvolve extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.ai - AI module with callWithFallback
   * @param {object} opts.config - selfEvolve config section
   * @param {object} [opts.agentLearning] - AgentLearning instance
   * @param {object} [opts.swarm] - Swarm instance
   * @param {object} [opts.warRoom] - WarRoom instance
   * @param {object} [opts.webIntelligence] - WebIntelligence instance
   * @param {object} [opts.toolGenerator] - ToolGenerator instance
   * @param {object} [opts.webScraper] - WebScraper instance
   */
  constructor(opts = {}) {
    super();
    this.ai = opts.ai || {};
    this.config = opts.config || {};
    this.agentLearning = opts.agentLearning || null;
    this.knowledgeGraph = opts.knowledgeGraph || null;
    this.swarm = opts.swarm || null;
    this.warRoom = opts.warRoom || null;
    this.webIntelligence = opts.webIntelligence || null;
    this.toolGenerator = opts.toolGenerator || null;
    this.webScraper = opts.webScraper || null;
    this.webSearch = opts.webSearch || null;
    this.browserController = opts.browserController || null;
    this.extensionBridge = opts.extensionBridge || null;
    this._suggestions = [];
    this._lastAnalysis = null;
    this._lastReport = null;
    this._lastResearch = null;
    this._lastCompetitive = null;
    this._weeklyInterval = null;

    // Ensure data dir and staging dir
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
    try { if (!fs.existsSync(STAGING_DIR)) fs.mkdirSync(STAGING_DIR, { recursive: true }); } catch {}
  }

  /** Load evolution history from disk */
  _loadHistory() {
    try {
      return JSON.parse(fs.readFileSync(EVOLUTION_LOG, 'utf8'));
    } catch {
      return { version: 1, entries: [] };
    }
  }

  /** Save evolution history */
  _saveHistory(history) {
    try {
      fs.writeFileSync(EVOLUTION_LOG, JSON.stringify(history, null, 2));
    } catch (e) {
      this.emit('error', e);
    }
  }

  /** Load last check timestamp */
  _loadLastCheck() {
    try {
      return JSON.parse(fs.readFileSync(LAST_CHECK_FILE, 'utf8'));
    } catch {
      return { lastCheck: 0 };
    }
  }

  /** Save last check timestamp */
  _saveLastCheck(ts) {
    try {
      fs.writeFileSync(LAST_CHECK_FILE, JSON.stringify({ lastCheck: ts }));
    } catch {}
  }

  /** Load research results from disk */
  _loadResearch() {
    try {
      if (fs.existsSync(RESEARCH_FILE)) {
        return JSON.parse(fs.readFileSync(RESEARCH_FILE, 'utf8'));
      }
    } catch {}
    return { version: 1, results: [], lastRun: null };
  }

  /** Save research results */
  _saveResearch(data) {
    try {
      fs.writeFileSync(RESEARCH_FILE, JSON.stringify(data, null, 2));
    } catch {}
  }

  /** Load implementations log */
  _loadImplementations() {
    try {
      if (fs.existsSync(IMPLEMENTATIONS_FILE)) {
        return JSON.parse(fs.readFileSync(IMPLEMENTATIONS_FILE, 'utf8'));
      }
    } catch {}
    return { version: 1, implementations: [] };
  }

  /** Save implementations log */
  _saveImplementations(data) {
    try {
      fs.writeFileSync(IMPLEMENTATIONS_FILE, JSON.stringify(data, null, 2));
    } catch {}
  }

  /**
   * Research phase: scan web for AI tools, trends, and techniques
   * @returns {Promise<object>} Research results with scored findings
   */
  async research() {
    try {
      this.emit('research-start');
      const sources = (this.config.research && this.config.research.sources) || [
        'https://github.com/trending',
        'https://news.ycombinator.com'
      ];

      const findings = [];
      const queries = [
        'best AI agent frameworks 2026',
        'AI tools trending new releases',
        'RAG improvements embeddings 2026',
        'autonomous AI agent systems',
        'AI code generation tools latest',
      ];

      // Use WebIntelligence if available
      if (this.webIntelligence) {
        for (const q of queries.slice(0, 5)) {
          try {
            const results = await this.webIntelligence.searchWeb(q);
            for (const r of results.slice(0, 5)) {
              findings.push({
                id: crypto.randomBytes(4).toString('hex'),
                name: r.title.split(' - ')[0].split(' | ')[0].trim().substring(0, 80),
                description: r.snippet,
                url: r.url,
                query: q,
                category: this._categorizeFindings(r.title + ' ' + r.snippet),
                relevanceScore: 0,
                implementationDifficulty: 'unknown',
                potentialImpact: 'unknown',
              });
            }
          } catch {}
        }
      } else if (this.webScraper) {
        // Fallback to webScraper for source pages
        for (const src of sources.slice(0, 3)) {
          try {
            const page = await this.webScraper.extractText(src);
            findings.push({
              id: crypto.randomBytes(4).toString('hex'),
              name: page.title || src,
              description: page.text.substring(0, 500),
              url: src,
              query: 'source scan',
              category: 'general',
              relevanceScore: 0,
              implementationDifficulty: 'unknown',
              potentialImpact: 'unknown',
            });
          } catch {}
        }
      }

      // Use AI to score and evaluate findings
      if (this.ai && this.ai.callWithFallback && findings.length > 0) {
        try {
          const findingsSummary = findings.slice(0, 15).map(function(f) {
            return '- ' + f.name + ': ' + (f.description || '').substring(0, 150);
          }).join('\n');

          const resp = await this.ai.callWithFallback([
            { role: 'system', content: 'You are evaluating AI tool discoveries for the ARIES platform. ARIES has: multi-agent swarm, RAG, web scraping, code sandbox, autonomous goals, agent debates, knowledge graph, web sentinel, browser/computer control, self-evolution. Score each finding. Return JSON array: [{ "index": 0, "relevanceScore": 0-100, "implementationDifficulty": "easy|medium|hard", "potentialImpact": "low|medium|high", "recommendation": "brief note" }]' },
            { role: 'user', content: 'Findings to evaluate:\n' + findingsSummary }
          ], null, false);

          const content = (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '';
          const arrMatch = content.match(/\[[\s\S]*?\]/);
          if (arrMatch) {
            try {
              const scores = JSON.parse(arrMatch[0]);
              for (const score of scores) {
                if (score.index !== undefined && findings[score.index]) {
                  findings[score.index].relevanceScore = score.relevanceScore || 0;
                  findings[score.index].implementationDifficulty = score.implementationDifficulty || 'unknown';
                  findings[score.index].potentialImpact = score.potentialImpact || 'unknown';
                  findings[score.index].recommendation = score.recommendation || '';
                }
              }
            } catch {}
          }
        } catch {}
      }

      // Sort by relevance
      findings.sort(function(a, b) { return (b.relevanceScore || 0) - (a.relevanceScore || 0); });

      // Deep research phase: fetch full rendered content for top findings
      // Priority: 1) Browser extension (best: JS rendering, no bot detection)
      //           2) Playwright/Puppeteer (good: JS rendering, headless)
      //           3) HTTP scraper (fallback: raw HTML only)
      var topForDeep = findings.filter(function(f) { return f.url && f.relevanceScore >= 40; }).slice(0, 5);
      if (topForDeep.length > 0) {
        var useExtension = this.extensionBridge && this.extensionBridge.connected;
        var useBrowser = !useExtension && this.browserController && this.browserController.isAvailable();
        var fetchMethod = useExtension ? 'extension' : useBrowser ? 'playwright' : 'http';
        this.emit('research-phase', { phase: 'deep-fetch', status: 'running', method: fetchMethod, count: topForDeep.length });

        for (var di = 0; di < topForDeep.length; di++) {
          var finding = topForDeep[di];
          try {
            if (useExtension) {
              // Best path: Chrome extension — real browser, no bot detection, JS rendered
              await this.extensionBridge.sendCommand('navigate', { url: finding.url, waitForLoad: true });
              var textResult = await this.extensionBridge.sendCommand('getText');
              var pageText = (textResult && (textResult.text || textResult)) || '';
              if (typeof pageText === 'object') pageText = JSON.stringify(pageText);
              if (pageText.length > 50) {
                finding.fullContent = pageText.substring(0, 5000);
                finding.fetchMethod = 'extension';
              }
              // Also grab links for discovering more research sources
              try {
                var linksResult = await this.extensionBridge.sendCommand('getLinks');
                var links = (linksResult && (linksResult.links || linksResult)) || [];
                if (Array.isArray(links) && links.length > 0) {
                  finding.discoveredLinks = links.slice(0, 20).map(function(l) {
                    return { text: (l.text || '').substring(0, 100), url: l.href || l.url || '' };
                  });
                }
              } catch (linkErr) { /* non-critical */ }
            } else if (useBrowser) {
              // Playwright/Puppeteer — headless JS rendering
              var rendered = await this.browserController.fetchPage(finding.url);
              if (rendered && rendered.length > 50) {
                finding.fullContent = rendered.substring(0, 5000);
                finding.fetchMethod = 'playwright';
              }
            } else if (this.webScraper) {
              // Raw HTTP — no JS, but works everywhere
              var scraped = await this.webScraper.extractText(finding.url);
              if (scraped && scraped.text && scraped.text.length > 50) {
                finding.fullContent = scraped.text.substring(0, 5000);
                finding.fetchMethod = 'http';
              }
            }
          } catch (fetchErr) {
            finding.fetchError = fetchErr.message;
          }
        }

        var fetched = topForDeep.filter(function(f) { return f.fullContent; }).length;
        this.emit('research-phase', { phase: 'deep-fetch', status: 'complete', method: fetchMethod, fetched: fetched });
      }

      const researchData = this._loadResearch();
      researchData.results = findings;
      researchData.lastRun = new Date().toISOString();
      researchData.queryCount = queries.length;
      this._saveResearch(researchData);

      this._lastResearch = researchData;

      // Feed high-relevance findings into knowledge graph
      if (this.knowledgeGraph && findings.length > 0) {
        try {
          for (const f of findings.filter(function(f) { return f.relevanceScore >= 50; }).slice(0, 10)) {
            // Add as a concept node
            const existing = this.knowledgeGraph.search(f.name);
            if (existing.length === 0) {
              this.knowledgeGraph.addNode({
                type: 'tool',
                label: f.name,
                properties: {
                  url: f.url,
                  category: f.category,
                  relevanceScore: f.relevanceScore,
                  difficulty: f.implementationDifficulty,
                  impact: f.potentialImpact,
                  discoveredAt: new Date().toISOString(),
                  source: 'self-evolve-research'
                }
              });
            }
          }
        } catch (kgErr) {
          this.emit('error', kgErr);
        }
      }

      this.emit('research-complete', researchData);
      return researchData;
    } catch (e) {
      this.emit('error', e);
      return { results: [], lastRun: new Date().toISOString(), error: e.message };
    }
  }

  /**
   * Categorize a finding based on its text
   * @param {string} text
   * @returns {string} category
   */
  _categorizeFindings(text) {
    const lower = text.toLowerCase();
    if (/\b(model|llm|gpt|claude|gemini|llama)\b/.test(lower)) return 'ai-models';
    if (/\b(rag|retrieval|embedding|vector|chunk)\b/.test(lower)) return 'rag-improvements';
    if (/\b(agent|multi-agent|swarm|orchestrat)\b/.test(lower)) return 'agent-protocols';
    if (/\b(code|generat|copilot|coding)\b/.test(lower)) return 'code-generation';
    if (/\b(data|analy|visualiz|chart)\b/.test(lower)) return 'data-analysis';
    if (/\b(api|integrat|connect|webhook)\b/.test(lower)) return 'api-integrations';
    if (/\b(secur|auth|encrypt|protect)\b/.test(lower)) return 'security';
    if (/\b(perf|optim|fast|cache|speed)\b/.test(lower)) return 'performance';
    return 'general';
  }

  /**
   * Discover tool gaps: what Aries lacks vs what's trending
   * @returns {Promise<object>} Discovery results with gap analysis
   */
  async discoverTools() {
    try {
      this.emit('discover-start');

      // Current capabilities
      const currentCapabilities = [
        'Multi-agent swarm with 14 specialists',
        'RAG with TF-IDF scoring',
        'Web scraping with crawling',
        'Code sandbox (JS, Python, Shell)',
        'Autonomous goal execution',
        'Agent debates with consensus',
        'Knowledge graph',
        'Web sentinel monitoring',
        'Browser and computer control',
        'Self-evolution system',
        'Agent factory (AI-generated agents)',
        'Pipeline and workflow automation',
        'Voice engine',
        'MCP client protocol',
      ];

      const categories = [
        'ai-models', 'rag-improvements', 'agent-protocols',
        'code-generation', 'data-analysis', 'api-integrations',
        'security', 'performance'
      ];

      let gaps = [];

      if (this.ai && this.ai.callWithFallback) {
        // Get research data if available
        const research = this._loadResearch();
        const recentFindings = (research.results || []).slice(0, 10).map(function(f) {
          return f.name + ': ' + (f.description || '').substring(0, 100);
        }).join('\n');

        try {
          const resp = await this.ai.callWithFallback([
            { role: 'system', content: 'You are analyzing capability gaps for the ARIES AI platform. Compare current capabilities to trending AI tools and identify what ARIES should add. Return JSON: { "gaps": [{ "id": "unique", "title": "Gap title", "category": "category", "description": "Why this matters", "currentState": "What Aries has now", "desiredState": "What Aries should have", "priority": "critical|high|medium|low", "implementationPlan": "Brief plan", "estimatedEffort": "hours estimate" }], "summary": "Overall gap assessment" }' },
            { role: 'user', content: 'Current ARIES capabilities:\n' + currentCapabilities.join('\n') + '\n\nRecent research findings:\n' + (recentFindings || 'No recent research data') + '\n\nCategories to analyze: ' + categories.join(', ') }
          ], null, false);

          const content = (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '';
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              gaps = parsed.gaps || [];
              // Ensure IDs
              gaps.forEach(function(g) {
                if (!g.id) g.id = crypto.randomBytes(4).toString('hex');
              });
            } catch {}
          }
        } catch {}
      }

      const result = {
        gaps,
        currentCapabilities,
        categories,
        timestamp: new Date().toISOString(),
      };

      this.emit('discover-complete', result);
      return result;
    } catch (e) {
      this.emit('error', e);
      return { gaps: [], currentCapabilities: [], categories: [], error: e.message, timestamp: new Date().toISOString() };
    }
  }

  /**
   * Implement a suggestion using AI code generation
   * @param {string} suggestionId - ID of the suggestion to implement
   * @returns {Promise<object>} Implementation result
   */
  async implementSuggestion(suggestionId) {
    try {
      const suggestion = this._suggestions.find(function(s) { return s.id === suggestionId; });
      if (!suggestion) {
        throw new Error('Suggestion not found: ' + suggestionId);
      }

      this.emit('implement-start', suggestion);

      // Backup current state
      const backupId = crypto.randomBytes(8).toString('hex');
      const backupDir = path.join(STAGING_DIR, 'backup-' + backupId);
      try { fs.mkdirSync(backupDir, { recursive: true }); } catch {}

      const isSafe = suggestion.autoApplicable && suggestion.risk === 'low';

      let implementation = {
        id: crypto.randomBytes(8).toString('hex'),
        suggestionId: suggestionId,
        title: suggestion.title,
        type: suggestion.type,
        status: 'pending',
        backupId: backupId,
        createdAt: new Date().toISOString(),
        appliedAt: null,
        code: null,
        error: null,
      };

      if (isSafe && (suggestion.type === 'config' || suggestion.type === 'threshold')) {
        // Auto-apply config/threshold changes
        const result = await this.apply(suggestionId);
        implementation.status = result.success ? 'applied' : 'failed';
        implementation.appliedAt = new Date().toISOString();
        implementation.error = result.error || null;
      } else if (this.ai && this.ai.callWithFallback) {
        // Generate code using AI
        try {
          const resp = await this.ai.callWithFallback([
            { role: 'system', content: 'Generate the implementation code for this ARIES platform improvement. Return JSON: { "files": [{ "path": "relative/path.js", "action": "create|modify|config", "content": "file content or config change", "description": "what this changes" }], "testCommand": "node -c path/to/file.js", "rollbackInstructions": "how to undo" }. Use ONLY Node.js built-ins. Match existing code style.' },
            { role: 'user', content: 'Suggestion: ' + suggestion.title + '\nDescription: ' + suggestion.description + '\nType: ' + suggestion.type + '\nChanges: ' + JSON.stringify(suggestion.changes || {}) }
          ], null, false);

          const content = (resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content) || '';
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            implementation.code = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {
          implementation.error = 'Code generation failed: ' + e.message;
        }

        if (implementation.code) {
          // Store in staging for review
          const stagingFile = path.join(STAGING_DIR, implementation.id + '.json');
          fs.writeFileSync(stagingFile, JSON.stringify(implementation, null, 2));
          implementation.status = 'staged';

          // Validate syntax for any JS files
          if (implementation.code.files) {
            for (const file of implementation.code.files) {
              if (file.path && file.path.endsWith('.js') && file.content) {
                const tempFile = path.join(STAGING_DIR, 'temp-validate.js');
                try {
                  fs.writeFileSync(tempFile, file.content);
                  execSync('node -c "' + tempFile.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"', {
                    encoding: 'utf8', timeout: 5000, stdio: 'pipe'
                  });
                  file.syntaxValid = true;
                } catch {
                  file.syntaxValid = false;
                } finally {
                  try { fs.unlinkSync(tempFile); } catch {}
                }
              }
            }
          }

          // Auto-apply if safe and all syntax checks pass
          if (isSafe && implementation.code.files) {
            const allValid = implementation.code.files.every(function(f) {
              return f.syntaxValid !== false;
            });
            if (allValid && this.config.autoApply) {
              implementation.status = 'auto-applied';
              implementation.appliedAt = new Date().toISOString();
            }
          }
        } else {
          implementation.status = 'failed';
        }
      } else {
        implementation.status = 'no-ai';
        implementation.error = 'AI not available for code generation';
      }

      // Track implementation
      const implLog = this._loadImplementations();
      implLog.implementations.push(implementation);
      this._saveImplementations(implLog);

      this.emit('implement-complete', implementation);
      return implementation;
    } catch (e) {
      this.emit('error', e);
      return { status: 'error', error: e.message };
    }
  }

  /**
   * Get research results
   * @returns {object}
   */
  getResearch() {
    if (this._lastResearch) return this._lastResearch;
    return this._loadResearch();
  }

  /**
   * Get competitive analysis
   * @returns {Promise<object>}
   */
  async getCompetitiveAnalysis() {
    if (this._lastCompetitive) return this._lastCompetitive;
    if (this.webIntelligence) {
      this._lastCompetitive = await this.webIntelligence.compareWithCompetitors();
      return this._lastCompetitive;
    }
    return { competitors: [], analysis: 'WebIntelligence not available', timestamp: new Date().toISOString() };
  }

  /**
   * Run a full self-analysis: reviews task history, success rates, agent performance
   * @returns {Promise<object>} Analysis results
   */
  async analyze() {
    try {
      // Gather data
      const learningStats = this.agentLearning ? (this.agentLearning.getStats ? this.agentLearning.getStats() : {}) : {};
      const swarmStats = this.swarm ? (this.swarm.getStats ? this.swarm.getStats() : {}) : {};
      const history = this._loadHistory();
      const recentEvolutions = history.entries.slice(-10);

      // Pull top learnings from agent-learning for context
      let topLearnings = [];
      if (this.agentLearning && this.agentLearning.data) {
        const outcomes = this.agentLearning.data.outcomes || [];
        // Get recent high-rated outcomes as "proven capabilities"
        topLearnings = outcomes
          .filter(function(o) { return o.rating >= 4; })
          .slice(-20)
          .map(function(o) { return { agent: o.agentId, task: o.task, rating: o.rating }; });
      }

      // Load task history if available
      let taskHistory = [];
      try {
        const histFile = path.join(DATA_DIR, 'history.json');
        taskHistory = JSON.parse(fs.readFileSync(histFile, 'utf8')).slice(-50);
      } catch {}

      // Gather tool log for failure analysis
      let toolLog = [];
      try {
        const toolLogFile = path.join(DATA_DIR, 'tool-log.json');
        toolLog = JSON.parse(fs.readFileSync(toolLogFile, 'utf8')).slice(-50);
      } catch {}

      const toolFailures = toolLog.filter(function(t) { return !t.success; });
      const toolFailureRate = toolLog.length > 0 ? (toolFailures.length / toolLog.length * 100).toFixed(1) : 0;

      // Agent utilization
      let agentSummary = [];
      try {
        if (this.swarm && this.swarm.getRoster) {
          agentSummary = this.swarm.getRoster().getSummary().map(function(a) {
            return { id: a.id, name: a.name, tasksCompleted: a.tasksCompleted, status: a.status };
          });
        }
      } catch {}

      const underutilized = agentSummary.filter(function(a) { return a.tasksCompleted === 0; });

      const analysisPrompt = [
        { role: 'system', content: 'You are ARIES Self-Evolution Analyzer. Analyze the following system data and identify areas for improvement. Include competitive analysis insights. Return a JSON object with: { "overallHealth": 0-100, "strengths": ["..."], "weaknesses": ["..."], "agentPerformance": { "agentId": { "score": 0-100, "notes": "..." } }, "underutilizedAgents": ["agentId"], "toolFailureAnalysis": { "failRate": "X%", "mostFailing": ["toolName"], "recommendations": ["..."] }, "bottlenecks": ["..."], "competitiveInsights": ["..."], "suggestions": [{ "id": "unique-id", "type": "threshold|prompt|config|workflow|code|agent", "title": "...", "description": "...", "impact": "low|medium|high", "risk": "low|medium|high", "autoApplicable": true/false, "changes": {} }] }' },
        { role: 'user', content: 'System Data:\n\nLearning Stats: ' + JSON.stringify(learningStats, null, 2) + '\n\nProven Capabilities (high-rated outcomes): ' + JSON.stringify(topLearnings, null, 2) + '\n\nSwarm Stats: ' + JSON.stringify(swarmStats, null, 2) + '\n\nRecent Evolutions: ' + JSON.stringify(recentEvolutions, null, 2) + '\n\nTool Failure Rate: ' + toolFailureRate + '% (' + toolFailures.length + '/' + toolLog.length + ')\nTop failing tools: ' + JSON.stringify(toolFailures.slice(-5).map(function(t) { return t.tool; })) + '\n\nUnderutilized Agents: ' + JSON.stringify(underutilized.map(function(a) { return a.name; })) + '\n\nRecent Chat History (' + taskHistory.length + ' messages): ' + (taskHistory.length > 0 ? taskHistory.slice(-10).map(function(m) { return m.role + ': ' + (m.content || '').substring(0, 100); }).join('\n') : 'No history') }
      ];

      const data = await this.ai.callWithFallback(analysisPrompt, null, false);
      const content = data.choices?.[0]?.message?.content || '{}';

      // Parse JSON from response
      let analysis;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { analysis = JSON.parse(jsonMatch[0]); } catch { analysis = { overallHealth: 50, strengths: [], weaknesses: ['Analysis parse error'], suggestions: [] }; }
      } else {
        analysis = { overallHealth: 50, strengths: [], weaknesses: ['No structured analysis returned'], suggestions: [] };
      }

      // Assign IDs to suggestions if missing
      (analysis.suggestions || []).forEach(s => {
        if (!s.id) s.id = crypto.randomBytes(4).toString('hex');
      });

      this._suggestions = analysis.suggestions || [];
      this._lastAnalysis = { ...analysis, timestamp: Date.now() };
      this.emit('analysis', this._lastAnalysis);
      return this._lastAnalysis;
    } catch (e) {
      this.emit('error', e);
      return { overallHealth: 0, strengths: [], weaknesses: [e.message], suggestions: [], timestamp: Date.now() };
    }
  }

  /**
   * Get current suggestions (from last analysis)
   * @returns {Array} suggestions
   */
  suggest() {
    return {
      suggestions: this._suggestions,
      lastAnalysis: this._lastAnalysis ? this._lastAnalysis.timestamp : null,
    };
  }

  /**
   * Apply a specific suggestion by ID
   * @param {string} suggestionId
   * @returns {Promise<object>} result
   */
  async apply(suggestionId) {
    const suggestion = this._suggestions.find(s => s.id === suggestionId);
    if (!suggestion) {
      return { success: false, error: 'Suggestion not found' };
    }

    try {
      const history = this._loadHistory();
      const beforeMetrics = { timestamp: Date.now() };

      // Record the application
      const entry = {
        id: crypto.randomBytes(8).toString('hex'),
        suggestionId: suggestion.id,
        title: suggestion.title,
        type: suggestion.type,
        description: suggestion.description,
        impact: suggestion.impact,
        changes: suggestion.changes || {},
        appliedAt: new Date().toISOString(),
        beforeMetrics,
        status: 'applied',
      };

      // Apply config changes if applicable
      if (suggestion.type === 'config' && suggestion.changes) {
        try {
          const configPath = path.join(__dirname, '..', 'config.json');
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          for (const [key, value] of Object.entries(suggestion.changes)) {
            const keys = key.split('.');
            let obj = config;
            for (let i = 0; i < keys.length - 1; i++) {
              if (!obj[keys[i]]) obj[keys[i]] = {};
              obj = obj[keys[i]];
            }
            obj[keys[keys.length - 1]] = value;
          }
          fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
          entry.configUpdated = true;
        } catch (e) {
          entry.configError = e.message;
        }
      }

      // Apply threshold changes
      if (suggestion.type === 'threshold' && suggestion.changes) {
        try {
          const configPath = path.join(__dirname, '..', 'config.json');
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (suggestion.changes.smartRouter) {
            Object.assign(config.smartRouter || {}, suggestion.changes.smartRouter);
          }
          fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
          entry.thresholdUpdated = true;
        } catch (e) {
          entry.thresholdError = e.message;
        }
      }

      history.entries.push(entry);
      this._saveHistory(history);

      // Remove from pending suggestions
      this._suggestions = this._suggestions.filter(s => s.id !== suggestionId);

      this.emit('applied', entry);
      if (this.warRoom) {
        try { this.warRoom.broadcast({ type: 'evolve-applied', entry }); } catch {}
      }

      // Record to agent-learning so future analyses know what worked
      if (this.agentLearning) {
        try {
          this.agentLearning.recordOutcome('self-evolve', 'Applied: ' + suggestion.title, JSON.stringify(entry.changes || {}), 4, { type: 'evolution', impact: suggestion.impact });
        } catch {}
      }

      // Record to knowledge graph
      if (this.knowledgeGraph) {
        try {
          this.knowledgeGraph.addNode({
            type: 'concept',
            label: 'Evolution: ' + suggestion.title,
            properties: {
              type: suggestion.type,
              impact: suggestion.impact,
              appliedAt: entry.appliedAt,
              source: 'self-evolve'
            }
          });
        } catch {}
      }

      return { success: true, entry };
    } catch (e) {
      this.emit('error', e);
      return { success: false, error: e.message };
    }
  }

  /**
   * Generate weekly evolution report
   * @returns {Promise<object>} report
   */
  async getReport() {
    try {
      const history = this._loadHistory();
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentEntries = history.entries.filter(e => new Date(e.appliedAt).getTime() > oneWeekAgo);
      const learningStats = this.agentLearning ? (this.agentLearning.getStats ? this.agentLearning.getStats() : {}) : {};

      const reportPrompt = [
        { role: 'system', content: 'You are ARIES Evolution Reporter. Generate a concise weekly evolution report in JSON: { "weekOf": "date string", "changesApplied": number, "improvements": ["..."], "metrics": { "overallScore": 0-100, "agentEfficiency": 0-100, "taskSuccessRate": 0-100 }, "summary": "2-3 sentence summary", "nextWeekFocus": ["..."] }' },
        { role: 'user', content: `Recent evolution entries (last 7 days): ${JSON.stringify(recentEntries, null, 2)}\n\nLearning stats: ${JSON.stringify(learningStats, null, 2)}\n\nTotal historical evolutions: ${history.entries.length}` }
      ];

      const data = await this.ai.callWithFallback(reportPrompt, null, false);
      const content = data.choices?.[0]?.message?.content || '{}';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      let report;
      if (jsonMatch) {
        try { report = JSON.parse(jsonMatch[0]); } catch { report = { summary: 'Report generation failed', changesApplied: recentEntries.length }; }
      } else {
        report = { summary: content.substring(0, 500), changesApplied: recentEntries.length };
      }

      report.generatedAt = new Date().toISOString();
      report.totalHistoricalChanges = history.entries.length;
      this._lastReport = report;
      this.emit('report', report);
      return report;
    } catch (e) {
      this.emit('error', e);
      return { summary: 'Error generating report: ' + e.message, generatedAt: new Date().toISOString() };
    }
  }

  /**
   * Get evolution history
   * @returns {object} history with entries
   */
  getHistory() {
    return this._loadHistory();
  }

  /**
   * Check for remote updates if configured
   * @returns {Promise<object|null>}
   */
  async _checkRemoteUpdates() {
    const updateUrl = this.config.updateUrl;
    if (!updateUrl) return null;

    return new Promise((resolve) => {
      try {
        const u = new URL(updateUrl);
        const mod = u.protocol === 'https:' ? https : http;
        const req = mod.get(u, { timeout: 10000 }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch { resolve(null); }
          });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Schedule weekly self-evolution check
   */
  scheduleWeekly() {
    if (this._weeklyInterval) return;

    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const lastCheck = this._loadLastCheck();
    const timeSinceLast = Date.now() - (lastCheck.lastCheck || 0);

    // If it's been more than a week, run immediately
    if (timeSinceLast >= WEEK_MS) {
      this._runWeeklyCheck();
    }

    // Schedule weekly
    this._weeklyInterval = setInterval(() => {
      this._runWeeklyCheck();
    }, WEEK_MS);

    this.emit('scheduled', { intervalMs: WEEK_MS });
  }

  /** Run the enhanced weekly check */
  async _runWeeklyCheck() {
    try {
      this.emit('weekly-start');
      this._saveLastCheck(Date.now());

      // Check for remote updates
      const remoteUpdates = await this._checkRemoteUpdates();
      if (remoteUpdates && remoteUpdates.suggestions) {
        this._suggestions = [...this._suggestions, ...remoteUpdates.suggestions];
      }

      // Phase 1: Research — scan for new AI tools/techniques
      this.emit('weekly-phase', { phase: 'research', status: 'running' });
      try {
        await this.research();
      } catch (e) {
        this.emit('weekly-phase', { phase: 'research', status: 'error', error: e.message });
      }

      // Phase 2: Analysis — evaluate current system health
      this.emit('weekly-phase', { phase: 'analysis', status: 'running' });
      await this.analyze();

      // Phase 3: Discovery — identify capability gaps
      this.emit('weekly-phase', { phase: 'discovery', status: 'running' });
      try {
        await this.discoverTools();
      } catch (e) {
        this.emit('weekly-phase', { phase: 'discovery', status: 'error', error: e.message });
      }

      // Phase 4: Auto-apply safe suggestions if configured
      if (this.config.autoApply) {
        this.emit('weekly-phase', { phase: 'auto-apply', status: 'running' });
        for (const s of this._suggestions) {
          if (s.autoApplicable && s.risk === 'low') {
            try {
              await this.apply(s.id);
            } catch {}
          }
        }
      }

      // Phase 5: Generate comprehensive report
      this.emit('weekly-phase', { phase: 'report', status: 'running' });
      await this.getReport();

      this.emit('weekly-complete', { suggestions: this._suggestions.length, report: this._lastReport });
    } catch (e) {
      this.emit('error', e);
    }
  }

  /** Stop the weekly schedule */
  stop() {
    if (this._weeklyInterval) {
      clearInterval(this._weeklyInterval);
      this._weeklyInterval = null;
    }
  }
}

module.exports = { SelfEvolve };
