<div align="center">

```
                     ╔═╗
                    ╔╝ ╚╗
                   ╔╝   ╚╗
                  ╔╝     ╚╗
                 ╔╝  ▲▲▲  ╚╗
                ╔╝         ╚╗
               ╔╝           ╚╗
              ╚╗             ╔╝
```

# A R I E S

### The AI Command Center That Runs On Your Machine

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-00fff7?style=for-the-badge&logo=nodedotjs&logoColor=00fff7&labelColor=0d1117)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/ZERO-DEPENDENCIES-ff00ff?style=for-the-badge&labelColor=0d1117)](/)
[![MIT License](https://img.shields.io/badge/LICENSE-MIT-00fff7?style=for-the-badge&labelColor=0d1117)](LICENSE)
[![Docker](https://img.shields.io/badge/DOCKER-READY-2496ED?style=for-the-badge&logo=docker&logoColor=white&labelColor=0d1117)](/)
[![MCP](https://img.shields.io/badge/MCP-SERVER-8B5CF6?style=for-the-badge&labelColor=0d1117)](/)
[![PWA](https://img.shields.io/badge/PWA-MOBILE-34D399?style=for-the-badge&labelColor=0d1117)](/)
[![OpenAI API](https://img.shields.io/badge/OpenAI_API-COMPATIBLE-10A37F?style=for-the-badge&logo=openai&logoColor=white&labelColor=0d1117)](/)

**Your machine. Your data. Your AI. Zero compromises.**

A fully local AI platform with 50+ modules, specialist agents, distributed compute, RAG, code execution, browser automation, MCP server, OpenAI-compatible API — and literally zero npm dependencies. Runs in 60 seconds.

[⚡ Quick Start](#-quick-start) · [🎯 Why Aries](#-why-aries-wins) · [🚀 Features](#-features) · [🐳 Docker](#-docker) · [🔌 MCP Server](#-mcp-server) · [📱 Mobile](#-mobile--pwa)

---

</div>

## ⚡ Quick Start

### Option A: One Command
```bash
git clone https://github.com/dsfgsdgf33/aries.git
cd aries
node launcher.js
```
Open **http://localhost:3333** → done.

### Option B: One-Click Install (Windows)
```powershell
irm https://raw.githubusercontent.com/dsfgsdgf33/aries/main/install-windows.ps1 | iex
```

### Option C: One-Click Install (macOS/Linux)
```bash
curl -fsSL https://raw.githubusercontent.com/dsfgsdgf33/aries/main/install-mac-linux.sh | bash
```

### Option D: Docker
```bash
docker run -p 3333:3333 -p 18800:18800 ghcr.io/dsfgsdgf33/aries
```

That's it. No `npm install`. No Python venv. No Docker compose files. No config files. **It just works.**

<br>

## 🎯 Why Aries Wins

Other tools make you choose. Aries doesn't.

| Feature | ChatGPT | LM Studio | Jan | Open WebUI | **ARIES** |
|:---|:---:|:---:|:---:|:---:|:---:|
| Runs 100% locally | ❌ | ✅ | ✅ | ✅ | ✅ |
| Zero dependencies | ❌ | ❌ | ❌ | ❌ | **✅** |
| Web dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Specialist AI agents | ❌ | ❌ | ❌ | ❌ | **✅ 14 agents** |
| Agent swarm / parallel | ❌ | ❌ | ❌ | ❌ | **✅** |
| RAG (chat with files) | Plugin | ❌ | ❌ | ✅ | **✅ Built-in** |
| Code interpreter | ✅ (cloud) | ❌ | ❌ | ❌ | **✅ Local** |
| Browser automation | ❌ | ❌ | ❌ | ❌ | **✅** |
| Browser extension | ❌ | ❌ | ❌ | ❌ | **✅** |
| MCP server | ❌ | ❌ | ❌ | ❌ | **✅** |
| OpenAI-compatible API | — | ✅ | ❌ | ✅ | **✅** |
| Distributed compute | ❌ | ❌ | ❌ | ❌ | **✅** |
| Scheduled tasks / cron | ❌ | ❌ | ❌ | ❌ | **✅** |
| PWA / mobile access | ✅ | ❌ | ❌ | ✅ | **✅** |
| Self-evolution | ❌ | ❌ | ❌ | ❌ | **✅** |
| Ollama auto-fallback | — | — | — | ❌ | **✅** |
| Screenshot + vision | ✅ (cloud) | ❌ | ❌ | ❌ | **✅ Local** |
| Plugin system | Plugin | ❌ | ❌ | ✅ | **✅ Hot-reload** |
| One-command setup | N/A | Installer | Installer | Docker | **✅** |
| Cost | $20/mo | Free | Free | Free | **Free** |

**Aries isn't just another chat UI.** It's a full AI operating system that runs on your machine.

<br>

## 🚀 Features

### 💬 AI Chat — Any Model, Any Provider
Stream responses from **Ollama** (local), **Anthropic** (Claude), **OpenAI** (GPT), **Groq**, or **OpenRouter**. Switch with one click. Automatic Ollama fallback when API limits hit — your conversations never stop.

### 🤖 14 Specialist AI Agents
Not one AI — **fourteen**. Each optimized for a task:

> 👑 Commander · 💻 Coder · 🔍 Researcher · 📊 Analyst · 🎨 Creative · 🛰️ Scout · ⚡ Executor · 🛡️ Security · 📈 Trader · 🐛 Debugger · 🏗️ Architect · ⚙️ Optimizer · 🧭 Navigator · 📝 Scribe

Deploy a **swarm** — multiple agents work in parallel on complex tasks, debate solutions, and synthesize results.

### 📚 RAG — Chat With Your Files
Drop a folder. Ask questions. Aries indexes your documents with TF-IDF scoring and retrieves relevant context automatically. No vector database needed. No embeddings API. **Works offline.**

### 💻 Code Interpreter
Run **JavaScript, Python, PowerShell, or Bash** directly in chat. Like ChatGPT's code interpreter — but fully local, no limits, no upload restrictions. Sandboxed with timeout and memory limits.

### 🌐 Browser Automation
Control a browser through natural language. Open pages, click elements, fill forms, take screenshots, extract data. All from the chat.

### 🔌 MCP Server — Connect Claude Desktop, Cursor, VS Code
Aries exposes its tools via the **Model Context Protocol**. Claude Desktop, Cursor, and VS Code can use Aries for:
- Web search & summarization
- Memory storage & retrieval
- Code execution
- RAG queries
- Screenshots

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

### ⚡ OpenAI-Compatible API
Drop-in replacement on port **18800**. Any tool that works with OpenAI's API works with Aries — routing to local Ollama or cloud providers.

```bash
curl http://localhost:18800/v1/chat/completions \
  -H "Authorization: Bearer aries-gateway-2026" \
  -d '{"model": "llama3", "messages": [{"role": "user", "content": "Hello"}]}'
```

### 📸 Screenshot + Vision
Capture your screen and analyze it with local multimodal models (LLaVA, Qwen-VL via Ollama). Computer vision without sending your screen to the cloud.

### ⏰ Scheduled Tasks & Cron
Full cron scheduling system built in. Schedule AI tasks, automated workflows, periodic checks — all from the dashboard UI. Standard cron expressions supported.

### 🌍 Chrome Extension
A browser companion that overlays Aries on any webpage. Highlight text, ask questions, get instant answers without leaving the page.

### 📱 Mobile & PWA
Open Aries on your phone. It installs as a PWA — looks and feels like a native app. QR code on the dashboard for instant mobile access.

### 🔄 Automatic Ollama Fallback
API key expired? Rate limited? Aries **automatically** switches to local Ollama models. No configuration. No interruption. A notification appears, and your conversation continues seamlessly. When the API comes back, Aries switches back.

### 🔐 Desktop App Experience
System tray icon, startup integration, desktop shortcuts. One-click installers for Windows, macOS, and Linux. Feels like a native app — because it is.

<br>

## 🐳 Docker

### Quick Start
```bash
docker run -d -p 3333:3333 -p 18800:18800 --name aries ghcr.io/dsfgsdgf33/aries
```

### With Local Ollama (GPU)
```bash
docker compose --profile gpu up -d
```

### Build From Source
```bash
docker build -t aries .
docker run -d -p 3333:3333 aries
```

The Docker image has **no `npm install` step** — because there are zero dependencies. The image is tiny.

<br>

## 🔌 MCP Server

Aries is a full MCP server. Connect it to your IDE and get AI superpowers everywhere.

<details>
<summary><b>Claude Desktop Setup</b></summary>

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "aries": {
      "command": "node",
      "args": ["C:/path/to/aries/launcher.js", "--mcp-stdio"]
    }
  }
}
```
</details>

<details>
<summary><b>Cursor Setup</b></summary>

Add to `.cursor/mcp.json`:
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
</details>

<details>
<summary><b>VS Code Setup</b></summary>

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
</details>

<details>
<summary><b>Available MCP Tools</b></summary>

| Tool | What It Does |
|------|-------------|
| `aries_chat` | Send messages to Aries AI |
| `aries_search` | Web search with summaries |
| `aries_memory_search` | Search persistent memory |
| `aries_memory_save` | Save to memory bank |
| `aries_rag_query` | Query indexed documents |
| `aries_run_code` | Execute code in sandbox |
| `aries_screenshot` | Capture screen |
| `aries_system_status` | System stats |
</details>

<br>

## 📱 Mobile & PWA

1. Open Aries on your phone's browser: `http://your-pc-ip:3333`
2. Tap **"Add to Home Screen"** / **"Install App"**
3. Done — Aries is now a native-feeling app on your phone

The dashboard generates a QR code for instant mobile access.

<br>

## 🛠️ Setup — How It Works

On first launch, Aries runs a **setup wizard** that configures everything:

### Local AI with Ollama (Recommended)
The wizard detects your hardware and:
1. Downloads and installs [Ollama](https://ollama.com) automatically
2. Selects the best model for your system:
   - **16GB+ RAM / GPU** → `deepseek-r1:14b`
   - **8–16GB RAM** → `llama3.1:8b`
   - **Under 8GB** → `phi3:mini`
3. You're chatting in ~60 seconds

### Cloud AI
Paste an API key for Anthropic (`sk-ant-*`), OpenAI (`sk-*`), Groq (`gsk_*`), or OpenRouter (`sk-or-*`). Validated instantly.

### Hybrid Mode
Use cloud APIs when available, **auto-fallback to Ollama** when rate limited. Best of both worlds.

<br>

## 📖 All Features

<details>
<summary><b>🏠 Dashboard & UI</b></summary>

- Cyberpunk web dashboard at `localhost:3333`
- 4 themes: Neon, Matrix, Synthwave, Midnight
- Real-time CPU, RAM, GPU monitoring
- Global search (Ctrl+K)
- Built-in terminal
- Notification center
</details>

<details>
<summary><b>🤖 AI & Agents</b></summary>

- Multi-model support (Ollama, Anthropic, OpenAI, Groq, OpenRouter)
- 14 specialist agents with parallel swarm execution
- Agent debate system (multiple perspectives on problems)
- Custom agent factory
- Conversation branching (like git for chats)
- 5 personas: Default, Coder, Creative, Analyst, Trader
- Autonomous goal execution
- Self-evolution & optimization
</details>

<details>
<summary><b>📚 Knowledge & Memory</b></summary>

- Persistent memory bank with categories & priorities
- RAG engine with TF-IDF scoring
- Knowledge graph with entity extraction
- Daily notes & long-term memory
- Semantic search
</details>

<details>
<summary><b>🛠️ Tools & Automation</b></summary>

- Code sandbox (JS, Python, PowerShell, Bash)
- Browser automation (Playwright)
- Screenshot & vision analysis
- Cron scheduler with calendar view
- Workflow engine & pipelines
- Web scraping & search
- File management
</details>

<details>
<summary><b>🌐 Integration</b></summary>

- MCP server (Claude Desktop, Cursor, VS Code)
- OpenAI-compatible API (port 18800)
- Chrome browser extension
- Telegram & Discord bots
- PWA / mobile access
- Docker deployment
</details>

<details>
<summary><b>🌍 Network & Swarm</b></summary>

- Distributed AI compute mesh
- One-click network join
- Model sharing across nodes
- Parallel task execution
- Remote worker management
</details>

<details>
<summary><b>🔒 Security & Reliability</b></summary>

- Token-based authentication
- Rate limiting
- Audit trail
- Self-healing (crash detection & auto-fix)
- Automated backups
- Config encryption (vault)
</details>

<br>

## 🏗️ Architecture

```
aries/
├── launcher.js          # Entry point
├── core/
│   ├── ai.js            # Multi-model AI with fallback chain
│   ├── ai-gateway.js    # OpenAI-compatible API server (port 18800)
│   ├── api-server.js    # HTTP server & REST API
│   ├── ollama-fallback.js  # Automatic Ollama fallback system
│   ├── mcp-server.js    # MCP server for Claude/Cursor/VS Code
│   ├── rag-engine.js    # Document indexing & retrieval
│   ├── code-sandbox.js  # Sandboxed code execution
│   ├── scheduler.js     # Cron-based task scheduling
│   ├── swarm-agents.js  # Multi-agent swarm system
│   └── ...              # 50+ core modules
├── web/
│   ├── index.html       # Dashboard UI
│   ├── manifest.json    # PWA manifest
│   └── sw.js            # Service worker
├── extensions/
│   └── aries-browser/   # Chrome extension
├── Dockerfile           # Docker support
├── docker-compose.yml   # Docker Compose with Ollama
└── docs/
    └── MCP-SETUP.md     # MCP configuration guide
```

**Zero dependencies.** Every module uses Node.js built-in APIs (`http`, `fs`, `crypto`, `child_process`, `os`, `zlib`). No `node_modules`. No supply chain risk.

<br>

## 📋 Requirements

- **Node.js 18+** — that's it
- ~200MB disk (+ AI model if using Ollama)
- Any OS: Windows, macOS, Linux
- **Optional:** Docker, Ollama

<br>

## 🤝 Contributing

MIT License. PRs welcome.

1. Fork → branch → PR
2. Zero dependencies rule: use only Node.js built-ins
3. Test before submitting

<br>

## ❓ FAQ

<details>
<summary><b>How is this zero dependencies?</b></summary>
Every module is written using only Node.js built-in APIs. The HTTP server, WebSocket server, crypto, file system operations — all use `require('http')`, `require('crypto')`, etc. No npm packages needed. The `package.json` lists optional deps for the TUI mode, but the core runs without them.
</details>

<details>
<summary><b>Is my data private?</b></summary>
Yes. Everything runs on your machine. When using Ollama, your data never leaves localhost. When using cloud APIs (Anthropic/OpenAI), data goes to their servers — but your config, memory, and files stay local.
</details>

<details>
<summary><b>Can I use this with Claude Desktop?</b></summary>
Yes! Aries is an MCP server. Add it to your Claude Desktop config and all Aries tools (search, memory, code execution, RAG) become available directly in Claude.
</details>

<details>
<summary><b>What happens when my API key runs out?</b></summary>
Aries automatically falls back to local Ollama models. A subtle notification appears. When the API is available again, it switches back. You don't have to do anything.
</details>

<br>

---

<div align="center">

```
              ╔═╗
             ╔╝ ╚╗
            ╔╝   ╚╗
           ╔╝ ▲▲▲ ╚╗
          ╔╝       ╚╗
         ╚╗         ╔╝
```

**MIT License** · Zero dependencies · Built with pure Node.js

**[⬆ Back to top](#)**

</div>
