// Patch api-server.js to add Anthropic models to /api/models
const fs = require('fs');
const file = require('path').join(__dirname, 'core', 'api-server.js');
let code = fs.readFileSync(file, 'utf8');

const marker = "return json(res, 200, { models: models, count: models.length });\n    }\n\n";
const idx = code.indexOf(marker);
if (idx === -1) {
  // try CRLF
  const marker2 = "return json(res, 200, { models: models, count: models.length });\r\n    }\r\n\r\n";
  const idx2 = code.indexOf(marker2);
  if (idx2 === -1) { console.log('MARKER NOT FOUND'); process.exit(1); }
  // Find the FIRST occurrence (there might be multiple return json for models)
  // We want the one in /api/models handler
}

// Find the specific return in /api/models context
const modelsHandler = code.indexOf("if (method === 'GET' && reqPath === '/api/models')");
if (modelsHandler === -1) { console.log('MODELS HANDLER NOT FOUND'); process.exit(1); }

// Find the return json after the models handler
const returnPos = code.indexOf("return json(res, 200, { models: models, count: models.length });", modelsHandler);
if (returnPos === -1) { console.log('RETURN NOT FOUND'); process.exit(1); }

const patch = `// Add Anthropic models if API key is configured
      var anthropicKey = (refs.config.anthropic && refs.config.anthropic.apiKey) ||
                         (refs.config.fallback && refs.config.fallback.directApi && refs.config.fallback.directApi.apiKey) ||
                         process.env.ANTHROPIC_API_KEY;
      if (anthropicKey && anthropicKey.length > 10) {
        var aModels = ['claude-opus-4-20250514','claude-sonnet-4-20250514','claude-haiku-3-20240307'];
        for (var ami = 0; ami < aModels.length; ami++) {
          if (!existingNames[aModels[ami]]) {
            models.push({ name: aModels[ami], source: 'anthropic', configured: true });
            existingNames[aModels[ami]] = true;
          }
        }
      }
      // Add models from config.models
      if (refs.config.models) {
        var cfgModelKeys = Object.keys(refs.config.models);
        for (var mki = 0; mki < cfgModelKeys.length; mki++) {
          var mval = refs.config.models[cfgModelKeys[mki]];
          if (mval && !existingNames[mval]) {
            models.push({ name: mval, source: 'config', configured: true });
            existingNames[mval] = true;
          }
        }
      }
      `;

code = code.slice(0, returnPos) + patch + code.slice(returnPos);
fs.writeFileSync(file, code);
console.log('Patched /api/models to include Anthropic + config models');
