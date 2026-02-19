# 🔌 Aries as MCP Server

Aries works as a **Model Context Protocol (MCP) server**, letting Claude Desktop, Cursor, VS Code, and other MCP clients use Aries tools directly.

## Quick Setup

### Claude Desktop

Add to your Claude Desktop config file:

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

### VS Code (Copilot)

Add to your VS Code `settings.json`:

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

## Available Tools

| Tool | Description |
|------|-------------|
| `aries_chat` | Chat with Aries AI (local or cloud models) |
| `aries_search` | Web search with summarized results |
| `aries_memory_search` | Search persistent memory bank |
| `aries_memory_save` | Save to persistent memory |
| `aries_rag_query` | Query indexed documents (RAG) |
| `aries_run_code` | Execute code in sandbox (JS, Python, PowerShell, Bash) |
| `aries_screenshot` | Capture screen screenshot |
| `aries_system_status` | Get system stats |

## SSE Transport

For HTTP/SSE-based MCP connections:

```
http://localhost:18801/sse
```

Start with `node launcher.js` — the SSE transport is available automatically.
