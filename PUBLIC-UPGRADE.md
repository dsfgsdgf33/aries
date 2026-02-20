# PUBLIC-UPGRADE.md — Aries Public Version Upgrade Summary

## Date: 2026-02-19

## TASK 1: Bug Fixes

### Critical Bug: SwarmJoin routes not registered
- **Problem**: `core/swarm-join.js` defines routes for `/api/swarm/join`, `/api/swarm/leave`, `/api/swarm/worker/*`, `/api/swarm/mining/*` but they were **never registered** in the API server or headless.js
- **Impact**: The "Join Swarm" and "Leave Swarm" buttons in the web dashboard were completely broken — 404 errors
- **Fix**: 
  - Added `SwarmJoin` import and initialization in `core/headless.js`
  - Added `swarmJoin` to refs object
  - Added all SwarmJoin routes directly in `core/api-server.js` (13 new endpoints)
  - Added routes to `publicPaths` for unauthenticated access

### Bug: `apiFetch` undefined
- **Problem**: Several admin panel functions (loadRemoteWipe, loadSwarmIntel, etc.) call `apiFetch()` which was never defined
- **Fix**: Added `apiFetch` as a fallback wrapper around `fetch()` in `web/app.js`

### Bug: Auto-reconnect on startup
- **Problem**: If a user was enrolled in the swarm, restarting Aries would not reconnect
- **Fix**: Added `swarmJoin.autoReconnect()` call in headless.js when enrollment is detected

## TASK 2: One-Click "Join Aries Network"

### CLI Setup Wizard (`setup-wizard.js`)
- **Quick Join is now Option 1** (default — just press Enter)
- Full automated flow: Ollama install → model pull → relay connect → config write
- Options renumbered: [1] Quick Join, [2] API Key, [3] Ollama, [4] Manual Network

### Web Dashboard (`web/app.js`, `web/index.html`)
- **Full-screen welcome overlay** for first-time users (no config)
- Giant animated "⚡ One-Click: Join Aries Network" button
- Progress bar with WebSocket-driven step updates
- Secondary options (API Key, Local Ollama) shown smaller below
- Network node count pulled from relay ("Join X users in the Aries Network")

### API Endpoint (`core/api-server.js`)
- `POST /api/swarm/quickjoin` — orchestrates full join flow
- Streams progress via WebSocket (`quickjoin-progress` events)
- Steps: ollama-setup → connecting → worker-started → miner-setup → miner-started → done

## TASK 3: Growth Features Implemented

### 1. Landing Page / Welcome Screen
- Full-screen cyberpunk welcome overlay with animated Aries logo
- Three paths: Quick Join (recommended, huge) | API Key | Ollama
- Network user count from relay
- Auto-dismissed after joining

### 2. Network Stats Widget
- Added to swarm panel header: 4-column stats bar
  - Network Nodes | AI Tasks Done | Your Uptime | Invite Friends button
- Auto-refreshes with swarm data
- Visible before joining (creates FOMO)

### 3. Referral System UI
- "Invite Friends" button in network stats bar and welcome screen
- Share panel overlay with:
  - Share on Twitter (pre-written text)
  - Share on Reddit
  - Share on Discord (copies to clipboard)
  - Copy-paste install command
  - Referral stats from `/api/referral/stats`

### 4. Leaderboard
- `GET /api/network/leaderboard` endpoint added (placeholder — data from relay)
- UI framework ready for when relay provides real leaderboard data

### 5. Share Buttons
- Twitter, Reddit, Discord share with pre-written messages
- Copy install command: `git clone https://github.com/dsfgsdgf33/aries && cd aries && node install.js`
- Available from welcome screen + invite panel

### 6. Auto-Update Notification
- `checkAutoUpdate()` runs on dashboard init
- Checks GitHub releases API for latest version
- Shows persistent banner at top: "🚀 Aries vX.X available! Update now"
- Dismissible with X button

## Files Modified
- `core/headless.js` — SwarmJoin init + refs
- `core/api-server.js` — 13 new SwarmJoin routes + quickjoin + network stats + leaderboard
- `web/app.js` — Welcome screen, quick join UI, share panel, auto-update, apiFetch, network stats
- `web/index.html` — Network stats widget bar in swarm panel
- `setup-wizard.js` — Quick Join as option 1 with full auto-setup flow

## All files pass `node -c` syntax check ✅
