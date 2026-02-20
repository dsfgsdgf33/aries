/**
 * ARES Swarm Trainer — Distributed Compute via Aries Swarm
 * Farms gradient computation tasks to swarm GPU nodes.
 * Gradients are sent back and aggregated on the central ARES server.
 * The model itself never leaves the server.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SWARM_STATE_FILE = path.join(DATA_DIR, 'ares-swarm-training.json');

class AresSwarmTrainer {
  constructor(config) {
    this.config = Object.assign({
      coordinatorUrl: 'http://127.0.0.1:3333',
      gradientTimeout: 120000, // 2 minutes per gradient task
      minWorkers: 1,
      maxMicroBatchSize: 16,
    }, config || {});

    this._workers = {}; // workerId → { url, gpu, status, lastSeen }
    this._tasks = {};   // taskId → { status, workerIds, gradients, created }
    this._stats = this._loadState();
  }

  _loadState() {
    try {
      if (fs.existsSync(SWARM_STATE_FILE)) return JSON.parse(fs.readFileSync(SWARM_STATE_FILE, 'utf8'));
    } catch (e) {}
    return {
      totalTasks: 0,
      totalGradients: 0,
      totalTokensProcessed: 0,
      activeWorkers: 0,
      throughputTokensPerSec: 0,
      history: [],
    };
  }

  _saveState() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SWARM_STATE_FILE, JSON.stringify(this._stats, null, 2));
    } catch (e) {}
  }

  registerWorker(workerId, info) {
    this._workers[workerId] = {
      url: info.url,
      gpu: info.gpu || null,
      gpuVram: info.gpuVram || 0,
      status: 'idle',
      lastSeen: Date.now(),
      tasksCompleted: (this._workers[workerId] && this._workers[workerId].tasksCompleted) || 0,
    };
    this._stats.activeWorkers = Object.keys(this._workers).length;
    this._saveState();
  }

  removeWorker(workerId) {
    delete this._workers[workerId];
    this._stats.activeWorkers = Object.keys(this._workers).length;
    this._saveState();
  }

  hasGpuWorkers() {
    var ids = Object.keys(this._workers);
    for (var i = 0; i < ids.length; i++) {
      if (this._workers[ids[i]].gpu) return true;
    }
    return false;
  }

  getGpuWorkers() {
    var result = [];
    var ids = Object.keys(this._workers);
    for (var i = 0; i < ids.length; i++) {
      if (this._workers[ids[i]].gpu) result.push(ids[i]);
    }
    return result;
  }

  async distributeTrainingTask(cycleOrBatch) {
    var gpuWorkers = this.getGpuWorkers();
    if (gpuWorkers.length === 0) {
      return { status: 'error', reason: 'No GPU workers available' };
    }

    // Load training data for the cycle
    var batch = [];
    if (typeof cycleOrBatch === 'number') {
      var dataPath = path.join(DATA_DIR, 'ares-datasets', 'cycle-' + cycleOrBatch, 'train.jsonl');
      if (fs.existsSync(dataPath)) {
        var lines = fs.readFileSync(dataPath, 'utf8').trim().split('\n');
        batch = lines.map(function(l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
      }
    } else if (Array.isArray(cycleOrBatch)) {
      batch = cycleOrBatch;
    }

    if (batch.length === 0) {
      return { status: 'error', reason: 'No training data to distribute' };
    }

    // Split into micro-batches
    var microBatchSize = Math.max(1, Math.ceil(batch.length / gpuWorkers.length));
    if (microBatchSize > this.config.maxMicroBatchSize) microBatchSize = this.config.maxMicroBatchSize;

    var taskId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    var task = {
      taskId: taskId,
      status: 'distributed',
      workerIds: [],
      microBatches: [],
      gradients: [],
      created: Date.now(),
      deadline: Date.now() + this.config.gradientTimeout,
    };

    // Distribute micro-batches to workers
    var batchIdx = 0;
    for (var i = 0; i < gpuWorkers.length && batchIdx < batch.length; i++) {
      var wId = gpuWorkers[i];
      var microBatch = batch.slice(batchIdx, batchIdx + microBatchSize);
      batchIdx += microBatchSize;

      var swarmTask = {
        taskId: taskId,
        type: 'gradient-compute',
        workerId: wId,
        microBatch: microBatch,
        modelCheckpoint: null, // URL to current adapter weights (set when available)
        hyperparams: {
          lr: this.config.learningRate || 2e-4,
          rank: this.config.loraRank || 64,
          batchSize: microBatch.length,
        },
        deadline: task.deadline,
      };

      task.workerIds.push(wId);
      task.microBatches.push(swarmTask);
      this._workers[wId].status = 'training';

      // Send task to worker (fire and forget, worker will POST gradient back)
      this._sendTaskToWorker(wId, swarmTask).catch(function(e) {
        console.error('[ARES-SWARM] Failed to send task to worker ' + wId + ':', e.message);
      });
    }

    this._tasks[taskId] = task;
    this._stats.totalTasks++;
    this._saveState();

    return {
      status: 'distributed',
      taskId: taskId,
      workers: task.workerIds.length,
      totalExamples: batch.length,
      microBatchSize: microBatchSize,
      deadline: new Date(task.deadline).toISOString(),
    };
  }

  _sendTaskToWorker(workerId, task) {
    var worker = this._workers[workerId];
    if (!worker || !worker.url) return Promise.reject(new Error('Worker not found'));

    return new Promise(function(resolve, reject) {
      var parsed;
      try { parsed = new URL(worker.url); } catch (e) { return reject(e); }

      var body = JSON.stringify(task);
      var mod = parsed.protocol === 'https:' ? https : http;
      var req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: '/api/swarm/training/task',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 10000,
      }, function(res) {
        var data = '';
        res.on('data', function(c) { data += c; });
        res.on('end', function() { resolve(data); });
      });
      req.on('error', reject);
      req.on('timeout', function() { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });
  }

  collectGradients(taskId) {
    var task = this._tasks[taskId];
    if (!task) return { status: 'error', reason: 'Task not found' };

    return {
      taskId: taskId,
      status: task.status,
      expected: task.workerIds.length,
      received: task.gradients.length,
      complete: task.gradients.length >= task.workerIds.length,
      expired: Date.now() > task.deadline,
    };
  }

  submitGradient(taskId, workerId, gradientData) {
    var task = this._tasks[taskId];
    if (!task) return { status: 'error', reason: 'Task not found' };

    task.gradients.push({
      workerId: workerId,
      data: gradientData,
      received: Date.now(),
    });

    if (this._workers[workerId]) {
      this._workers[workerId].status = 'idle';
      this._workers[workerId].tasksCompleted++;
    }

    this._stats.totalGradients++;

    // Check if all gradients received
    if (task.gradients.length >= task.workerIds.length) {
      task.status = 'complete';
      // Trigger averaging
      var averaged = this.averageGradients(task.gradients);
      task.averagedGradient = averaged;
    }

    this._saveState();
    return { status: 'ok', received: task.gradients.length, expected: task.workerIds.length };
  }

  averageGradients(gradients) {
    // In a real implementation, this would do federated averaging of tensor data.
    // For now, return a placeholder that signals the gradient data is ready.
    return {
      numGradients: gradients.length,
      averaged: true,
      timestamp: Date.now(),
      workers: gradients.map(function(g) { return g.workerId; }),
    };
  }

  applyUpdate(taskId) {
    var task = this._tasks[taskId];
    if (!task || !task.averagedGradient) return { status: 'error', reason: 'No averaged gradient available' };
    // Placeholder — in real impl, this applies the averaged gradient to the model
    task.status = 'applied';
    this._saveState();
    return { status: 'ok', applied: true };
  }

  getSwarmTrainingStats() {
    var gpuWorkers = this.getGpuWorkers();
    var activeTasks = 0;
    var taskIds = Object.keys(this._tasks);
    for (var i = 0; i < taskIds.length; i++) {
      if (this._tasks[taskIds[i]].status === 'distributed') activeTasks++;
    }

    return {
      totalWorkers: Object.keys(this._workers).length,
      gpuWorkers: gpuWorkers.length,
      activeTasks: activeTasks,
      totalTasks: this._stats.totalTasks,
      totalGradients: this._stats.totalGradients,
      throughput: this._stats.throughputTokensPerSec,
      workers: Object.keys(this._workers).map(function(id) {
        var w = this._workers[id];
        return { id: id, gpu: w.gpu, status: w.status, tasksCompleted: w.tasksCompleted, lastSeen: w.lastSeen };
      }.bind(this)),
    };
  }

  estimateTimeToCompletion(targetParams) {
    var currentParams = 70e9; // base
    var paramsPerCycle = 100e6; // ~100M per LoRA adapter
    var cyclesNeeded = Math.ceil((targetParams - currentParams) / paramsPerCycle);
    var gpuWorkers = this.getGpuWorkers().length || 1;
    var hoursPerCycle = 24 / gpuWorkers; // rough estimate
    var totalHours = cyclesNeeded * hoursPerCycle;

    return {
      currentParams: currentParams,
      targetParams: targetParams,
      cyclesNeeded: cyclesNeeded,
      gpuWorkers: gpuWorkers,
      estimatedHours: Math.round(totalHours),
      estimatedDays: Math.round(totalHours / 24),
    };
  }

  // Handle incoming worker requests (called from API routes)
  handleWorkerTaskRequest(workerId) {
    // Find a pending task for this worker
    var taskIds = Object.keys(this._tasks);
    for (var i = 0; i < taskIds.length; i++) {
      var task = this._tasks[taskIds[i]];
      if (task.status === 'distributed') {
        for (var j = 0; j < task.microBatches.length; j++) {
          if (task.microBatches[j].workerId === workerId) {
            return task.microBatches[j];
          }
        }
      }
    }
    return null;
  }
}

module.exports = { AresSwarmTrainer };
