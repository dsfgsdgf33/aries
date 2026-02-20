<div align="center">

# ⬡ A R I E S

### A Model By The People, For The People

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-00fff7?style=for-the-badge&logo=nodedotjs&logoColor=00fff7&labelColor=0d1117)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/ZERO-DEPENDENCIES-ff00ff?style=for-the-badge&labelColor=0d1117)](/)
[![MIT License](https://img.shields.io/badge/LICENSE-MIT-00fff7?style=for-the-badge&labelColor=0d1117)](LICENSE)
[![Docker](https://img.shields.io/badge/DOCKER-READY-2496ED?style=for-the-badge&logo=docker&logoColor=white&labelColor=0d1117)](/)
[![MCP Compatible](https://img.shields.io/badge/MCP-COMPATIBLE-8B5CF6?style=for-the-badge&labelColor=0d1117)](/)
[![PWA](https://img.shields.io/badge/PWA-MOBILE-34D399?style=for-the-badge&labelColor=0d1117)](/)
[![OpenAI API](https://img.shields.io/badge/OpenAI_API-COMPATIBLE-10A37F?style=for-the-badge&logo=openai&logoColor=white&labelColor=0d1117)](/)

---

*What if the people built their own AI?*

*No corporate filters. No censorship. No $200/month subscriptions.*

*What if every person who joined made it smarter — and everyone who contributed got access?*

---

**Aries** is an open-source AI platform with **ARES** — the **Aries Recursive Evolution System** — a collective AI training network where your computer contributes to building a model that belongs to everyone. No corporation decides what it can say. No paywall decides who gets to use it. The more people join, the smarter it gets.

[⚡ Quick Start](#-quick-start) · [🧬 ARES: Collective AI Training](#-ares-collective-ai-training) · [🏆 Why Aries](#-why-aries-wins) · [🚀 Features](#-feature-deep-dives) · [❓ FAQ](#-faq)

</div>

---

## 🧬 ARES: Collective AI Training

**ARES** (Aries Recursive Evolution System) is the core of what makes Aries different from every other AI tool. It's not just a chat interface — it's a collective compute network that's building an uncensored AI model. The model lives on a central server; swarm members contribute compute and earn API access to query it.

### The Problem

- GPT-4, Claude, Gemini — all controlled by corporations who decide what the AI can and can't say
- Access costs $20–200/month — a tax on intelligence
- Your data trains *their* models, but you get nothing back
- One company goes down or changes policy? Your access disappears overnight

### The Solution: Train Our Own

```
┌─────────────────────────────────────────────────────────────┐
│                    THE ARES FLYWHEEL                         │
│                                                             │
│   More People Join ──→ More Compute Power                   │
│         ↑                     │                             │
│         │                     ▼                             │
│   More People Want It ←── Smarter Model                     │
│                                                             │
│   Every node that joins accelerates training.               │
│   A better model attracts more contributors.                │
│   The people's AI gets smarter every day.                   │
└─────────────────────────────────────────────────────────────┘
```

### How It Works

1. **Install Aries** — takes 60 seconds, zero dependencies
2. **Join the Network** — one click in the dashboard
3. **Your Machine Contributes** — GPU gradient computation, CPU tasks, mining, or just uptime
4. **Earn Credits & Access** — the more you contribute, the higher your tier
5. **Query the Model via API** — spend credits to access the ARES model hosted centrally

### Contribution Tiers

Your access scales with your contribution. No freeloaders, no paywalls — just fair exchange.

| Tier | Requirement | Access |
|:-----|:------------|:-------|
| **🟢 FREE** | Install Aries | Basic Ollama model access |
| **🔵 CONTRIBUTOR** | 100+ credit-hours | Access to the latest ARES model for inference |
| **🟣 TRAINER** | 500+ credit-hours or GPU training | Priority access, higher rate limits |
| **🟡 CORE** | 1000+ credit-hours with GPU | Unlimited access, early model releases |

**How credits work:**
- GPU training time: **10 credits/hour** (highest value — this directly improves the model)
- Mining contribution: **2 credits/hour**
- CPU inference: **1 credit/hour**
- Uptime: **0.5 credits/hour** (just keeping your node online helps)
- Storage: **0.1 credits/GB-hour**

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

### Join the ARES Network

After setup, click **"Join Swarm"** in the dashboard. One click. Your machine starts contributing, you start earning tiers. Leave anytime.

---

## 🏆 Why Aries Wins

| Feature | **Aries** | ChatGPT | LM Studio | Jan | Open WebUI | OpenClaw |
|:--------|:---------:|:-------:|:---------:|:---:|:----------:|:--------:|
| Zero Dependencies | **✅ Pure Node.js** | ❌ Cloud | ❌ Electron | ❌ Electron | ❌ Python/Docker | ❌ Node.js + npm |
| Collective AI Training (ARES) | **✅** | ❌ | ❌ | ❌ | ❌ | ❌ |
| Earn Access by Contributing | **✅ Tier system** | ❌ $20/mo | ❌ | ❌ | ❌ | ❌ |
| Local AI (Ollama) | **✅** | ❌ | ✅ | ✅ | ✅ | ✅ (via tools) |
| Cloud AI (Anthropic/OpenAI) | **✅** | ✅ OpenAI only | ❌ | ✅ | ✅ | ✅ |
| Auto Ollama Fallback | **✅** | ❌ | ❌ | ❌ | ❌ | ❌ |
| Swarm Network (P2P AI) | **✅ Join & contribute** | ❌ | ❌ | ❌ | ❌ | ❌ |
| MCP Server | **✅ Built-in** | ❌ | ❌ | ❌ | ❌ | ✅ Client |
| OpenAI-Compatible API | **✅ Port 18800** | ✅ | ✅ | ✅ | ✅ | ❌ |
| RAG (Chat with Files) | **✅** | ✅ Paid | ❌ | ✅ | ✅ | ❌ |
| Code Interpreter | **✅ Local sandbox** | ✅ Cloud | ❌ | ❌ | ❌ | ✅ (via tools) |
| Screenshot + Vision | **✅** | ✅ | ✅ | ✅ | ✅ | ✅ (via tools) |
| Browser Extension | **✅** | ❌ | ❌ | ❌ | ❌ | ❌ |
| PWA Mobile | **✅** | ✅ | ❌ | ❌ | ✅ | ❌ |
| Docker Support | **✅** | N/A | ❌ | ❌ | ✅ | ❌ |
| Agent System | **✅ 14 agents** | ❌ | ❌ | ❌ | ❌ | ✅ Single agent |
| Memory System | **✅** | ✅ | ❌ | ✅ | ❌ | ✅ |
| Encrypted Config | **✅ AES-256-GCM** | N/A | ❌ | ❌ | ❌ | ❌ |
| Scheduled Tasks | **✅** | ❌ | ❌ | ❌ | ❌ | ✅ Cron |
| Built-in Tools | **30+** | ~5 | 0 | ~3 | ~5 | ~12 |
| Cyberpunk UI | **✅** | ❌ | ❌ | ❌ | ❌ | ❌ |
| Price | **Free forever** | $20/mo | Free | Free | Free | Free |
| Self-Hosted | **✅** | ❌ | ✅ | ✅ | ✅ | ✅ |

---

## 🚀 30+ Built-in Tools

Every tool is pure Node.js. Zero dependencies. Works offline.

### 🤖 AI & Models

| Tool | What It Does |
|:-----|:-------------|
| **Multi-Model Chat** | Stream from Ollama, Anthropic, OpenAI, Groq, OpenRouter. Switch mid-conversation. |
| **Aries AI (ARES)** | Query the collectively-trained uncensored model. Powered by the swarm. |
| **14 AI Agents** | Specialized agents for coding, research, analysis, writing, security, and more. |
| **Agent Factory** | Create custom agents with natural language. Describe it → it exists. |
| **Agent Debates** | Pit agents against each other on a topic. Get diverse perspectives. |
| **Auto Ollama Fallback** | API down? Auto-switches to local model. Zero interruption. |

### 🔧 System Tools

| Tool | What It Does |
|:-----|:-------------|
| **File Manager** | Browse, create, read, write, delete, search files anywhere on your PC. |
| **Terminal** | Execute shell commands from the dashboard. Full system access. |
| **System Control** | Volume, brightness, launch/kill apps, power management. |
| **Clipboard** | Read/write system clipboard programmatically. |
| **Process Manager** | List, monitor, kill processes. CPU/memory per process. |
| **Network Tools** | Ping, port scan, DNS flush, ARP tables, WiFi info. |
| **System Monitor** | Real-time CPU, RAM, disk, GPU stats. Live dashboard. |

### 🌐 Web Tools

| Tool | What It Does |
|:-----|:-------------|
| **Web Search** | DuckDuckGo-powered search. No API key needed. |
| **Web Fetch** | Fetch any URL → clean readable content. |
| **Browser Extension** | Chrome extension: right-click → Ask Aries, summarize pages. |
| **Web Sentinel** | Monitor websites for changes. Alerts on updates. |

### 💻 Developer Tools

| Tool | What It Does |
|:-----|:-------------|
| **Code Interpreter** | Run JS, Python, PowerShell, Bash in local sandbox. |
| **MCP Server** | Model Context Protocol for Claude Desktop, Cursor, VS Code. |
| **OpenAI-Compatible API** | Drop-in replacement on port 18800. |
| **Git Integration** | Status, log, diff, commit, push, pull — from the UI. |
| **Docker Deploy** | Dockerfiles, compose, build images, manage containers. |
| **Tool Generator** | Describe a tool in English → working API endpoint. |
| **Pipelines & Workflows** | Chain AI operations. Automate multi-step tasks. |

### 📄 Document Tools

| Tool | What It Does |
|:-----|:-------------|
| **RAG (Chat with Files)** | Index PDFs, docs, code. TF-IDF search. Fully offline. |
| **PDF Export** | Export conversations as PDF. Pure Node.js. |
| **Notes & Memory** | Persistent memory bank. AI remembers across sessions. |
| **Knowledge Graph** | Visual knowledge graph with relationship exploration. |
| **Bookmarks** | Save, tag, organize URLs. Personal link library. |

### ⚡ Automation

| Tool | What It Does |
|:-----|:-------------|
| **Scheduled Tasks** | Cron-style scheduler. Run AI tasks on any schedule. |
| **Desktop Notifications** | Push notifications from any automation. |
| **Autonomous Goals** | Give AI a goal → it works autonomously. Pause/resume/abort. |
| **Todo List** | Personal task management with priorities. |

### 🧠 Intelligence

| Tool | What It Does |
|:-----|:-------------|
| **Semantic Memory** | Search memories by meaning, not just keywords. |
| **Screenshot + Vision** | Capture screen → analyze with multimodal models. All local. |
| **Self-Evolution** | Platform analyzes itself and suggests improvements. |

### 🎨 Media

| Tool | What It Does |
|:-----|:-------------|
| **Voice Engine** | Text-to-speech with multiple voices. |
| **Screenshot Capture** | One-click screen capture. |
| **Content Generation** | Articles, social posts, docs on demand. |

### 🏆 Aries Network

| Tool | What It Does |
|:-----|:-------------|
| **Credits Dashboard** | Balance, tier progress, earning history. Visual progress bars. |
| **Tier System** | FREE → CONTRIBUTOR → TRAINER → CORE. Earn by contributing. |
| **Swarm Join** | One-click. Start earning immediately. |
| **Collective Training** | Your compute builds the people's AI model. |

---

## 🧬 ARES: Recursive Model Evolution

The ARES system runs continuous training cycles across the swarm:

- **Data Generation** — High-quality training data distilled from frontier models
- **Distributed Compute** — Gradient computation tasks farmed out to GPU-equipped swarm nodes, results sent back to the central server
- **Central Training** — Gradients aggregated and applied on the ARES server; the model never leaves the server
- **Growth Tracking** — Real-time projections of network capacity and model quality

The dashboard shows training progress, contributor leaderboards, tier breakdowns, and growth projections in real-time.

### 🤖 Multi-Model AI Chat

Stream responses from **Ollama**, **Anthropic** (Claude), **OpenAI** (GPT), **Groq**, or **OpenRouter**. Switch providers mid-conversation. Auto-detects your hardware:

| Your Hardware | Recommended Model |
|:---|:---|
| 16 GB+ RAM / GPU | `deepseek-r1:14b` |
| 8–16 GB RAM | `llama3.1:8b` |
| Under 8 GB | `phi3:mini` |

### 🔄 Automatic Ollama Fallback

API key expired? Rate limited? Aries **automatically** switches to a local Ollama model — no config, no interruption. When the API recovers, it switches back.

### 📁 Chat With Your Files (RAG)

Index your documents with TF-IDF scoring. Query them in chat. No vector database, no embeddings API — works fully offline. Supports PDF, TXT, MD, JSON, CSV, HTML, source code.

### 🔌 MCP Server (Claude Desktop / Cursor / VS Code)

Aries exposes tools via the **Model Context Protocol**:

| MCP Tool | What It Does |
|:---------|:-------------|
| `aries_chat` | Chat with any model |
| `aries_search` | Web search with summaries |
| `aries_memory_search` | Query persistent memory |
| `aries_memory_save` | Save to memory bank |
| `aries_rag_query` | Query indexed documents |
| `aries_run_code` | Execute code in sandbox |
| `aries_screenshot` | Capture screen |
| `aries_system_status` | System stats |

### 🌐 OpenAI-Compatible API

Drop-in replacement on port **18800**. Routes to local Ollama or cloud providers transparently.

```bash
curl http://localhost:18800/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer aries-gateway-2026" \
  -d '{"model": "llama3", "messages": [{"role": "user", "content": "Hello"}]}'
```

### 🕸️ Swarm Network

P2P compute network. Join → contribute GPU/CPU compute → earn credits to query the ARES model. One-click join, one-click leave. Completely opt-in.

### 💻 Code Interpreter

Run JavaScript, Python, PowerShell, or Bash in chat. Local, sandboxed, no upload limits.

### 👁️ Screenshot + Vision

Capture your screen and analyze with local multimodal models. Computer vision without sending your screen to the cloud.

### ⏰ Scheduled Tasks | 🌍 Browser Extension | 📱 PWA Mobile | 🐳 Docker | 🧠 Memory & Knowledge Graph | 🎭 Persona System | 🔒 AES-256-GCM Config | ⚡ Workflow Engine | 🎨 Cyberpunk UI

All included. All zero dependencies.

---

## 🔒 Security

| Layer | Protection |
|:------|:-----------|
| Config at rest | AES-256-GCM, machine-locked master key |
| API endpoints | Token authentication on ALL routes |
| Swarm network | Shared secret + per-node auth keys |
| Data locality | Everything stays on your machine (local models) |
| Supply chain | Zero npm dependencies = zero supply chain risk |
| Swarm opt-in | Disabled by default. No passive discovery. No open ports. |

---

## 🔌 MCP Setup

### Claude Desktop

Add to `claude_desktop_config.json`:

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

### Cursor / VS Code

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

SSE transport: `http://localhost:18801/sse`

> Full guide: [`docs/MCP-SETUP.md`](docs/MCP-SETUP.md)

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
│ MCP      │ Memory & │ Browser  │ Vision & │ ARES         │
│ Server   │ KGraph   │ Control  │ Screenshot│ Training    │
└──────────┴──────────┴──────────┴──────────┴──────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│              AI Gateway (:18800)                          │
│   OpenAI-compatible API · Provider routing · Fallback    │
├──────────┬──────────┬──────────┬─────────────────────────┤
│ Ollama   │ Anthropic│ OpenAI   │ Groq / OpenRouter       │
│ (local)  │ (Claude) │ (GPT)    │ (cloud)                 │
└──────────┴──────────┴──────────┴─────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│         ARES Central Server (model host)                  │
│   Training · Gradient aggregation · Model serving        │
├──────────┬──────────┬──────────┬─────────────────────────┤
│ Data     │ Gradient │ Credit   │ Growth                  │
│ Distiller│ Aggregator│ System  │ Tracking                │
└──────────┴──────────┴──────────┴─────────────────────────┘
                         ▲
              Swarm nodes send gradients
              & receive API access
```

**Zero dependencies.** Every module uses Node.js built-ins. No `node_modules`. No supply chain risk.

---

## ⚙️ Configuration

Aries generates `config.json` on first launch via the setup wizard:

```jsonc
{
  "version": "8.0.0",
  "ariesGateway": {
    "enabled": true,
    "port": 18800,
    "providers": {
      "anthropic": { "apiKey": "", "defaultModel": "claude-sonnet-4-20250514" },
      "openai":    { "apiKey": "", "defaultModel": "gpt-4o" }
    }
  },
  "ollamaFallback": { "enabled": true, "model": "auto" },
  "rag": { "enabled": true },
  "sandbox": { "enabled": true },
  "mcp": { "enabled": true },
  "swarm": { "maxWorkers": 14 },
  "ares": { "enabled": true },
  "miner": {
    "enabled": false,
    "wallet": "",
    "coin": "SOL"
  },
  "apiPort": 3333,
  "theme": "cyan"
}
```

See [`config.example.json`](config.example.json) for full reference.

---

## 📖 API Reference

### Core

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/status` | System status |
| `POST` | `/api/chat/stream` | Stream chat (SSE) |
| `POST` | `/api/code/run` | Execute code in sandbox |

### RAG & Memory

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/api/rag/index` | Index a directory |
| `POST` | `/api/rag/query` | Query documents |
| `POST` | `/api/memory/save` | Save to memory |
| `POST` | `/api/memory/search` | Search memory |

### ARES

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `GET` | `/api/ares/status` | ARES system status |
| `GET` | `/api/ares/model` | Current model info |
| `GET` | `/api/ares/growth` | Growth history & projections |
| `GET` | `/api/ares/training` | Training progress |
| `POST` | `/api/ares/training/start` | Start training cycle |
| `GET` | `/api/ares/leaderboard` | Top contributors |
| `GET` | `/api/ares/credits?workerId=X` | Worker credit balance |

### OpenAI-Compatible (port 18800)

| Method | Endpoint | Description |
|:-------|:---------|:------------|
| `POST` | `/v1/chat/completions` | Chat completions |
| `GET` | `/v1/models` | List models |

All endpoints require authentication via `x-aries-key` or `Authorization: Bearer`.

---

## ❓ FAQ

<details>
<summary><b>What is ARES and how does it train a model?</b></summary>

ARES (Aries Recursive Evolution System) is a collective compute network for AI training. It generates high-quality training data by distilling knowledge from frontier models, farms out gradient computation tasks to GPU-equipped swarm nodes, and aggregates the results on the central ARES server. The model lives and trains on one server — swarm members contribute compute power and earn API credits to query it. The model improves continuously as more people contribute.
</details>

<details>
<summary><b>Do I need a GPU to participate in ARES?</b></summary>

No. Any contribution helps — CPU tasks, uptime, and storage all earn credits. But GPU nodes earn credits 10x faster and unlock higher tiers because they compute gradients that directly improve the model.
</details>

<details>
<summary><b>Is the ARES model uncensored?</b></summary>

The ARES model is trained without corporate content filters. It's built on open base models (like Llama, Dolphin) and fine-tuned by the community. The goal is an AI that answers honestly, not one that refuses to help.
</details>

<details>
<summary><b>How is this truly zero dependencies?</b></summary>

Every module uses Node.js built-in APIs: `http`, `fs`, `crypto`, `child_process`, `os`, `zlib`. No npm packages. Zero supply chain risk.
</details>

<details>
<summary><b>Is my data private?</b></summary>

Yes. Everything runs on your machine. Config files are encrypted with AES-256-GCM and machine-locked — they can't be decrypted on another computer. When using Ollama, data never leaves localhost.
</details>

<details>
<summary><b>Can someone access my machine through the swarm?</b></summary>

No. Swarm networking is **opt-in only** — disabled by default. Every swarm API call requires authentication. Without valid credentials, all requests are rejected. You cannot discover or scan your way into someone's node.
</details>

<details>
<summary><b>Can I use this with Claude Desktop / Cursor?</b></summary>

Yes — Aries is a full MCP server. See the [MCP Setup](#-mcp-setup) section.
</details>

<details>
<summary><b>What about the mining component?</b></summary>

Mining is optional and disabled by default. If you enable it, you configure your own wallet address. Mining contributes to the swarm and earns you credits toward higher ARES tiers. You can contribute to ARES without mining.
</details>

<details>
<summary><b>How do I update?</b></summary>

```bash
cd aries && git pull
```
No build step. No dependency install.
</details>

---

## 🗺️ Roadmap

### Now (v8.0)
- ✅ ARES collective training system
- ✅ Credit-based access tiers
- ✅ Swarm training with gradient aggregation
- ✅ Growth tracking and projections
- ✅ Full MCP server + OpenAI-compatible API
- ✅ Zero-dependency architecture

### 6 Months
- 🔄 ARES model v1 release (fine-tuned on community data)
- 🔄 Redundant model hosting (high availability)
- 🔄 Mobile node support (contribute from your phone)
- 🔄 Cross-swarm federation (multiple networks can share training)

### 1 Year
- 🔮 ARES model competitive with commercial offerings
- 🔮 Self-sustaining training loop (model generates its own training data)
- 🔮 Specialized model variants (code, creative, research)
- 🔮 Governance system for training priorities (community votes on what to train)

---

## 🤝 Contributing

We welcome contributions! See [`CONTRIBUTING.md`](CONTRIBUTING.md).

**Quick version:**
1. Fork → branch → code → PR
2. **Zero dependencies** — Node.js built-ins only
3. Test: `node launcher.js`

---

## 📄 License

[MIT](LICENSE) — use it however you want.

---

<div align="center">

**The people's AI. Built by everyone. Owned by no one.**

*Every node that joins accelerates training. Every person who contributes earns access.*

*This isn't just software. It's a movement.*

[⬡ Join the Network](https://github.com/dsfgsdgf33/aries) · [Report a Bug](https://github.com/dsfgsdgf33/aries/issues) · [Discussions](https://github.com/dsfgsdgf33/aries/discussions)

**[⬆ Back to top](#-a-r-i-e-s)**

</div>
