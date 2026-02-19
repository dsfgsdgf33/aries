# Changelog

All notable changes to Aries are documented here.

## v7.2.0 — Launch-Ready Docs (2026-02-19)

- Complete README rewrite — professional, comprehensive, scannable
- Added CONTRIBUTING.md with contribution guidelines
- Updated CHANGELOG.md with full version history
- Improved docs/MCP-SETUP.md

## v7.1.0 — Polish & Stability (2026-02-15)

- UI polish across all 4 themes (Neon, Matrix, Synthwave, Midnight)
- Improved streaming reliability for long responses
- Fixed Ollama fallback edge cases with certain error codes
- Better error messages in setup wizard
- Dashboard performance improvements
- Memory bank auto-pruning refinements

## v7.0.0 — Major Release (2026-02-01)

- **AI Gateway** — OpenAI-compatible API server on port 18800
- **MCP Server** — stdio + SSE transport for Claude Desktop, Cursor, VS Code
- **Workflow Engine** — chain AI steps into multi-step pipelines
- **Knowledge Graph** — automatic entity extraction and relationship mapping
- **Agent Factory** — create custom specialist agents
- **Conversation Engine** — session management with auto-compaction
- **Smart Router** — auto-route queries to optimal model by complexity
- **Plugin Marketplace** — hot-reload plugin system
- **Persistent Memory** — daily notes + long-term memory with auto-context
- **Self-Evolution** — weekly optimization suggestions
- Bumped config version to 7.0.0

## v6.0.0 — Swarm & Scale (2025-12-01)

- **Distributed Compute Mesh** — connect multiple machines
- **Swarm Agents** — 14 specialist agents with parallel execution
- **Agent Debate** — multiple agents argue perspectives, synthesize results
- **Remote Workers** — token-authenticated node pairing
- **Improved RAG** — TF-IDF scoring, better chunking
- **Browser Automation** — natural language browser control
- Docker Compose with GPU support

## v5.3.2 — One-Click Installers (2025-02-18)

- Windows one-click installer (`install-windows.ps1`)
- macOS/Linux one-click installer (`install-mac-linux.sh`)
- Remote one-liner installers (irm/curl pipes)
- Desktop shortcuts (Windows, Linux, macOS)
- First-run detection — launcher auto-runs setup wizard

## v5.0.0 — Foundation (2025-01-01)

- Initial public release
- Multi-model AI chat (Ollama, OpenAI, Anthropic, Groq, OpenRouter)
- Automatic Ollama fallback
- RAG engine
- Code sandbox (JS, Python, PowerShell, Bash)
- Cyberpunk web dashboard
- Chrome browser extension
- PWA mobile support
- Cron scheduler
- Screenshot + vision
- System tray integration

## System Requirements

- **Node.js** 18+ (20+ recommended)
- **OS:** Windows 10+, macOS 12+, Ubuntu 20.04+, Fedora 36+, Arch Linux
- **RAM:** 2 GB minimum, 4 GB+ recommended
- **Disk:** ~200 MB (+ model files if using Ollama)
