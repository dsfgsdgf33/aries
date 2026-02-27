/**
 * ARIES — Google OAuth2 + API Key Authentication
 * Supports OAuth2 (Desktop/Installed App flow) and API Key mode for Gemini.
 * Zero npm dependencies — Node.js built-ins only.
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const querystring = require('querystring');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TOKEN_PATH = path.join(DATA_DIR, 'google-tokens.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// Encryption key derived from machine-specific data
function _getEncKey() {
  const seed = 'aries-google-' + require('os').hostname();
  return crypto.createHash('sha256').update(seed).digest();
}

function _encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', _getEncKey(), iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

function _decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', _getEncKey(), iv);
  let dec = decipher.update(parts.join(':'), 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

function _httpRequest(urlStr, opts, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout: 15000,
    };
    if (body) reqOpts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = mod.request(reqOpts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function _loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}

function _saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 4));
}

const OAUTH_SCOPES = 'https://www.googleapis.com/auth/generative-language https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

const SUCCESS_PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Aries — Google Auth</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a1a;color:#0ff;font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden}
.card{background:#111;border:1px solid #0ff3;border-radius:16px;padding:48px;text-align:center;box-shadow:0 0 60px #0ff15;max-width:420px}
.check{font-size:72px;margin-bottom:16px;animation:pulse 1.5s infinite}
h1{font-size:24px;margin-bottom:8px;color:#0ff}p{color:#888;font-size:14px;margin-top:8px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}</style></head>
<body><div class="card"><div class="check">✓</div><h1>Authentication Successful</h1><p>You can close this tab and return to Aries.</p></div></body></html>`;

class GoogleAuth {
  constructor() {
    this._tokens = null;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(TOKEN_PATH)) {
        const raw = fs.readFileSync(TOKEN_PATH, 'utf8');
        const data = JSON.parse(raw);
        // Decrypt sensitive fields
        if (data._encrypted) {
          const dec = JSON.parse(_decrypt(data._encrypted));
          this._tokens = dec;
        } else {
          this._tokens = data;
        }
      }
    } catch (e) {
      console.error('[GOOGLE-AUTH] Load error:', e.message);
      this._tokens = null;
    }
  }

  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const encrypted = { _encrypted: _encrypt(JSON.stringify(this._tokens)) };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(encrypted, null, 2));
    } catch (e) {
      console.error('[GOOGLE-AUTH] Save error:', e.message);
    }
  }

  /**
   * Start OAuth2 flow — opens browser, returns promise with tokens
   */
  startOAuthFlow() {
    const self = this;
    const cfg = _loadConfig();
    const google = cfg.google || {};
    const clientId = google.clientId;
    const clientSecret = google.clientSecret;

    if (!clientId || !clientSecret) {
      return Promise.reject(new Error('OAuth not configured. Set google.clientId and google.clientSecret in config.json. Create credentials at https://console.cloud.google.com/apis/credentials (Desktop app type).'));
    }

    return new Promise((resolve, reject) => {
      // Start temp server on random port
      const server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url, 'http://127.0.0.1');
        if (!reqUrl.pathname.startsWith('/callback')) {
          res.writeHead(404); res.end('Not found'); return;
        }

        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body style="background:#0a0a1a;color:#f44;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><h1>Auth failed: ' + error + '</h1></body></html>');
          server.close();
          reject(new Error('OAuth denied: ' + error));
          return;
        }

        if (!code) {
          res.writeHead(400); res.end('No code'); return;
        }

        // Exchange code for tokens
        const tokenBody = querystring.stringify({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: 'http://127.0.0.1:' + server.address().port + '/callback',
          grant_type: 'authorization_code',
        });

        _httpRequest('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }, tokenBody).then(async (tokenRes) => {
          if (tokenRes.status >= 400) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body style="background:#0a0a1a;color:#f44;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><h1>Token exchange failed</h1></body></html>');
            server.close();
            reject(new Error('Token exchange failed: ' + JSON.stringify(tokenRes.data)));
            return;
          }

          const t = tokenRes.data;
          self._tokens = {
            method: 'oauth',
            oauth: {
              access_token: t.access_token,
              refresh_token: t.refresh_token,
              expires_at: Date.now() + (t.expires_in * 1000),
              scope: t.scope,
              token_type: t.token_type || 'Bearer',
            },
            apiKey: '',
            profile: {},
            linkedAt: new Date().toISOString(),
          };

          // Fetch profile
          try {
            const profile = await self._fetchProfile();
            self._tokens.profile = profile;
          } catch {}

          self._save();

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(SUCCESS_PAGE);
          server.close();
          resolve(self._tokens);
        }).catch(e => {
          res.writeHead(500); res.end('Error');
          server.close();
          reject(e);
        });
      });

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const redirectUri = 'http://127.0.0.1:' + port + '/callback';
        const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + querystring.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: OAUTH_SCOPES,
          access_type: 'offline',
          prompt: 'consent',
        });

        // Open browser
        const { exec } = require('child_process');
        const platform = process.platform;
        if (platform === 'win32') exec('start "" "' + authUrl + '"');
        else if (platform === 'darwin') exec('open "' + authUrl + '"');
        else exec('xdg-open "' + authUrl + '"');

        console.log('[GOOGLE-AUTH] OAuth flow started on port ' + port);

        // Timeout after 5 min
        setTimeout(() => {
          try { server.close(); } catch {}
          reject(new Error('OAuth flow timed out'));
        }, 300000);
      });
    });
  }

  async _fetchProfile() {
    const token = this._tokens?.oauth?.access_token;
    if (!token) return {};
    const res = await _httpRequest('https://www.googleapis.com/oauth2/v2/userinfo', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (res.status < 400 && res.data) {
      return { email: res.data.email, name: res.data.name, picture: res.data.picture };
    }
    return {};
  }

  /**
   * Set API key mode
   */
  async setApiKey(key) {
    if (!key) throw new Error('API key required');
    // Validate key by calling Gemini
    const testUrl = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key);
    const res = await _httpRequest(testUrl, { method: 'GET' });
    if (res.status >= 400) {
      throw new Error('Invalid API key: ' + (res.data?.error?.message || 'HTTP ' + res.status));
    }

    this._tokens = {
      method: 'apikey',
      oauth: null,
      apiKey: key,
      profile: { email: 'API Key User', name: 'Gemini API Key' },
      linkedAt: new Date().toISOString(),
    };
    this._save();

    // Also save to config.json
    const cfg = _loadConfig();
    if (!cfg.google) cfg.google = {};
    cfg.google.apiKey = key;
    _saveConfig(cfg);

    return this._tokens;
  }

  /**
   * Get current credentials
   */
  getCredentials() {
    return this._tokens;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated() {
    if (!this._tokens) return false;
    if (this._tokens.method === 'apikey') return !!this._tokens.apiKey;
    if (this._tokens.method === 'oauth') return !!this._tokens.oauth?.access_token;
    return false;
  }

  /**
   * Get user profile
   */
  getProfile() {
    return this._tokens?.profile || null;
  }

  /**
   * Refresh OAuth token
   */
  async refreshToken() {
    if (!this._tokens || this._tokens.method !== 'oauth') return;
    const rt = this._tokens.oauth?.refresh_token;
    if (!rt) throw new Error('No refresh token');

    const cfg = _loadConfig();
    const google = cfg.google || {};
    const body = querystring.stringify({
      client_id: google.clientId,
      client_secret: google.clientSecret,
      refresh_token: rt,
      grant_type: 'refresh_token',
    });

    const res = await _httpRequest('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, body);

    if (res.status >= 400) throw new Error('Refresh failed: ' + JSON.stringify(res.data));

    this._tokens.oauth.access_token = res.data.access_token;
    this._tokens.oauth.expires_at = Date.now() + (res.data.expires_in * 1000);
    if (res.data.refresh_token) this._tokens.oauth.refresh_token = res.data.refresh_token;
    this._save();
  }

  /**
   * Logout — clear credentials
   */
  logout() {
    this._tokens = null;
    try { if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH); } catch {}
  }

  /**
   * Get headers for Gemini API calls
   */
  async getGeminiHeaders() {
    if (!this._tokens) return {};

    if (this._tokens.method === 'apikey') {
      // API key goes as query param, not header — return empty headers
      return {};
    }

    if (this._tokens.method === 'oauth') {
      // Auto-refresh if expired (with 60s buffer)
      if (this._tokens.oauth?.expires_at && Date.now() > this._tokens.oauth.expires_at - 60000) {
        try { await this.refreshToken(); } catch (e) {
          console.error('[GOOGLE-AUTH] Token refresh failed:', e.message);
        }
      }
      return { 'Authorization': 'Bearer ' + this._tokens.oauth.access_token };
    }

    return {};
  }

  /**
   * Get API key query parameter (for API key mode)
   */
  getApiKeyParam() {
    if (this._tokens?.method === 'apikey' && this._tokens.apiKey) {
      return 'key=' + encodeURIComponent(this._tokens.apiKey);
    }
    // Also check config
    const cfg = _loadConfig();
    if (cfg.google?.apiKey) return 'key=' + encodeURIComponent(cfg.google.apiKey);
    return '';
  }

  /**
   * Get auth status summary
   */
  getStatus() {
    const cfg = _loadConfig();
    const google = cfg.google || {};
    return {
      authenticated: this.isAuthenticated(),
      method: this._tokens?.method || null,
      profile: this._tokens?.profile || null,
      linkedAt: this._tokens?.linkedAt || null,
      oauthConfigured: !!(google.clientId && google.clientSecret),
    };
  }
}

// Singleton
let _instance = null;
function getInstance() {
  if (!_instance) _instance = new GoogleAuth();
  return _instance;
}

module.exports = { GoogleAuth, getInstance };
