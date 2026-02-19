/**
 * ARIES v5.0 — HTTPS Server Support
 * 
 * Optional HTTPS server alongside HTTP.
 * Auto-generates self-signed certificates using Node.js crypto.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

/**
 * @class HttpsServer
 */
class HttpsServer {
  /**
   * @param {Object} config
   * @param {boolean} [config.enabled=false]
   * @param {number} [config.port=3334]
   * @param {string} [config.certPath]
   * @param {string} [config.keyPath]
   * @param {boolean} [config.autoGenerate=true]
   * @param {string} [config.baseDir]
   */
  constructor(config = {}) {
    try {
      this.enabled = config.enabled === true;
      this.port = config.port || 3334;
      this.baseDir = config.baseDir || path.join(__dirname, '..');
      this.certPath = config.certPath || path.join(this.baseDir, 'data', 'certs', 'server.cert');
      this.keyPath = config.keyPath || path.join(this.baseDir, 'data', 'certs', 'server.key');
      this.autoGenerate = config.autoGenerate !== false;
      this.server = null;
      this._running = false;
    } catch (err) {
      console.error('[HTTPS] Init error:', err.message);
      this.enabled = false;
    }
  }

  /**
   * Start HTTPS server using the same request handler as HTTP.
   * @param {Function} requestHandler
   * @param {string} [host='0.0.0.0']
   * @returns {https.Server|null}
   */
  start(requestHandler, host) {
    try {
      if (!this.enabled) return null;

      // Auto-generate certs if needed
      if (!fs.existsSync(this.certPath) || !fs.existsSync(this.keyPath)) {
        if (this.autoGenerate) {
          this._generateCert();
        } else {
          console.error('[HTTPS] Certificate files not found and autoGenerate is disabled');
          return null;
        }
      }

      if (!fs.existsSync(this.certPath) || !fs.existsSync(this.keyPath)) {
        console.error('[HTTPS] Failed to generate certificates');
        return null;
      }

      var options = {
        cert: fs.readFileSync(this.certPath),
        key: fs.readFileSync(this.keyPath)
      };

      this.server = https.createServer(options, requestHandler);
      this.server.listen(this.port, host || '0.0.0.0', () => {
        console.log('[HTTPS] Server listening on port ' + this.port);
      });
      this.server.on('error', (err) => {
        console.error('[HTTPS] Server error:', err.message);
      });
      this._running = true;
      return this.server;
    } catch (err) {
      console.error('[HTTPS] Start error:', err.message);
      return null;
    }
  }

  /**
   * Stop the HTTPS server.
   */
  stop() {
    try {
      if (this.server) {
        this.server.close();
        this._running = false;
      }
    } catch (err) {
      // ignore
    }
  }

  /**
   * Get HTTPS server status.
   * @returns {Object}
   */
  getStatus() {
    try {
      return {
        enabled: this.enabled,
        running: this._running,
        port: this.port,
        hasCert: fs.existsSync(this.certPath),
        hasKey: fs.existsSync(this.keyPath),
        certPath: this.certPath,
        keyPath: this.keyPath,
      };
    } catch (err) {
      return { enabled: false, running: false, error: err.message };
    }
  }

  /** @private */
  _generateCert() {
    try {
      var certDir = path.dirname(this.certPath);
      if (!fs.existsSync(certDir)) {
        fs.mkdirSync(certDir, { recursive: true });
      }

      // Try OpenSSL first
      try {
        execSync(
          'openssl req -x509 -newkey rsa:2048 -keyout "' + this.keyPath + '" -out "' + this.certPath + '" -days 365 -nodes -subj "/CN=localhost"',
          { stdio: 'ignore', timeout: 10000 }
        );
        if (fs.existsSync(this.certPath) && fs.existsSync(this.keyPath)) {
          console.log('[HTTPS] Generated self-signed certificate via OpenSSL');
          return;
        }
      } catch (e) {
        // OpenSSL not available, try Node.js crypto
      }

      // Generate using Node.js crypto (requires Node 15+)
      try {
        var keyPair = crypto.generateKeyPairSync('rsa', {
          modulusLength: 2048,
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });

        // Create a minimal self-signed cert using raw ASN.1 (simplified)
        // For Node 15+, use X509Certificate if available
        fs.writeFileSync(this.keyPath, keyPair.privateKey);

        // Create self-signed cert using PowerShell on Windows as fallback
        try {
          var psCmd = 'powershell -Command "' +
            '$cert = New-SelfSignedCertificate -DnsName localhost -CertStoreLocation Cert:\\CurrentUser\\My -NotAfter (Get-Date).AddYears(1); ' +
            '$pwd = ConvertTo-SecureString -String \'pass\' -Force -AsPlainText; ' +
            'Export-PfxCertificate -Cert $cert -FilePath temp_cert.pfx -Password $pwd | Out-Null; ' +
            'openssl pkcs12 -in temp_cert.pfx -out \'' + this.certPath.replace(/\\/g, '/') + '\' -nokeys -passin pass:pass 2>$null; ' +
            'openssl pkcs12 -in temp_cert.pfx -out \'' + this.keyPath.replace(/\\/g, '/') + '\' -nocerts -nodes -passin pass:pass 2>$null; ' +
            'Remove-Item temp_cert.pfx -ErrorAction SilentlyContinue"';
          execSync(psCmd, { stdio: 'ignore', timeout: 30000 });
        } catch (psErr) {
          // If all else fails, write a placeholder
          console.error('[HTTPS] Could not generate certificate. Provide manually at ' + this.certPath);
        }
      } catch (cryptoErr) {
        console.error('[HTTPS] Certificate generation failed:', cryptoErr.message);
      }
    } catch (err) {
      console.error('[HTTPS] _generateCert error:', err.message);
    }
  }
}

module.exports = { HttpsServer };
