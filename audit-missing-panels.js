const fs = require('fs');
const idx = fs.readFileSync('web/index.html', 'utf8');

// Panels without loadPanelData cases
const missing = ['meta','gen-dna','mind','memetic','theater','causal','cognition','cognition-plus',
  'evolution','existential','deep-self','growth','commitments','world','social','lock',
  'knowledge-wiki','reasoning','deep-mind','skill-progress','marketplace','desktop','self-arch','tor-service'];

for (const panel of missing) {
  // Check if inline script has a load function
  const loadFn = 'load' + panel.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('');
  const hasInline = idx.includes('panel-' + panel);
  const hasLoader = idx.includes(loadFn) || idx.includes("loadPanel('" + panel + "')") || idx.includes('data-panel="' + panel + '"');
  
  // Check section content — is it just a placeholder?
  const sectionStart = idx.indexOf('id="panel-' + panel + '"');
  if (sectionStart === -1) { console.log(panel + ': NO HTML SECTION'); continue; }
  const sectionEnd = idx.indexOf('</section>', sectionStart);
  const content = idx.slice(sectionStart, sectionEnd);
  const hasTable = content.includes('<table') || content.includes('data-table');
  const hasFetch = content.includes('fetch(') || content.includes('api(');
  const hasOnclick = content.includes('onclick');
  const lineCount = content.split('\n').length;
  
  console.log(panel + ': ' + lineCount + ' lines, table=' + hasTable + ', fetch=' + hasFetch + ', onclick=' + hasOnclick);
}
