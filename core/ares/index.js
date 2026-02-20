/**
 * ARES — Aries Recursive Evolution System
 * Main entry point. Initializes all ARES subsystems.
 */

const path = require('path');
const { AresCoordinator } = require('./ares-coordinator');
const { AresDistiller } = require('./ares-distiller');
const { AresTrainer } = require('./ares-trainer');
const { AresSwarmTrainer } = require('./ares-swarm-trainer');
const { AresGrowth } = require('./ares-growth');
const { AresCredits } = require('./ares-credits');

function initAres(config, addPluginRoute, wsBroadcast) {
  config = config || {};

  // Extract Anthropic API key from config
  var anthropicKey = null;
  if (config.ariesGateway && config.ariesGateway.providers && config.ariesGateway.providers.anthropic) {
    anthropicKey = config.ariesGateway.providers.anthropic.apiKey;
  }
  if (!anthropicKey && config.keys && config.keys.anthropic) {
    anthropicKey = config.keys.anthropic;
  }

  var aresConfig = config.ares || {};

  // Initialize subsystems
  var coordinator = new AresCoordinator(Object.assign({ baseModel: aresConfig.baseModel || 'dolphin-2.9-llama3.1-70b' }, aresConfig));
  var distiller = new AresDistiller({ anthropicApiKey: anthropicKey, model: aresConfig.distillModel || 'claude-opus-4-20250514' });
  var trainer = new AresTrainer(aresConfig.training || {});
  var swarmTrainer = new AresSwarmTrainer(aresConfig.swarm || {});
  var growth = new AresGrowth(aresConfig.growth || {});
  var credits = new AresCredits(aresConfig.credits || {});

  // Wire subsystems to coordinator
  coordinator.distiller = distiller;
  coordinator.trainer = trainer;
  coordinator.swarmTrainer = swarmTrainer;
  coordinator.growth = growth;
  coordinator.credits = credits;

  // Forward events via WebSocket
  if (wsBroadcast) {
    coordinator.on('status', function(s) { wsBroadcast({ type: 'ares', event: 'status', data: s }); });
    coordinator.on('cycle-phase', function(p) { wsBroadcast({ type: 'ares', event: 'cycle-phase', data: p }); });
    coordinator.on('cycle-complete', function(r) { wsBroadcast({ type: 'ares', event: 'cycle-complete', data: r }); });
  }

  coordinator.init();

  // Register API routes
  if (addPluginRoute) {
    registerRoutes(addPluginRoute, coordinator, distiller, trainer, swarmTrainer, growth, credits);
  }

  return { coordinator: coordinator, distiller: distiller, trainer: trainer, swarmTrainer: swarmTrainer, growth: growth, credits: credits };
}

function _parseBody(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function _parseQuery(req) {
  var u = require('url').parse(req.url, true);
  return u.query || {};
}

function registerRoutes(addRoute, coordinator, distiller, trainer, swarmTrainer, growth, credits) {

  // GET /api/ares/status
  addRoute('GET', '/api/ares/status', function(req, res, json) {
    json(200, coordinator.getStatus());
  });

  // GET /api/ares/model
  addRoute('GET', '/api/ares/model', function(req, res, json) {
    json(200, coordinator.getModelInfo());
  });

  // GET /api/ares/growth
  addRoute('GET', '/api/ares/growth', function(req, res, json) {
    var history = growth.getGrowthHistory();
    var projection = growth.projectGrowth(6);
    json(200, { history: history, projection: projection });
  });

  // GET /api/ares/training
  addRoute('GET', '/api/ares/training', function(req, res, json) {
    json(200, {
      status: coordinator.getStatus(),
      progress: trainer.getTrainingProgress(),
      swarm: swarmTrainer.getSwarmTrainingStats(),
    });
  });

  // POST /api/ares/training/start
  addRoute('POST', '/api/ares/training/start', function(req, res, json, rawBody) {
    coordinator.startTrainingCycle().then(function(result) {
      json(200, result);
    }).catch(function(e) {
      json(500, { error: e.message });
    });
  });

  // POST /api/ares/training/stop
  addRoute('POST', '/api/ares/training/stop', function(req, res, json) {
    json(200, coordinator.stop());
  });

  // POST /api/ares/training/pause
  addRoute('POST', '/api/ares/training/pause', function(req, res, json) {
    json(200, coordinator.pause());
  });

  // POST /api/ares/training/resume
  addRoute('POST', '/api/ares/training/resume', function(req, res, json) {
    json(200, coordinator.resume());
  });

  // GET /api/ares/data
  addRoute('GET', '/api/ares/data', function(req, res, json) {
    json(200, distiller.getDatasetStats());
  });

  // POST /api/ares/data/generate
  addRoute('POST', '/api/ares/data/generate', function(req, res, json, rawBody) {
    var body = _parseBody(rawBody);
    var category = body.category || 'reasoning';
    var count = body.count || 10;
    distiller.generateBatch(category, count).then(function(result) {
      json(200, { ok: true, generated: result.length, category: category });
    }).catch(function(e) {
      json(500, { error: e.message });
    });
  });

  // POST /api/ares/schedule
  addRoute('POST', '/api/ares/schedule', function(req, res, json, rawBody) {
    var body = _parseBody(rawBody);
    json(200, coordinator.setSchedule(body.schedule));
  });

  // GET /api/ares/credits
  addRoute('GET', '/api/ares/credits', function(req, res, json) {
    var query = _parseQuery(req);
    if (query.workerId) {
      json(200, credits.getCredits(query.workerId));
    } else {
      json(200, credits.getTierBreakdown());
    }
  });

  // GET /api/ares/leaderboard
  addRoute('GET', '/api/ares/leaderboard', function(req, res, json) {
    var query = _parseQuery(req);
    var limit = parseInt(query.limit) || 10;
    json(200, credits.getLeaderboard(limit));
  });

  // GET /api/ares/swarm/training
  addRoute('GET', '/api/ares/swarm/training', function(req, res, json) {
    json(200, swarmTrainer.getSwarmTrainingStats());
  });

  // POST /api/ares/swarm/training/task (for workers)
  addRoute('POST', '/api/ares/swarm/training/task', function(req, res, json, rawBody) {
    var body = _parseBody(rawBody);
    if (!body.workerId) return json(400, { error: 'workerId required' });
    var task = swarmTrainer.handleWorkerTaskRequest(body.workerId);
    if (task) json(200, task);
    else json(404, { message: 'No pending tasks' });
  });

  // POST /api/ares/swarm/training/gradient (for workers)
  addRoute('POST', '/api/ares/swarm/training/gradient', function(req, res, json, rawBody) {
    var body = _parseBody(rawBody);
    if (!body.taskId || !body.workerId) return json(400, { error: 'taskId and workerId required' });
    var result = swarmTrainer.submitGradient(body.taskId, body.workerId, body.gradient);
    json(200, result);
    // Award credits for GPU training
    credits.addCredits(body.workerId, 'gpu_training', 1);
  });

  // POST /api/ares/swarm/register (worker registration)
  addRoute('POST', '/api/ares/swarm/register', function(req, res, json, rawBody) {
    var body = _parseBody(rawBody);
    if (!body.workerId) return json(400, { error: 'workerId required' });
    swarmTrainer.registerWorker(body.workerId, body);
    json(200, { ok: true });
  });

  // GET /api/ares/export
  addRoute('GET', '/api/ares/export', function(req, res, json) {
    coordinator.exportModel().then(function(manifest) {
      json(200, manifest);
    }).catch(function(e) {
      json(500, { error: e.message });
    });
  });
}

module.exports = { initAres };
