/**
 * ARES Growth Engine — Parameter Growth Management
 * Tracks effective params, manages LoRA stacking & merging.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const GROWTH_FILE = path.join(DATA_DIR, 'ares-growth.json');

class AresGrowth {
  constructor(config) {
    this.config = Object.assign({
      baseParams: 70e9,
      baseModel: 'dolphin-2.9-llama3.1-70b',
      mergeThreshold: 10, // merge when adapter stack reaches this depth
    }, config || {});

    this.state = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(GROWTH_FILE)) return JSON.parse(fs.readFileSync(GROWTH_FILE, 'utf8'));
    } catch (e) {}
    return {
      baseParams: this.config.baseParams,
      currentBaseModel: this.config.baseModel,
      adapters: [],
      mergeHistory: [],
      growthTimeline: [],
      created: new Date().toISOString(),
    };
  }

  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(GROWTH_FILE, JSON.stringify(this.state, null, 2));
    } catch (e) { console.error('[ARES-GROWTH] Save error:', e.message); }
  }

  _adapterParams(rank) {
    // LoRA params ≈ 2 * rank * hidden_dim * num_layers
    // For a 70B model (hidden_dim ~8192, ~80 layers):
    // rank 64: ~2 * 64 * 8192 * 80 ≈ 84M params
    // rank 128: ~168M, rank 256: ~336M
    var hiddenDim = 8192;
    var numLayers = 80;
    return 2 * rank * hiddenDim * numLayers;
  }

  getCurrentParams() {
    var total = this.state.baseParams;
    for (var i = 0; i < this.state.adapters.length; i++) {
      total += this.state.adapters[i].params || this._adapterParams(this.state.adapters[i].rank || 64);
    }
    return total;
  }

  stackAdapter(adapter) {
    var rank = adapter.rank || 64;
    var params = this._adapterParams(rank);
    this.state.adapters.push({
      cycle: adapter.cycle,
      rank: rank,
      params: params,
      path: adapter.path || null,
      stacked: new Date().toISOString(),
    });

    var totalParams = this.getCurrentParams();
    this.state.growthTimeline.push({
      cycle: adapter.cycle,
      effectiveParams: totalParams,
      adapterCount: this.state.adapters.length,
      timestamp: new Date().toISOString(),
    });

    this._save();

    // Auto-merge check
    if (this.state.adapters.length >= this.config.mergeThreshold) {
      return this.mergeAndGrow();
    }

    return { status: 'stacked', adapterCount: this.state.adapters.length, effectiveParams: totalParams };
  }

  mergeAndGrow(threshold) {
    threshold = threshold || this.config.mergeThreshold;
    if (this.state.adapters.length < 2) return { status: 'nothing_to_merge' };

    var preMergeParams = this.getCurrentParams();
    var mergedAdapters = this.state.adapters.slice();

    // Record merge
    this.state.mergeHistory.push({
      mergedAt: new Date().toISOString(),
      adaptersMerged: mergedAdapters.length,
      preParams: this.state.baseParams,
      postParams: preMergeParams,
      previousBase: this.state.currentBaseModel,
    });

    // After merge: base absorbs all adapter params
    this.state.baseParams = preMergeParams;
    this.state.currentBaseModel = this.state.currentBaseModel + '-merged-' + Date.now();
    this.state.adapters = [];

    this.state.growthTimeline.push({
      cycle: 'merge',
      effectiveParams: preMergeParams,
      adapterCount: 0,
      merged: true,
      timestamp: new Date().toISOString(),
    });

    this._save();

    return {
      status: 'merged',
      adaptersMerged: mergedAdapters.length,
      newBaseParams: preMergeParams,
      newBaseModel: this.state.currentBaseModel,
    };
  }

  projectGrowth(months) {
    months = months || 6;
    var projections = [];
    var currentParams = this.getCurrentParams();
    var cyclesPerMonth = 30; // ~1 cycle per day
    var currentCycle = this.state.growthTimeline.length;

    for (var m = 0; m < months; m++) {
      var futureCycle = currentCycle + (m + 1) * cyclesPerMonth;
      var rank = futureCycle <= 10 ? 64 : futureCycle <= 50 ? 128 : 256;
      var paramsPerCycle = this._adapterParams(rank);
      var newAdapters = cyclesPerMonth;
      // Account for merges every mergeThreshold cycles
      var merges = Math.floor(newAdapters / this.config.mergeThreshold);

      currentParams += newAdapters * paramsPerCycle;

      projections.push({
        month: m + 1,
        cycle: futureCycle,
        rank: rank,
        effectiveParams: currentParams,
        effectiveParamsHuman: this._humanParams(currentParams),
        mergesThisMonth: merges,
      });
    }

    return {
      current: this.getCurrentParams(),
      currentHuman: this._humanParams(this.getCurrentParams()),
      projections: projections,
    };
  }

  _humanParams(n) {
    if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    return n.toString();
  }

  getGrowthHistory() {
    return {
      baseParams: this.state.baseParams,
      baseModel: this.state.currentBaseModel,
      currentEffective: this.getCurrentParams(),
      currentEffectiveHuman: this._humanParams(this.getCurrentParams()),
      adapterCount: this.state.adapters.length,
      mergeCount: this.state.mergeHistory.length,
      timeline: this.state.growthTimeline,
      mergeHistory: this.state.mergeHistory,
    };
  }
}

module.exports = { AresGrowth };
