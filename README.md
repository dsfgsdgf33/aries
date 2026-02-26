<div align="center">

# ▲ A R I E S

### Autonomous Runtime Intelligence & Execution System

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/Dependencies-ZERO-00ff41?style=for-the-badge)](/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)
[![Tools](https://img.shields.io/badge/Tools-42+-8b5cf6?style=for-the-badge)](/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-00d4ff?style=for-the-badge)](/)

**Self-hosted AI platform. Autonomous coding agent. Zero dependencies.**

*Your machine. Your models. Your data. No exceptions.*

[Get Started](#-quick-start) · [Aries Code](#-aries-code) · [Swarm Network](#-swarm-network) · [Vision](#-the-aries-flywheel)

---

</div>

## What is Aries?

Aries is a self-hosted AI platform built entirely on Node.js built-ins — **zero npm dependencies**. It ships with a cyberpunk web dashboard, 42+ integrated tools, multi-provider model support, and **Aries Code**: an autonomous coding agent that plans, builds, tests, and fixes entire applications without human intervention.

It also includes a **P2P swarm network** where machines pool compute for distributed AI — and if your hardware can't run models, it mines crypto instead. Either way, you contribute and earn.

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

The flagship feature. Aries Code is a **fully autonomous coding agent** — not a copilot, not a suggestion engine. It builds complete applications from a single prompt.

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

### Multi-Agent Swarm

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

## 🌐 Swarm Network

Aries includes a **P2P distributed compute network**. Connect machines into a swarm for pooled AI processing — inference, training, and task distribution across nodes.

### How contribution works

| Your Hardware | What It Does | What You Earn |
|---------------|-------------|---------------|
| **GPU machine** | Runs LLM inference + distributed training | Aries tokens → free AI access |
| **CPU machine** | Handles lighter AI workloads | Aries tokens → free AI access |
| **Low-end PC** | Mines crypto instead (automatic fallback) | **Crypto earnings** → still earns API credits |

> **Low-end PC?** No problem. If your machine can't handle LLM workloads, it automatically switches to crypto mining. You still contribute to the ecosystem and earn API credits. Nobody gets left out.

### Join the swarm

```bash
node launcher.js
# → Dashboard → Swarm tab → Click "Join"
# Ollama installs automatically. Mining is opt-in, low-priority.
```

<br>

## 🔄 The Aries Flywheel

This is the core loop that makes the whole system work:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│           ┌──────────────┐                                      │
│           │  You join the │                                      │
│           │    swarm      │                                      │
│           └──────┬───────┘                                      │
│                  ▼                                               │
│      ┌───────────────────────┐     ┌──────────────────────┐     │
│      │  Contribute compute   │────▶│  Model gets smarter  │     │
│      │  (GPU/CPU/mining)     │     │  (distributed train)  │     │
│      └───────────────────────┘     └──────────┬───────────┘     │
│                  ▲                             │                 │
│                  │                             ▼                 │
│      ┌───────────────────────┐     ┌──────────────────────┐     │
│      │  More people join     │◀────│  Better AI for free  │     │
│      │  (word spreads)       │     │  (no subscription)   │     │
│      └───────────────────────┘     └──────────────────────┘     │
│                                                                 │
│   More contributors → smarter model → better AI → more users   │
│                        THE VIRTUOUS CYCLE                       │
└─────────────────────────────────────────────────────────────────┘
```

<br>

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     ARIES PLATFORM                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  launcher.js ──▶ API Server (HTTP/WS :3333)              │
│                        │                                 │
│         ┌──────────────┼──────────────┐                  │
│         │              │              │                  │
│     AI Core       42+ Tools      Aries Code              │
│     (ai.js)      (tools.js)    (phase-engine)            │
│         │                          │                     │
│    AI Gateway ◀────────────────────┘                     │
│    (multi-provider routing + fallback)                   │
│         │                                                │
│    Ollama · OpenAI · Anthropic · OpenRouter · Any        │
│                                                          │
│    Swarm Network (P2P) — distributed compute + mining    │
└──────────────────────────────────────────────────────────┘
```

### Core Files

| File | Purpose |
|------|---------|
| `launcher.js` | Entry point — boots everything |
| `core/api-server.js` | HTTP/WS server, routing, auth |
| `core/ai.js` | LLM interaction engine |
| `core/ai-gateway.js` | Multi-provider routing with automatic fallback |
| `core/aries-code.js` | Autonomous coding agent (20-iteration loop) |
| `core/aries-code-swarm.js` | Multi-agent parallel coding |
| `core/phase-engine.js` | 5-phase app generation pipeline |
| `core/tools.js` | 42+ built-in tools |
| `core/auth.js` | Authentication & role-based access |
| `core/swarm.js` | P2P swarm network |
| `web/` | Cyberpunk dashboard frontend |

<br>

## 🎯 Feature Overview

### Platform
- **Zero npm dependencies** — entire platform runs on Node.js built-ins
- **42+ built-in tools** — file ops, shell, web search, browser, git, crypto, TTS, and more
- **Multi-provider AI** — Ollama, OpenAI, Anthropic, OpenRouter, Groq, Mistral, or any OpenAI-compatible API
- **MCP compatible** — works as an MCP server with any MCP client
- **PWA installable** — runs as a native app on mobile and desktop
- **Authentication** — login system with role-based access control
- **Self-healing** — automatic error detection and recovery

### Aries Code
- **Autonomous 20-iteration coding loop** — plans, writes, runs, fixes, serves
- **5-phase app generation** — Plan → Scaffold → Implement → Fix → Serve
- **Multi-agent swarm** — 5 roles working in parallel for complex projects
- **CLI + Dashboard + API** — use it however you prefer
- **Any language** — JavaScript, Python, Rust, Go, whatever the model supports

### Swarm
- **P2P distributed compute** — pool machines for AI workloads
- **Automatic crypto mining fallback** — low-end PCs earn credits through mining
- **Secure pairing** — relay-based peer discovery
- **Health monitoring** — real-time node status and performance metrics
- **Task scheduling** — intelligent workload distribution

<br>

## ⚙️ Configuration

Aries works out of the box with Ollama. Add cloud providers through the dashboard or `config.json`:

```json
{
  "providers": {
    "ollama": { "url": "http://localhost:11434" },
    "openai": { "apiKey": "sk-..." },
    "anthropic": { "apiKey": "sk-ant-..." },
    "openrouter": { "apiKey": "sk-or-..." }
  },
  "defaultProvider": "ollama",
  "defaultModel": "llama3.1"
}
```

### Recommended Local Models

| Model | Size | Best For |
|-------|------|----------|
| `llama3.1:8b` | 4.7 GB | General use, fast responses |
| `qwen2.5-coder:32b` | 18 GB | Strong multi-language coding |
| `deepseek-coder-v2` | 8.9 GB | Code generation |
| `llama3.1:70b` | 40 GB | Complex architecture & reasoning |

<br>

## 📡 API

```
POST /api/chat                 # Chat with AI
POST /api/aries-code           # Start autonomous coding task
GET  /api/aries-code/status    # Check task progress
POST /api/tools/:name          # Execute a tool directly
GET  /api/models               # List available models
GET  /api/swarm/status         # Swarm network status
GET  /api/system/stats         # System health
WS   ws://localhost:3333/ws    # Streaming responses
```

<br>

## ❓ FAQ

**Do I need to install anything besides Node.js?**
No. Zero dependencies. `git clone` → `node launcher.js` → done.

**Can I use it fully offline?**
Yes — with Ollama running locally, Aries is 100% offline capable.

**Is my data sent anywhere?**
Never. Everything runs on your machine. No telemetry, no analytics, no phone-home.

**What about the crypto mining?**
Completely opt-in and low-priority. It only activates in swarm mode as a fallback for machines that can't run LLM inference. You can disable it anytime.

**What models work best for coding?**
`qwen2.5-coder:32b` for code generation. `llama3.1:70b` for complex architecture.

<br>

## 🤝 Contributing

```bash
git clone https://github.com/dsfgsdgf33/aries
cd aries
# Make your changes
git checkout -b feature/your-feature
git commit -m "Add your feature"
git push origin feature/your-feature
# Open a PR
```

### Areas where help is welcome

- 🌍 Internationalization
- 📱 Mobile PWA improvements
- 🧪 Test coverage
- 📖 Documentation
- 🔧 New tool integrations
- 🌐 Swarm protocol improvements

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

[⭐ Star on GitHub](https://github.com/dsfgsdgf33/aries) · [🐛 Report Bug](https://github.com/dsfgsdgf33/aries/issues) · [💡 Request Feature](https://github.com/dsfgsdgf33/aries/issues)

</div>
