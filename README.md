<div align="center">

# ⬡ A R I E S

### AI Runtime Intelligence & Execution System

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-00fff7?style=for-the-badge&logo=nodedotjs&logoColor=00fff7&labelColor=0d1117)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/ZERO-DEPENDENCIES-ff00ff?style=for-the-badge&labelColor=0d1117)](/)
[![MIT License](https://img.shields.io/badge/LICENSE-MIT-00fff7?style=for-the-badge&labelColor=0d1117)](LICENSE)
[![Docker](https://img.shields.io/badge/DOCKER-READY-2496ED?style=for-the-badge&logo=docker&logoColor=white&labelColor=0d1117)](/)
[![MCP Compatible](https://img.shields.io/badge/MCP-COMPATIBLE-8B5CF6?style=for-the-badge&labelColor=0d1117)](/)
[![PWA](https://img.shields.io/badge/PWA-MOBILE-34D399?style=for-the-badge&labelColor=0d1117)](/)
[![OpenAI API](https://img.shields.io/badge/OpenAI_API-COMPATIBLE-10A37F?style=for-the-badge&logo=openai&logoColor=white&labelColor=0d1117)](/)

**Your machine. Your models. Your data. Zero compromises.**

---

Aries is a self-contained AI platform that runs entirely on your hardware with **zero npm dependencies**. Connect any model — Ollama, OpenAI, Anthropic, Groq — and get a full-featured AI operating system: multi-agent swarms, RAG, code execution, browser automation, an MCP server for your IDE, an OpenAI-compatible API, scheduled tasks, a cyberpunk dashboard, and a PWA for your phone. Clone the repo, run `node launcher.js`, and you're live in 60 seconds.

[⚡ Quick Start](#-quick-start) · [🏆 Why Aries](#-why-aries-wins) · [🚀 Features](#-feature-deep-dives) · [🔌 MCP Setup](#-mcp-setup) · [📖 API Reference](#-api-reference) · [❓ FAQ](#-faq)

</div>

---

## ⚡ Quick Start

Four ways to get running. Pick one.

### 1. Git Clone (recommended)

```bash
git clone https://github.com/dsfgsdgf33/aries.git
cd aries
node launcher.js
```

Open **http://localhost:3333** — done.

### 2. Windows One-Click

```powershell
irm https://raw.githubusercontent.com/dsfgsdgf33/aries/main/install-windows.ps1 | iex
```

### 3. macOS / Linux One-Click

```bash
curl -fsSL https://raw.githubusercontent.com/dsfgsdgf33/aries/main/install-mac-linux.sh | bash
```

### 4. Docker

```bash
# CPU
docker run -d -p 3333:3333 -p 18800:18800 --name aries ghcr.io/dsfgsdgf33/aries

# GPU (with local Ollama)
docker compose --profile gpu up -d
```

No `npm install`. No Python venv. No config files. **It just works.**

> **Requirements:** Node.js 18+ and ~200 MB disk. That's it. Ollama is optional (auto-installed by the setup wizard if you want local models).

---

## 🏆 Why Aries Wins

| Feature | **Aries** | ChatGPT | LM Studio | Jan | Open WebUI |
|:--------|:---------:|:-------:|:---------:|:---:|:----------:|
| Runs 100% locally | ✅ | ❌ | ✅ | ✅ | ✅ |
| Zero npm dependencies | **✅** | ❌ | ❌ | ❌ | ❌ |
| Works with ANY model provider | **✅** | ❌ | Partial | Partial | ✅ |
| Automatic Ollama fallback | **✅** | — | — | ❌ | ❌ |
| Built-in MCP server | **✅** | ❌ | ❌ | ❌ | ❌ |
| OpenAI-compatible API | **✅** | — | ✅ | ❌ | ✅ |
| RAG (chat with files) | **✅ Built-in** | Plugin | ❌ | ❌ | ✅ |
| Code interpreter (local) | **✅** | Cloud only | ❌ | ❌ | ❌ |
| Screenshot + Vision | **✅ Local** | Cloud only | ❌ | ❌ | ❌ |
| Scheduled tasks / Cron | **✅** | ❌ | ❌ | ❌ | ❌ |
| Browser extension | **✅** | ❌ | ❌ | ❌ | ❌ |
| Browser automation | **✅** | ❌ | ❌ | ❌ | ❌ |
| PWA mobile access | **✅** | ✅ | ❌ | ❌ | ✅ |
| Multi-agent swarm | **✅ 14 agents** | ❌ | ❌ | ❌ | ❌ |
| Distributed compute (swarm networking) | **✅** | ❌ | ❌ | ❌ | ❌ |
| Persona system | **✅** | Limited | ❌ | ❌ | ❌ |
| Persistent memory | **✅** | Limited | ❌ | ❌ | ❌ |
| Knowledge graph | **✅** | ❌ | ❌ | ❌ | ❌ |
| Workflow engine | **✅** | ❌ | ❌ | ❌ | ❌ |
| Plugin marketplace | **✅ Hot-reload** | Plugins | ❌ | ❌ | ✅ |
| Cyberpunk UI themes | **✅ 4 themes** | ❌ | ❌ | ❌ | ❌ |
| One-command install | **✅** | N/A | Installer | Installer | Docker |
| Cost | **Free** | $20/mo | Free | Free | Free |

---

## 🚀 Feature Deep-Dives

### 🤖 Multi-Model AI Chat

Stream responses from **Ollama**, **Anthropic** (Claude), **OpenAI** (GPT), **Groq**, or **OpenRouter**. Switch providers with one click mid-conversation. The setup wizard auto-detects your hardware and picks the best local model:

| Your Hardware | Recommended Model |
|:---|:---|
| 16 GB+ RAM / GPU | `deepseek-r1:14b` |
| 8–16 GB RAM | `llama3.1:8b` |
| Under 8 GB | `phi3:mini` |

### 🔄 Automatic Ollama Fallback

API key expired? Rate limited? Aries **automatically** switches to a local Ollama model — no config, no interruption. A notification appears, and your chat keeps going. When the API recovers, it switches back silently.

### 📁 Chat With Your Files (RAG)

Point Aries at a folder. It indexes your documents with TF-IDF scoring and retrieves relevant chunks at query time. No vector database, no embeddings API — works fully offline.

```
Supported: PDF, TXT, MD, JSON, CSV, HTML, source code
```

### 🔌 MCP Server (Claude Desktop / Cursor / VS Code)

Aries exposes its tools via the **Model Context Protocol**. Your IDE gets superpowers:

| MCP Tool | What It Does |
|:---------|:-------------|
| `aries_chat` | Chat with any model through Aries |
| `aries_search` | Web search with summaries |
| `aries_memory_search` | Query persistent memory |
| `aries_memory_save` | Save to memory bank |
| `aries_rag_query` | Query indexed documents |
| `aries_run_code` | Execute code in sandbox |
| `aries_screenshot` | Capture screen |
| `aries_system_status` | System stats |

> See [MCP Setup](#-mcp-setup) below for config snippets, or the full guide at [`docs/MCP-SETUP.md`](docs/MCP-SETUP.md).

### 🌐 OpenAI-Compatible API

Drop-in replacement on port **18800**. Any tool that speaks OpenAI's API works with Aries — it routes to local Ollama or cloud providers transparently.

```bash
curl http://localhost:18800/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer aries-gateway-2026" \
  -d '{"model": "llama3", "messages": [{"role": "user", "content": "Hello"}]}'
```

### 💻 Code Interpreter

Run **JavaScript, Python, PowerShell, or Bash** in chat. Like ChatGPT's code interpreter, but local — no upload limits, no timeouts, sandboxed with memory caps.

### 👁️ Screenshot + Vision

Capture your screen and analyze it with local multimodal models (LLaVA, Qwen-VL via Ollama). Computer vision without sending your screen to the cloud.

### ⏰ Scheduled Tasks

Built-in cron scheduler with a calendar UI. Schedule AI tasks, automated workflows, periodic checks — standard cron expressions.

### 🌍 Browser Extension

Chrome extension that overlays Aries on any webpage. Highlight text, ask questions, get answers without leaving the page. Source in `extensions/aries-browser/`.

### 📱 PWA Mobile Access

Open `http://your-pc-ip:3333` on your phone → "Add to Home Screen" → native-feeling app. The dashboard shows a QR code for instant access.

### 🐳 Docker Support

```bash
# Basic
docker run -d -p 3333:3333 -p 18800:18800 --name aries ghcr.io/dsfgsdgf33/aries

# With Ollama + GPU
docker compose --profile gpu up -d

# Build from source
docker build -t aries . && docker run -d -p 3333:3333 aries
```

The image is tiny — zero dependencies means no `npm install` step.

### 🕸️ Swarm Networking

Distribute AI workloads across machines. Connect nodes into a compute mesh — share models, parallelize tasks, and scale horizontally. Fully opt-in, token-authenticated.

### 🧠 Memory & Knowledge Graph

Persistent memory bank with categories, priorities, and automatic pruning. Knowledge graph with entity extraction builds connections across your conversations over time.

### 🎭 Persona System

Five built-in personas (Default, Coder, Creative, Analyst, Trader) plus a custom agent factory. Create specialized agents with unique system prompts and tool access.

### ⚡ Workflow Engine

Chain AI steps into pipelines — research → analyze → summarize → notify. Up to 20 steps per workflow, with conditional branching and error handling.

---

## 🔌 MCP Setup

### Claude Desktop

Add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "aries": {
      "command": "node",
      "args": ["/path/to/aries/launcher.js", "--mcp-stdio"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "aries": {
      "command": "node",
      "args": ["/path/to/aries/launcher.js", "--mcp-stdio"]
    }
  }
}
```

### VS Code

Add to VS Code `settings.json`:

```json
{
  "mcp.servers": {
    "aries": {
      "command": "node",
      "args": ["/path/to/aries/launcher.js", "--mcp-stdio"]
    }
  }
}
```

### SSE Transport

For HTTP/SSE-based MCP connections: `http://localhost:18801/sse` (available automatically when Aries is running).

> Full guide with troubleshooting: [`docs/MCP-SETUP.md`](docs/MCP-SETUP.md)

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Web Dashboard (:3333)                  │
│              Cyberpunk UI · PWA · 4 Themes               │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│                   API Server (core)                       │
│  REST endpoints · WebSocket · Auth · Rate limiting        │
├──────────┬──────────┬──────────┬──────────┬──────────────┤
│ AI Chat  │ RAG      │ Code     │ Scheduler│ Swarm        │
│ Engine   │ Engine   │ Sandbox  │ (Cron)   │ Agents (14)  │
├──────────┼──────────┼──────────┼──────────┼──────────────┤
│ MCP      │ Memory & │ Browser  │ Vision & │ Workflow     │
│ Server   │ KGraph   │ Control  │ Screenshot│ Engine      │
└──────────┴──────────┴──────────┴──────────┴──────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│              AI Gateway (:18800)                          │
│   OpenAI-compatible API · Provider routing · Fallback    │
├──────────┬──────────┬──────────┬─────────────────────────┤
│ Ollama   │ Anthropic│ OpenAI   │ Groq / OpenRouter       │
│ (local)  │ (Claude) │ (GPT)    │ (cloud)                 │
└──────────┴──────────┴──────────┴─────────────────────────┘
```

**Zero dependencies.** Every module uses Node.js built-ins (`http`, `fs`, `crypto`, `child_process`, `os`, `zlib`). No `node_modules`. No supply chain risk.

```
aries/
├── launcher.js            # Entry point — run this
├── core/
│   ├── ai.js              # Multi-model chat with fallback chain
│   ├── ai-gateway.js      # OpenAI-compatible API (port 18800)
│   ├── api-server.js      # HTTP server & REST API
│   ├── ollama-fallback.js # Automatic Ollama fallback
│   ├── mcp-server.js      # MCP server (stdio + SSE)
│   ├── rag-engine.js      # Document indexing & retrieval
│   ├── code-sandbox.js    # Sandboxed code execution
│   ├── scheduler.js       # Cron task scheduling
│   ├── swarm-agents.js    # Multi-agent swarm system
│   └── ...                # 50+ modules
├── web/
│   ├── index.html         # Dashboard UI
│   ├── manifest.json      # PWA manifest
│   └── sw.js              # Service worker
├── extensions/
│   └── aries-browser/     # Chrome extension
├── docs/
│   └── MCP-SETUP.md       # MCP configuration guide
├── Dockerfile
├── docker-compose.yml
└── config.example.json    # Reference configuration
```

---

## ⚙️ Configuration

Aries generates `config.json` on first launch via the setup wizard. Here's a trimmed example:

```jsonc
{
  "version": "7.0.0",

  // AI Gateway — OpenAI-compatible API server
  "ariesGateway": {
    "enabled": true,
    "port": 18800,
    "providers": {
      "anthropic": { "apiKey": "", "defaultModel": "claude-sonnet-4-20250514" },
      "openai":    { "apiKey": "", "defaultModel": "gpt-4o" },
      "groq":      { "apiKey": "", "defaultModel": "llama-3.1-70b-versatile" }
    }
  },

  // Automatic fallback to local Ollama when APIs fail
  "ollamaFallback": {
    "enabled": true,
    "url": "http://localhost:11434",
    "model": "auto",
    "triggerOn": ["429", "500", "502", "503", "timeout"]
  },

  // RAG — chat with your files
  "rag": { "enabled": true, "chunkSize": 500, "topK": 5 },

  // Code execution sandbox
  "sandbox": {
    "enabled": true,
    "timeoutMs": 30000,
    "maxMemoryMb": 256,
    "allowedLanguages": ["javascript", "python", "shell"]
  },

  // Scheduled tasks
  "scheduler": { "enabled": true, "maxJobs": 100 },

  // MCP server
  "mcp": { "enabled": true },

  // Multi-agent swarm
  "swarm": { "maxWorkers": 14, "concurrency": 2 },

  // Dashboard
  "apiPort": 3333,
  "theme": "cyan"
}
```

See [`config.example.json`](config.example.json) for the full reference with all options.

---

## 📖 API Reference

### Dashboard & UI

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/` | Web dashboard |
| `GET` | `/api/status` | System status (CPU, RAM, GPU, uptime) |
| `GET` | `/api/models` | List available models |

### Chat

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/api/chat/stream` | Stream a chat response (SSE) |
| `GET` | `/api/conversations` | List conversations |
| `DELETE` | `/api/conversations/:id` | Delete a conversation |

### RAG

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/api/rag/index` | Index a directory |
| `POST` | `/api/rag/query` | Query indexed documents |
| `GET` | `/api/rag/status` | Index stats |

### OpenAI-Compatible (port 18800)

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/v1/chat/completions` | Chat completions (streaming supported) |
| `GET` | `/v1/models` | List models |
| `GET` | `/health` | Gateway health check |

### Other

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/api/code/run` | Execute code in sandbox |
| `POST` | `/api/memory/save` | Save to memory bank |
| `POST` | `/api/memory/search` | Search memory |
| `GET` | `/api/scheduler/jobs` | List scheduled jobs |
| `POST` | `/api/scheduler/jobs` | Create a scheduled job |

All endpoints accept JSON. Authentication via `Authorization: Bearer <apiKey>` header.

---

## ❓ FAQ

<details>
<summary><b>How is this truly zero dependencies?</b></summary>

Every module is built on Node.js built-in APIs: `http`, `https`, `fs`, `crypto`, `child_process`, `os`, `zlib`, `path`, `url`, `stream`. No npm packages. The `package.json` exists only for metadata — `node_modules` is empty. This means zero supply chain risk and instant startup.
</details>

<details>
<summary><b>Is my data private?</b></summary>

Yes. Everything runs on your machine. When using Ollama, data never leaves localhost. Cloud APIs (Anthropic/OpenAI) send your prompts to their servers, but your config, memory, files, and RAG index stay local.
</details>

<details>
<summary><b>Can I use this with Claude Desktop / Cursor?</b></summary>

Yes — Aries is a full MCP server. Add it to your IDE config and you get web search, memory, code execution, RAG, and more — all inside Claude or Cursor. See the [MCP Setup](#-mcp-setup) section.
</details>

<details>
<summary><b>What happens when my API key hits rate limits?</b></summary>

Aries detects 429/5xx errors and automatically falls back to local Ollama models. A notification appears in the UI. When the API recovers, it switches back. No action required.
</details>

<details>
<summary><b>Can I run this on a server / headless?</b></summary>

Yes. `node launcher.js` works headless — access the dashboard remotely at `http://your-server:3333`. Docker works the same way. The MCP server and API gateway function without a browser.
</details>

<details>
<summary><b>What models work with Aries?</b></summary>

Any model available through Ollama (llama3, mistral, deepseek, phi3, qwen, codellama, etc.), OpenAI (GPT-4o, GPT-4, etc.), Anthropic (Claude Opus/Sonnet/Haiku), Groq, or OpenRouter. If it has an API, Aries can talk to it.
</details>

<details>
<summary><b>How do I update?</b></summary>

```bash
cd aries && git pull
```

That's it. No build step, no dependency install.
</details>

---

## 🤝 Contributing

We welcome contributions! See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full guide.

**Quick version:**

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. **Zero dependencies rule** — use only Node.js built-in modules
4. Test your changes: `node launcher.js`
5. Submit a PR with a clear description

---

## 📄 License

[MIT](LICENSE) — use it however you want.

---

<div align="center">

**Built with pure Node.js — zero dependencies, infinite possibilities.**

[Report a Bug](https://github.com/dsfgsdgf33/aries/issues) · [Request a Feature](https://github.com/dsfgsdgf33/aries/issues) · [Discussions](https://github.com/dsfgsdgf33/aries/discussions)

**[⬆ Back to top](#-a-r-i-e-s)**

</div>
