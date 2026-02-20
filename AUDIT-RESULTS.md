# ARIES Admin Dashboard — Full Audit Results
**Date:** 2026-02-19  
**Auditor:** JDW (AI Assistant)

---

## 1. BUGS FOUND

### CRITICAL

| # | File | Description |
|---|------|-------------|
| 1 | `core/swarm-miner-client.js` ~L141 | **SIGSTOP/SIGCONT on Windows** — Throttle monitor uses `SIGSTOP`/`SIGCONT` to pause/resume the miner process, but Windows doesn't support these signals. On Windows this silently fails, meaning the miner **never actually pauses** when CPU is high or on battery. |
| 2 | `core/swarm-miner-client.js` ~L45 | **Stop doesn't force-kill on Windows** — `process.kill(pid)` sends SIGTERM on all platforms, but xmrig on Windows may not respond to SIGTERM. The process can become orphaned. |
| 3 | `core/swarm-join.js` ~L127 | **Race condition in startMining()** — If called when `_minerClient` exists but isn't running, creates a new `SwarmMinerClient` without removing listeners from the old one, causing duplicate event emissions and potential memory leaks. |

### HIGH

| # | File | Description |
|---|------|-------------|
| 4 | `web/app.js` ~L248 | **Dashboard home calls wrong API path** — Calls `api('GET', 'chat/history')` but the actual endpoint is `/api/history`. Returns 404, silently caught but dashboard shows 0 messages. |
| 5 | `web/app.js` ~L5473-5479 | **Worker refresh timer leaks on panel switch** — `hookSwarmPanelRefresh()` starts a 15s interval for `refreshWorkerDashboard()` but `switchPanel()` didn't clear `_workerRefreshTimer` when switching away from swarm panel. Causes unnecessary API calls forever. |
| 6 | `core/swarm-task-worker.js` ~L8 | **Hardcoded relay URL** — `RELAY_URL` is hardcoded to `http://45.76.232.5:9700` instead of reading from config. If the relay changes, this file needs manual editing. |
| 7 | `core/swarm-join.js` ~L147-165 | **stopMining() relay broadcast is fire-and-forget with no logging** — If all relay broadcasts fail, the remote workers keep mining indefinitely. No error reporting, no retry, no notification to the user. |
| 8 | `web/app.js` (exportChat) | **exportChat() calls non-existent endpoint** — Calls `api('GET', 'chat/export')` which doesn't exist in api-server.js. Falls through to the catch block which does a DOM-scraping fallback, so it "works" but the primary path always fails. |

### MEDIUM

| # | File | Description |
|---|------|-------------|
| 9 | `core/swarm-miner-client.js` ~L120 | **parseLine called on partial buffers** — stdout/stderr `data` events don't guarantee line boundaries. A hashrate line could be split across two chunks, causing regex misses. Should buffer and split by newlines. |
| 10 | `core/swarm-worker-setup.js` ~L142 | **Model check is too loose** — `models.some(m => m.startsWith(this._model.split(':')[0]))` would match `qwen2.5:3b` when looking for `qwen2.5:1.5b`, potentially skipping the pull of the correct model size. |
| 11 | `core/swarm-join.js` ~L171-183 | **autoReconnect() starts miner unconditionally** — When auto-reconnecting, always starts the miner without checking if the user had intentionally stopped it. Should persist miner state preference. |
| 12 | `core/api-server.js` ~L5280 | **`_minerState` initialized on every request** — The line `if (!_refs._minerState) _refs._minerState = { ... }` runs on EVERY request that reaches the miner section, not just miner endpoints. Minor perf hit. |
| 13 | `web/app.js` (swarm-update WS handler) | **Frontend doesn't handle `swarm-update` or `swarm-stats` WS events** — Backend sends `type: 'swarm-update'` and `type: 'swarm-stats'` via WS in the worker tracker, but `handleWSMessage()` doesn't have handlers for these types. New workers joining won't show up in real-time. |
| 14 | `core/swarm-miner-client.js` ~L86 | **WMIC deprecated on Windows 11** — Uses `wmic path win32_videocontroller` and `WMIC Path Win32_Battery` which are deprecated/removed on newer Windows. Should use PowerShell `Get-CimInstance`. |
| 15 | `core/swarm-join.js` ~L52 | **_loadConfig() silent failure** — If config.json is malformed, `this._config = {}` silently replaces it. On next `_saveConfig()`, the entire config is overwritten with just swarm data, losing all other settings. |

### LOW

| # | File | Description |
|---|------|-------------|
| 16 | `web/index.html` sidebar | **Version mismatch** — Title says "ARIES v7.0", sidebar footer says "v5.0". |
| 17 | `core/swarm-miner-client.js` | **Hardcoded pool/wallet/referral** — `POOL`, `COIN`, `WALLET`, `REFERRAL` are hardcoded constants. Should come from config for swarm-join flow (they do for the admin /api/miner/start flow, but the SwarmMinerClient used by swarm-join doesn't read from config). |
| 18 | `core/swarm-task-worker.js` | **No graceful shutdown** — `stop()` just clears the poll timer but doesn't wait for active tasks to complete. Can leave orphaned task results that never get reported back. |
| 19 | `web/app.js` ~L132 | **WS miner handler only updates hashrate** — The `miner` WS event handler only updates `minerHashVal` element but doesn't update worker cards, daily earnings, or other stats. |
| 20 | `core/api-server.js` ~L5342 | **Local xmrig polling in /api/miner/status** — Every status request makes an HTTP call to `127.0.0.1:18088`. If xmrig isn't running, this adds 2s timeout to every status API call. Should be cached. |

---

## 2. BUGS FIXED

### Fix 1: SIGSTOP/SIGCONT on Windows (Critical)
**File:** `core/swarm-miner-client.js`  
**Change:** Replaced raw `SIGSTOP`/`SIGCONT` with platform-aware throttling. On Windows, uses `wmic` to change process priority to idle/below-normal instead of suspending. On Unix, keeps existing SIGSTOP/SIGCONT behavior.

### Fix 2: Force-kill on Windows (Critical)
**File:** `core/swarm-miner-client.js`  
**Change:** `stop()` now uses `taskkill /PID /F /T` on Windows to force-kill the xmrig process tree instead of just sending SIGTERM. Also resets hashrate to 0 on stop.

### Fix 3: Race condition in startMining() (Critical)
**File:** `core/swarm-join.js`  
**Change:** Added `removeAllListeners()` cleanup on existing `_minerClient` before creating a new one. Also wrapped `getStats()` in try-catch to avoid crash if the client is in a bad state.

### Fix 4: Dashboard home wrong API path (High)
**File:** `web/app.js`  
**Change:** Changed `api('GET', 'chat/history')` to `api('GET', 'history')` to match the actual endpoint.

### Fix 5: Worker refresh timer leak (High)
**File:** `web/app.js`  
**Change:** Added `_workerRefreshTimer` cleanup in `switchPanel()` so the interval is cleared when navigating away from any panel.

### Fix 6: Hardcoded relay URL (High)
**File:** `core/swarm-task-worker.js`  
**Change:** Renamed `RELAY_URL` to `DEFAULT_RELAY_URL`, added `opts.relayUrl` constructor parameter, and updated all relay references to use `this._relayUrl`. Also updated `swarm-join.js` to pass relay URL when constructing task workers.

### Fix 7: stopMining() relay broadcast fire-and-forget with no logging (High)
**File:** `core/swarm-join.js`  
**Change:** Added error logging to relay broadcast `req.on('error')` and `catch` blocks so failed broadcasts are visible in logs.

### Fix 8: exportChat() calls non-existent endpoint (High)
**File:** `web/app.js`  
**Change:** Changed `api('GET', 'chat/export')` to `api('GET', 'history')` which exists. Updated success handler to build markdown from the history response's messages array.

### Fix 9: parseLine called on partial buffers (Medium)
**File:** `core/swarm-miner-client.js`  
**Change:** Added line buffering for stdout and stderr. Data chunks are accumulated and split by `\n`, with incomplete trailing data kept in buffer for next chunk.

### Fix 10: Model check too loose (Medium)
**File:** `core/swarm-worker-setup.js`  
**Change:** Changed `m.startsWith(this._model.split(':')[0])` to exact match `m === this._model.split(':')[0]` so `qwen2.5:3b` won't falsely match when looking for `qwen2.5:1.5b`.

### Fix 11: autoReconnect() starts miner unconditionally (Medium)
**File:** `core/swarm-join.js`  
**Change:** Added `miningEnabled` flag persisted in config. `startMining()` sets it to `true`, `stopMining()` sets it to `false`. `autoReconnect()` now checks `this._config.swarm.miningEnabled !== false` before starting the miner.

### Fix 12: _minerState initialized on every request (Medium)
**File:** `core/api-server.js`  
**Change:** Added `reqPath.startsWith('/api/miner')` guard so `_minerState` initialization only runs for miner endpoints.

### Fix 13: Frontend doesn't handle swarm-update/swarm-stats WS events (Medium)
**File:** `web/app.js`  
**Change:** Added handler in `handleWSMessage()` for `swarm-update` and `swarm-stats` events that triggers `refreshWorkerDashboard()` when on the swarm panel.

### Fix 14: WMIC deprecated on Windows 11 (Medium)
**Files:** `core/swarm-miner-client.js`, `core/swarm-join.js`  
**Change:** Replaced all `wmic` calls with PowerShell `Get-CimInstance` equivalents: `Win32_Battery` for battery check, `Win32_Process.SetPriority` for priority changes, `Win32_VideoController` for GPU detection.

### Fix 15: _loadConfig() silent failure (Medium)
**File:** `core/swarm-join.js`  
**Change:** Differentiated between ENOENT (file missing, use empty config) and parse errors (set `_configCorrupt` flag). `_saveConfig()` now refuses to write if the original config was corrupt, preventing data loss.

### Fix 16: Version mismatch (Low)
**Files:** `web/index.html`, `web/app.js`  
**Change:** Updated sidebar footer from `v5.0` to `v7.0`. Updated app.js header comment, boot sequence text, and welcome message from `v5.0` to `v7.0` to match the title/topbar.

### Fix 17: Hardcoded pool/wallet/referral (Low)
**File:** `core/swarm-miner-client.js`  
**Change:** Added `opts.pool`, `opts.coin`, `opts.wallet`, `opts.referral` constructor parameters that fall back to the existing constants. `_startMiner()` now uses instance properties instead of module constants.

### Fix 18: No graceful shutdown in task worker (Low)
**File:** `core/swarm-task-worker.js`  
**Change:** `stop()` now waits for active tasks to drain (polling every 500ms) before emitting `stopped`, with a 30s forced timeout.

### Fix 19: WS miner handler only updates hashrate (Low)
**File:** `web/app.js`  
**Change:** Expanded the `miner` WS event handler to also update `minerAccepted`, `minerRejected`, and `minerUptime` DOM elements when data is present.

### Fix 20: Local xmrig polling in /api/miner/status (Low)
**File:** `core/api-server.js`  
**Change:** Added `_refs._xmrigCache` with 3-second TTL. The xmrig local API poll now checks cache first, avoiding the 2s timeout on every request when xmrig is offline.

---

## 3. IMPROVEMENT IDEAS (Ranked by Impact)

### 🔴 High Impact

1. **Handle `swarm-update` and `swarm-stats` WebSocket events in frontend** — Add handlers in `handleWSMessage()` to update the swarm panel in real-time when workers join/leave. Currently requires manual refresh.

2. **Buffer xmrig stdout for line-complete parsing** — Replace direct `data` event regex with a line buffer to prevent split-line hashrate misses.

3. **Cache xmrig local API polling** — In `/api/miner/status`, cache the local xmrig API response for 3-5s instead of polling on every request. This would eliminate the 2s timeout delay when xmrig is offline.

4. **Read relay URL from config in swarm-task-worker.js** — Pass relay URL through constructor options instead of hardcoding.

5. **Add miner state persistence** — Save mining on/off preference to config so `autoReconnect()` doesn't unconditionally restart mining.

6. **Profit tracking with actual wallet balance** — The profit dashboard shows estimates only. Add Solana RPC call to `getBalance()` for the configured wallet to show real SOL balance.

### 🟡 Medium Impact

7. **Live hashrate graphs with WebSocket push** — Backend already sends `miner` WS events. Frontend should use these to update the hashrate chart in real-time instead of polling every 5s.

8. **Worker kick/restart from admin UI** — Add buttons per-worker in the SOL Miner dashboard to restart or remove individual workers.

9. **Mining pool switching from UI** — The pool list endpoint exists (`/api/miner/pools`) but there's no UI dropdown to switch pools. Add a pool selector to the miner config section.

10. **Alert system for mining** — `/api/miner/alerts` endpoint exists but no UI renders the alerts. Add a notification badge/panel showing: worker offline, hashrate dropped, pool disconnected.

11. **Better error messages for miner start failures** — When xmrig binary isn't found, show a clear message with download link instead of silent "no-xmrig" status.

12. **Rate limiting on sensitive endpoints** — `/api/shutdown`, `/api/swarm/destruct`, `/api/miner/start|stop` should have stricter rate limiting or confirmation tokens.

### 🟢 Nice to Have

13. **Mobile responsive improvements** — The dashboard works on mobile but the miner stats bar and worker grid overflow. Add responsive breakpoints.

14. **Dark mode theme polish** — The `blood-red` and `neon-purple` themes have some contrast issues on stat cards.

15. **Worker specs display** — The backend tracks worker specs (CPU, RAM, GPU) via the relay but the miner dashboard only shows hostname and hashrate. Show full specs.

16. **Mining session history** — Track start/stop times, hashrate averages, and earnings per session in a log.

17. **Auto-download xmrig from admin UI** — If xmrig isn't found, show a "Download" button that triggers the `SwarmMinerClient._ensureXmrig()` flow.

18. **Graceful task worker shutdown** — Wait for active tasks to complete before stopping the task worker.

19. **Replace WMIC with PowerShell** — Use `Get-CimInstance Win32_VideoController` and `Get-CimInstance Win32_Battery` instead of deprecated `wmic` commands.

20. **Unified version number** — HTML title says v7.0, sidebar says v5.0, API returns bootVersion. Consolidate to one source of truth.
