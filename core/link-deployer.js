const EventEmitter = require('events');

class LinkDeployer extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.config = opts;
    this.enabled = false;
  }

  status() { return { enabled: this.enabled, status: 'standby' }; }

  deploy() { return { success: true, message: "Not yet configured" }; }
  getDeployPage() { return { success: true, message: 'Not yet configured' }; }
  writeHead() { return { success: true, message: 'Not yet configured' }; }
  end() { return { success: true, message: 'Not yet configured' }; }
  startsWith() { return { success: true, message: 'Not yet configured' }; }
  existsSync() { return { success: true, message: 'Not yet configured' }; }
  extname() { return { success: true, message: 'Not yet configured' }; }
  toLowerCase() { return { success: true, message: 'Not yet configured' }; }
  readFileSync() { return { success: true, message: 'Not yet configured' }; }
  check() { return { success: true, message: 'Not yet configured' }; }
  security() { return { success: true, message: 'Not yet configured' }; }
  ceil() { return { success: true, message: 'Not yet configured' }; }
  stringify() { return { success: true, message: 'Not yet configured' }; }
  handler() { return { success: true, message: 'Not yet configured' }; }
  get() { return { success: true, message: 'Not yet configured' }; }
  floor() { return { success: true, message: 'Not yet configured' }; }
  now() { return { success: true, message: 'Not yet configured' }; }
  every() { return { success: true, message: 'Not yet configured' }; }
  request() { return { success: true, message: 'Not yet configured' }; }
  listLinks() { return []; }
  revokeLink(token) { return false; }
  generateLink(opts) { return { token: '', url: '' }; }
}

module.exports = LinkDeployer;
