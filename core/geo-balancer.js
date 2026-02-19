/**
 * ARIES — Geographic Load Balancer
 * Routes AI tasks to the nearest available worker using haversine distance.
 * Uses worker geo data from data/worker-geo.json.
 */

const fs = require('fs');
const path = require('path');

const GEO_FILE = path.join(__dirname, '..', 'data', 'worker-geo.json');

function _loadGeo() {
  try { return JSON.parse(fs.readFileSync(GEO_FILE, 'utf8')); } catch (e) { return {}; }
}

/**
 * Haversine distance in km between two lat/lon points
 */
function haversine(lat1, lon1, lat2, lon2) {
  var R = 6371; // Earth radius in km
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Estimate latency from distance (rough: ~0.01ms/km for fiber + overhead)
 */
function estimateLatency(distanceKm) {
  return Math.round(distanceKm * 0.01 + 10); // base 10ms + distance factor
}

/**
 * Route a task to the best worker based on proximity and model availability
 * @param {object} task - { model?, requesterLat?, requesterLon? }
 * @param {array} workerList - [{ id, hostname, model, installedModels?, lat?, lon? }]
 * @returns {array} sorted workers with distance info
 */
function routeTask(task, workerList) {
  var geo = _loadGeo();
  var reqLat = task.requesterLat || null;
  var reqLon = task.requesterLon || null;

  // If no requester location, try to use master location from geo data
  if (reqLat === null || reqLon === null) {
    var masterGeo = geo['master'] || geo['aries'] || null;
    if (masterGeo) { reqLat = masterGeo.lat; reqLon = masterGeo.lon; }
  }

  var scored = workerList.map(function (w) {
    var wGeo = geo[w.id] || geo[w.hostname] || {};
    var wLat = w.lat || wGeo.lat || null;
    var wLon = w.lon || wGeo.lon || null;
    var distance = null;
    var latency = null;

    if (reqLat !== null && wLat !== null) {
      distance = Math.round(haversine(reqLat, reqLon, wLat, wLon));
      latency = estimateLatency(distance);
    }

    // Check if worker has the requested model
    var hasModel = true;
    if (task.model) {
      var installed = w.installedModels || [];
      if (w.model) installed.push(w.model);
      hasModel = installed.some(function (m) { return m.toLowerCase().includes(task.model.toLowerCase()); });
    }

    return {
      id: w.id,
      hostname: w.hostname,
      model: w.model,
      installedModels: w.installedModels || [],
      distanceKm: distance,
      estimatedLatencyMs: latency,
      hasModel: hasModel,
      lat: wLat,
      lon: wLon,
      // Sort score: prefer model match, then distance
      _score: (hasModel ? 0 : 100000) + (distance !== null ? distance : 50000)
    };
  });

  scored.sort(function (a, b) { return a._score - b._score; });

  // Clean up internal score
  return scored.map(function (s) {
    var r = Object.assign({}, s);
    delete r._score;
    return r;
  });
}

/**
 * Get routing table for all known workers
 */
function getRoutingTable(workerList) {
  var geo = _loadGeo();
  var masterGeo = geo['master'] || geo['aries'] || {};
  var reqLat = masterGeo.lat || null;
  var reqLon = masterGeo.lon || null;

  return workerList.map(function (w) {
    var wGeo = geo[w.id] || geo[w.hostname] || {};
    var wLat = wGeo.lat || null;
    var wLon = wGeo.lon || null;
    var distance = null;
    var latency = null;

    if (reqLat !== null && wLat !== null) {
      distance = Math.round(haversine(reqLat, reqLon, wLat, wLon));
      latency = estimateLatency(distance);
    }

    return {
      id: w.id,
      hostname: w.hostname || w.id,
      lat: wLat,
      lon: wLon,
      distanceKm: distance,
      estimatedLatencyMs: latency,
      model: w.model || '',
      status: w.status || 'unknown'
    };
  }).sort(function (a, b) { return (a.distanceKm || 99999) - (b.distanceKm || 99999); });
}

module.exports = { routeTask, getRoutingTable, haversine, estimateLatency };
