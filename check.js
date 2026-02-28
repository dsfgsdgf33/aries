const fs = require('fs');

// Check existing workflow panel HTML
const h = fs.readFileSync('D:/openclaw/workspace/aries/web/index.html', 'utf8');
const start = h.indexOf('id="panel-workflows"');
if (start > -1) {
  const chunk = h.substring(start - 20, start + 1500);
  console.log('=== WORKFLOW PANEL HTML ===');
  console.log(chunk);
}

// Check workflow engine exports
console.log('\n=== WORKFLOW ENGINE ===');
const wf = fs.readFileSync('D:/openclaw/workspace/aries/core/workflow-engine.js', 'utf8');
console.log(wf.substring(0, 3000));

// Check subagents structure
console.log('\n=== SUBAGENTS ===');
const sa = fs.readFileSync('D:/openclaw/workspace/aries/core/subagents.js', 'utf8');
console.log(sa.substring(0, 2000));

// Check scheduled-pipelines
console.log('\n=== PIPELINES ===');
const sp = fs.readFileSync('D:/openclaw/workspace/aries/core/scheduled-pipelines.js', 'utf8');
console.log(sp.substring(0, 2000));
