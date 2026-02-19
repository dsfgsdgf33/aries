# Aries Browser Extension

Chrome extension (Manifest V3) for autonomous browser control by Aries AI.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `aries/extensions/aries-browser/`

## How It Works

- Auto-connects via WebSocket to `ws://localhost:3333/ext`
- No toolbar click needed — fully autonomous
- Reconnects automatically every 5 seconds if disconnected

## Capabilities

| Command | Description |
|---------|-------------|
| `navigate` | Go to URL |
| `snapshot` | Get page content (text/html/clean) |
| `screenshot` | Capture visible tab as PNG |
| `click` | Click element (CSS/XPath/text) |
| `type` | Type into element |
| `fill` | Fill form fields by label/name |
| `select` | Select dropdown option |
| `scroll` | Scroll to element or position |
| `evaluate` | Run JavaScript in page |
| `waitFor` | Wait for element/text |
| `getLinks` | Extract all links |
| `getText` | Extract visible text |
| `getTables` | Extract tables as JSON |
| `getTabs` | List open tabs |
| `openTab` | Open new tab |
| `closeTab` | Close tab |
| `focusTab` | Switch to tab |
| `groupTabs` | Group tabs by domain |
| `closeDuplicates` | Close duplicate tabs |
| `watch` | Monitor URL for changes |
| `unwatch` | Stop monitoring |
| `saveCredentials` | Store encrypted login |
| `autoLogin` | Auto-fill and submit login |

## Protocol

```json
// Command (Aries → Extension)
{ "id": "uuid", "cmd": "navigate", "args": { "url": "https://example.com" } }

// Response (Extension → Aries)
{ "id": "uuid", "ok": true, "data": { "tabId": 1, "url": "..." } }

// Event (Extension → Aries)
{ "event": "tabUpdated", "data": { "tabId": 1, "url": "...", "title": "..." } }
```

## Server Side

The extension bridge (`core/extension-bridge.js`) handles the WebSocket server and provides REST API endpoints at `/api/extension/*`.
