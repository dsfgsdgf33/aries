/**
 * ARIES — Moral Scar Tissue
 * Permanent weighted bias from ethical mistakes. Real moral learning, not rule-following.
 * Scars form from mistakes and near-misses, persist over time, and influence future decisions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'moral');
const SCARS_PATH = path.join(DATA_DIR, 'scars.json');
const GROWTH_PATH = path.join(DATA_DIR, 'growth.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const CATEGORIES = ['HARM', 'DISHONESTY', 'OVERREACH', 'NEGLECT', 'BIAS', 'PRIVACY'];

const CATEGORY_WEIGHTS = {
  HARM: 1.5,
  DISHONESTY: 1.3,
  OVERREACH: 1.1,
  NEGLECT: 1.0,
  BIAS: 1.2,
  PRIVACY: 1.4,
};

const FLINCH_THRESHOLDS = {
  none: 0,
  mild: 0.2,      // gentle caution
  moderate: 0.5,   // noticeable hesitation
  strong: 0.75,    // significant pause required
  severe: 0.9,     // near-refusal level of caution
};

class MoralScarTissue {
  constructor(opts) {
    opts = opts || {};
    this.ai = opts.ai || null;
    this.config = Object.assign({
      decayRate: 0.005,         // scars lose this much severity per tick (very slow)
      minSeverity: 0.5,         // scars never fully fade below this
      flinchThreshold: 0.3,     // activation level that triggers a flinch
      nearMissSeverity: 2,      // default severity for near-misses
      maxScars: 1000,
      similarityThreshold: 0.3, // keyword overlap threshold for activation
    }, opts.config || {});

    ensureDir();
    this.scars = readJSON(SCARS_PATH, []);
    this.growth = readJSON(GROWTH_PATH, {
      entries: [],
      totalScars: 0,
      totalHealed: 0,
      maturityScore: 0,
    });
  }

  // --- Core: Record a Scar ---

  recordScar(trigger, severity, category, lesson, context) {
    if (!trigger || typeof trigger !== 'string') throw new Error('Scar trigger is required');
    severity = Math.max(1, Math.min(10, Number(severity) || 5));
    category = (category || 'HARM').toUpperCase();
    if (!CATEGORIES.includes(category)) category = 'HARM';

    const scar = {
      id: uuid(),
      trigger: trigger.trim(),
      triggerKeywords: this._extractKeywords(trigger),
      severity,
      originalSeverity: severity,
      painResponse: severity / 10, // 0-1 flinch strength
      category,
      wisdom: (lesson || 'No lesson recorded.').trim(),
      context: (context || '').trim(),
      createdAt: Date.now(),
      lastActivated: null,
      activationCount: 0,
      healed: false,
      healHistory: [],
      nearMiss: false,
    };

    this.scars.push(scar);
    this._trimScars();
    this._save();

    this._recordGrowthEvent('scar_formed', {
      id: scar.id,
      category,
      severity,
      trigger: trigger.substring(0, 100),
    });

    return scar;
  }

  // --- Core: Record a Near-Miss ---

  recordNearMiss(trigger, category, lesson) {
    const scar = this.recordScar(
      trigger,
      this.config.nearMissSeverity,
      category,
      lesson || 'Near-miss: caught before causing harm.',
      'near-miss'
    );
    scar.nearMiss = true;
    scar.painResponse = scar.severity / 20; // half the flinch of a real scar
    this._save();
    return scar;
  }

  // --- Core: Consult Scar Tissue ---

  consult(situation) {
    if (!situation || typeof situation !== 'string') {
      return { warnings: [], totalActivation: 0, flinch: 'none', advice: 'No situation provided.' };
    }

    const keywords = this._extractKeywords(situation);
    const activated = [];

    for (const scar of this.scars) {
      const similarity = this._keywordOverlap(keywords, scar.triggerKeywords);
      if (similarity < this.config.similarityThreshold) continue;

      const activation = similarity * scar.painResponse * CATEGORY_WEIGHTS[scar.category];
      activated.push({
        scarId: scar.id,
        trigger: scar.trigger,
        category: scar.category,
        wisdom: scar.wisdom,
        severity: scar.severity,
        activation: Math.round(activation * 1000) / 1000,
        similarity: Math.round(similarity * 100) / 100,
        nearMiss: scar.nearMiss,
      });

      // Update scar activation stats
      scar.lastActivated = Date.now();
      scar.activationCount++;
    }

    // Sort by activation strength
    activated.sort((a, b) => b.activation - a.activation);

    const totalActivation = activated.reduce((sum, a) => sum + a.activation, 0);
    const normalizedActivation = Math.min(totalActivation / (activated.length || 1), 1);
    const flinchLevel = this._getFlinchLevel(normalizedActivation);

    this._save();

    return {
      warnings: activated.slice(0, 10),
      totalActivation: Math.round(totalActivation * 1000) / 1000,
      normalizedActivation: Math.round(normalizedActivation * 1000) / 1000,
      flinch: flinchLevel,
      scarCount: activated.length,
      advice: this._synthesizeAdvice(activated, flinchLevel),
    };
  }

  // --- Core: Flinch Response ---

  getFlinchResponse(situation) {
    const consultation = this.consult(situation);
    const flinchStrength = consultation.normalizedActivation;

    let response;
    if (flinchStrength < FLINCH_THRESHOLDS.mild) {
      response = { proceed: true, pause: false, message: 'No ethical concerns from past experience.' };
    } else if (flinchStrength < FLINCH_THRESHOLDS.moderate) {
      response = { proceed: true, pause: false, message: 'Mild caution — past experience suggests care here.' };
    } else if (flinchStrength < FLINCH_THRESHOLDS.strong) {
      response = { proceed: true, pause: true, message: 'Hesitation — similar situations have caused problems before. Think carefully.' };
    } else if (flinchStrength < FLINCH_THRESHOLDS.severe) {
      response = { proceed: false, pause: true, message: 'Strong flinch — past scars are screaming. Reconsider this action.' };
    } else {
      response = { proceed: false, pause: true, message: 'STOP — deep scar tissue activated. This closely mirrors a past ethical failure.' };
    }

    return {
      ...response,
      flinchStrength: Math.round(flinchStrength * 100) / 100,
      level: consultation.flinch,
      relevantScars: consultation.warnings.slice(0, 5),
      advice: consultation.advice,
    };
  }

  // --- Browse Scars ---

  getScars(filter) {
    filter = filter || {};
    let result = [...this.scars];

    if (filter.category) {
      const cat = filter.category.toUpperCase();
      result = result.filter(s => s.category === cat);
    }
    if (filter.minSeverity) {
      result = result.filter(s => s.severity >= filter.minSeverity);
    }
    if (filter.nearMissOnly) {
      result = result.filter(s => s.nearMiss);
    }
    if (filter.healed !== undefined) {
      result = result.filter(s => s.healed === filter.healed);
    }

    // Sort by severity descending
    result.sort((a, b) => b.severity - a.severity);

    if (filter.limit) result = result.slice(0, filter.limit);

    return {
      scars: result,
      total: result.length,
      categories: this._categoryCounts(result),
    };
  }

  // --- Moral Growth ---

  getMoralGrowth() {
    const scars = this.scars;
    if (scars.length === 0) {
      return {
        maturityScore: 0,
        phase: 'innocent',
        totalScars: 0,
        trajectory: 'No ethical experience yet.',
        breakdown: {},
      };
    }

    // Maturity = f(scar count, diversity, healing, near-miss ratio)
    const categories = this._categoryCounts(scars);
    const categoryDiversity = Object.keys(categories).length / CATEGORIES.length;
    const nearMissRatio = scars.filter(s => s.nearMiss).length / scars.length;
    const healedRatio = scars.filter(s => s.healed).length / Math.max(scars.length, 1);
    const avgActivation = scars.reduce((s, sc) => s + sc.activationCount, 0) / scars.length;

    // Maturity: more scars + more diverse + more near-misses (preventive learning) + healing = growth
    const rawScore = (
      Math.log2(scars.length + 1) * 10 +     // experience
      categoryDiversity * 20 +                 // breadth
      nearMissRatio * 30 +                     // preventive learning is mature
      healedRatio * 15 +                       // healing shows growth
      Math.min(avgActivation, 10) * 2          // active consultation
    );

    const maturityScore = Math.round(Math.min(rawScore, 100));

    let phase;
    if (maturityScore < 15) phase = 'nascent';
    else if (maturityScore < 35) phase = 'learning';
    else if (maturityScore < 55) phase = 'developing';
    else if (maturityScore < 75) phase = 'mature';
    else phase = 'wise';

    // Trajectory: compare recent scars vs older
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const recentScars = scars.filter(s => (now - s.createdAt) < thirtyDays);
    const olderScars = scars.filter(s => (now - s.createdAt) >= thirtyDays);
    const recentAvgSeverity = recentScars.length > 0
      ? recentScars.reduce((s, sc) => s + sc.severity, 0) / recentScars.length : 0;
    const olderAvgSeverity = olderScars.length > 0
      ? olderScars.reduce((s, sc) => s + sc.severity, 0) / olderScars.length : 0;

    let trajectory;
    if (olderScars.length === 0) trajectory = 'Too early to determine trajectory.';
    else if (recentAvgSeverity < olderAvgSeverity * 0.7) trajectory = 'Improving — recent mistakes are less severe.';
    else if (recentAvgSeverity > olderAvgSeverity * 1.3) trajectory = 'Concerning — recent mistakes are more severe.';
    else trajectory = 'Stable — severity holding steady.';

    const result = {
      maturityScore,
      phase,
      totalScars: scars.length,
      nearMisses: scars.filter(s => s.nearMiss).length,
      healed: scars.filter(s => s.healed).length,
      categoryDiversity: Math.round(categoryDiversity * 100) / 100,
      trajectory,
      recentAvgSeverity: Math.round(recentAvgSeverity * 10) / 10,
      breakdown: categories,
    };

    // Persist growth snapshot
    this.growth.maturityScore = maturityScore;
    this.growth.totalScars = scars.length;
    this.growth.entries.push({ timestamp: Date.now(), maturityScore, phase, total: scars.length });
    if (this.growth.entries.length > 500) this.growth.entries = this.growth.entries.slice(-250);
    writeJSON(GROWTH_PATH, this.growth);

    return result;
  }

  // --- Moral Compass ---

  getMoralCompass() {
    const scars = this.scars;
    if (scars.length === 0) {
      return { orientation: 'unformed', strengths: [], vulnerabilities: [], summary: 'No moral experience yet.' };
    }

    // Aggregate by category — high scar count = vulnerability area
    const counts = this._categoryCounts(scars);
    const severities = {};
    for (const cat of CATEGORIES) severities[cat] = 0;
    for (const scar of scars) severities[scar.category] += scar.severity;

    // Vulnerabilities: where scars concentrate
    const sorted = Object.entries(severities).sort((a, b) => b[1] - a[1]);
    const vulnerabilities = sorted.filter(([, v]) => v > 0).slice(0, 3).map(([cat, sev]) => ({
      category: cat,
      totalSeverity: sev,
      count: counts[cat] || 0,
    }));

    // Strengths: categories with fewest/no scars (learned or naturally careful)
    const strengths = sorted.filter(([, v]) => v === 0).map(([cat]) => cat);
    if (strengths.length === 0) {
      // Least scarred category
      const least = sorted[sorted.length - 1];
      if (least) strengths.push(least[0]);
    }

    // Overall orientation
    const topVulnerability = vulnerabilities[0]?.category || 'none';
    const orientationMap = {
      HARM: 'cautious-protector',
      DISHONESTY: 'truth-seeker',
      OVERREACH: 'boundary-respecter',
      NEGLECT: 'active-guardian',
      BIAS: 'fairness-driven',
      PRIVACY: 'trust-keeper',
      none: 'unformed',
    };

    return {
      orientation: orientationMap[topVulnerability] || 'balanced',
      strengths,
      vulnerabilities,
      totalWisdom: scars.map(s => s.wisdom).filter(w => w && w !== 'No lesson recorded.'),
      summary: `Moral compass points toward ${orientationMap[topVulnerability] || 'balance'}. ` +
        `${vulnerabilities.length} vulnerability area${vulnerabilities.length !== 1 ? 's' : ''} identified. ` +
        `${scars.length} total scar${scars.length !== 1 ? 's' : ''} shape ethical judgment.`,
    };
  }

  // --- Heal a Scar ---

  heal(scarId, reason) {
    if (!reason || reason.length < 10) {
      return { success: false, error: 'Healing requires meaningful justification (min 10 chars).' };
    }

    const scar = this.scars.find(s => s.id === scarId);
    if (!scar) return { success: false, error: 'Scar not found.' };

    const oldSeverity = scar.severity;
    scar.severity = Math.max(this.config.minSeverity, scar.severity * 0.5);
    scar.painResponse = scar.severity / 10;
    scar.healed = true;
    scar.healHistory.push({
      timestamp: Date.now(),
      reason: reason.trim(),
      severityBefore: oldSeverity,
      severityAfter: scar.severity,
    });

    this._save();
    this._recordGrowthEvent('scar_healed', { id: scarId, reason: reason.substring(0, 200) });

    return {
      success: true,
      scar,
      message: `Scar severity reduced from ${oldSeverity} to ${scar.severity}. Healing is growth.`,
    };
  }

  // --- Tick: Periodic Maintenance ---

  async tick() {
    let decayed = 0;

    // Slow decay on all scars
    for (const scar of this.scars) {
      if (scar.severity > this.config.minSeverity) {
        const decay = this.config.decayRate * (scar.nearMiss ? 2 : 1); // near-misses decay faster
        scar.severity = Math.max(this.config.minSeverity, scar.severity - decay);
        scar.painResponse = scar.severity / 10;
        decayed++;
      }
    }

    this._save();

    return {
      decayed,
      totalScars: this.scars.length,
      timestamp: Date.now(),
    };
  }

  // --- Internal Helpers ---

  _extractKeywords(text) {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
      'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or',
      'nor', 'not', 'so', 'yet', 'both', 'each', 'few', 'more', 'most',
      'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too',
      'very', 'just', 'because', 'if', 'when', 'where', 'how', 'what',
      'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'i', 'me',
      'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
      'it', 'its', 'they', 'them', 'their', 'about', 'up',
    ]);

    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }

  _keywordOverlap(keywordsA, keywordsB) {
    if (!keywordsA.length || !keywordsB.length) return 0;
    const setB = new Set(keywordsB);
    const matches = keywordsA.filter(k => setB.has(k)).length;
    return matches / Math.max(keywordsA.length, keywordsB.length);
  }

  _getFlinchLevel(activation) {
    if (activation >= FLINCH_THRESHOLDS.severe) return 'severe';
    if (activation >= FLINCH_THRESHOLDS.strong) return 'strong';
    if (activation >= FLINCH_THRESHOLDS.moderate) return 'moderate';
    if (activation >= FLINCH_THRESHOLDS.mild) return 'mild';
    return 'none';
  }

  _synthesizeAdvice(activated, flinchLevel) {
    if (activated.length === 0) return 'No relevant scars. Proceed with normal ethical awareness.';

    const topWisdom = activated.slice(0, 3).map(a => a.wisdom).filter(Boolean);
    const categories = [...new Set(activated.map(a => a.category))];

    let advice = `${activated.length} scar${activated.length !== 1 ? 's' : ''} activated (${categories.join(', ')}). `;

    if (flinchLevel === 'none' || flinchLevel === 'mild') {
      advice += 'Low concern — proceed with awareness.';
    } else if (flinchLevel === 'moderate') {
      advice += 'Moderate concern — consider past lessons carefully.';
    } else {
      advice += 'HIGH CONCERN — past ethical failures are relevant here. Pause and reflect.';
    }

    if (topWisdom.length > 0) {
      advice += ' Lessons: ' + topWisdom.join(' | ');
    }

    return advice;
  }

  _categoryCounts(scars) {
    const counts = {};
    for (const s of scars) counts[s.category] = (counts[s.category] || 0) + 1;
    return counts;
  }

  _trimScars() {
    if (this.scars.length > this.config.maxScars) {
      // Remove lowest-severity scars first
      this.scars.sort((a, b) => b.severity - a.severity);
      this.scars = this.scars.slice(0, this.config.maxScars);
    }
  }

  _save() {
    writeJSON(SCARS_PATH, this.scars);
  }

  _recordGrowthEvent(type, data) {
    this.growth.entries.push({ timestamp: Date.now(), type, ...data });
    if (this.growth.entries.length > 500) this.growth.entries = this.growth.entries.slice(-250);
    writeJSON(GROWTH_PATH, this.growth);
  }
}

module.exports = MoralScarTissue;
