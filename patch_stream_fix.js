const fs = require('fs');
const f = require('path').join(__dirname, 'core', 'ai.js');
let code = fs.readFileSync(f, 'utf8');

// Fix streamWithFallback to try direct API FIRST (gateway isn't running)
const oldFallback = `async function streamWithFallback(messages, model, onChunk) {
  try {
    return await streamGateway(messages, model, onChunk);
  } catch (e) {
    // Fallback to direct Anthropic streaming
    const cfg = getConfig();
    const hasKey = cfg.anthropic?.apiKey || cfg.fallback?.directApi?.key || process.env.ANTHROPIC_API_KEY;
    if (hasKey) {
      return await streamAnthropicDirect(messages, model, onChunk);
    }
    throw e;
  }
}`;

const newFallback = `async function streamWithFallback(messages, model, onChunk) {
  const cfg = getConfig();
  const hasKey = cfg.anthropic?.apiKey || cfg.fallback?.directApi?.apiKey || cfg.fallback?.directApi?.key || process.env.ANTHROPIC_API_KEY;
  
  // Try direct Anthropic API first (faster, no gateway dependency)
  if (hasKey) {
    try {
      return await streamAnthropicDirect(messages, model, onChunk);
    } catch (e) {
      console.error('[AI] Direct stream failed:', e.message);
    }
  }
  
  // Fallback to gateway
  try {
    return await streamGateway(messages, model, onChunk);
  } catch (e) {
    throw new Error('All streaming methods failed: ' + e.message);
  }
}`;

if (code.includes(oldFallback)) {
  code = code.replace(oldFallback, newFallback);
  console.log('Fixed streamWithFallback - direct API first');
} else {
  // Try CRLF
  const oldCRLF = oldFallback.replace(/\n/g, '\r\n');
  if (code.includes(oldCRLF)) {
    code = code.replace(oldCRLF, newFallback.replace(/\n/g, '\r\n'));
    console.log('Fixed streamWithFallback - direct API first (CRLF)');
  } else {
    console.log('WARNING: Could not find streamWithFallback');
  }
}

// Also fix callWithFallback to try direct first
const oldCall = 'async function callWithFallback(messages, model) {';
const callIdx = code.indexOf(oldCall);
if (callIdx !== -1) {
  // Find the body - it probably tries gateway first too
  const bodyStart = code.indexOf('{', callIdx) + 1;
  const bodySnippet = code.substring(bodyStart, bodyStart + 200);
  if (bodySnippet.includes('callGateway')) {
    console.log('callWithFallback also tries gateway first - consider fixing');
  }
}

fs.writeFileSync(f, code);
console.log('Stream fix applied');
