/**
 * ARIES Authentication Module
 * Built-in only (no npm deps) — uses crypto.pbkdf2Sync
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class Auth {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.usersFile = path.join(dataDir, 'users.json');
    this.tokens = new Map(); // token → { username, role, expiresAt }
    this._ensureDataDir();
    this._loadOrSeed();
  }

  _ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  _loadOrSeed() {
    if (fs.existsSync(this.usersFile)) {
      try { this.users = JSON.parse(fs.readFileSync(this.usersFile, 'utf8')); return; } catch (e) {}
    }
    // Seed default admin
    var pw = this.hashPassword('W070705s!');
    this.users = [{
      username: 'Jay',
      passwordHash: pw.hash,
      salt: pw.salt,
      role: 'admin',
      createdAt: new Date().toISOString(),
      lastLogin: null
    }];
    this._save();
  }

  _save() {
    fs.writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2));
  }

  hashPassword(password) {
    var salt = crypto.randomBytes(32).toString('hex');
    var hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return { hash: hash, salt: salt };
  }

  verifyPassword(password, hash, salt) {
    var derived = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return derived === hash;
  }

  generateToken(username) {
    var token = crypto.randomBytes(32).toString('hex');
    var user = this.users.find(function(u) { return u.username === username; });
    this.tokens.set(token, {
      username: username,
      role: user ? user.role : 'user',
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    });
    return token;
  }

  createUser(username, password, role) {
    if (this.users.find(function(u) { return u.username === username; })) {
      throw new Error('User already exists');
    }
    var pw = this.hashPassword(password);
    this.users.push({
      username: username,
      passwordHash: pw.hash,
      salt: pw.salt,
      role: role || 'user',
      createdAt: new Date().toISOString(),
      lastLogin: null
    });
    this._save();
  }

  deleteUser(username) {
    var idx = this.users.findIndex(function(u) { return u.username === username; });
    if (idx === -1) throw new Error('User not found');
    this.users.splice(idx, 1);
    // Invalidate their tokens
    for (var [token, data] of this.tokens) {
      if (data.username === username) this.tokens.delete(token);
    }
    this._save();
  }

  updateUser(username, updates) {
    var user = this.users.find(function(u) { return u.username === username; });
    if (!user) throw new Error('User not found');
    if (updates.password) {
      var pw = this.hashPassword(updates.password);
      user.passwordHash = pw.hash;
      user.salt = pw.salt;
    }
    if (updates.role) user.role = updates.role;
    this._save();
  }

  listUsers() {
    return this.users.map(function(u) {
      return { username: u.username, role: u.role, createdAt: u.createdAt, lastLogin: u.lastLogin };
    });
  }

  login(username, password) {
    var user = this.users.find(function(u) { return u.username === username; });
    if (!user) throw new Error('Invalid credentials');
    if (!this.verifyPassword(password, user.passwordHash, user.salt)) {
      throw new Error('Invalid credentials');
    }
    user.lastLogin = new Date().toISOString();
    this._save();
    var token = this.generateToken(username);
    return { token: token, user: { username: user.username, role: user.role } };
  }

  validateToken(token) {
    if (!token) return null;
    var data = this.tokens.get(token);
    if (!data) return null;
    if (Date.now() > data.expiresAt) { this.tokens.delete(token); return null; }
    return { username: data.username, role: data.role };
  }

  logout(token) {
    this.tokens.delete(token);
  }
}

module.exports = { Auth };
