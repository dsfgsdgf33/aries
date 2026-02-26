<p align="center">
  <img src="https://img.shields.io/badge/ARIES-AI%20Platform-00ff41?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzAwZmY0MSIgZD0iTTEyIDJMMiAyMmgyMEwxMiAyem0wIDRsMTUgMTZINy4wMkwxMiA2eiIvPjwvc3ZnPg==&logoColor=00ff41" alt="ARIES" height="60"/>
</p>

<h1 align="center">⚡ A R I E S ⚡</h1>
<h3 align="center">Self-Hosted AI Platform with an Autonomous Coding Agent</h3>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 18+"/>
  <img src="https://img.shields.io/badge/Dependencies-ZERO-00ff41?style=flat-square" alt="Zero Dependencies"/>
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License"/>
  <img src="https://img.shields.io/badge/Tools-42+-purple?style=flat-square" alt="42+ Tools"/>
  <img src="https://img.shields.io/badge/MCP-Compatible-00d4ff?style=flat-square" alt="MCP Compatible"/>
</p>

<p align="center">
  <i>Zero npm dependencies. Runs any model. 100% self-hosted. One command to start.</i>
</p>

---

## What is Aries?

Aries is a self-hosted AI platform built entirely on Node.js with **zero npm dependencies**. It gives you a cyberpunk web dashboard, 42+ built-in tools, multi-provider AI support, and an autonomous coding agent that can plan, build, and run entire applications on its own.

## Key Features

- **🔧 Zero Dependencies** — No `node_modules/`. The entire platform runs on Node.js built-ins. Clone and go.
- **🤖 Aries Code** — Autonomous coding agent that architects, writes, tests, and fixes full applications in a loop.
- **🌐 Any Model** — Ollama, OpenAI, Anthropic, OpenRouter, Groq, Mistral, or any OpenAI-compatible API.
- **🔒 100% Private** — Everything runs on your machine. No telemetry, no cloud processing.
- **🖥️ Web Dashboard** — Cyberpunk-themed UI with real-time stats, conversation panels, and tool logs.
- **🔌 42+ Built-in Tools** — File ops, shell exec, web search, browser control, git, and more.
- **🤝 MCP Compatible** — Works as an MCP server with any MCP client.
- **📱 PWA** — Installable as a native app on mobile and desktop.
- **🌐 Swarm Network** — P2P distributed compute across multiple machines.
- **🛡️ Self-Healing** — Automatic error detection and recovery.

---

## Quick Start

```bash
git clone https://github.com/dsfgsdgf33/aries
cd aries
node launcher.js
```

Open **http://localhost:3333** → Log in → Start building.

That's it. No `npm install`. No Docker. No config files. **One command.**

---

## ⌨️ Aries Code

The star feature. Aries Code is a full autonomous coding agent that doesn't suggest snippets — it **builds entire applications**.

```
You: "Build me a REST API with user auth and a React dashboard"

Aries Code:
  📋 Plan       → Analyzes requirements, creates architecture
  🏗️ Scaffold   → Generates project structure
  ⚡ Implement   → Writes all source code
  🔧 Fix        → Runs the app, catches errors, patches them
  🚀 Serve      → Launches with hot reload, ready to use
```

### Three ways to use it

**CLI** — `aries-code "build a REST API with SQLite and JWT auth"`

**Dashboard** — Visual interface at `http://localhost:3333/aries-code` with live output, file trees, and phase tracking.

**Multi-Agent Swarm** — For complex projects, deploys a 5-role agent swarm (Architect → Coders → Reviewer → Tester → Fixer) with up to 20 iteration loops.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    ARIES PLATFORM                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  launcher.js ─── API Server (HTTP/WS :3333)             │
│                      │                                  │
│          ┌───────────┼───────────┬──────────┐           │
│          │           │           │          │           │
│      AI Core    42+ Tools   Aries Code   Agents        │
│      ai.js      tools.js   phase-engine  swarm         │
│          │                                              │
│   AI Gateway (multi-provider)                           │
│   Ollama · OpenAI · Anthropic · OpenRouter · Any        │
│                                                         │
│   Swarm Network (P2P) — optional distributed compute    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `launcher.js` | Entry point — starts everything |
| `core/api-server.js` | HTTP/WS server, routing, auth |
| `core/ai.js` | LLM interaction engine |
| `core/ai-gateway.js` | Multi-provider routing with fallback |
| `core/aries-code.js` | Autonomous coding agent |
| `core/aries-code-swarm.js` | Multi-agent parallel coding |
| `core/phase-engine.js` | 5-phase app generation pipeline |
| `core/tools.js` | 42+ built-in tools |
| `core/swarm.js` | P2P swarm network |
| `web/` | Dashboard frontend |

---

## Configuration

Aries works with any OpenAI-compatible API. Configure through the dashboard or `config.json`:

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
| `llama3.1:8b` | 4.7GB | General tasks, fast responses |
| `qwen2.5-coder:32b` | 18GB | Strong multi-language coding |
| `deepseek-coder-v2` | 8.9GB | Code generation |
| `llama3.1:70b` | 40GB | Complex coding and architecture |

---

## API

```
POST /api/chat              # Send a message
POST /api/aries-code        # Start autonomous coding task
GET  /api/aries-code/status # Check coding task status
POST /api/tools/:name       # Execute a specific tool
GET  /api/models            # List available models
GET  /api/swarm/status      # Swarm network status
GET  /api/system/stats      # System health metrics
```

WebSocket at `ws://localhost:3333/ws` for streaming responses.

---

## FAQ

**Do I need to install anything besides Node.js?**
No. Zero npm dependencies. Just `node launcher.js`.

**Can I use it offline?**
Yes — with Ollama running locally, Aries is fully offline capable.

**Is it really free?**
Yes. MIT licensed. Use local models for $0. Cloud APIs are optional.

**Is my data sent anywhere?**
Never. Everything runs locally. No telemetry, no analytics.

**What models work best for coding?**
`qwen2.5-coder:32b` or `deepseek-coder-v2` for code. `llama3.1:70b` for general tasks.

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push and open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

### Areas we'd love help with

- 🌍 Internationalization
- 📱 Mobile PWA improvements
- 🧪 Test coverage
- 📖 Documentation
- 🔌 New tool integrations

---

## Vision

Aries has a longer-term vision around community-powered distributed AI. See [VISION.md](VISION.md) for the full picture.

---

## License

[MIT](LICENSE) — Do whatever you want with it.

<p align="center">
  <b>Built with 💚 and zero dependencies</b><br/>
  <i>Aries — Self-hosted AI that actually respects your privacy.</i>
</p>

<p align="center">
  <a href="https://github.com/dsfgsdgf33/aries">⭐ Star on GitHub</a> •
  <a href="https://github.com/dsfgsdgf33/aries/issues">🐛 Report Bug</a> •
  <a href="https://github.com/dsfgsdgf33/aries/issues">💡 Request Feature</a>
</p>
