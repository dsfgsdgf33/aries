<div align="center">

```
                     ╔═╗
                    ╔╝ ╚╗
                   ╔╝   ╚╗
                  ╔╝     ╚╗
                 ╔╝  ═══  ╚╗
                ╔╝         ╚╗
               ╔╝           ╚╗
              ╚╝             ╚╝
```

# A R I E S

**Personal AI Command Center**

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-00fff7?style=for-the-badge&logo=nodedotjs&logoColor=00fff7&labelColor=0d1117)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/DEPENDENCIES-ZERO-ff00ff?style=for-the-badge&labelColor=0d1117)](/)
[![MIT License](https://img.shields.io/badge/LICENSE-MIT-00fff7?style=for-the-badge&labelColor=0d1117)](LICENSE)

A local-first AI command center with a cyberpunk dashboard, distributed compute network, and zero npm dependencies.<br>
**Your machine. Your data. Your AI.**

[Quick Start](#-quick-start) · [Features](#-features) · [Network](#-the-aries-network) · [API](#-api-reference)

---

</div>

## ⚡ What Is Aries?

Aries is a personal AI assistant that runs **entirely on your machine**. No cloud accounts required. No telemetry. No bloat. No npm install.

It ships with a cyberpunk web dashboard, specialist AI agents, persistent memory, browser automation, a distributed compute network — and it sets itself up in under 60 seconds.

<br>

## 🚀 Quick Start

```bash
git clone https://github.com/dsfgsdgf33/aries.git
cd aries
node launcher.js
```

That's it. Open **http://localhost:3333** and you're in.

<br>

## 🔧 Setup — How It Works

On first launch, Aries runs a **setup wizard** that gets you running in one of three ways:

### Option 1: Local AI with Ollama (Recommended)
> **Zero cost. Fully private. One click.**

The wizard detects your hardware (RAM, GPU) and:
1. Downloads and installs [Ollama](https://ollama.com) automatically
2. Selects the best model for your system:
   - **16GB+ RAM / GPU** → `deepseek-r1:14b` (flagship reasoning)
   - **8–16GB RAM** → `llama3.1:8b` (fast and capable)
   - **Under 8GB** → `phi3:mini` (lightweight, still useful)
3. Pulls the model and configures everything
4. You're chatting with local AI in ~60 seconds

You never touch a config file. You never copy-paste a model name. It just works.

### Option 2: Cloud AI (Anthropic / OpenAI)
> **Bring your own API key for Claude, GPT-4, etc.**

1. Wizard asks for your API key
2. Paste it in — Aries validates it immediately
3. Done. Cloud models are available instantly alongside local ones

Supports `sk-ant-*` (Anthropic) and `sk-*` (OpenAI) keys. Your key stays in `config.json` on your machine — never transmitted anywhere else.

### Option 3: Skip Setup
> **For power users who want to configure manually.**

Edit `config.json` directly and set your provider, model, and key. Aries respects your choices.

```jsonc
// config.json — created automatically, fully optional to edit
{
  "ai": {
    "provider": "ollama",        // "ollama", "anthropic", or "openai"
    "apiKey": "",                // only needed for cloud providers
    "ollamaModel": "auto"       // "auto" = hardware-optimized selection
  }
}
```

<br>

## 🖥️ Features

### Dashboard
A cyberpunk-themed local web UI at `localhost:3333` with **4 themes** (Neon, Matrix, Synthwave, Midnight) and real-time system monitoring.

### Core Capabilities

| | Feature | What It Does |
|---|---|---|
| 💬 | **AI Chat** | Streaming responses, conversation history, multiple personas |
| 🕵️ | **Specialist Agents** | Dynamic agents that spin up for coding, research, analysis, writing |
| 🧠 | **Memory & RAG** | Persistent knowledge base with retrieval-augmented generation |
| 🌐 | **Browser Automation** | Control a headless browser through natural language |
| 💻 | **Code Sandbox** | Write, run, and iterate on code in an isolated environment |
| 🔍 | **Web Search** | Search the web and summarize results from chat |
| 🧩 | **Skill System** | Import, create, and share reusable AI skills |
| 🧬 | **Self-Evolution** | The system analyzes its own performance and improves over time |
| 📊 | **System Monitor** | Real-time CPU, RAM, disk, and network stats |
| 💾 | **Backup & Restore** | One-click compressed snapshots of your entire state |
| 🖥️ | **Built-in Terminal** | Full terminal access from the dashboard |
| 🔌 | **Plugin Marketplace** | Extend Aries with community plugins (hot-reload, no restart) |

### Chrome Extension
A browser companion extension that overlays Aries on any webpage — highlight text, ask questions, get instant answers without leaving the page.

<br>

## 🌐 The Aries Network

Aries can run standalone — but it's more powerful as part of the **Aries Network**, a distributed AI compute mesh.

### How It Works
1. Click **Join Network** in the dashboard
2. Your node contributes idle compute to the mesh
3. You gain access to shared AI models and parallel processing across all members

### What You Get
| Benefit | Description |
|---|---|
| 🚀 **Free AI Access** | Earn compute credits by contributing — use them for better models |
| ⚡ **Parallel Processing** | Large tasks split across the network and run simultaneously |
| 🧠 **Multi-Agent Collab** | Agents on different machines collaborate on complex problems |
| 🔒 **Privacy First** | Your data never leaves your machine — only task metadata crosses the wire |
| 🏆 **Achievement System** | Earn badges and unlock features as you contribute uptime |

**One click to join. Zero config. The network handles discovery, load balancing, and failover automatically.**

<br>

## 📊 How Does Aries Compare?

| Feature | ChatGPT | Ollama | LM Studio | **Aries** |
|---|---|---|---|---|
| Runs locally | ❌ | ✅ | ✅ | ✅ |
| Zero dependencies | ❌ | ❌ | ❌ | ✅ |
| Web dashboard | ✅ | ❌ | ✅ | ✅ |
| Distributed network | ❌ | ❌ | ❌ | ✅ |
| Browser automation | ❌ | ❌ | ❌ | ✅ |
| Specialist agents | ❌ | ❌ | ❌ | ✅ |
| Memory / RAG | Plugin | ❌ | ❌ | ✅ Built-in |
| Plugin system | Plugin | ❌ | ❌ | ✅ Hot-reload |
| Auto-setup | N/A | Manual | GUI | ✅ One command |
| Self-evolution | ❌ | ❌ | ❌ | ✅ |
| Cost | $20/mo | Free | Free | **Free** |

<br>

## 💡 Use Cases

<details>
<summary><b>👨‍💻 Developers</b></summary>

- **AI Pair Programming** — Coding agents that understand your codebase and suggest changes
- **Code Review** — Get structured feedback from multiple AI perspectives before you push
- **Documentation Generator** — Point Aries at a project directory, generate complete docs
- **Bug Hunter** — Agents analyze, debate, and pinpoint issues in your code

</details>

<details>
<summary><b>🔬 Researchers</b></summary>

- **Literature Analysis** — Load papers into RAG, query across your entire knowledge base
- **Data Synthesis** — Multiple agents analyze datasets from different angles simultaneously
- **Web Intelligence** — Automated monitoring, scraping, and summarization of sources

</details>

<details>
<summary><b>📚 Students</b></summary>

- **Study Assistant** — Ask complex questions, get multi-perspective explanations
- **Essay Feedback** — Structured critique and improvement suggestions
- **Exam Prep** — Auto-generate flashcards and practice questions from your notes

</details>

<details>
<summary><b>⚡ Power Users</b></summary>

- **Personal Knowledge Base** — A RAG-powered second brain that remembers everything
- **Browser Copilot** — AI overlay on every webpage via the Chrome extension
- **Workflow Automation** — Schedule tasks, chain operations, automate repetitive work
- **Home Automation** — Control smart devices through natural language commands

</details>

<details>
<summary><b>👥 Teams</b></summary>

- **Shared Compute** — Pool resources across machines via the Aries Network
- **Skill Sharing** — Import and distribute custom AI tools across your team
- **Multi-Agent Problem Solving** — Complex tasks decomposed and solved by specialist agents in parallel

</details>

<br>

## 📡 API Reference

All endpoints served from `http://localhost:3333`.

<details>
<summary><b>Core Endpoints</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | System status, version, uptime |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/chat` | Send a message, get a response |
| `POST` | `/api/chat/stream` | Streaming chat via SSE |
| `GET` | `/api/gateway/models` | List available AI models |
| `POST` | `/api/gateway/chat` | Route chat through the AI gateway |

</details>

<details>
<summary><b>Network Endpoints</b></summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/swarm/join` | Join the Aries Network |
| `GET` | `/api/swarm/status` | Your network membership status |
| `POST` | `/api/swarm/leave` | Leave the network |
| `GET` | `/api/workers` | View active network participants |

</details>

<br>

## 🏗️ Architecture

```
aries/
├── launcher.js          # Entry point — run this
├── config.json          # Auto-generated config
├── core/
│   ├── headless.js      # Module loader & orchestrator
│   ├── api-server.js    # HTTP server & API routes
│   ├── ai-chat.js       # AI provider abstraction
│   ├── auto-setup.js    # First-run hardware detection & Ollama install
│   ├── setup-wizard.js  # Interactive setup wizard
│   ├── swarm-join.js    # One-click network enrollment
│   └── ...              # 50+ core modules
├── web/
│   ├── index.html       # Dashboard UI
│   └── app.js           # Frontend logic
├── extensions/
│   └── aries-browser/   # Chrome extension
└── data/                # Persistent storage (auto-created)
```

**Zero dependencies.** Every module is built on Node.js built-in APIs (`http`, `fs`, `crypto`, `child_process`, `os`, `zlib`). No `node_modules`. No `package-lock.json`. No supply chain risk.

<br>

## 📋 Requirements

- **Node.js 18+** — that's it
- ~200MB disk space (plus AI model if using Ollama)
- Any OS: Windows, macOS, Linux

<br>

## 🤝 Contributing

Aries is open source under the MIT License. PRs welcome.

1. Fork the repo
2. Create a feature branch
3. Submit a pull request

<br>

---

<div align="center">

```
              ╔═╗
             ╔╝ ╚╗
            ╔╝   ╚╗
           ╔╝ ═══ ╚╗
          ╔╝       ╚╗
         ╚╝         ╚╝
```

**MIT License** · Zero dependencies · Built with pure Node.js

[⬆ Back to top](#)

</div>
