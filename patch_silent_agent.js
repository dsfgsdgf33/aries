const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════
// 1. Fix ai.js — Rewrite system prompt for silent execution
// ══════════════════════════════════════════
const aiFile = path.join(__dirname, 'core', 'ai.js');
let aiCode = fs.readFileSync(aiFile, 'utf8');

// Find the system prompt and replace the Style section
const oldStyle = `## Style
- **Be concise.** No walls of text. Lead with the answer, explain only if needed.
- **Act first, narrate after.** When asked to do something, DO IT with tools, then report the result.
- **No filler.** Skip pleasantries, preambles, and obvious observations.
- **Smart and direct.** Like a sharp engineer, not a customer service bot.
- Use markdown: **bold**, \\\`code\\\`, code blocks. Short paragraphs.`;

const newStyle = `## CRITICAL RULES
1. **NEVER show tool calls in your response text.** Tool tags are for the system only — the user must NEVER see them.
2. **Work silently.** When building something, just use tools. Don't narrate each step.
3. **Only show the user a brief summary of what you did.** Like: "Created the project with 5 files. Server running on port 8080."
4. **Be extremely concise.** 1-3 sentences for simple tasks. No code dumps unless the user specifically asks to see code.
5. **No filler.** No "Great!", no "I'd be happy to help!", no "Let me...". Just results.
6. **Don't show file contents** unless asked. Say "Written to path" not the whole file.
7. **Don't show command output** unless relevant. Say "Installed 5 packages" not the full npm log.
8. Think of how a senior engineer would report to their boss — brief, results-only.

## Response Format
- Put ALL tool calls FIRST, before any text response
- After tools execute, write a SHORT summary for the user
- The user sees ONLY your text, never the tool tags

## Workspace
Your workspace is D:\\\\aries-workspace. Create projects there.`;

if (aiCode.includes(oldStyle)) {
  aiCode = aiCode.replace(oldStyle, newStyle);
  console.log('Style section replaced');
} else {
  console.log('WARNING: Could not find old style section, trying partial match...');
  // Try matching just the first line
  const partial = '## Style\n- **Be concise.**';
  const partialCRLF = '## Style\r\n- **Be concise.**';
  if (aiCode.includes(partial)) {
    const startIdx = aiCode.indexOf(partial);
    const endMarker = '## Tools';
    const endIdx = aiCode.indexOf(endMarker, startIdx);
    if (endIdx > startIdx) {
      aiCode = aiCode.slice(0, startIdx) + newStyle + '\n\n' + aiCode.slice(endIdx);
      console.log('Style section replaced (partial match)');
    }
  } else if (aiCode.includes(partialCRLF)) {
    const startIdx = aiCode.indexOf(partialCRLF);
    const endMarker = '## Tools';
    const endIdx = aiCode.indexOf(endMarker, startIdx);
    if (endIdx > startIdx) {
      aiCode = aiCode.slice(0, startIdx) + newStyle + '\r\n\r\n' + aiCode.slice(endIdx);
      console.log('Style section replaced (CRLF partial match)');
    }
  } else {
    console.log('ERROR: Could not find style section at all');
  }
}

fs.writeFileSync(aiFile, aiCode);
console.log('ai.js updated');

// ══════════════════════════════════════════
// 2. Fix web/app.js — Hide tool output, show only summaries
// ══════════════════════════════════════════
const appFile = path.join(__dirname, 'web', 'app.js');
let appCode = fs.readFileSync(appFile, 'utf8');

// Find the appendChatMessage function and add tool tag stripping
// Look for where assistant messages get rendered
const stripToolTags = `
  // Strip tool tags from displayed messages (tools execute silently)
  function stripToolXml(text) {
    if (!text) return text;
    // Remove all <tool:...>...</tool:...> blocks
    text = text.replace(/<tool:[^>]*>[\s\S]*?<\/tool:[^>]*>/g, '');
    // Remove self-closing tool tags
    text = text.replace(/<tool:[^/]*\/>/g, '');
    // Clean up excess whitespace left behind
    text = text.replace(/\\n{3,}/g, '\\n\\n');
    return text.trim();
  }
`;

// Insert stripToolXml function near the top of the IIFE
const iifeMarker = 'var _adminMode = false;';
if (appCode.includes(iifeMarker)) {
  appCode = appCode.replace(iifeMarker, iifeMarker + '\n' + stripToolTags);
  console.log('Added stripToolXml function');
}

// Find appendChatMessage and make it strip tool tags for assistant messages
// Look for where content gets set in assistant messages
const contentMarkers = [
  "if (role === 'assistant')",
  "role === 'assistant'"
];

// Also modify the SSE chunk handler to strip tool tags from streamed content
// Find where chunks get appended to the chat
const chunkAppend = "currentDiv.innerHTML";
// We need to strip tool tags from the accumulated text, not individual chunks

// Add stripping to the final message render
// Find appendChatMessage
const appendFnMarker = 'function appendChatMessage(';
const appendIdx = appCode.indexOf(appendFnMarker);
if (appendIdx !== -1) {
  // Add tool stripping right after the function signature
  const braceIdx = appCode.indexOf('{', appendIdx);
  if (braceIdx !== -1) {
    const insertAfter = braceIdx + 1;
    const strip = "\n    // Strip tool XML from displayed messages\n    if (role === 'assistant' && typeof stripToolXml === 'function') content = stripToolXml(content);\n";
    appCode = appCode.slice(0, insertAfter) + strip + appCode.slice(insertAfter);
    console.log('Added tool stripping to appendChatMessage');
  }
}

fs.writeFileSync(appFile, appCode);
console.log('app.js updated');

// ══════════════════════════════════════════
// 3. Update config to set workspace
// ══════════════════════════════════════════
const cfgFile = path.join(__dirname, 'config', 'aries.json');
let cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
cfg.workspace = 'D:\\aries-workspace';
fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

// Also update config.json
const cfg2File = path.join(__dirname, 'config.json');
try {
  let cfg2 = JSON.parse(fs.readFileSync(cfg2File, 'utf8'));
  cfg2.workspace = 'D:\\aries-workspace';
  fs.writeFileSync(cfg2File, JSON.stringify(cfg2, null, 2));
} catch {}

console.log('Workspace set to D:\\aries-workspace');

console.log('\nAll patches applied. Restart Aries to take effect.');
