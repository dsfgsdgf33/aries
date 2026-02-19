/**
 * ARIES v4.4 — Device Pairing & Remote Control
 * Allows phones/devices to connect via pairing codes and poll for commands.
 * Uses only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEVICES_FILE = path.join(DATA_DIR, 'paired-devices.json');
const HISTORY_FILE = path.join(DATA_DIR, 'node-history.json');

class NodePairing extends EventEmitter {
  /**
   * @param {object} config - nodePairing config section
   */
  constructor(config = {}) {
    super();
    this.maxDevices = config.maxDevices || 10;
    this.pairCodeTTLMs = config.pairCodeTTLMs || 300000; // 5 minutes
    this._devices = {};
    this._pendingCodes = {};
    this._pendingCommands = {}; // deviceId -> [commands]
    this._pendingResults = {};  // commandId -> result
    this._history = [];
    this._loadDevices();
    this._loadHistory();
  }

  _ensureDir() {
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  }

  _loadDevices() {
    try {
      if (fs.existsSync(DEVICES_FILE)) {
        this._devices = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8'));
      }
    } catch { this._devices = {}; }
  }

  _saveDevices() {
    try {
      this._ensureDir();
      fs.writeFileSync(DEVICES_FILE, JSON.stringify(this._devices, null, 2));
    } catch {}
  }

  _loadHistory() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        this._history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      }
    } catch { this._history = []; }
  }

  _saveHistory() {
    try {
      this._ensureDir();
      if (this._history.length > 500) this._history = this._history.slice(-500);
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this._history, null, 2));
    } catch {}
  }

  _addHistory(deviceId, action, details) {
    this._history.push({
      deviceId,
      action,
      details,
      timestamp: new Date().toISOString()
    });
    this._saveHistory();
  }

  /**
   * Generate a 6-digit pairing code valid for 5 minutes
   * @returns {{code: string, expiresAt: string}}
   */
  generatePairCode() {
    // Clean expired codes
    const now = Date.now();
    for (const [code, info] of Object.entries(this._pendingCodes)) {
      if (now > info.expiresAt) delete this._pendingCodes[code];
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = now + this.pairCodeTTLMs;
    this._pendingCodes[code] = { expiresAt, createdAt: new Date().toISOString() };

    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * Validate a pairing code and register device
   * @param {string} code - 6-digit code
   * @param {object} deviceInfo - Device info { name, type, platform, ... }
   * @returns {{success: boolean, deviceId?: string, error?: string}}
   */
  validatePair(code, deviceInfo = {}) {
    const pending = this._pendingCodes[code];
    if (!pending) return { success: false, error: 'Invalid pairing code' };
    if (Date.now() > pending.expiresAt) {
      delete this._pendingCodes[code];
      return { success: false, error: 'Pairing code expired' };
    }

    const deviceCount = Object.keys(this._devices).length;
    if (deviceCount >= this.maxDevices) {
      return { success: false, error: 'Maximum devices reached' };
    }

    const deviceId = crypto.randomBytes(8).toString('hex');
    const deviceToken = crypto.randomBytes(24).toString('hex');

    this._devices[deviceId] = {
      id: deviceId,
      token: deviceToken,
      name: deviceInfo.name || 'Unknown Device',
      type: deviceInfo.type || 'unknown',
      platform: deviceInfo.platform || 'unknown',
      pairedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      status: { online: true, battery: null, connectivity: null }
    };

    delete this._pendingCodes[code];
    this._saveDevices();
    this._pendingCommands[deviceId] = [];
    this._addHistory(deviceId, 'paired', { name: deviceInfo.name });
    this.emit('paired', { deviceId, deviceInfo });

    return { success: true, deviceId, token: deviceToken };
  }

  /**
   * List all paired devices
   * @returns {Array}
   */
  listDevices() {
    return Object.values(this._devices).map(d => ({
      id: d.id,
      name: d.name,
      type: d.type,
      platform: d.platform,
      pairedAt: d.pairedAt,
      lastSeen: d.lastSeen,
      status: d.status
    }));
  }

  /**
   * Remove a paired device
   * @param {string} deviceId
   * @returns {{removed: boolean}}
   */
  removeDevice(deviceId) {
    if (this._devices[deviceId]) {
      const name = this._devices[deviceId].name;
      delete this._devices[deviceId];
      delete this._pendingCommands[deviceId];
      this._saveDevices();
      this._addHistory(deviceId, 'removed', { name });
      this.emit('removed', { deviceId });
      return { removed: true };
    }
    return { removed: false, error: 'Device not found' };
  }

  /**
   * Get device status
   * @param {string} deviceId
   * @returns {object|null}
   */
  getDeviceStatus(deviceId) {
    const device = this._devices[deviceId];
    if (!device) return null;
    return {
      ...device.status,
      lastSeen: device.lastSeen,
      name: device.name,
      online: device.lastSeen ? (Date.now() - new Date(device.lastSeen).getTime() < 60000) : false
    };
  }

  /**
   * Send a command to a device (queued for polling)
   * @param {string} deviceId
   * @param {string} type - Command type: 'camera', 'screen', 'notification', 'custom'
   * @param {object} payload - Command payload
   * @returns {{commandId: string, queued: boolean}}
   */
  sendCommand(deviceId, type, payload = {}) {
    if (!this._devices[deviceId]) {
      return { queued: false, error: 'Device not found' };
    }

    const commandId = crypto.randomBytes(6).toString('hex');
    const command = {
      id: commandId,
      type,
      payload,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    if (!this._pendingCommands[deviceId]) this._pendingCommands[deviceId] = [];
    this._pendingCommands[deviceId].push(command);
    this._addHistory(deviceId, 'command-sent', { type, commandId });

    return { commandId, queued: true };
  }

  /**
   * Request camera snapshot from device
   * @param {string} deviceId
   * @returns {{commandId: string, queued: boolean}}
   */
  requestCamera(deviceId) {
    return this.sendCommand(deviceId, 'camera', { action: 'snapshot' });
  }

  /**
   * Request screenshot from device
   * @param {string} deviceId
   * @returns {{commandId: string, queued: boolean}}
   */
  requestScreen(deviceId) {
    return this.sendCommand(deviceId, 'screen', { action: 'screenshot' });
  }

  /**
   * Send notification to device
   * @param {string} deviceId
   * @param {string} title
   * @param {string} body
   * @returns {{commandId: string, queued: boolean}}
   */
  sendNotification(deviceId, title, body) {
    return this.sendCommand(deviceId, 'notification', { title, body });
  }

  /**
   * Poll for pending commands (called by device)
   * @param {string} deviceId
   * @param {string} token - Device token
   * @returns {{commands: Array}}
   */
  pollCommands(deviceId, token) {
    const device = this._devices[deviceId];
    if (!device || device.token !== token) {
      return { commands: [], error: 'Invalid device or token' };
    }

    // Update last seen
    device.lastSeen = new Date().toISOString();
    this._saveDevices();

    const commands = this._pendingCommands[deviceId] || [];
    this._pendingCommands[deviceId] = [];
    return { commands };
  }

  /**
   * Submit command result (called by device)
   * @param {string} deviceId
   * @param {string} token
   * @param {string} commandId
   * @param {object} result
   * @returns {{received: boolean}}
   */
  submitResult(deviceId, token, commandId, result) {
    const device = this._devices[deviceId];
    if (!device || device.token !== token) {
      return { received: false, error: 'Invalid device or token' };
    }

    device.lastSeen = new Date().toISOString();
    if (result.status) device.status = { ...device.status, ...result.status };
    this._saveDevices();

    this._pendingResults[commandId] = { ...result, receivedAt: new Date().toISOString() };
    this._addHistory(deviceId, 'result-received', { commandId });
    this.emit('result', { deviceId, commandId, result });

    return { received: true };
  }

  /**
   * Get command result
   * @param {string} commandId
   * @returns {object|null}
   */
  getResult(commandId) {
    return this._pendingResults[commandId] || null;
  }

  /**
   * Get device history
   * @param {string} deviceId
   * @returns {Array}
   */
  getDeviceHistory(deviceId) {
    if (deviceId) {
      return this._history.filter(h => h.deviceId === deviceId);
    }
    return this._history;
  }

  /**
   * Cleanup
   */
  stop() {
    this.removeAllListeners();
  }

  // ═══════════════════════════════════════════════════════════
  // v5.0 — Advanced Node Pairing Upgrades
  // ═══════════════════════════════════════════════════════════

  /**
   * Get pairing URL for QR code generation
   * @param {string} baseUrl - e.g. 'http://192.168.1.100:3333'
   * @returns {{code: string, url: string, expiresAt: string}}
   */
  generatePairUrl(baseUrl) {
    try {
      var pair = this.generatePairCode();
      var url = (baseUrl || 'http://localhost:3333') + '/api/nodes/validate?code=' + pair.code;
      return { code: pair.code, url: url, expiresAt: pair.expiresAt };
    } catch (e) { return { error: e.message }; }
  }

  /**
   * Update device capabilities
   * @param {string} deviceId
   * @param {string} token
   * @param {Array<string>} capabilities - e.g. ['camera', 'screen', 'gps', 'notifications', 'microphone']
   * @returns {{updated: boolean}}
   */
  updateCapabilities(deviceId, token, capabilities) {
    try {
      var device = this._devices[deviceId];
      if (!device || device.token !== token) return { updated: false, error: 'Invalid device or token' };
      device.capabilities = capabilities || [];
      device.lastSeen = new Date().toISOString();
      this._saveDevices();
      return { updated: true };
    } catch (e) { return { updated: false, error: e.message }; }
  }

  /**
   * Report device GPS location
   * @param {string} deviceId
   * @param {string} token
   * @param {number} lat
   * @param {number} lng
   * @param {number} accuracy
   * @returns {{recorded: boolean}}
   */
  reportLocation(deviceId, token, lat, lng, accuracy) {
    try {
      var device = this._devices[deviceId];
      if (!device || device.token !== token) return { recorded: false, error: 'Invalid device or token' };
      if (!device.locationHistory) device.locationHistory = [];
      device.locationHistory.push({ lat: lat, lng: lng, accuracy: accuracy, timestamp: new Date().toISOString() });
      if (device.locationHistory.length > 100) device.locationHistory.shift();
      device.lastLocation = { lat: lat, lng: lng, accuracy: accuracy, timestamp: new Date().toISOString() };
      device.lastSeen = new Date().toISOString();
      this._saveDevices();
      this.emit('location', { deviceId: deviceId, lat: lat, lng: lng });
      return { recorded: true };
    } catch (e) { return { recorded: false, error: e.message }; }
  }

  /**
   * Get all device locations
   * @returns {Array<{deviceId: string, name: string, lat: number, lng: number, timestamp: string}>}
   */
  getAllLocations() {
    try {
      var locations = [];
      var ids = Object.keys(this._devices);
      for (var i = 0; i < ids.length; i++) {
        var dev = this._devices[ids[i]];
        if (dev.lastLocation) {
          locations.push({
            deviceId: dev.id, name: dev.name,
            lat: dev.lastLocation.lat, lng: dev.lastLocation.lng,
            accuracy: dev.lastLocation.accuracy,
            timestamp: dev.lastLocation.timestamp
          });
        }
      }
      return locations;
    } catch (e) { return []; }
  }

  // ── Device Groups ──

  /**
   * Create a device group
   * @param {string} name
   * @param {Array<string>} deviceIds
   * @returns {{groupId: string, created: boolean}}
   */
  createGroup(name, deviceIds) {
    try {
      if (!this._groups) this._groups = {};
      var groupId = crypto.randomBytes(6).toString('hex');
      this._groups[groupId] = { id: groupId, name: name, deviceIds: deviceIds || [], createdAt: new Date().toISOString() };
      return { groupId: groupId, created: true };
    } catch (e) { return { created: false, error: e.message }; }
  }

  /**
   * Send command to all devices in a group
   * @param {string} groupId
   * @param {string} type
   * @param {object} payload
   * @returns {Array<{deviceId: string, commandId: string}>}
   */
  sendGroupCommand(groupId, type, payload) {
    try {
      if (!this._groups || !this._groups[groupId]) return [];
      var results = [];
      var deviceIds = this._groups[groupId].deviceIds;
      for (var i = 0; i < deviceIds.length; i++) {
        var result = this.sendCommand(deviceIds[i], type, payload);
        results.push({ deviceId: deviceIds[i], commandId: result.commandId, queued: result.queued });
      }
      return results;
    } catch (e) { return []; }
  }

  /**
   * List device groups
   * @returns {Array}
   */
  listGroups() {
    try {
      return Object.values(this._groups || {});
    } catch (e) { return []; }
  }

  // ── Heartbeat Monitoring ──

  /**
   * Check device heartbeats and mark stale devices offline
   * @param {number} timeoutMs - Default 90000 (3 missed 30s heartbeats)
   * @returns {{checked: number, offline: number}}
   */
  checkHeartbeats(timeoutMs) {
    try {
      timeoutMs = timeoutMs || 90000;
      var now = Date.now();
      var checked = 0;
      var offline = 0;
      var ids = Object.keys(this._devices);
      for (var i = 0; i < ids.length; i++) {
        checked++;
        var dev = this._devices[ids[i]];
        if (dev.lastSeen) {
          var elapsed = now - new Date(dev.lastSeen).getTime();
          if (elapsed > timeoutMs) {
            dev.status = dev.status || {};
            dev.status.online = false;
            offline++;
          } else {
            dev.status = dev.status || {};
            dev.status.online = true;
          }
        }
      }
      this._saveDevices();
      return { checked: checked, offline: offline };
    } catch (e) { return { checked: 0, offline: 0 }; }
  }
}

module.exports = { NodePairing };
