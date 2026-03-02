const fs = require('fs');
const html = fs.readFileSync('web/index.html', 'utf8');
const appjs = fs.readFileSync('web/app.js', 'utf8');

// Get all panel IDs from HTML
const panels = [];
const re = /id=["']panel-([^"']+)["']/g;
let m;
while (m = re.exec(html)) panels.push(m[1]);

// Get loadPanelData switch cases from app.js
const cases = new Set();
const caseRe = /case\s+['"]([^'"]+)['"]\s*:/g;
while (m = caseRe.exec(appjs)) cases.add(m[1]);

// Check panel HTML content size
for (const p of panels) {
  const startTag = new RegExp(`id=["']panel-${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`);
  const startMatch = startTag.exec(html);
  if (!startMatch) continue;
  const startIdx = startMatch.index + startMatch[0].length;
  // Find closing </section> or </div> (panels use both)
  const rest = html.slice(startIdx);
  const closeIdx = rest.search(/<\/section>|<\/div>\s*\n\s*<(?:section|div)\s+id="panel-/);
  const content = closeIdx > 0 ? rest.slice(0, closeIdx) : rest.slice(0, 500);
  const lines = content.split('\n').filter(l => l.trim().length > 0).length;
  const hasCase = cases.has(p);
  
  // Check if there's a loader function in app.js or inline in html
  const loaderPatterns = [
    `load${p.replace(/-/g, '')}`,
    `loadPanel.*${p}`,
    `panel-${p}`,
  ];
  const hasInlineLoader = html.includes(`function load`) && html.includes(`panel-${p}`);
  
  if (lines < 5 && !hasCase) {
    console.log(`BLANK: ${p} (${lines} lines, no case)`);
  } else if (lines < 5) {
    console.log(`STUB:  ${p} (${lines} lines, has case)`);
  }
}

console.log('\n--- ALL PANELS ---');
for (const p of panels) {
  const hasCase = cases.has(p);
  console.log(`  ${hasCase ? '✓' : '✗'} ${p}`);
}
console.log(`\nTotal: ${panels.length} panels, ${[...cases].length} switch cases`);
