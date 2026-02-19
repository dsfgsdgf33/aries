# 🔌 Aries MCP Server — Setup Guide

Aries implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), letting Claude Desktop, Cursor, VS Code, and other MCP-compatible clients use Aries tools directly.

## Transports

Aries supports two MCP transports:

| Transport | How It Works | Best For |
|:----------|:-------------|:---------|
| **stdio** | Client spawns `node launcher.js --mcp-stdio` | Claude Desktop, Cursor, VS Code |
| **SSE** | Client connects to `http://localhost:18801/sse` | Remote clients, custom integrations |

The SSE transport starts automatically when Aries is running.

---

## Claude Desktop

Edit your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "aries": {
      "command": "node",
      "args": ["/absolute/path/to/aries/launcher.js", "--mcp-stdio"]
    }
  }
}
```

**Windows example:**
```json
{
  "mcpServers": {
    "aries": {
      "command": "node",
      "args": ["C:\\Users\\you\\aries\\launcher.js", "--mcp-stdio"]
    }
  }
}
```

Restart Claude Desktop after saving. You should see Aries tools appear in the tools menu (🔧 icon).

---

## Cursor

Add to `.cursor/mcp.json` in your project root (or global config):

```json
{
  "mcpServers": {
    "aries": {
      "command": "node",
      "args": ["/absolute/path/to/aries/launcher.js", "--mcp-stdio"]
    }
  }
}
```

Restart Cursor. Aries tools will be available in Cursor's AI features.

---

## VS Code (Copilot)

Add to your VS Code `settings.json` (`Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)"):

```json
{
  "mcp.servers": {
    "aries": {
      "command": "node",
      "args": ["/absolute/path/to/aries/launcher.js", "--mcp-stdio"]
    }
  }
}
```

---

## Available Tools

Once connected, these tools are available to your MCP client:

| Tool | Description |
|:-----|:------------|
| `aries_chat` | Chat with any AI model configured in Aries |
| `aries_search` | Web search with summarized results |
| `aries_memory_search` | Search persistent memory bank |
| `aries_memory_save` | Save information to memory |
| `aries_rag_query` | Query RAG-indexed documents |
| `aries_run_code` | Execute code in sandbox (JS, Python, Shell) |
| `aries_screenshot` | Capture screen screenshot |
| `aries_system_status` | Get system stats (CPU, RAM, GPU, uptime) |

---

## Troubleshooting

### Tools don't appear in Claude Desktop
1. Verify the path to `launcher.js` is absolute and correct
2. Make sure Node.js 18+ is in your system PATH
3. Restart Claude Desktop completely (quit and reopen)
4. Check Claude Desktop logs for MCP errors

### "Cannot find module" error
Use the full absolute path to `launcher.js`. Relative paths don't work with MCP stdio transport.

### SSE connection refused
Make sure Aries is running (`node launcher.js`). The SSE endpoint is at `http://localhost:18801/sse`.

### Permission errors on macOS/Linux
```bash
chmod +x /path/to/aries/launcher.js
```

---

## SSE Transport (Advanced)

For HTTP-based MCP connections (custom clients, remote access):

```
Endpoint: http://localhost:18801/sse
Method:   GET (SSE stream)
```

This is useful for MCP clients that don't support spawning local processes, or for connecting to Aries running on a remote machine.
