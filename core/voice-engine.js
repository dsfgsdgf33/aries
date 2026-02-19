/**
 * ARIES v4.2 — Voice Engine
 * TTS via system speech APIs (PowerShell System.Speech on Windows).
 * No npm packages — uses only Node.js built-ins.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const DATA_DIR = path.join(__dirname, '..', 'data');
const VOICE_DIR = path.join(DATA_DIR, 'voice');

class VoiceEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.defaultVoice = config.defaultVoice || '';
    this.history = [];
    this._ensureDirs();
  }

  _ensureDirs() {
    try {
      if (!fs.existsSync(VOICE_DIR)) fs.mkdirSync(VOICE_DIR, { recursive: true });
    } catch {}
  }

  /**
   * Speak text using system TTS and save as WAV
   * @param {string} text - Text to speak
   * @param {object} opts - Options { voice, rate, volume }
   * @returns {Promise<{file: string, duration: number}>}
   */
  async speak(text, opts = {}) {
    const id = crypto.randomUUID();
    const outFile = path.join(VOICE_DIR, `${id}.wav`);
    const voice = opts.voice || this.defaultVoice;
    const rate = opts.rate || 0; // -10 to 10
    const volume = opts.volume || 100; // 0 to 100

    // Escape text for PowerShell
    const safeText = text.replace(/'/g, "''").replace(/\r?\n/g, ' ').substring(0, 5000);

    const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
${voice ? "$synth.SelectVoice('" + voice.replace(/'/g, "''") + "')" : ''}
$synth.Rate = ${rate}
$synth.Volume = ${volume}
$synth.SetOutputToWaveFile('${outFile.replace(/\\/g, '\\\\')}')
$synth.Speak('${safeText}')
$synth.Dispose()
`.trim();

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const child = spawn('powershell', ['-NoProfile', '-Command', psScript], {
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', d => { stderr += d.toString(); });

      child.on('close', (code) => {
        const duration = Date.now() - startTime;

        if (code !== 0 || !fs.existsSync(outFile)) {
          reject(new Error(stderr || 'TTS failed'));
          return;
        }

        const entry = {
          id,
          text: text.substring(0, 200),
          file: outFile,
          voice: voice || '(default)',
          duration,
          timestamp: new Date().toISOString(),
        };
        this.history.push(entry);
        if (this.history.length > 100) this.history = this.history.slice(-100);
        this.emit('spoken', entry);

        resolve({ file: outFile, duration, id });
      });

      child.on('error', (err) => {
        reject(new Error('PowerShell TTS error: ' + err.message));
      });
    });
  }

  /**
   * Get available system voices
   * @returns {Promise<Array<{name: string, culture: string, gender: string}>>}
   */
  async getVoices() {
    try {
      const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.GetInstalledVoices() | ForEach-Object {
  $v = $_.VoiceInfo
  Write-Output "$($v.Name)|$($v.Culture)|$($v.Gender)"
}
$synth.Dispose()
`.trim();
      const output = execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, { timeout: 10000 }).toString().trim();
      if (!output) return [];
      return output.split('\n').filter(l => l.includes('|')).map(line => {
        const [name, culture, gender] = line.trim().split('|');
        return { name, culture, gender };
      });
    } catch (e) {
      return [{ name: '(error)', culture: '', gender: '', error: e.message }];
    }
  }

  /**
   * Set the default voice
   * @param {string} name - Voice name
   */
  setVoice(name) {
    this.defaultVoice = name;
    this.emit('voice-changed', name);
  }

  /**
   * Parse voice-like text to extract intent
   * @param {string} text - Natural language text
   * @returns {object} Parsed intent
   */
  parseVoiceCommand(text) {
    const lower = text.toLowerCase().trim();
    const intents = [
      { pattern: /^(hey |ok |hi )?(aries|system)[,!]?\s*/i, type: 'wake' },
      { pattern: /^(search|look up|find|google)\s+(.+)/i, type: 'search', extract: 2 },
      { pattern: /^(run|execute|start)\s+(.+)/i, type: 'execute', extract: 2 },
      { pattern: /^(read|open|show)\s+(.+)/i, type: 'read', extract: 2 },
      { pattern: /^(write|save|create)\s+(.+)/i, type: 'write', extract: 2 },
      { pattern: /^(stop|cancel|abort|quit)/i, type: 'stop' },
      { pattern: /^(status|health|check)/i, type: 'status' },
    ];

    for (const intent of intents) {
      const match = lower.match(intent.pattern);
      if (match) {
        return {
          type: intent.type,
          raw: text,
          argument: intent.extract ? match[intent.extract] : null,
          confidence: 0.8,
        };
      }
    }

    return { type: 'chat', raw: text, argument: text, confidence: 0.5 };
  }

  /**
   * Get speech history
   * @returns {Array}
   */
  getHistory() {
    return this.history;
  }
}

module.exports = { VoiceEngine };
