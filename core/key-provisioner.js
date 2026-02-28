/**
 * ARIES — Key Provisioner
 * Manages API keys in an encrypted vault, auto-registers from env vars.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class KeyProvisioner {
  constructor(opts = {}) {
    this._dataDir = opts.dataDir || path.join(__dirname, '..', 'data');
    this._providerManager = opts.providerManager || null;
    this._masterPassword = opts.masterPassword || 'aries-default-vault-2026';
    this._vaultPath = path.join(this._dataDir, '.key-vault');
    this._keys = {};
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this._vaultPath)) {
        const enc = fs.readFileSync(this._vaultPath, 'utf8');
        const decipher = crypto.createDecipheriv('aes-256-cbc',
          crypto.scryptSync(this._masterPassword, 'aries-salt', 32),
          Buffer.alloc(16, 0));
        let dec = decipher.update(enc, 'hex', 'utf8');
        dec += decipher.final('utf8');
        this._keys = JSON.parse(dec);
      }
    } catch {
      this._keys = {};
    }
  }

  _save() {
    try {
      const dir = path.dirname(this._vaultPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const cipher = crypto.createCipheriv('aes-256-cbc',
        crypto.scryptSync(this._masterPassword, 'aries-salt', 32),
        Buffer.alloc(16, 0));
      let enc = cipher.update(JSON.stringify(this._keys), 'utf8', 'hex');
      enc += cipher.final('hex');
      fs.writeFileSync(this._vaultPath, enc);
    } catch (e) {
      console.error('[KEY-VAULT] Save error:', e.message);
    }
  }

  addKey(name, key) {
    this._keys[name] = { key, addedAt: Date.now() };
    this._save();
  }

  getKey(name) {
    return this._keys[name]?.key || null;
  }

  removeKey(name) {
    delete this._keys[name];
    this._save();
  }

  autoRegister() {
    let count = 0;
    const envMap = {
      'ANTHROPIC_API_KEY': 'anthropic',
      'OPENAI_API_KEY': 'openai',
      'BRAVE_API_KEY': 'brave',
      'GOOGLE_API_KEY': 'google',
    };
    for (const [env, name] of Object.entries(envMap)) {
      if (process.env[env] && !this._keys[name]) {
        this.addKey(name, process.env[env]);
        count++;
      }
    }
    return count;
  }

  listKeys() {
    return Object.keys(this._keys);
  }

  listProviders() {
    return Object.keys(this._keys).map(name => ({
      name, hasKey: !!this._keys[name], masked: this._keys[name] ? this._keys[name].substring(0, 8) + '...' : ''
    }));
  }

  exportKeys(password) { return { keys: this._keys, exported: Date.now() }; }
  importKeys(data, password) { if (data && data.keys) { Object.assign(this._keys, data.keys); this._save(); } }
}

module.exports = { KeyProvisioner };
