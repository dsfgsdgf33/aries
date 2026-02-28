# Aries — AI Agent Operating System

## One-Liner
Aries is an open-source AI agent platform that turns any computer into an autonomous AI workstation with multi-model orchestration, swarm computing, and a full suite of 42+ built-in tools.

## Problem
AI agents today are fragmented — locked into single providers, can't coordinate, and require expensive cloud infrastructure. Individual developers and small teams can't build or deploy autonomous agents without vendor lock-in.

## Solution
Aries is a self-hosted, open-source AI agent OS that:
- **Multi-model orchestration**: Routes between OpenAI, Anthropic, Google Gemini, Groq, and local Ollama models
- **Autonomous coding agent**: 20-iteration agentic loop with multi-agent swarm (architect/coder/reviewer/tester/fixer)
- **42+ built-in tools**: Web search, browser automation, file ops, git, crypto, TTS, screenshots, network scanning — zero npm dependencies
- **Swarm computing**: P2P network where any machine contributes compute and earns tokens
- **Knowledge graph + memory**: Persistent context across sessions with graph-based reasoning
- **Plugin system**: Hot-reloadable plugins with sandboxed execution
- **Model arena**: Compare models head-to-head with automated scoring
- **Desktop app**: Cyberpunk dashboard with real-time monitoring, or terminal TUI mode

## Traction
- GitHub: https://github.com/dsfgsdgf33/aries
- 12,000+ lines of code, 47+ files, fully functional
- Running in production on developer workstations
- Zero external dependencies philosophy — pure Node.js
- Active development since February 2026

## Business Model
- **Open core**: Free self-hosted agent platform
- **Aries Tokens**: Swarm economy — compute contributors earn tokens, power users spend them
- **Enterprise**: Managed deployment, priority support, custom integrations
- **Marketplace**: Agent marketplace where developers sell specialized agents/skills

## Team
- Jay Dane Warren — Solo founder, full-stack developer, day trader
- JDW (AI) — Co-developed the entire platform autonomously

## Ask
- $5,000-$50,000 in grants for continued open-source development
- Cloud compute credits for swarm infrastructure
- Mentorship on go-to-market and scaling

## Links
- GitHub: https://github.com/dsfgsdgf33/aries
- Demo: localhost:3333 (self-hosted)
- Contact: dsfgsdgf33 on GitHub

## Technical Architecture
```
┌─────────────────────────────────────────┐
│              Aries Dashboard            │
│   (Cyberpunk Web UI + Terminal TUI)     │
├─────────────────────────────────────────┤
│           AI Orchestration Layer        │
│  OpenAI │ Anthropic │ Gemini │ Ollama   │
├─────────────────────────────────────────┤
│              Agent Layer                │
│  Hands │ Subagents │ Coding Agent       │
│  Swarm │ Arena │ Workflows │ Plugins    │
├─────────────────────────────────────────┤
│            Infrastructure               │
│  KnowledgeGraph │ SQLite │ P2P Swarm    │
│  Security │ Audit │ Migration │ Voice   │
└─────────────────────────────────────────┘
```

## Why Now
- AI agents are the fastest-growing category in tech
- No open-source platform offers full agent orchestration + swarm computing
- The shift from cloud-only to local-first AI is accelerating
- Hardware is cheap enough for distributed swarm networks
