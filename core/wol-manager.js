/**
 * ARIES — Wake-on-LAN Manager
 * Sends WoL magic packets to wake sleeping worker nodes.
 */
const dgram = require('dgram');
const EventEmitter = require('events');

class WoLManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._config = opts.config || {};
    this._refs = opts.refs || {};
    this._watchdogEnabled = false;
    this._interval = null;
    this._knownMacs = (this._config.wol?.macs) || {};
  }

  setWatchdogEnabled(enabled) {
    this._watchdogEnabled = enabled;
    if (enabled && !this._interval) {
      this._interval = setInterval(() => this._checkWorkers(), 60000);
    } else if (!enabled && this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  _checkWorkers() {
    // Check which workers are offline and need waking
    try {
      const ms = this._refs?._minerState;
      if (!ms || !ms.nodes) return;
      for (const [id, node] of Object.entries(ms.nodes)) {
        if (node.status === 'offline' || node.status === 'dead') {
          const mac = this._knownMacs[id] || this._knownMacs[node.hostname];
          if (mac) {
            this.wake(mac).then(() => {
              this.emit('wake-sent', { id, mac, hostname: node.hostname });
            }).catch(() => {});
          }
        }
      }
    } catch {}
  }

  wake(mac, opts = {}) {
    return new Promise((resolve, reject) => {
      const broadcastAddr = opts.broadcast || '255.255.255.255';
      const port = opts.port || 9;

      // Build magic packet: 6x 0xFF + 16x MAC
      const macBytes = mac.replace(/[:-]/g, '').match(/.{2}/g).map(b => parseInt(b, 16));
      const packet = Buffer.alloc(102);
      for (let i = 0; i < 6; i++) packet[i] = 0xff;
      for (let i = 0; i < 16; i++) {
        for (let j = 0; j < 6; j++) {
          packet[6 + i * 6 + j] = macBytes[j];
        }
      }

      const client = dgram.createSocket('udp4');
      client.on('error', (err) => { client.close(); reject(err); });
      client.bind(() => {
        client.setBroadcast(true);
        client.send(packet, 0, packet.length, port, broadcastAddr, (err) => {
          client.close();
          if (err) reject(err); else resolve({ mac, sent: true });
        });
      });
    });
  }

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  }

  getHealth() {
    return { devicesMonitored: 0, lastCheck: null, wakesTriggered: this._wakesTriggered || 0 };
  }

  getDevices() { return []; }
}

module.exports = WoLManager;
