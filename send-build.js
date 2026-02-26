const http = require('http');
const task = `BUILD THIS PROJECT COMPLETELY. Write ONE file per tool call. Do not stop until pnpm dev compiles clean.

Project: Permian AAS Studio — Digital Twin Platform for Permian Basin oil & gas
Location: D:\\aries-workspace\\permian-aas-studio\\

FIRST: Delete D:\\aries-workspace\\permian-aas-studio-2 and D:\\aries-workspace\\permian-aas-studio-3 (broken old attempts).

ShaleXP credentials: api2020@icloud.com / YhXi32WK$xzj@is
Admin login: username=Admin, password=Admin

=== PHASE 1: PROJECT SETUP ===
Step 1: shell — cd D:\\aries-workspace && npx create-next-app@latest permian-aas-studio --typescript --tailwind --app --use-pnpm --no-eslint --no-src-dir --yes
Step 2: shell — cd D:\\aries-workspace\\permian-aas-studio && pnpm add openai recharts axios papaparse leaflet react-leaflet && pnpm add -D @types/papaparse @types/leaflet
Step 3: write .env.local

=== PHASE 2: CORE LIBRARIES (one file per write call) ===
Step 4: write lib/rrc/types.ts — ALL interfaces verbatim:
  MonthlyWellProduction { period, oilBbl, gasMcf, waterBbl, condensateBbl?, casingheadMcf?, daysProduced }
  WellProductionRecord { apiNumber, wellName, wellNumber?, leaseNumber?, leaseName?, operator, county, district?, field?, formation?, wellType?, status?, latitude?, longitude?, spudDate?, completionDate?, firstProdDate?, source, production[] }
  ReservoirProperties { targetZone, tvdFt, mdFt, porosity, permeabilityMd, payThicknessFt, initialPressurePsi, reservoirTempF, saturationType, groundElevationFt, kbElevationFt }
  CompletionData { lateralLengthFt, proppantLbs, fluidGallons, stageCount, perfIntervalTopFt, perfIntervalBottomFt, completionType, direction }
  SpacingData { section, township, range, abstract, surveyName, wellSpacingFt, nearestOffsetApiNumber, nearestOffsetDistanceFt }
  EconomicsData { estimatedDCCostUsd, monthlyLoeUsd, loePerBoe, royaltyBurden, nri, oilPriceUsd, gasPriceUsd, breakevenOilBopd }
  UnifiedWellRecord extends WellProductionRecord { reservoir, completion, spacing, economics }
Step 5: write lib/cache.ts — In-memory TTL cache (Map + setTimeout)
Step 6: write lib/utils.ts — byteSize helper, etc
Step 7: write lib/economics/permian-defaults.ts — WTI $72, HH $2.75, NGL $28, D&C costs, LOE $9.50/BOE, Royalty 20%, NRI 80%, severance, county classification (Midland vs Delaware)
Step 8: write lib/rrc/shalexp-scraper.ts — Free profile scrape + premium login with cookie cache 50min TTL + well search + pagination + production history. Axios with 150ms delay, 1s per 50 wells. Operator resolution: h1 -> slug -> first word
Step 9: write lib/rrc/rrc-scraper.ts — RRC EWA with session/CSRF cookies, operator/lease queries districts 7C/08, max 15 leases, 2s delay
Step 10: write lib/rrc/normalize.ts — Normalize + merge by apiNumber. ShaleXP wins metadata, RRC wins overlapping production
Step 11: write lib/decline/engine.ts — Exp/hyp/harm DCA, 20yr forecast, EUR, uncertainty (bootstrap), emissions CH4/CO2 GWP=28

=== PHASE 3: API ROUTES (one file per write call) ===
Step 12: write app/api/data-model/route.ts — POST: query sources, normalize, merge, return {wells, meta}
Step 13: write app/api/rrc/query/route.ts — POST: ShaleXP scrape+normalize
Step 14: write app/api/rrc/direct/route.ts — POST: RRC EWA query+normalize
Step 15: write app/api/rrc/upload/route.ts — POST: CSV/TSV upload with papaparse
Step 16: write app/api/decline/route.ts — POST: DCA on wells
Step 17: write app/api/data-model/chat/route.ts — POST: NDJSON streaming AI chat. OpenAI SDK with tools: queryWells, aggregateProduction, rankWells, calculateSpacing. Enforce MAX_WELLS=5000, MAX_BYTES=15MB → 413. Stream events: meta, token, tool_call, tool_result, done, error. System prompt: "Permian Basin expert, never guess, use tools."
Step 18: write app/api/auth/route.ts — POST login. In-memory users Map. Admin account hardcoded: Admin/Admin. Returns JWT-like token. GET returns user info from token.

=== PHASE 4: COMPONENTS (one file per write call) ===
Step 19: write components/Chat.tsx — Fetch /api/data-model/chat, parse NDJSON with ReadableStream, collapsible tool traces, 413 red banner
Step 20: write components/WellTable.tsx — DataTable with pagination and search
Step 21: write components/DeclineChart.tsx — Recharts production/decline chart
Step 22: write components/InteractiveMap.tsx — Leaflet map with well markers (lat/lng from UnifiedWellRecord), clickable popups with well info. Dynamic import (no SSR for Leaflet)
Step 23: write components/LoginPage.tsx — Username/password form, calls /api/auth POST, stores token in localStorage
Step 24: write components/AdminPanel.tsx — List users, create new credentials (username/password), delete users. Calls admin API endpoints

=== PHASE 5: PAGES (one file per write call) ===
Step 25: write app/layout.tsx — Sidebar nav, auth guard (check localStorage token, redirect to /login if missing). Admin tab only for admin users
Step 26: write app/page.tsx — Home/dashboard landing
Step 27: write app/login/page.tsx — Login page (no auth guard)
Step 28: write app/data-model/page.tsx — Two-panel: left (source toggles, query form, well table, domain stats, upload, JSON export, interactive map), right (AI chat)
Step 29: write app/operator/[slug]/page.tsx — Tabs: ShaleXP, RRC, Wells table, Decline chart
Step 30: write app/dashboard/page.tsx — Overview dashboard
Step 31: write app/aas-explorer/page.tsx — AAS Explorer
Step 32: write app/submodels/page.tsx — Submodels viewer
Step 33: write app/ingestion/page.tsx — Data ingestion status
Step 34: write app/admin/page.tsx — Admin panel (admin-only, uses AdminPanel component)

=== PHASE 6: VERIFY ===
Step 35: shell — cd D:\\aries-workspace\\permian-aas-studio && pnpm dev (check output for errors)
Step 36: Fix any compilation errors
Step 37: Use done() tool with summary of everything built

REMEMBER: ONE FILE PER TOOL CALL. Start with Step 1 NOW.`;

const body = JSON.stringify({ message: task });
const opts = {
  hostname: '127.0.0.1', port: 3333, path: '/api/chat',
  method: 'POST', timeout: 0,
  headers: { 'Content-Type': 'application/json', 'X-API-Key': 'aries-api-2026', 'Content-Length': Buffer.byteLength(body) }
};

const req = http.request(opts, res => {
  let data = '';
  res.on('data', c => { data += c; process.stdout.write('.'); });
  res.on('end', () => {
    console.log('\nDone! Status:', res.statusCode, 'Length:', data.length);
    try {
      const j = JSON.parse(data);
      console.log('Iterations:', j.iterations);
      console.log('Response:', (j.response || '').slice(-300));
    } catch { console.log('Raw:', data.slice(-300)); }
  });
});
req.on('error', e => console.error('Error:', e.message));
req.write(body);
req.end();
console.log('=== Permian AAS Studio build started ===');
console.log('Native tool calling through OpenClaw gateway');
console.log('Monitoring: check D:\\aries-workspace\\permian-aas-studio\\ for files');
