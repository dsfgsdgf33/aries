const fs = require('fs');
const f = fs.readFileSync('D:/openclaw/workspace/aries/web/app.js', 'utf8');
console.log('app.js Lines:', f.split('\n').length);
const panels = f.match(/switchPanel\(['"][^'"]+['"]\)/g);
console.log('Panels:', [...new Set(panels || [])]);

// Check subagents API
const api = fs.readFileSync('D:/openclaw/workspace/aries/core/api-server.js', 'utf8');
console.log('api-server.js Lines:', api.split('\n').length);

// Check existing workflow engine
try {
  const wf = fs.readFileSync('D:/openclaw/workspace/aries/core/workflow-engine.js', 'utf8');
  console.log('workflow-engine.js Lines:', wf.split('\n').length);
  // Find exports
  const exports = wf.match(/(?:async\s+)?(\w+)\s*\(/g);
  console.log('Methods:', exports?.slice(0, 20));
} catch(e) { console.log('No workflow-engine.js'); }

// Check subagents
try {
  const sa = fs.readFileSync('D:/openclaw/workspace/aries/core/subagents.js', 'utf8');
  console.log('subagents.js Lines:', sa.split('\n').length);
} catch(e) { console.log('No subagents.js'); }

// Check scheduled pipelines
try {
  const sp = fs.readFileSync('D:/openclaw/workspace/aries/core/scheduled-pipelines.js', 'utf8');
  console.log('scheduled-pipelines.js Lines:', sp.split('\n').length);
} catch(e) { console.log('No scheduled-pipelines.js'); }

// Check index.html for panel divs
const html = fs.readFileSync('D:/openclaw/workspace/aries/web/index.html', 'utf8');
const panelDivs = html.match(/id="panel-[^"]+"/g);
console.log('Panel divs:', panelDivs);
