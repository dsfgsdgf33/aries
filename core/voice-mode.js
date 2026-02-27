'use strict';

/**
 * @fileoverview VoiceMode - Speech-to-text and text-to-speech for Aries AI platform.
 * Uses OpenAI Whisper (STT) and TTS APIs via Node.js built-in https module.
 * @module voice-mode
 */

const { EventEmitter } = require('events');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data', 'voice');

const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const TTS_MODELS = ['tts-1', 'tts-1-hd'];
const STT_FORMATS = ['wav', 'mp3', 'webm', 'mp4', 'm4a', 'mpeg', 'mpga', 'oga', 'ogg', 'flac'];

const STATES = { IDLE: 'idle', LISTENING: 'listening', PROCESSING: 'processing', SPEAKING: 'speaking' };

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Make an HTTPS request returning a Promise.
 * @param {object} options - https.request options
 * @param {Buffer|null} body - Request body
 * @param {boolean} [raw=false] - If true, return raw Buffer instead of parsed JSON
 * @returns {Promise<object|Buffer>}
 */
function httpsRequest(options, body, raw = false) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          let msg;
          try { msg = JSON.parse(buf.toString()).error?.message || buf.toString(); } catch (_) { msg = buf.toString().slice(0, 500); }
          return reject(new Error(`API ${res.statusCode}: ${msg}`));
        }
        resolve(raw ? buf : JSON.parse(buf.toString()));
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('Request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Build a multipart/form-data body.
 * @param {object} fields - { key: string_value }
 * @param {object} file - { field, filename, buffer, contentType }
 * @returns {{ body: Buffer, contentType: string }}
 */
function buildMultipart(fields, file) {
  const boundary = '----AriesBoundary' + crypto.randomBytes(8).toString('hex');
  const parts = [];
  const CRLF = '\r\n';

  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${key}"${CRLF}${CRLF}${value}${CRLF}`
    );
  }

  if (file) {
    parts.push(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"${CRLF}Content-Type: ${file.contentType}${CRLF}${CRLF}`
    );
  }

  const head = Buffer.from(parts.join(''));
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
  const body = file ? Buffer.concat([head, file.buffer, tail]) : Buffer.concat([head, tail]);

  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

const MIME_MAP = {
  wav: 'audio/wav', mp3: 'audio/mpeg', webm: 'audio/webm',
  mp4: 'audio/mp4', m4a: 'audio/mp4', mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg', oga: 'audio/ogg', ogg: 'audio/ogg', flac: 'audio/flac'
};

class VoiceMode extends EventEmitter {
  constructor() {
    super();
    ensureDir(DATA_DIR);
    this._settings = {
      model: 'tts-1',
      voice: 'nova',
      speed: 1.0
    };
    this._state = STATES.IDLE;
    this._apiKey = process.env.OPENAI_API_KEY || null;
  }

  /**
   * Check if API key is configured. Returns error info if not.
   * @returns {string|null} null if OK, error string if missing.
   */
  _checkKey() {
    if (this._apiKey) return null;
    return 'OpenAI API key not configured. Set OPENAI_API_KEY environment variable. Get one at https://platform.openai.com/api-keys';
  }

  /**
   * Configure voice settings.
   * @param {object} settings
   * @param {string} [settings.model] - tts-1 or tts-1-hd
   * @param {string} [settings.voice] - alloy, echo, fable, onyx, nova, shimmer
   * @param {number} [settings.speed] - 0.25 to 4.0
   * @param {string} [settings.apiKey] - Override API key
   * @returns {object} Current settings.
   */
  configure(settings = {}) {
    if (settings.apiKey) this._apiKey = settings.apiKey;
    if (settings.model && TTS_MODELS.includes(settings.model)) this._settings.model = settings.model;
    if (settings.voice && VOICES.includes(settings.voice)) this._settings.voice = settings.voice;
    if (settings.speed != null) {
      this._settings.speed = Math.max(0.25, Math.min(4.0, Number(settings.speed)));
    }
    return { ...this._settings };
  }

  /**
   * Transcribe audio buffer to text using OpenAI Whisper.
   * @param {Buffer} audioBuffer - Raw audio data.
   * @param {string} [format='wav'] - Audio format.
   * @param {object} [options={}]
   * @param {string} [options.language] - ISO language hint.
   * @param {string} [options.prompt] - Optional context prompt.
   * @returns {Promise<{ text: string, duration?: number }>}
   */
  async transcribe(audioBuffer, format = 'wav', options = {}) {
    const keyErr = this._checkKey();
    if (keyErr) throw new Error(keyErr);

    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw new Error('audioBuffer must be a non-empty Buffer');
    }

    this._setState(STATES.PROCESSING);
    this.emit('transcribe-start', { format, size: audioBuffer.length });

    try {
      const fields = { model: 'whisper-1', response_format: 'verbose_json' };
      if (options.language) fields.language = options.language;
      if (options.prompt) fields.prompt = options.prompt;

      const ext = STT_FORMATS.includes(format) ? format : 'wav';
      const mime = MIME_MAP[ext] || 'audio/wav';

      const { body, contentType } = buildMultipart(fields, {
        field: 'file',
        filename: `audio.${ext}`,
        buffer: audioBuffer,
        contentType: mime
      });

      const result = await httpsRequest({
        hostname: 'api.openai.com',
        path: '/v1/audio/transcriptions',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this._apiKey}`,
          'Content-Type': contentType,
          'Content-Length': body.length
        }
      }, body);

      // Save input audio
      const ts = Date.now();
      const inPath = path.join(DATA_DIR, `stt-${ts}.${ext}`);
      fs.writeFileSync(inPath, audioBuffer);

      const out = { text: result.text, duration: result.duration || null, file: inPath };
      this.emit('transcribe-complete', out);
      this._setState(STATES.IDLE);
      return out;
    } catch (err) {
      this._setState(STATES.IDLE);
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Generate speech audio from text using OpenAI TTS.
   * @param {string} text - Text to speak.
   * @param {object} [options={}]
   * @param {string} [options.model]
   * @param {string} [options.voice]
   * @param {number} [options.speed]
   * @returns {Promise<{ audioBuffer: Buffer, file: string }>}
   */
  async speak(text, options = {}) {
    const keyErr = this._checkKey();
    if (keyErr) throw new Error(keyErr);

    if (!text || typeof text !== 'string') throw new Error('text is required');

    this._setState(STATES.SPEAKING);
    this.emit('speak-start', { text: text.slice(0, 100), length: text.length });

    try {
      const payload = JSON.stringify({
        model: options.model || this._settings.model,
        input: text,
        voice: options.voice || this._settings.voice,
        speed: options.speed || this._settings.speed,
        response_format: 'mp3'
      });

      const audioBuffer = await httpsRequest({
        hostname: 'api.openai.com',
        path: '/v1/audio/speech',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this._apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, Buffer.from(payload), true);

      const ts = Date.now();
      const outPath = path.join(DATA_DIR, `tts-${ts}.mp3`);
      fs.writeFileSync(outPath, audioBuffer);

      const out = { audioBuffer, file: outPath };
      this.emit('speak-complete', out);
      this._setState(STATES.IDLE);
      return out;
    } catch (err) {
      this._setState(STATES.IDLE);
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Get available voices.
   * @returns {string[]}
   */
  getVoices() {
    return [...VOICES];
  }

  /**
   * Get current conversation state.
   * @returns {{ state: string, settings: object }}
   */
  getConversationState() {
    return { state: this._state, settings: { ...this._settings } };
  }

  _setState(state) {
    const prev = this._state;
    this._state = state;
    if (prev !== state) this.emit('state-change', { from: prev, to: state });
  }
}

let _instance = null;

/**
 * Get or create singleton instance.
 * @returns {VoiceMode}
 */
function getInstance() {
  if (!_instance) _instance = new VoiceMode();
  return _instance;
}

module.exports = { VoiceMode, getInstance };
