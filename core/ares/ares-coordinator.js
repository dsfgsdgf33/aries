/**
 * ARES Coordinator — The Brain
 * Central coordinator for the Aries Recursive Evolution System.
 * Manages: data_gen → distribute → train → merge → evaluate → repeat
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'ares-state.json');

class AresCoordinator extends EventEmitter {
  constructor(config) {
    super();
    this.config = Object.assign({
      baseModel: 'dolphin-2.9-llama3.1-70b',
      baseParams: 70e9,
      loraRank: 64,
      learningRate: 2e-4,
      batchSize: 4,
      gradientAccumulation: 16,
      epochsPerCycle: 3,
      schedule: null, // cron expression or null for manual
      dataCategories: ['reasoning', 'code', 'creative', 'tool_use', 'long_context', 'problem_solving', 'instruction', 'roleplay'],
      distillBatchSize: 50,
    }, config || {});

    this.state = this._loadState();
    this._scheduleTimer = null;
    this._running = false;
    this._paused = false;

    // Sub-modules (injected after construction)
    this.distiller = null;
    this.trainer = null;
    this.swarmTrainer = null;
    this.growth = null;
    this.credits = null;
  }

  _loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      }
    } catch (e) {
      console.error('[ARES] Failed to load state:', e.message);
    }
    return {
      current_cycle: 0,
      total_cycles: 0,
      current_adapter_count: 0,
      effective_params: this.config ? this.config.baseParams || 70e9 : 70e9,
      training_status: 'idle',
      last_cycle_start: null,
      last_cycle_end: null,
      last_cycle_results: null,
      history: [],
      schedule: null,
      created: new Date().toISOString(),
    };
  }

  _saveState() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.error('[ARES] Failed to save state:', e.message);
    }
  }

  _updateStatus(status, detail) {
    this.state.training_status = status;
    if (detail) this.state.status_detail = detail;
    this._saveState();
    this.emit('status', { status, detail });
  }

  async startTrainingCycle() {
    if (this._running) return { error: 'Cycle already running' };
    if (this._paused) return { error: 'System is paused' };

    this._running = true;
    var cycle = ++this.state.current_cycle;
    this.state.last_cycle_start = new Date().toISOString();
    this._updateStatus('generating_data', 'Cycle ' + cycle + ': generating training data from Opus');

    var cycleResult = { cycle: cycle, started: this.state.last_cycle_start, phases: {} };

    try {
      // Phase 1: Generate training data via Opus distillation
      this.emit('cycle-phase', { cycle: cycle, phase: 'data_gen' });
      var dataResult = { examples: 0, categories: {} };
      if (this.distiller) {
        for (var i = 0; i < this.config.dataCategories.length; i++) {
          if (this._paused) break;
          var cat = this.config.dataCategories[i];
          this._updateStatus('generating_data', 'Cycle ' + cycle + ': generating ' + cat + ' data');
          try {
            var batch = await this.distiller.generateBatch(cat, this.config.distillBatchSize);
            dataResult.examples += batch.length;
            dataResult.categories[cat] = batch.length;
          } catch (e) {
            console.error('[ARES] Data gen error for ' + cat + ':', e.message);
            dataResult.categories[cat] = 0;
          }
        }
      }
      cycleResult.phases.data_gen = dataResult;

      if (this._paused) { this._running = false; this._updateStatus('paused'); return { paused: true }; }

      // Phase 2: Prepare dataset
      this._updateStatus('preparing', 'Cycle ' + cycle + ': preparing dataset for training');
      this.emit('cycle-phase', { cycle: cycle, phase: 'prepare' });
      var prepResult = {};
      if (this.trainer) {
        prepResult = await this.trainer.prepareDataset(cycle);
      }
      cycleResult.phases.prepare = prepResult;

      // Phase 3: Training (local or swarm-distributed)
      this._updateStatus('training', 'Cycle ' + cycle + ': training in progress');
      this.emit('cycle-phase', { cycle: cycle, phase: 'training' });
      var trainResult = {};
      if (this.swarmTrainer && this.swarmTrainer.hasGpuWorkers()) {
        trainResult = await this.swarmTrainer.distributeTrainingTask(cycle);
      } else if (this.trainer) {
        trainResult = await this.trainer.startTraining(cycle);
      } else {
        trainResult = { status: 'skipped', reason: 'no trainer available' };
      }
      cycleResult.phases.training = trainResult;

      // Phase 4: Merge adapter
      this._updateStatus('merging', 'Cycle ' + cycle + ': merging adapter');
      this.emit('cycle-phase', { cycle: cycle, phase: 'merge' });
      if (this.growth) {
        var adapterPath = path.join(DATA_DIR, 'ares-adapters', 'cycle-' + cycle);
        await this.growth.stackAdapter({ path: adapterPath, cycle: cycle, rank: this._currentRank() });
        this.state.current_adapter_count++;
        this.state.effective_params = this.growth.getCurrentParams();
      }

      // Phase 5: Evaluate
      this._updateStatus('evaluating', 'Cycle ' + cycle + ': evaluating model');
      this.emit('cycle-phase', { cycle: cycle, phase: 'evaluate' });
      var evalResult = {};
      if (this.trainer) {
        evalResult = await this.trainer.evaluateModel(cycle);
      }
      cycleResult.phases.evaluation = evalResult;

      // Finalize
      this.state.total_cycles = cycle;
      this.state.last_cycle_end = new Date().toISOString();
      this.state.last_cycle_results = cycleResult;
      this.state.history.push({
        cycle: cycle,
        started: cycleResult.started,
        ended: this.state.last_cycle_end,
        examples_generated: dataResult.examples,
        effective_params: this.state.effective_params,
        eval: evalResult,
      });
      this._updateStatus('idle', 'Cycle ' + cycle + ' complete');
      this.emit('cycle-complete', cycleResult);

    } catch (e) {
      console.error('[ARES] Cycle ' + cycle + ' error:', e.message);
      this._updateStatus('error', e.message);
      cycleResult.error = e.message;
    }

    this._running = false;
    this._saveState();
    return cycleResult;
  }

  _currentRank() {
    var c = this.state.current_cycle;
    if (c <= 10) return 64;
    if (c <= 50) return 128;
    return 256;
  }

  getStatus() {
    return {
      status: this.state.training_status,
      detail: this.state.status_detail || null,
      current_cycle: this.state.current_cycle,
      total_cycles: this.state.total_cycles,
      adapter_count: this.state.current_adapter_count,
      effective_params: this.state.effective_params,
      effective_params_human: this._humanParams(this.state.effective_params),
      last_cycle_start: this.state.last_cycle_start,
      last_cycle_end: this.state.last_cycle_end,
      last_cycle_results: this.state.last_cycle_results,
      schedule: this.state.schedule,
      running: this._running,
      paused: this._paused,
    };
  }

  _humanParams(n) {
    if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    return n.toString();
  }

  getModelInfo() {
    return {
      base_model: this.config.baseModel,
      base_params: this.config.baseParams,
      effective_params: this.state.effective_params,
      effective_params_human: this._humanParams(this.state.effective_params),
      adapter_count: this.state.current_adapter_count,
      lora_rank: this._currentRank(),
      cycle: this.state.current_cycle,
      version: 'ares-v' + this.state.current_cycle,
      history: (this.state.history || []).slice(-20),
    };
  }

  pause() {
    this._paused = true;
    this._updateStatus('paused');
    return { ok: true, status: 'paused' };
  }

  resume() {
    this._paused = false;
    this._updateStatus('idle', 'Resumed');
    return { ok: true, status: 'idle' };
  }

  stop() {
    this._running = false;
    this._paused = false;
    this._updateStatus('idle', 'Stopped');
    return { ok: true, status: 'stopped' };
  }

  setSchedule(schedule) {
    this.state.schedule = schedule;
    this._saveState();
    this._setupScheduleTimer();
    return { ok: true, schedule: schedule };
  }

  _setupScheduleTimer() {
    if (this._scheduleTimer) { clearInterval(this._scheduleTimer); this._scheduleTimer = null; }
    if (!this.state.schedule) return;
    // Simple schedule: 'daily', 'weekly', or interval in hours
    var intervalMs;
    if (this.state.schedule === 'daily') intervalMs = 24 * 60 * 60 * 1000;
    else if (this.state.schedule === 'weekly') intervalMs = 7 * 24 * 60 * 60 * 1000;
    else {
      var hours = parseFloat(this.state.schedule);
      if (isNaN(hours) || hours < 1) return;
      intervalMs = hours * 60 * 60 * 1000;
    }
    var self = this;
    this._scheduleTimer = setInterval(function() {
      if (!self._running && !self._paused) {
        console.log('[ARES] Scheduled cycle starting...');
        self.startTrainingCycle().catch(function(e) {
          console.error('[ARES] Scheduled cycle error:', e.message);
        });
      }
    }, intervalMs);
  }

  async exportModel() {
    var exportDir = path.join(DATA_DIR, 'ares-exports', 'v' + this.state.current_cycle);
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
    var manifest = {
      version: 'ares-v' + this.state.current_cycle,
      base_model: this.config.baseModel,
      effective_params: this.state.effective_params,
      adapter_count: this.state.current_adapter_count,
      cycle: this.state.current_cycle,
      exported: new Date().toISOString(),
      adapters: [],
    };
    // List adapter directories
    var adapterBase = path.join(DATA_DIR, 'ares-adapters');
    if (fs.existsSync(adapterBase)) {
      try {
        var dirs = fs.readdirSync(adapterBase);
        manifest.adapters = dirs.filter(function(d) { return d.startsWith('cycle-'); });
      } catch (e) {}
    }
    fs.writeFileSync(path.join(exportDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  init() {
    this._setupScheduleTimer();
    console.log('[ARES] Coordinator initialized — cycle ' + this.state.current_cycle + ', ' + this._humanParams(this.state.effective_params) + ' effective params');
  }
}

module.exports = { AresCoordinator };
