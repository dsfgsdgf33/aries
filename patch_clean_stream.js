const fs = require('fs');
const f = require('path').join(__dirname, 'core', 'api-server.js');
let code = fs.readFileSync(f, 'utf8');

// Replace the onChunk callback to buffer and strip tool tags
const oldChunk = `          onChunk: (chunk) => {
            res.write(\`data: \${JSON.stringify({ type: 'chunk', text: chunk })}\\n\\n\`);
          },`;

const newChunk = `          onChunk: (chunk) => {
            // Buffer chunks and only send non-tool text to user
            _chunkBuffer = (_chunkBuffer || '') + chunk;
            // Check if we're inside a tool tag
            const openTag = _chunkBuffer.lastIndexOf('<tool:');
            const closeTag = _chunkBuffer.lastIndexOf('</tool:');
            const closeEnd = _chunkBuffer.lastIndexOf('>');
            // If we have an open tool tag without close, we're mid-tool — don't send
            if (openTag > -1 && (closeTag === -1 || closeTag < openTag)) {
              // Inside a tool tag, buffer it
              return;
            }
            // Strip any complete tool tags from buffer
            var clean = _chunkBuffer.replace(/<tool:[^>]*>[\\s\\S]*?<\\/tool:[^>]*>/g, '').trim();
            if (clean && clean !== _lastSentClean) {
              // Only send the new part
              var newPart = clean.substring((_lastSentClean || '').length);
              if (newPart) {
                res.write(\`data: \${JSON.stringify({ type: 'chunk', text: newPart })}\\n\\n\`);
              }
              _lastSentClean = clean;
            }
          },`;

if (code.includes(oldChunk)) {
  // Add buffer vars before the agentLoop call
  code = code.replace(
    "let fullCleanResponse = '';",
    "let fullCleanResponse = '';\n        var _chunkBuffer = '';\n        var _lastSentClean = '';"
  );
  code = code.replace(oldChunk, newChunk);
  console.log('Chunk streaming patched - tool tags hidden from user');
} else {
  // Try CRLF
  const oldCRLF = oldChunk.replace(/\n/g, '\r\n');
  if (code.includes(oldCRLF)) {
    code = code.replace(
      "let fullCleanResponse = '';",
      "let fullCleanResponse = '';\r\n        var _chunkBuffer = '';\r\n        var _lastSentClean = '';"
    );
    code = code.replace(oldCRLF, newChunk.replace(/\n/g, '\r\n'));
    console.log('Chunk streaming patched (CRLF) - tool tags hidden from user');
  } else {
    console.log('WARNING: Could not find onChunk handler');
  }
}

// Also hide tool-start and tool-result from the main chat stream
// (they should only show as subtle status indicators, not chat messages)
// Keep them as SSE events but change type so UI can handle differently
code = code.replace(
  /res\.write\(`data: \$\{JSON\.stringify\(\{ type: 'tool-start'/g,
  "// Tool status sent only to WS, not SSE stream\n            // res.write(`data: ${JSON.stringify({ type: 'tool-start'"
);

fs.writeFileSync(f, code);
console.log('Stream cleanup done');
