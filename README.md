<div align="center">

# ⚡ ARIES

### Your Personal AI Command Center

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-blue?style=flat-square)](/)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

A local-first AI assistant with a cyberpunk dashboard, distributed network capabilities, and zero npm dependencies.

</div>

---

## What Is Aries?

Aries is a personal AI assistant that runs entirely on your machine. No cloud accounts required, no telemetry, no bloat.

- 🖥️ **Cyberpunk dashboard** — a slick local web UI with 4 themes
- 📦 **Zero dependencies** — built on Node.js built-in modules only
- 🤖 **Local AI out of the box** — auto-installs [Ollama](https://ollama.com) and picks the best model for your hardware
- ☁️ **Cloud AI optional** — drop in an Anthropic or OpenAI key if you prefer
- 🌐 **Aries Network** — one click to join a distributed AI compute mesh
- 🧠 **Agents, memory, tools, browser automation** — and much more

## Quick Start

```bash
git clone https://github.com/your-org/aries.git
cd aries
node core/headless.js
```

Open **http://localhost:3333** and you're in.

On first run, Aries checks for an API key. If it doesn't find one, it installs Ollama automatically and selects the best model for your hardware. That's it — you're running.

## Join the Aries Network

Want access to shared AI compute across the mesh?

1. Open the dashboard
2. Click **Join Network**
3. Done

You contribute idle compute and gain access to the collective. No config files to edit, no ports to forward.

## Features

| | Feature | Description |
|---|---|---|
| 💬 | **AI Chat** | Streaming responses, personas, conversation history |
| 🕵️ | **Specialist Agents** | Dynamic agents that spin up for specific tasks |
| 🧠 | **Memory & RAG** | Persistent knowledge base with retrieval-augmented generation |
| 🌐 | **Browser Automation** | Control a headless browser from chat |
| 💻 | **Code Sandbox** | Write, run, and iterate on code safely |
| 🔍 | **Web Search** | Search the web directly from the assistant |
| 🧩 | **Skill System** | Import and share skills via ClawHub |
| 📊 | **System Monitor** | Real-time resource usage at a glance |
| 💾 | **Backup & Restore** | One-click state snapshots |
| 🧬 | **Self-Evolution** | The system improves itself over time |
| 🖥️ | **Terminal** | Built-in terminal access |
| 🎨 | **4 Cyberpunk Themes** | Neon, Matrix, Synthwave, Midnight |

## 💡 Use Cases

### For Developers
- **AI Pair Programming** — Chat with specialized coding agents that understand your codebase
- **Code Review** — Get instant feedback on your code from multiple AI perspectives
- **Documentation Generator** — Point ARIES at your project and generate docs automatically
- **Bug Hunter** — Agents debate and analyze your code to find issues before they ship

### For Researchers
- **Literature Analysis** — Feed papers into RAG, ask questions across your knowledge base
- **Data Synthesis** — Multiple agents analyze data from different angles simultaneously
- **Web Intelligence** — Automated web monitoring and content summarization

### For Students
- **Study Assistant** — Ask questions, get explanations from multiple AI perspectives
- **Essay Feedback** — Get structured feedback on your writing
- **Exam Prep** — Create flashcards and practice questions from your notes

### For Power Users
- **Home Automation Hub** — Control your devices through AI-powered commands
- **Personal Knowledge Base** — RAG-powered second brain that remembers everything
- **Browser Copilot** — AI overlay on every webpage via the Chrome extension
- **Workflow Automation** — Schedule tasks, chain operations, monitor the web for changes

### For Teams
- **Shared AI Network** — Join the Aries swarm for distributed AI processing
- **Skill Sharing** — Import and share custom AI tools via ClawHub
- **Multi-Agent Problem Solving** — Complex tasks get decomposed and solved by specialist agents

## 🌐 The Aries Network

When you join the Aries Network, you become part of something bigger:

- **🚀 Free AI Access** — Contributing compute earns you access to shared AI models
- **⚡ Faster Processing** — Tasks distribute across the network for parallel execution
- **🧠 Smarter Results** — Multiple agents on multiple machines collaborate on your queries
- **🔒 Privacy First** — Your data stays on your machine; only task metadata crosses the network
- **🌍 Growing Network** — Every new member makes the whole network stronger
- **🏆 Achievement System** — Earn badges and unlock features as you contribute

One click to join. Zero config. The network handles everything.

## How Does Aries Compare?

| Feature | ChatGPT | Ollama | LM Studio | **ARIES** |
|---|---|---|---|---|
| Local-first | ❌ | ✅ | ✅ | ✅ |
| Zero dependencies | ❌ | ❌ | ❌ | ✅ |
| Distributed network | ❌ | ❌ | ❌ | ✅ |
| Browser automation | ❌ | ❌ | ❌ | ✅ |
| Specialist agents | ❌ | ❌ | ❌ | ✅ |
| RAG / Memory | Plugin | ❌ | ❌ | ✅ |
| Skill marketplace | Plugin | ❌ | ❌ | ✅ |
| Use cases | Chat only | Chat only | Chat only | **Dev, research, students, teams, automation** |

## Dashboard

> 📸 *Screenshot coming soon*

## Configuration

Aries works out of the box. Everything below is optional.

```jsonc
// config.json (created automatically on first run)
{
  "ai": {
    "provider": "ollama",          // or "anthropic", "openai"
    "apiKey": "",                   // only needed for cloud providers
    "ollamaModel": "auto"          // auto-selects based on your hardware
  }
}
```

- **Want cloud AI?** Add your Anthropic or OpenAI API key
- **Want a specific local model?** Set `ollamaModel` to any Ollama-supported model
- **Everything else** works with defaults

## API Reference

All endpoints are served from `localhost:3333`.

### Health & Status
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | System status and version |
| `GET` | `/api/health` | Health check |

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/chat` | Send a message, get a response |
| `POST` | `/api/chat/stream` | Streaming chat (SSE) |

### Aries Network
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/swarm/join` | Join the distributed network |
| `GET` | `/api/swarm/status` | Your network status |
| `POST` | `/api/swarm/leave` | Leave the network |
| `GET` | `/api/workers` | View active network participants |

### AI Gateway
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/gateway/chat` | Route chat through the AI gateway |
| `GET` | `/api/gateway/models` | List available models |

## Tech Stack

- **Runtime:** Node.js 18+ (built-in modules only)
- **Dependencies:** None. Zero. Zilch.
- **Frontend:** Vanilla HTML, CSS, and JavaScript
- **AI:** Ollama (local) or Anthropic / OpenAI (cloud)

## Requirements

- Node.js 18 or later
- That's it

---

<div align="center">

**MIT License** · Built with zero dependencies and pure stubbornness.

</div>
