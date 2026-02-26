/**
 * ARIES Native Tool Calling — OpenAI-compatible function calling
 * 
 * Instead of XML tags in text (<tool:write>), uses structured tool_calls
 * from the API response. Tools are separate from text — can't be cut off.
 * 
 * This is how OpenClaw works. Now Aries does too.
 */

// Tool definitions as OpenAI function schemas
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'shell',
      description: 'Run a shell command (PowerShell on Windows). Use for quick commands. Returns stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'shellBg',
      description: 'Run a command in background (servers, watchers). Returns PID.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run in background' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read a file. Returns file contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
          offset: { type: 'number', description: 'Line number to start from (1-indexed)' },
          limit: { type: 'number', description: 'Max lines to read' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write',
      description: 'Write content to a file. Creates directories if needed. ONE file per call.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write' },
          content: { type: 'string', description: 'Full file content' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit',
      description: 'Edit a file by replacing exact text. oldText must match exactly.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          oldText: { type: 'string', description: 'Exact text to find' },
          newText: { type: 'string', description: 'Replacement text' }
        },
        required: ['path', 'oldText', 'newText']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'append',
      description: 'Append content to a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'Content to append' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ls',
      description: 'List directory contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete',
      description: 'Delete a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to delete' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search for text in files using regex.',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Directory to search' },
          pattern: { type: 'string', description: 'Regex pattern' },
          glob: { type: 'string', description: 'File glob pattern' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Grep for pattern in files.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern' },
          dir: { type: 'string', description: 'Directory' },
          glob: { type: 'string', description: 'File glob' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'install',
      description: 'Install npm package.',
      parameters: {
        type: 'object',
        properties: {
          package: { type: 'string', description: 'Package name(s)' }
        },
        required: ['package']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'launch',
      description: 'Launch an application or open a URL.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'App path or URL' }
        },
        required: ['target']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'kill',
      description: 'Kill a process by name or PID.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Process name or PID' }
        },
        required: ['target']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bg_check',
      description: 'Check status of a background process.',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'string', description: 'Process ID' }
        },
        required: ['pid']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bg_kill',
      description: 'Kill a tracked background process.',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'string', description: 'Process ID' }
        },
        required: ['pid']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'bg_list',
      description: 'List all tracked background processes.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'websearch',
      description: 'Search the web.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web',
      description: 'Fetch and extract content from a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'memory',
      description: 'Save information to memory.',
      parameters: {
        type: 'object',
        properties: {
          info: { type: 'string', description: 'Information to remember' }
        },
        required: ['info']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'memorySearch',
      description: 'Search saved memories.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sandbox',
      description: 'Run code in a sandbox (node/python/powershell).',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Code to execute' },
          language: { type: 'string', description: 'Language: node, python, powershell', default: 'node' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'desktopScreenshot',
      description: 'Take a screenshot of the desktop.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Save path (optional)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git',
      description: 'Run a git command.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Git command (e.g. "status", "add .", "commit -m msg")' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'done',
      description: 'Signal that the task is COMPLETE. Use this when ALL work is finished.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Summary of what was accomplished' }
        },
        required: ['summary']
      }
    }
  }
];

/**
 * Map native tool call to Aries tools.js execution format
 */
function mapToolCallToArgs(name, args) {
  // Map function call arguments to the positional args that tools.js expects
  switch (name) {
    case 'shell': return [args.command];
    case 'shellBg': return [args.command];
    case 'read': return [args.path, args.offset, args.limit];
    case 'write': return [args.path, args.content];
    case 'edit': return [args.path, args.oldText, args.newText];
    case 'append': return [args.path, args.content];
    case 'ls': return [args.path];
    case 'delete': return [args.path];
    case 'search': return [args.dir || '.', args.pattern, args.glob];
    case 'grep': return [args.pattern, args.dir || '.', args.glob];
    case 'install': return [args.package];
    case 'launch': return [args.target];
    case 'kill': return [args.target];
    case 'bg_check': return [args.pid];
    case 'bg_kill': return [args.pid];
    case 'bg_list': return [];
    case 'websearch': return [args.query];
    case 'web': return [args.url];
    case 'memory': return [args.info];
    case 'memorySearch': return [args.query];
    case 'sandbox': return [args.code, args.language];
    case 'desktopScreenshot': return [args.filename];
    case 'git': return [args.command];
    case 'done': return [args.summary];
    default: return Object.values(args || {});
  }
}

// Map native names to tools.js names (bg_check -> bg-check etc)
function mapToolName(name) {
  const map = { bg_check: 'bg-check', bg_kill: 'bg-kill', bg_list: 'bg-list' };
  return map[name] || name;
}

module.exports = { TOOL_DEFINITIONS, mapToolCallToArgs, mapToolName };
