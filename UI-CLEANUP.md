# Aries UI Cleanup — v8.1

## Summary
Cleaned up the public-facing Aries UI to present a polished AI chat app experience instead of exposing swarm/admin internals.

## Changes Made

### `web/index.html`
- **Sidebar restructured**: Public users see only: 💬 Chat, 📁 Files (RAG), 🤖 Agents, ⚙️ Settings, 🧠 Aries AI (conditional)
- **Admin tabs hidden by default**: All swarm, mining, network, system panels have `data-admin="true"` and are hidden unless admin mode is enabled
- **Topbar cleaned up**: CPU/RAM/Uptime/Workers stats hidden for public users
- **"Swarm" renamed to "Aries Network"** in all user-facing text (join button, leave button, panel header)
- **New Aries AI panel** added — shows contribution stats, tier progression, model growth chart
- **Title updated** from "ARIES v7.0 — Command Center" to "Aries AI"
- **Version bumped** to v8.1

### `web/app.js`
- **Admin mode detection**: Checks `config.adminMode` from API and `localStorage('aries-admin-mode')`. If not admin, all `[data-admin]` elements stay hidden
- **`applyUiMode()`**: Toggles visibility of admin-only UI elements
- **Model dropdown improved**: Groups models by source (Local Ollama, Cloud, Aries Network). Shows "⚡ Aries AI" option if joined network. Shows "Get free AI → Join Aries Network" prompt if not joined
- **Join flow updated**: On successful join, shows Aries AI nav tab and refreshes model dropdown
- **`loadAriesAi()` function**: Full Aries AI tab with tier progression, credits, contribution stats, model growth chart, "You're helping build this" messaging
- **Settings enhanced**: API key configuration (Anthropic, OpenAI, Groq, Google), Ollama model management, Join Aries Network button (if not joined)
- **New exports**: `refreshAriesAi`, `saveApiKeys`, `settingsPullModel`

## How Admin Mode Works
- Backend sets `config.adminMode: true` → full UI visible
- Or user sets `localStorage.setItem('aries-admin-mode', 'true')` → full UI visible  
- Default (no flag): clean public UI with only Chat, Files, Agents, Settings

## What Public Users See
- 💬 Chat (default tab, model dropdown at top)
- 📁 Files (RAG knowledge base)
- 🤖 Agents
- ⚙️ Settings (API keys, Ollama, theme, join network)
- 🧠 Aries AI (only after joining — tier/credits/growth)

## What's Hidden from Public
- Swarm worker dashboard, mining controls
- SOL miner, proxy earnings, content farm
- Network scanner, packet send, WiFi deploy
- All admin panels (terminal, logs, monitor, etc.)
- System stats in topbar
