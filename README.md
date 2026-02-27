<div align="center">

# ▲ A R I E S

### Autonomous Runtime Intelligence & Execution System

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/Dependencies-ZERO-00ff41?style=for-the-badge)](/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Tools](https://img.shields.io/badge/Tools-42+-8b5cf6?style=for-the-badge)](/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-00d4ff?style=for-the-badge)](/)

**Self-hosted AI platform. Autonomous agents. Zero dependencies.**

*Your machine. Your models. Your data. No exceptions.*

[Get Started](#-quick-start) · [Aries Code](#-aries-code) · [Hands](#-hands--autonomous-agents) · [Features](#-feature-overview) · [Swarm](#-swarm-network)

---

</div>

## What is Aries?

Aries is a self-hosted AI platform built entirely on Node.js built-ins — **zero npm dependencies**. It ships with a cyberpunk web dashboard, 42+ integrated tools, multi-provider model support (including Google Gemini), and a full autonomous agent system.

**Aries Code** plans, builds, tests, and fixes entire applications. **Hands** are autonomous agents that research, monitor, collect intel, and execute tasks on schedules. **Pipelines** chain agents together. And the whole thing learns from itself through nightly self-reflection.

<br>

## ⚡ Quick Start

```bash
git clone https://github.com/dsfgsdgf33/aries
cd aries
node launcher.js
```

Open **http://localhost:3333** → Log in → Start building.

No `npm install`. No Docker. No config files required. **One command.**

<br>

## 🤖 Aries Code

Aries Code is a **fully autonomous coding agent** — not a copilot, not a suggestion engine. It builds complete applications from a single prompt.

```
 You: "Build a REST API with auth and a React dashboard"

 Aries Code:
   ① Plan        → Analyzes requirements, designs architecture
   ② Scaffold    → Generates project structure and boilerplate
   ③ Implement   → Writes all source files
   ④ Fix         → Runs the app, catches errors, auto-patches
   ⑤ Serve       → Launches with hot reload — ready to use
```

### How to use it

| Method | Command | Best for |
|--------|---------|----------|
| **CLI** | `aries-code "build a chat app with WebSockets"` | Quick tasks from terminal |
| **Dashboard** | Visual UI at `localhost:3333` | Live output, file trees, phase tracking |
| **Swarm Mode** | 5-agent parallel build | Complex multi-service projects |

### Multi-Agent Swarm Build

For large projects, Aries Code deploys a **5-role agent swarm** that works in parallel:

```
  Architect → designs the system
       ↓
  Coders (parallel) → write all modules simultaneously
       ↓
  Reviewer → checks code quality and consistency
       ↓
  Tester → runs the application, identifies failures
       ↓
  Fixer → patches bugs, re-runs tests
       ↻ up to 20 iterations until everything passes
```

<br>

## 🤚 Hands — Autonomous Agents

Hands are persistent, autonomous agents that operate independently on schedules or triggers. Each Hand has its own AI model, tools, and purpose.

### 7 Built-in Hands

| Hand | Purpose | Tools |
|------|---------|-------|
| 🔬 **Researcher** | Deep research with cited reports, 3+ sources per claim | web, websearch, write, read |
| 🎯 **Lead Generator** | Autonomous lead prospecting and outreach | websearch, web, write |
| 🕵️ **Collector / OSINT** | Open-source intelligence gathering | websearch, web, write, shell |
| 📊 **Predictor** | Data analysis and trend prediction | websearch, web, write, shell |
| 🐦 **Social / Twitter** | Social media monitoring and engagement | websearch, web, write |
| 📰 **News Monitor** | Real-time news tracking and alerts | websearch, web, write |
| 🔍 **Code Auditor** | Security and quality code review | read, write, shell |

### Clone & Customize

One-click clone any Hand with different settings:

```
POST /api/hands/researcher/clone
{ "overrides": { "name": "Crypto Researcher", "settings": { "topic": "DeFi" } } }
```

Bulk clone for parallel intelligence: _"Make 3 researchers watching different sectors"_

<br>

## 🔗 Scheduled Pipelines

Chain Hands together into multi-step automated workflows:

```
Research → Summarize → Alert
   ↓          ↓          ↓
  Hand 1    Hand 2    Telegram
```

- Sequential execution — output of step N feeds into step N+1
- Conditional branching — skip/route based on previous output
- Cron scheduling or manual triggers
- Full run history and pause/resume

<br>

## 🧠 Intelligence Engine

### Self-Reflection
Every night, Aries reviews its own day: what worked, what failed, what patterns emerged. Reflections compound into insights that make it genuinely smarter over time.

### Context Injection
Before any AI call, automatically enriches the prompt with relevant memories, knowledge graph entities, and accumulated insights. TF-IDF relevance scoring ensures only useful context gets injected.

### Knowledge Graph
Persistent entity-relationship graph. Add nodes (people, projects, tools, concepts), connect them with typed edges, traverse relationships, auto-extract entities from conversations.

### Memory DB
JSON-backed memory store with TF-IDF search. Stores memories, conversations, entities — all searchable with relevance scoring.

<br>

## ⚔️ Multi-Model Arena

Send the same prompt to multiple AI models simultaneously. Compare responses side-by-side with auto-scoring on length, coherence, and speed. Track model win rates over time.

```
POST /api/arena/run
{ "prompt": "Explain quantum computing", "models": ["gpt-4", "claude-3", "gemini-pro"] }
```

- Auto-scoring with leaderboard
- Human vote override
- Per-category tracking (coding, creative, analysis)

<br>

## 🎙️ Voice Mode

Talk to Aries through the dashboard. Whisper STT + OpenAI TTS.

- 6 voice options: alloy, echo, fable, onyx, nova, shimmer
- Adjustable speed (0.25x–4.0x)
- Conversation state management (listening → processing → speaking)
- Audio files saved to `data/voice/`

<br>

## 🔌 Plugin System

Drop `.js` files in `plugins/` — auto-loaded on boot with hot-reload:

```javascript
// plugins/my-plugin.js
module.exports = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'Does cool stuff',
  init(api) {
    api.registerTool('myTool', handler);
    api.onEvent('chat', listener);
  },
  destroy() { /* cleanup */ }
};
```

Plugins get a sandboxed API: `registerHand`, `registerTool`, `registerRoute`, `onEvent`, `log`, `config`.

<br>

## 🛡️ Security

### MCP Protocol Server
Full JSON-RPC 2.0 Model Context Protocol implementation. Works with any MCP-compatible client.

### Prompt Injection Scanner
Real-time detection of prompt injection attacks. Configurable sensitivity, threat scoring, automatic sanitization.

### Merkle Audit Trail
Hash-chain audit log. Every action cryptographically linked to the previous one. Tamper-evident, verifiable, exportable.

<br>

## 🎨 Dashboard

Cyberpunk web UI at `localhost:3333` with:

- **Command Palette** (`Ctrl+K`) — fuzzy search across everything
- **4 Themes** — Cyberpunk, Matrix (green), Blade Runner (amber), Clean (light)
- **Live Agent Feed** — real-time WebSocket activity stream
- **Memory Timeline** — visual history of all Aries activity, color-coded
- **PWA Support** — installable on mobile and desktop
- **Subagent Management** — create, edit models, monitor tasks
- **AriesCode Panel** — live phase tracking, file trees, output streaming

<br>

## 🌐 Swarm Network

P2P distributed compute network. Connect machines into a swarm for pooled AI processing.

| Your Hardware | What It Does | What You Earn |
|---------------|-------------|---------------|
| **GPU machine** | Runs LLM inference + distributed training | Swarm tokens → free AI access |
| **CPU machine** | Handles lighter AI workloads | Swarm tokens → free AI access |
| **Low-end PC** | Mines crypto (automatic fallback) | Crypto → API credits |

```bash
node launcher.js → Dashboard → Swarm tab → Click "Join"
```

<br>

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       ARIES PLATFORM                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  launcher.js ──▶ API Server (HTTP/WS :3333)                  │
│                        │                                     │
│         ┌──────────────┼──────────────┐                      │
│         │              │              │                      │
│     AI Core       42+ Tools      Aries Code                  │
│     (ai.js)      (tools.js)    (phase-engine)                │
│         │                          │                         │
│    AI Gateway ◀────────────────────┘                         │
│    (multi-provider routing + fallback)                       │
│         │                                                    │
│    Ollama · OpenAI · Anthropic · Google Gemini · Groq · Any  │
│                                                              │
│    ┌─────────┐  ┌──────────┐  ┌────────────┐                │
│    │  Hands  │  │Pipelines │  │   Plugins  │                │
│    │ (7 agents) │(chained) │  │ (drop-in)  │                │
│    └─────────┘  └──────────┘  └────────────┘                │
│                                                              │
│    ┌─────────┐  ┌──────────┐  ┌────────────┐                │
│    │  Arena  │  │Reflection│  │ Knowledge  │                │
│    │(compare)│  │ (learns) │  │   Graph    │                │
│    └─────────┘  └──────────┘  └────────────┘                │
│                                                              │
│    Swarm Network (P2P) — distributed compute + mining        │
└──────────────────────────────────────────────────────────────┘
```

### Core Files

| File | Purpose |
|------|---------|
| `launcher.js` | Entry point — boots everything |
| `core/api-server.js` | HTTP/WS server, routing, auth, all REST endpoints |
| `core/ai.js` | LLM interaction engine with multi-provider routing |
| `core/ai-gateway.js` | Provider fallback chain (Ollama → OpenAI → Anthropic → etc.) |
| `core/gemini-provider.js` | Google Gemini integration (live model fetching) |
| `core/aries-code.js` | Autonomous coding agent (20-iteration loop) |
| `core/aries-code-swarm.js` | Multi-agent parallel coding |
| `core/phase-engine.js` | 5-phase app generation pipeline |
| `core/tools.js` | 42+ built-in tools |
| `core/hands.js` | Autonomous agent framework (7 built-in agents) |
| `core/scheduled-pipelines.js` | Pipeline engine with cron scheduling |
| `core/self-reflection.js` | Nightly self-review and insight accumulation |
| `core/context-injection.js` | Auto-enrich prompts with relevant context |
| `core/knowledge-graph.js` | Entity-relationship graph with search |
| `core/sqlite-memory.js` | JSON-backed memory store with TF-IDF search |
| `core/model-arena.js` | Multi-model comparison with leaderboard |
| `core/voice-mode.js` | STT (Whisper) + TTS (OpenAI) |
| `core/plugin-sandbox.js` | Drop-in plugin system with hot-reload |
| `core/agent-cloning.js` | Clone Hands with lineage tracking |
| `core/mcp-server.js` | MCP JSON-RPC 2.0 protocol server |
| `core/prompt-guard.js` | Prompt injection detection and sanitization |
| `core/audit-trail.js` | Merkle hash-chain audit log |
| `core/agent-analytics.js` | Performance tracking and cost forecasting |
| `core/agent-marketplace.js` | Import/export agent packages |
| `core/migration-engine.js` | Import data from other AI frameworks |
| `core/feature-routes.js` | WebSocket server, new feature REST routes, PWA |
| `core/subagents.js` | Multi-agent task execution with model selection |
| `core/workflow-engine.js` | Event-driven workflow automation |
| `core/desktop-launcher.js` | Desktop app launcher (Windows/Mac/Linux) |
| `core/auth.js` | Authentication & role-based access control |
| `core/swarm.js` | P2P swarm network |
| `web/` | Cyberpunk dashboard frontend |
| `web/features.js` | Command palette, themes, live feed, timeline, PWA |

<br>

## 🎯 Feature Overview

### Platform
- **Zero npm dependencies** — entire platform runs on Node.js built-ins
- **42+ built-in tools** — file ops, shell, web search, browser, git, crypto, TTS, and more
- **Multi-provider AI** — Ollama, OpenAI, Anthropic, Google Gemini, Groq, OpenRouter, or any OpenAI-compatible API
- **MCP compatible** — full JSON-RPC 2.0 protocol server
- **PWA installable** — runs as a native app on mobile and desktop
- **Authentication** — login system with role-based access control
- **Self-healing** — automatic error detection and recovery
- **WebSocket** — real-time streaming via raw RFC 6455 implementation

### Autonomous Agents
- **7 built-in Hands** — Researcher, Lead Gen, OSINT, Predictor, Social, News, Code Auditor
- **Agent cloning** — duplicate any Hand with different settings, lineage tracking
- **Scheduled pipelines** — chain agents into multi-step automated workflows
- **Subagent system** — spawn tasks with per-agent model selection
- **Agent marketplace** — import/export agent packages as JSON

### Intelligence
- **Self-reflection** — nightly review, insight accumulation, learning over time
- **Context injection** — auto-enrich prompts with relevant memories and entities
- **Knowledge graph** — persistent entity-relationship graph with traversal
- **Memory DB** — TF-IDF searchable memory store with categories
- **Multi-model arena** — compare models side-by-side with leaderboard

### Coding
- **Aries Code** — autonomous 20-iteration coding loop
- **5-phase generation** — Plan → Scaffold → Implement → Fix → Serve
- **Multi-agent swarm build** — 5 roles working in parallel
- **CLI + Dashboard + API** — use it however you prefer

### Security
- **Prompt injection scanner** — real-time detection with configurable sensitivity
- **Merkle audit trail** — cryptographic hash-chain logging
- **Plugin sandboxing** — isolated API surface for third-party plugins

### Dashboard
- **Command palette** (Ctrl+K) — fuzzy search across everything
- **4 themes** — Cyberpunk, Matrix, Blade Runner, Clean
- **Live agent feed** — real-time WebSocket activity stream
- **Memory timeline** — visual chronological history
- **Voice mode** — STT + TTS interaction

### Swarm
- **P2P distributed compute** — pool machines for AI workloads
- **Automatic crypto mining fallback** — low-end PCs earn credits
- **Health monitoring** — real-time node status and performance
- **Task scheduling** — intelligent workload distribution

<br>

## 📡 API Reference

### Chat & AI
```
POST /api/chat                    # Chat with AI
POST /api/aries-code              # Start autonomous coding task
GET  /api/aries-code/status       # Check task progress
GET  /api/models                  # List all available models (incl. Gemini)
```

### Hands & Agents
```
GET  /api/hands                   # List all Hands
GET  /api/hands/:id               # Get Hand details
POST /api/hands/:id/activate      # Activate a Hand
POST /api/hands/:id/pause         # Pause a Hand
POST /api/hands/:id/run           # Run a Hand now
POST /api/hands/:id/clone         # Clone with overrides
POST /api/hands/:id/clone-multiple # Bulk clone
GET  /api/hands/:id/lineage       # Clone family tree
```

### Pipelines
```
GET  /api/pipelines               # List all pipelines
POST /api/pipelines               # Create pipeline
GET  /api/pipelines/:id           # Get pipeline details
POST /api/pipelines/:id/run       # Trigger pipeline
GET  /api/pipelines/:id/history   # Run history
```

### Intelligence
```
GET  /api/analytics/report        # Performance analytics
GET  /api/analytics/models        # Model comparison stats
GET  /api/analytics/suggestions   # Optimization suggestions
POST /api/reflection/trigger      # Trigger self-reflection now
GET  /api/reflection/insights     # Accumulated insights
GET  /api/knowledge/export        # Export knowledge graph
POST /api/knowledge/entity        # Add entity to graph
POST /api/knowledge/relation      # Add relationship
GET  /api/memory/db/search?q=     # Search memory DB
POST /api/memory/db/add           # Add memory
```

### Arena & Voice
```
POST /api/arena/run               # Start model comparison
GET  /api/arena/leaderboard       # Model rankings
GET  /api/arena/history           # Past comparisons
POST /api/voice/speak             # Text-to-speech
POST /api/voice/transcribe        # Speech-to-text
GET  /api/voice/config            # Voice settings
```

### Security & System
```
POST /api/security/scan           # Scan for prompt injection
GET  /api/audit/verify            # Verify audit trail integrity
GET  /api/plugins                 # List installed plugins
GET  /api/activity                # Real-time activity feed
GET  /api/swarm/status            # Swarm network status
GET  /api/system/stats            # System health
WS   ws://localhost:3333/ws       # WebSocket streaming
```

<br>

## ⚙️ Configuration

Aries works out of the box with Ollama. Add cloud providers through the dashboard or `config.json`:

```json
{
  "providers": {
    "ollama": { "url": "http://localhost:11434" },
    "openai": { "apiKey": "sk-..." },
    "anthropic": { "apiKey": "sk-ant-..." },
    "google": { "apiKey": "AIza..." }
  },
  "defaultProvider": "ollama",
  "defaultModel": "llama3.1"
}
```

### Recommended Models

| Model | Provider | Best For |
|-------|----------|----------|
| `gemini-2.5-flash` | Google | Fast, cheap, great at tool use |
| `claude-sonnet-4-20250514` | Anthropic | Strong reasoning + coding |
| `gpt-4o` | OpenAI | Balanced quality + speed |
| `qwen2.5-coder:32b` | Ollama (local) | Offline code generation |
| `llama3.1:70b` | Ollama (local) | Complex architecture & reasoning |

<br>

## ❓ FAQ

**Do I need to install anything besides Node.js?**
No. Zero dependencies. `git clone` → `node launcher.js` → done.

**Can I use it fully offline?**
Yes — with Ollama running locally, Aries is 100% offline capable.

**Is my data sent anywhere?**
Never. Everything runs on your machine. No telemetry, no analytics, no phone-home.

**How many AI providers does it support?**
Ollama, OpenAI, Anthropic, Google Gemini, Groq, OpenRouter, and any OpenAI-compatible API. Models are auto-discovered.

**What's different from other AI platforms?**
Zero dependencies, self-hosted, autonomous agents (Hands), self-reflection that actually learns, plugin system, multi-model arena, and a P2P swarm network. All in one binary-like package.

<br>

## 🤝 Contributing

```bash
git clone https://github.com/dsfgsdgf33/aries
cd aries
git checkout -b feature/your-feature
# Make your changes
git commit -m "Add your feature"
git push origin feature/your-feature
# Open a PR
```

Or just drop a plugin in `plugins/` — the sandbox system makes extending Aries trivial.

<br>

## 🔭 Vision

Aries has a longer-term vision around community-powered distributed AI and a compute-for-AI economy. See **[VISION.md](VISION.md)** for the full picture.

<br>

## License

[MIT](LICENSE) — Use it however you want.

---

<div align="center">

**Built with ❤️ and zero dependencies**

*Aries — Self-hosted AI that respects your machine, your data, and your time.*

</div>
