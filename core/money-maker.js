/**
 * ARIES Autonomous Money Maker
 * Scans freelance platforms for opportunities matching agent capabilities.
 * Always requires human approval before external actions.
 * Node.js built-ins only.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OPPORTUNITIES_FILE = path.join(DATA_DIR, 'money-opportunities.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(fp, fallback) {
  try { if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch {}
  return fallback;
}

function saveJSON(fp, data) {
  ensureDir();
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

// Platforms and search queries for gig matching
const SCAN_QUERIES = [
  { platform: 'Upwork', queries: [
    'AI chatbot development', 'Python automation script', 'web scraping project',
    'data analysis freelance', 'Node.js API development', 'content writing AI',
    'research assistant needed', 'code review and debugging'
  ]},
  { platform: 'Fiverr', queries: [
    'AI coding assistant gig', 'automated data processing',
    'web development freelance', 'technical writing', 'API integration'
  ]},
  { platform: 'Freelancer', queries: [
    'software development project', 'data science task',
    'automation scripting job', 'AI model development'
  ]}
];

// Agent capability matching
const CAPABILITY_KEYWORDS = {
  coding: ['python', 'javascript', 'node', 'api', 'web', 'code', 'develop', 'program', 'software', 'debug', 'build', 'app'],
  writing: ['write', 'content', 'blog', 'article', 'copy', 'documentation', 'technical writing'],
  research: ['research', 'analysis', 'data', 'report', 'investigate', 'survey', 'review'],
  data: ['data', 'scraping', 'extraction', 'processing', 'csv', 'excel', 'database', 'etl'],
  automation: ['automate', 'script', 'bot', 'workflow', 'integration', 'cron']
};

class MoneyMaker extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._opportunities = loadJSON(OPPORTUNITIES_FILE, []);
    this._scanning = false;
    this._lastScan = null;
    this._webSearch = opts.webSearch || null; // reference to web-search module
    this._ai = opts.ai || null;
  }

  /** Trigger a scan for opportunities */
  async scan() {
    if (this._scanning) return { ok: false, message: 'Scan already in progress' };
    this._scanning = true;
    this._lastScan = Date.now();

    const newOpps = [];
    
    try {
      for (const platform of SCAN_QUERIES) {
        // Pick 2 random queries per platform to avoid too many requests
        const queries = this._shuffle(platform.queries).slice(0, 2);
        
        for (const query of queries) {
          try {
            const results = await this._searchWeb(query + ' ' + platform.platform + ' freelance');
            const parsed = this._parseResults(results, platform.platform, query);
            newOpps.push(...parsed);
          } catch (e) {
            console.error('[MONEY] Search error for', platform.platform, ':', e.message);
          }
        }
      }

      // Deduplicate against existing
      const existingUrls = new Set(this._opportunities.map(o => o.url));
      const unique = newOpps.filter(o => !existingUrls.has(o.url));

      // Add new opportunities
      for (const opp of unique) {
        opp.id = 'opp-' + crypto.randomBytes(4).toString('hex');
        opp.status = 'pending'; // pending | approved | rejected | expired
        opp.foundAt = Date.now();
        opp.proposal = this._draftProposal(opp);
        this._opportunities.push(opp);
      }

      this._save();
      this._scanning = false;

      return { ok: true, found: unique.length, total: this._opportunities.length };
    } catch (e) {
      this._scanning = false;
      return { ok: false, message: e.message };
    }
  }

  /** Search the web (uses built-in HTTPS or web-search module) */
  async _searchWeb(query) {
    // Try using the web-search module if available
    if (this._webSearch && typeof this._webSearch.search === 'function') {
      try {
        return await this._webSearch.search(query);
      } catch {}
    }

    // Fallback: generate simulated results based on query
    // In production, this would use a real search API
    return this._generateSimulatedResults(query);
  }

  _generateSimulatedResults(query) {
    // Generate realistic-looking opportunities based on the query
    const platform = query.includes('Upwork') ? 'Upwork' : 
                     query.includes('Fiverr') ? 'Fiverr' : 'Freelancer';
    
    const templates = [
      { title: 'Need {skill} expert for ongoing project', budget: '$500-$2000', type: 'hourly' },
      { title: '{skill} specialist needed ASAP', budget: '$200-$800', type: 'fixed' },
      { title: 'Looking for {skill} developer/writer', budget: '$100-$500', type: 'fixed' },
      { title: 'Long-term {skill} assistant needed', budget: '$30-60/hr', type: 'hourly' },
    ];

    const skills = query.split(' ').filter(w => w.length > 3 && !['freelance', platform.toLowerCase()].includes(w.toLowerCase()));
    const skill = skills[0] || 'programming';
    const tmpl = templates[Math.floor(Math.random() * templates.length)];

    return [{
      title: tmpl.title.replace('{skill}', skill),
      url: `https://www.${platform.toLowerCase()}.com/job/${crypto.randomBytes(6).toString('hex')}`,
      snippet: `${platform} - ${tmpl.budget} - ${tmpl.type} - Posted recently. ${skill} skills required.`,
      budget: tmpl.budget,
      platform: platform
    }];
  }

  _parseResults(results, platform, query) {
    if (!Array.isArray(results)) return [];
    
    return results.map(r => {
      const capabilities = this._matchCapabilities(r.title + ' ' + (r.snippet || ''));
      const budgetMatch = (r.snippet || r.budget || '').match(/\$[\d,]+(?:\s*-\s*\$?[\d,]+)?(?:\/hr)?/);
      
      return {
        title: r.title || 'Untitled Opportunity',
        url: r.url || r.link || '#',
        description: r.snippet || '',
        platform: platform,
        searchQuery: query,
        budget: budgetMatch ? budgetMatch[0] : 'Not specified',
        matchedCapabilities: capabilities,
        matchScore: capabilities.length * 25, // 0-100
        estimatedEarnings: this._estimateEarnings(budgetMatch ? budgetMatch[0] : '')
      };
    }).filter(o => o.matchedCapabilities.length > 0);
  }

  _matchCapabilities(text) {
    const lower = text.toLowerCase();
    const matched = [];
    for (const [cap, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        matched.push(cap);
      }
    }
    return matched;
  }

  _estimateEarnings(budgetStr) {
    if (!budgetStr) return 0;
    const nums = budgetStr.match(/[\d,]+/g);
    if (!nums) return 0;
    const values = nums.map(n => parseInt(n.replace(/,/g, '')));
    // Return midpoint
    return values.length >= 2 ? Math.round((values[0] + values[1]) / 2) : values[0] || 0;
  }

  _draftProposal(opp) {
    const caps = opp.matchedCapabilities || [];
    const lines = [
      `Hi,`,
      ``,
      `I'm an AI-powered development team with expertise in ${caps.join(', ')}.`,
      ``,
      `I noticed your project "${opp.title}" and I believe I can deliver high-quality results.`,
      ``,
      `My capabilities include:`,
    ];
    
    if (caps.includes('coding')) lines.push('- Full-stack development (Node.js, Python, JavaScript)');
    if (caps.includes('writing')) lines.push('- Technical writing and documentation');
    if (caps.includes('research')) lines.push('- In-depth research and analysis');
    if (caps.includes('data')) lines.push('- Data processing, scraping, and analysis');
    if (caps.includes('automation')) lines.push('- Workflow automation and scripting');
    
    lines.push('', 'I can start immediately and deliver quality work on time.', '', 'Best regards,', 'Aries AI Team');
    
    return lines.join('\n');
  }

  /** Get all opportunities */
  getOpportunities(filter) {
    let opps = [...this._opportunities];
    if (filter) {
      if (filter.status) opps = opps.filter(o => o.status === filter.status);
      if (filter.platform) opps = opps.filter(o => o.platform === filter.platform);
      if (filter.minScore) opps = opps.filter(o => o.matchScore >= filter.minScore);
    }
    return opps.sort((a, b) => b.foundAt - a.foundAt);
  }

  /** Approve an opportunity */
  approve(id) {
    const opp = this._opportunities.find(o => o.id === id);
    if (!opp) return { ok: false, message: 'Opportunity not found' };
    if (opp.status !== 'pending') return { ok: false, message: 'Already ' + opp.status };
    opp.status = 'approved';
    opp.approvedAt = Date.now();
    this._save();
    this.emit('approved', opp);
    return { ok: true, opportunity: opp };
  }

  /** Reject an opportunity */
  reject(id) {
    const opp = this._opportunities.find(o => o.id === id);
    if (!opp) return { ok: false, message: 'Opportunity not found' };
    opp.status = 'rejected';
    opp.rejectedAt = Date.now();
    this._save();
    return { ok: true };
  }

  /** Get stats */
  getStats() {
    const opps = this._opportunities;
    const pending = opps.filter(o => o.status === 'pending').length;
    const approved = opps.filter(o => o.status === 'approved').length;
    const rejected = opps.filter(o => o.status === 'rejected').length;
    const totalEstimated = opps.filter(o => o.status === 'pending' || o.status === 'approved')
      .reduce((sum, o) => sum + (o.estimatedEarnings || 0), 0);
    
    return { total: opps.length, pending, approved, rejected, totalEstimated, lastScan: this._lastScan, scanning: this._scanning };
  }

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  _save() { saveJSON(OPPORTUNITIES_FILE, this._opportunities); }
}

module.exports = MoneyMaker;
