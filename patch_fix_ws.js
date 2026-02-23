const fs = require('fs');

// 1. Remove the separate extension bridge upgrade handler from headless.js
let hf = require('path').join(__dirname, 'core', 'headless.js');
let hcode = fs.readFileSync(hf, 'utf8');

// Find and replace the extension bridge upgrade handler
// Just comment out the server.on('upgrade') for extension bridge
const extStart = hcode.indexOf("server.on('upgrade', (req, socket, head) => {");
if (extStart === -1) { console.log('Could not find ext upgrade handler'); }
else {
  // Find the closing of this handler - look for the matching });
  // It's the block that checks pathname === '/ext'
  const extCheck = hcode.indexOf("if (pathname === '/ext')", extStart);
  if (extCheck !== -1) {
    // Find the closing of the server.on('upgrade', ...) block
    // Pattern: starts at extStart, ends with }); after the catch block
    let depth = 0;
    let i = extStart;
    let found = false;
    // Skip to the opening { of the callback
    while (i < hcode.length && hcode[i] !== '{') i++;
    depth = 1; i++;
    while (i < hcode.length && depth > 0) {
      if (hcode[i] === '{') depth++;
      if (hcode[i] === '}') depth--;
      i++;
    }
    // Now i points just past the closing } of the callback
    // Skip );
    while (i < hcode.length && hcode[i] !== ';') i++;
    i++; // past ;
    
    // Replace the whole block with a comment
    const block = hcode.slice(extStart, i);
    hcode = hcode.replace(block, '// Extension bridge upgrade moved into wsServer');
    fs.writeFileSync(hf, hcode);
    console.log('Removed extension bridge upgrade handler from headless.js');
  }
}

// 2. Update wsServer to also handle /ext
let wf = require('path').join(__dirname, 'core', 'websocket.js');
let wcode = fs.readFileSync(wf, 'utf8');

// After the "if (urlParts.pathname !== '/ws') return;" line, add ext bridge handling
const wsCheck = wcode.indexOf("if (urlParts.pathname !== '/ws') return;");
if (wsCheck === -1) { console.log('Could not find /ws check'); }
else {
  const replacement = `if (urlParts.pathname === '/ext') return; // Extension bridge handles separately
        if (urlParts.pathname !== '/ws') { socket.destroy(); return; } // Reject unknown paths`;
  wcode = wcode.replace("if (urlParts.pathname !== '/ws') return; // Let other handlers deal with non-/ws", replacement);
  fs.writeFileSync(wf, wcode);
  console.log('Updated wsServer to reject non-/ws and non-/ext paths');
}

console.log('Done!');
