const fs = require('fs');
const f = require('path').join(__dirname, 'core', 'ai.js');
let code = fs.readFileSync(f, 'utf8');

// Find callWithFallback and swap order: direct API first, then gateway
const marker = "async function callWithFallback(messages, model, stream = false) {";
const idx = code.indexOf(marker);
if (idx === -1) { console.log('NOT FOUND'); process.exit(1); }

// Find the end of this function
let depth = 0, i = code.indexOf('{', idx);
depth = 1; i++;
while (i < code.length && depth > 0) {
  if (code[i] === '{') depth++;
  if (code[i] === '}') depth--;
  i++;
}

const replacement = `async function callWithFallback(messages, model, stream = false) {
  const cfg = getConfig();
  const errors = [];

  // 1. Direct Anthropic API first (fastest, no gateway dependency)
  const hasDirectKey = cfg.anthropic?.apiKey || cfg.fallback?.directApi?.apiKey || cfg.fallback?.directApi?.key || process.env.ANTHROPIC_API_KEY;
  if (hasDirectKey) {
    try {
      return await callDirectApi(messages, model);
    } catch (e) {
      errors.push('Direct: ' + e.message);
    }
  }

  // 2. Aries Gateway
  try {
    const resp = await callGateway(messages, model, false);
    return await resp.json();
  } catch (e) {
    errors.push('Gateway: ' + e.message);
  }

  // 3. Ollama
  try {
    return await callOllama(messages, model);
  } catch (e) {
    errors.push('Ollama: ' + e.message);
  }

  throw new Error('All AI providers failed: ' + errors.join('; '));
}`;

code = code.slice(0, idx) + replacement + code.slice(i);
fs.writeFileSync(f, code);
console.log('callWithFallback reordered: direct API first');
