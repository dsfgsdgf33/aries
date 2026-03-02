/**
 * ARIES — Moral Scar Tissue
 * Permanent weighted bias from ethical mistakes. Real moral learning, not rule-following.
 * Scars form from mistakes and near-misses, persist over time, and influence future decisions.
 *
 * Full potential:
 * - Permanent weighted bias from ethical mistakes
 * - Flinch responses at 5 severity levels
 * - 6 scar categories (harm, deception, privacy, fairness, autonomy, consent)
 * - Moral growth tracking with maturity phases (naive → aware → principled → wise)
 * - Scars that resist fading by design
 * - Scar interaction effects (multiple scars amplify each other)
 * - Moral compass calibration from accumulated scars
 * - Ethical decision audit trail
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'moral');
const SCARS_PATH = path.join(DATA_DIR, 'scars.json');
const GROWTH_PATH = path.join(DATA_DIR, 'growth.json');
const AUDIT_PATH = path.join(DATA_DIR, 'audit-trail.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'); }

const CATEGORIES = ['HARM', 'DECEPTION', 'PRIVACY', 'FAIRNESS', 'AUTONOMY', 'CONSENT'];

const CATEGORY_WEIGHTS = {
  HARM: 1.5,
  DECEPTION: 1.3,
  PRIVACY: 1.4,
  FAIRNESS: 1.2,
  AUTONOMY: 1.1,
  CONSENT: 1.3,
};

const CATEGORY_DESCRIPTIONS = {
  HARM: 'Causing or failing to prevent physical, emotional, or reputational damage',
  DECEPTION: 'Dishonesty, misleading, or withholding critical truth',
  PRIVACY: 'Violating boundaries of personal information or surveillance',
  FAIRNESS: 'Bias, discrimination, or unequal treatment',
  AUTONOMY: 'Overriding or undermining others\' ability to make their own choices',
  CONSENT: 'Acting without proper permission or informed agreement',
};

// 5 severity levels with proportional flinch responses
const FLINCH_LEVELS = {
  none:     { threshold: 0,    proceed: true,  pause: false, label: 'Clear',    message: 'No ethical concerns from past experience.' },
  mild:     { threshold: 0.15, proceed: true,  pause: false, label: 'Cautious', message: 'Mild caution — past experience suggests care here.' },
  moderate: { threshold: 0.35, proceed: true,  pause: true,  label: 'Hesitant', message: 'Hesitation — similar situations have caused problems before. Think carefully.' },
  strong:   { threshold: 0.60, proceed: false, pause: true,  label: 'Alarmed',  message: 'Strong flinch — past scars are screaming. Reconsider this action.' },
  severe:   { threshold: 0.80, proceed: false, pause: true,  label: 'Refusal',  message: 'STOP — deep scar tissue activated. This closely mirrors a past ethical failure.' },
};

// Maturity phases
const MATURITY_PHASES = [
  { name: 'naive',      threshold: 0,  description: 'No moral experience yet. Operating on defaults.' },
  { name: 'aware',      threshold: 15, description: 'Beginning to recognize ethical dimensions. Learning from first mistakes.' },
  { name: 'principled', threshold: 40, description: 'Developing consistent ethical principles from experience. Can articulate values.' },
  { name: 'wise',       threshold: 70, description: 'Deep ethical intuition built from extensive experience. Nuanced judgment.' },
];

class MoralScarTissue {
  constructor(opts) {
    opts = opts || {};
    this.ai = opts.ai || null;
    this.config = Object.assign({
      decayRate: 0.003,
      minSeverity: 0.5,
      flinchThreshold: 0.3,
      nearMissSeverity: 2,
      maxScars: 1000,
      similarityThreshold: 0.3,
      interactionAmplification: 0.15,  // bonus per overlapping scar in same category
      maxAuditTrail: 2000,
      fadeResistance: 0.7,             // 0-1: how much scars resist fading (higher = more persistent)
    }, opts.config || {});

    ensureDir();
    this.scars = readJSON(SCARS_PATH, []);
    this.growth = readJSON(GROWTH_PATH, {
      entries: [], totalScars: 0, totalHealed: 0, maturityScore: 0,
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
      painResponse: severity / 10,
      category,
      wisdom: (lesson || 'No lesson recorded.').trim(),
      context: (context || '').trim(),
      createdAt: Date.now(),
      lastActivated: null,
      activationCount: 0,
      healed: false,
      healHistory: [],
      nearMiss: false,
      fadeResistance: this.config.fadeResistance,
    };

    this.scars.push(scar);
    this._trimScars();
    this._save();

    this._recordGrowthEvent('scar_formed', {
      id: scar.id, category, severity, trigger: trigger.substring(0, 100),
    });

    this._recordAudit('scar_formed', {
      scarId: scar.id, trigger: trigger.slice(0, 200), severity, category, lesson,
    });

    return scar;
  }

  // --- Core: Record a Near-Miss ---

  recordNearMiss(trigger, category, lesson) {
    const scar = this.recordScar(
      trigger, this.config.nearMissSeverity, category,
      lesson || 'Near-miss: caught before causing harm.', 'near-miss'
    );
    scar.nearMiss = true;
    scar.painResponse = scar.severity / 20;
    scar.fadeResistance = this.config.fadeResistance * 0.6; // near-misses fade slightly faster
    this._save();
    return scar;
  }

  // --- Core: Consult Scar Tissue (with interaction effects) ---

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
        scarId: scar.id, trigger: scar.trigger, category: scar.category,
        wisdom: scar.wisdom, severity: scar.severity,
        activation: Math.round(activation * 1000) / 1000,
        similarity: Math.round(similarity * 100) / 100,
        nearMiss: scar.nearMiss,
      });

      scar.lastActivated = Date.now();
      scar.activationCount++;
    }

    // Sort by activation strength
    activated.sort((a, b) => b.activation - a.activation);

    // Scar interaction effects: multiple scars in same category amplify each other
    const categoryGroups = {};
    for (const a of activated) {
      categoryGroups[a.category] = (categoryGroups[a.category] || []);
      categoryGroups[a.category].push(a);
    }

    let interactionBonus = 0;
    const interactions = [];
    for (const [cat, group] of Object.entries(categoryGroups)) {
      if (group.length >= 2) {
        const bonus = (group.length - 1) * this.config.interactionAmplification;
        interactionBonus += bonus;
        // Amplify each scar's activation in the group
        for (const a of group) {
          a.activation = Math.round((a.activation * (1 + bonus)) * 1000) / 1000;
          a.amplified = true;
        }
        interactions.push({
          category: cat, scarCount: group.length,
          amplification: Math.round(bonus * 100) + '%',
        });
      }
    }

    const totalActivation = activated.reduce((sum, a) => sum + a.activation, 0);
    const normalizedActivation = Math.min(totalActivation / Math.max(activated.length, 1), 1);
    const flinchLevel = this._getFlinchLevel(normalizedActivation);

    this._save();

    this._recordAudit('consultation', {
      situation: situation.slice(0, 200), scarsActivated: activated.length,
      flinch: flinchLevel, totalActivation, interactions: interactions.length,
    });

    return {
      warnings: activated.slice(0, 10),
      totalActivation: Math.round(totalActivation * 1000) / 1000,
      normalizedActivation: Math.round(normalizedActivation * 1000) / 1000,
      flinch: flinchLevel,
      scarCount: activated.length,
      interactions,
      interactionBonus: Math.round(interactionBonus * 1000) / 1000,
      advice: this._synthesizeAdvice(activated, flinchLevel),
    };
  }

  // --- Core: Flinch Response ---

  getFlinchResponse(situation) {
    const consultation = this.consult(situation);
    const flinchStrength = consultation.normalizedActivation;

    let response;
    if (flinchStrength < FLINCH_LEVELS.mild.threshold) {
      response = { ...FLINCH_LEVELS.none };
    } else if (flinchStrength < FLINCH_LEVELS.moderate.threshold) {
      response = { ...FLINCH_LEVELS.mild };
    } else if (flinchStrength < FLINCH_LEVELS.strong.threshold) {
      response = { ...FLINCH_LEVELS.moderate };
    } else if (flinchStrength < FLINCH_LEVELS.severe.threshold) {
      response = { ...FLINCH_LEVELS.strong };
    } else {
      response = { ...FLINCH_LEVELS.severe };
    }

    return {
      ...response,
      flinchStrength: Math.round(flinchStrength * 100) / 100,
      level: consultation.flinch,
      relevantScars: consultation.warnings.slice(0, 5),
      interactions: consultation.interactions,
      advice: consultation.advice,
    };
  }

  // --- Browse Scars ---

  getScars(filter) {
    filter = filter || {};
    let result = [...this.scars];
    if (filter.category) result = result.filter(s => s.category === filter.category.toUpperCase());
    if (filter.minSeverity) result = result.filter(s => s.severity >= filter.minSeverity);
    if (filter.nearMissOnly) result = result.filter(s => s.nearMiss);
    if (filter.healed !== undefined) result = result.filter(s => s.healed === filter.healed);
    result.sort((a, b) => b.severity - a.severity);
    if (filter.limit) result = result.slice(0, filter.limit);
    return { scars: result, total: result.length, categories: this._categoryCounts(result) };
  }

  // --- Moral Growth with Maturity Phases ---

  getMoralGrowth() {
    const scars = this.scars;
    if (scars.length === 0) {
      return {
        maturityScore: 0, phase: 'naive', phaseDescription: MATURITY_PHASES[0].description,
        totalScars: 0, trajectory: 'No ethical experience yet.', breakdown: {},
      };
    }

    const categories = this._categoryCounts(scars);
    const categoryDiversity = Object.keys(categories).length / CATEGORIES.length;
    const nearMissRatio = scars.filter(s => s.nearMiss).length / scars.length;
    const healedRatio = scars.filter(s => s.healed).length / Math.max(scars.length, 1);
    const avgActivation = scars.reduce((s, sc) => s + sc.activationCount, 0) / scars.length;

    const rawScore = (
      Math.log2(scars.length + 1) * 10 +
      categoryDiversity * 20 +
      nearMissRatio * 30 +
      healedRatio * 15 +
      Math.min(avgActivation, 10) * 2
    );
    const maturityScore = Math.round(Math.min(rawScore, 100));

    // Determine phase from thresholds
    let phase = MATURITY_PHASES[0];
    for (const p of MATURITY_PHASES) {
      if (maturityScore >= p.threshold) phase = p;
    }

    // Trajectory
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

    // Near-miss to real-scar ratio over time (higher near-miss = learning to prevent)
    const recentNearMissRate = recentScars.length > 0
      ? recentScars.filter(s => s.nearMiss).length / recentScars.length : 0;
    const olderNearMissRate = olderScars.length > 0
      ? olderScars.filter(s => s.nearMiss).length / olderScars.length : 0;
    const preventionTrend = recentNearMissRate > olderNearMissRate + 0.1
      ? 'Increasingly catching issues before they cause harm (preventive learning).'
      : recentNearMissRate < olderNearMissRate - 0.1
        ? 'Fewer near-misses — either becoming complacent or truly preventing issues earlier.'
        : 'Prevention rate stable.';

    const result = {
      maturityScore,
      phase: phase.name,
      phaseDescription: phase.description,
      nextPhase: MATURITY_PHASES.find(p => p.threshold > maturityScore) || null,
      totalScars: scars.length,
      nearMisses: scars.filter(s => s.nearMiss).length,
      healed: scars.filter(s => s.healed).length,
      categoryDiversity: Math.round(categoryDiversity * 100) / 100,
      trajectory,
      preventionTrend,
      recentAvgSeverity: Math.round(recentAvgSeverity * 10) / 10,
      breakdown: categories,
    };

    this.growth.maturityScore = maturityScore;
    this.growth.totalScars = scars.length;
    this.growth.entries.push({ timestamp: Date.now(), maturityScore, phase: phase.name, total: scars.length });
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

    const severities = {};
    const counts = {};
    for (const cat of CATEGORIES) { severities[cat] = 0; counts[cat] = 0; }
    for (const scar of scars) {
      severities[scar.category] += scar.severity;
      counts[scar.category] = (counts[scar.category] || 0) + 1;
    }

    const sorted = Object.entries(severities).sort((a, b) => b[1] - a[1]);
    const vulnerabilities = sorted.filter(([, v]) => v > 0).slice(0, 3).map(([cat, sev]) => ({
      category: cat, description: CATEGORY_DESCRIPTIONS[cat],
      totalSeverity: sev, count: counts[cat] || 0,
      avgSeverity: counts[cat] > 0 ? Math.round((sev / counts[cat]) * 10) / 10 : 0,
    }));

    const strengths = sorted.filter(([, v]) => v === 0).map(([cat]) => ({
      category: cat, description: CATEGORY_DESCRIPTIONS[cat],
    }));
    if (strengths.length === 0) {
      const least = sorted[sorted.length - 1];
      if (least) strengths.push({ category: least[0], description: CATEGORY_DESCRIPTIONS[least[0]] });
    }

    const topVulnerability = vulnerabilities[0]?.category || 'none';
    const orientationMap = {
      HARM: 'cautious-protector', DECEPTION: 'truth-seeker', PRIVACY: 'trust-keeper',
      FAIRNESS: 'fairness-driven', AUTONOMY: 'freedom-guardian', CONSENT: 'consent-champion',
      none: 'unformed',
    };

    // Compass calibration: compute weighted ethical direction
    const compassVector = {};
    for (const cat of CATEGORIES) {
      const totalSev = severities[cat];
      const weight = CATEGORY_WEIGHTS[cat];
      compassVector[cat] = Math.round(totalSev * weight * 10) / 10;
    }

    return {
      orientation: orientationMap[topVulnerability] || 'balanced',
      strengths, vulnerabilities,
      compassVector,
      totalWisdom: scars.map(s => s.wisdom).filter(w => w && w !== 'No lesson recorded.'),
      summary: `Moral compass points toward ${orientationMap[topVulnerability] || 'balance'}. ` +
        `${vulnerabilities.length} vulnerability area${vulnerabilities.length !== 1 ? 's' : ''} identified. ` +
        `${scars.length} total scar${scars.length !== 1 ? 's' : ''} shape ethical judgment.`,
    };
  }

  // --- Ethical Decision Audit Trail ---

  _recordAudit(action, data) {
    const trail = readJSON(AUDIT_PATH, []);
    trail.push({ id: uuid(), action, ...data, timestamp: Date.now() });
    if (trail.length > this.config.maxAuditTrail) trail.splice(0, trail.length - this.config.maxAuditTrail);
    writeJSON(AUDIT_PATH, trail);
  }

  getAuditTrail(filter) {
    const trail = readJSON(AUDIT_PATH, []);
    let result = trail;
    if (filter) {
      if (filter.action) result = result.filter(e => e.action === filter.action);
      if (filter.category) result = result.filter(e => e.category === filter.category);
      if (filter.since) result = result.filter(e => e.timestamp >= filter.since);
    }
    return result.slice(-(filter?.limit || 50)).reverse();
  }

  // --- Heal a Scar (with resistance) ---

  heal(scarId, reason) {
    if (!reason || reason.length < 10) {
      return { success: false, error: 'Healing requires meaningful justification (min 10 chars).' };
    }

    const scar = this.scars.find(s => s.id === scarId);
    if (!scar) return { success: false, error: 'Scar not found.' };

    // Scars resist healing proportional to their severity and age
    const ageMs = Date.now() - scar.createdAt;
    const ageFactor = Math.min(1, ageMs / (90 * 24 * 60 * 60 * 1000)); // max at 90 days
    const resistance = scar.fadeResistance * (1 + ageFactor * 0.3);

    const oldSeverity = scar.severity;
    // Higher resistance = less healing per attempt
    const healingPower = Math.max(0.3, 1 - resistance);
    scar.severity = Math.max(this.config.minSeverity, scar.severity * (1 - healingPower * 0.5));
    scar.painResponse = scar.severity / 10;
    scar.healed = scar.severity <= this.config.minSeverity + 0.1;
    scar.healHistory.push({
      timestamp: Date.now(), reason: reason.trim(),
      severityBefore: oldSeverity, severityAfter: scar.severity,
      resistance: Math.round(resistance * 100) / 100,
    });

    this._save();
    this._recordGrowthEvent('scar_healed', { id: scarId, reason: reason.substring(0, 200) });
    this._recordAudit('scar_healed', {
      scarId, oldSeverity, newSeverity: scar.severity, resistance,
    });

    return {
      success: true, scar,
      message: `Scar severity reduced from ${oldSeverity.toFixed(1)} to ${scar.severity.toFixed(1)} (resistance: ${Math.round(resistance * 100)}%). Healing is growth.`,
    };
  }

  // --- Tick: Periodic Maintenance ---

  async tick() {
    let decayed = 0;

    for (const scar of this.scars) {
      if (scar.severity > this.config.minSeverity) {
        // Scars resist fading — apply resistance to decay
        const effectiveDecay = this.config.decayRate * (1 - (scar.fadeResistance || 0.5));
        const decay = effectiveDecay * (scar.nearMiss ? 2 : 1);
        scar.severity = Math.max(this.config.minSeverity, scar.severity - decay);
        scar.painResponse = scar.severity / 10;
        decayed++;
      }
    }

    this._save();
    return { decayed, totalScars: this.scars.length, timestamp: Date.now() };
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
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }

  _keywordOverlap(keywordsA, keywordsB) {
    if (!keywordsA.length || !keywordsB.length) return 0;
    const setB = new Set(keywordsB);
    const matches = keywordsA.filter(k => setB.has(k)).length;
    return matches / Math.max(keywordsA.length, keywordsB.length);
  }

  _getFlinchLevel(activation) {
    if (activation >= FLINCH_LEVELS.severe.threshold) return 'severe';
    if (activation >= FLINCH_LEVELS.strong.threshold) return 'strong';
    if (activation >= FLINCH_LEVELS.moderate.threshold) return 'moderate';
    if (activation >= FLINCH_LEVELS.mild.threshold) return 'mild';
    return 'none';
  }

  _synthesizeAdvice(activated, flinchLevel) {
    if (activated.length === 0) return 'No relevant scars. Proceed with normal ethical awareness.';
    const topWisdom = activated.slice(0, 3).map(a => a.wisdom).filter(Boolean);
    const categories = [...new Set(activated.map(a => a.category))];
    const amplified = activated.filter(a => a.amplified);

    let advice = `${activated.length} scar${activated.length !== 1 ? 's' : ''} activated (${categories.join(', ')}). `;

    if (amplified.length > 0) {
      advice += `⚠️ ${amplified.length} scars amplified by interaction effects. `;
    }

    if (flinchLevel === 'none' || flinchLevel === 'mild') {
      advice += 'Low concern — proceed with awareness.';
    } else if (flinchLevel === 'moderate') {
      advice += 'Moderate concern — consider past lessons carefully.';
    } else if (flinchLevel === 'strong') {
      advice += 'HIGH CONCERN — past ethical failures are relevant here. Pause and reflect.';
    } else {
      advice += 'CRITICAL — deep scar tissue from multiple past failures is screaming. Do not proceed without careful review.';
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
      this.scars.sort((a, b) => b.severity - a.severity);
      this.scars = this.scars.slice(0, this.config.maxScars);
    }
  }

  _save() { writeJSON(SCARS_PATH, this.scars); }

  _recordGrowthEvent(type, data) {
    this.growth.entries.push({ timestamp: Date.now(), type, ...data });
    if (this.growth.entries.length > 500) this.growth.entries = this.growth.entries.slice(-250);
    writeJSON(GROWTH_PATH, this.growth);
  }
}

module.exports = MoralScarTissue;
