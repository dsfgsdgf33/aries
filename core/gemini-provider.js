/**
 * ARIES — Gemini API Provider
 * Calls Google Gemini models using OAuth or API Key credentials.
 * Zero npm dependencies.
 */

const https = require('https');
const { getInstance: getGoogleAuth } = require('./google-auth');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const GEMINI_MODELS = [
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash', description: 'Latest gen — fast, 1M context, multimodal' },
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro', description: 'Latest gen — advanced reasoning, 1M context' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Strong reasoning with thinking' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast with thinking capabilities' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Fast, versatile model' },
  { id: 'gemini-2.0-pro', name: 'Gemini 2.0 Pro', description: 'Advanced reasoning' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Long context, strong reasoning' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast and efficient' },
];

/**
 * Convert Aries messages to Gemini API format
 */
function convertMessages(messages) {
  const contents = [];
  let systemInstruction = null;

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (!systemInstruction) systemInstruction = { parts: [] };
      systemInstruction.parts.push({ text: msg.content });
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
  }

  // Gemini requires alternating user/model. If two same roles in a row, merge.
  const merged = [];
  for (const c of contents) {
    if (merged.length > 0 && merged[merged.length - 1].role === c.role) {
      merged[merged.length - 1].parts.push(...c.parts);
    } else {
      merged.push(c);
    }
  }

  // Gemini requires first message to be 'user'
  if (merged.length > 0 && merged[0].role === 'model') {
    merged.unshift({ role: 'user', parts: [{ text: 'Hello.' }] });
  }

  return { contents: merged, systemInstruction };
}

/**
 * Make a Gemini API request
 */
function _geminiRequest(urlPath, body, auth) {
  return new Promise((resolve, reject) => {
    let fullUrl = GEMINI_BASE + urlPath;
    const keyParam = auth.getApiKeyParam();
    if (keyParam) {
      fullUrl += (fullUrl.includes('?') ? '&' : '?') + keyParam;
    }

    const parsed = new (require('url').URL)(fullUrl);
    const postBody = JSON.stringify(body);

    auth.getGeminiHeaders().then(headers => {
      const req = https.request({
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postBody),
        },
        timeout: 120000,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            try {
              const err = JSON.parse(data);
              reject(new Error('Gemini API error: ' + (err.error?.message || 'HTTP ' + res.statusCode)));
            } catch {
              reject(new Error('Gemini API error: HTTP ' + res.statusCode));
            }
            return;
          }
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid Gemini response')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Gemini request timeout')); });
      req.write(postBody);
      req.end();
    }).catch(reject);
  });
}

/**
 * Call Gemini (non-streaming) — returns OpenAI-compatible format
 */
async function callGemini(messages, model, opts) {
  const auth = getGoogleAuth();
  if (!auth.isAuthenticated()) throw new Error('Google account not linked. Connect via Dashboard → Accounts.');

  model = model || 'gemini-2.0-flash';
  // Strip google/ prefix if present
  model = model.replace(/^google\//, '');

  const { contents, systemInstruction } = convertMessages(messages);
  const body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  body.generationConfig = {
    maxOutputTokens: (opts && opts.max_tokens) || 8192,
    temperature: (opts && opts.temperature != null) ? opts.temperature : 0.1,
  };

  const result = await _geminiRequest('/models/' + model + ':generateContent', body, auth);

  // Extract text from response
  let text = '';
  if (result.candidates && result.candidates[0]?.content?.parts) {
    text = result.candidates[0].content.parts.map(p => p.text || '').join('');
  }

  // Return in OpenAI-compatible format for Aries
  return {
    choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    model: model,
    usage: result.usageMetadata || {},
  };
}

/**
 * Call Gemini with SSE streaming
 */
async function callGeminiStream(messages, model, onChunk) {
  const auth = getGoogleAuth();
  if (!auth.isAuthenticated()) throw new Error('Google account not linked.');

  model = (model || 'gemini-2.0-flash').replace(/^google\//, '');
  const { contents, systemInstruction } = convertMessages(messages);
  const body = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  body.generationConfig = { maxOutputTokens: 8192, temperature: 0.1 };

  let fullUrl = GEMINI_BASE + '/models/' + model + ':streamGenerateContent?alt=sse';
  const keyParam = auth.getApiKeyParam();
  if (keyParam) fullUrl += '&' + keyParam;

  const parsed = new (require('url').URL)(fullUrl);
  const postBody = JSON.stringify(body);
  const headers = await auth.getGeminiHeaders();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postBody),
      },
      timeout: 120000,
    }, (res) => {
      if (res.statusCode >= 400) {
        let errData = '';
        res.on('data', c => errData += c);
        res.on('end', () => reject(new Error('Gemini stream error: HTTP ' + res.statusCode + ' ' + errData.substring(0, 200))));
        return;
      }

      let buffer = '';
      let fullText = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.substring(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.candidates?.[0]?.content?.parts) {
              for (const part of parsed.candidates[0].content.parts) {
                if (part.text) {
                  fullText += part.text;
                  if (onChunk) onChunk(part.text);
                }
              }
            }
          } catch {}
        }
      });

      res.on('end', () => {
        resolve({
          choices: [{ message: { role: 'assistant', content: fullText }, finish_reason: 'stop' }],
          model: model,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Gemini stream timeout')); });
    req.write(postBody);
    req.end();
  });
}

/**
 * List available models
 */
function getModels() {
  return GEMINI_MODELS;
}

module.exports = { callGemini, callGeminiStream, getModels, convertMessages, GEMINI_MODELS };
