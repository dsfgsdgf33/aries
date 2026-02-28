/**
 * ARIES — Network Watcher
 * Monitors network for new devices, integrates with deployer/WiFi/fleet.
 */
const EventEmitter = require('events');

class NetworkWatcher extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._config = opts.config || {};
    this._networkDeployer = opts.networkDeployer || null;
    this._telegramBot = opts.telegramBot || null;
    this._wifiScanner = opts.wifiScanner || null;
    this._refs = opts.refs || {};
    this._knownDevices = new Set();
    this._interval = null;
    this._sites = [];
  }

  start() {
    // Passive — listens to events from sub-modules
    if (this._networkDeployer) {
      this._networkDeployer.on('scan-complete', (devices) => {
        for (const dev of devices) {
          if (!this._knownDevices.has(dev.ip)) {
            this._knownDevices.add(dev.ip);
            this.emit('new-device', dev);
          }
        }
      });
    }
  }

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }

  addSite(site) {
    this._sites.push({ ...site, addedAt: Date.now() });
    this.emit('site-added', site);
  }

  getSites() { return this._sites; }
  getKnownDevices() { return [...this._knownDevices]; }

  getStatus() {
    return { watching: this._running || false, autoApprove: this._autoApprove || false, sites: this._sites.length, pending: 0, deployed: this._knownDevices.size, failed: 0, total: this._knownDevices.size };
  }
  getPending() { return []; }
  getDeployed() { return [...this._knownDevices].map(ip => ({ ip, status: 'deployed' })); }
}

module.exports = NetworkWatcher;
