/**
 * migration-engine.js — Import data from other AI agent frameworks into Aries
 * 
 * Supports: openclaw, langchain, crewai, autogen
 * No external dependencies.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { MemoryDB, getInstance } = require('./sqlite-memory');

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return 0;
  let count = 0;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      count += copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    count = 1;
  }
  return count;
}

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

// ─── Migration Engine ───────────────────────────────────────────────────────

class MigrationEngine {
  constructor(ariesDir) {
    this.ariesDir = ariesDir || process.cwd();
  }

  /**
   * @param {'openclaw'|'langchain'|'crewai'|'autogen'} source
   * @param {object} options
   * @param {string} [options.sourcePath] — override default source location
   * @param {boolean} [options.dryRun] — report only, don't modify
   * @param {boolean} [options.backup] — backup before migration (default true)
   */
  async migrateFrom(source, options = {}) {
    const opts = { dryRun: false, backup: true, ...options };

    // Backup existing data
    if (opts.backup && !opts.dryRun) {
      this._backup();
    }

    switch (source) {
      case 'openclaw': return this._migrateOpenClaw(opts);
      case 'langchain': return this._migrateLangChain(opts);
      case 'crewai': return this._migrateCrewAI(opts);
      case 'autogen': return this._migrateAutoGen(opts);
      default: throw new Error(`Unknown migration source: ${source}`);
    }
  }

  _backup() {
    const dbPath = path.join(this.ariesDir, 'data', 'memory', 'memory.db.json');
    if (fs.existsSync(dbPath)) {
      const backupDir = path.join(this.ariesDir, 'data', 'backups');
      ensureDir(backupDir);
      const dest = path.join(backupDir, `memory.db.${timestamp()}.json`);
      fs.copyFileSync(dbPath, dest);
    }
  }

  // ── OpenClaw ───────────────────────────────────────────────────────────

  async _migrateOpenClaw(opts) {
    const report = { source: 'openclaw', imported: { memories: 0, conversations: 0, skills: 0, configs: 0 }, errors: [] };
    const srcPath = opts.sourcePath || path.join(os.homedir(), '.openclaw');

    if (!fs.existsSync(srcPath)) {
      // Also try workspace pattern
      const altPaths = [
        path.join(os.homedir(), 'openclaw', 'workspace'),
        path.join(os.homedir(), '.openclaw', 'workspace'),
      ];
      const found = altPaths.find(p => fs.existsSync(p));
      if (!found) {
        report.errors.push(`OpenClaw directory not found at ${srcPath} or common locations`);
        return report;
      }
      return this._migrateOpenClawWorkspace(found, opts, report);
    }

    return this._migrateOpenClawWorkspace(srcPath, opts, report);
  }

  async _migrateOpenClawWorkspace(srcPath, opts, report) {
    const db = opts.dryRun ? null : await getInstance(this.ariesDir);

    // Import MEMORY.md
    const memoryMd = path.join(srcPath, 'MEMORY.md');
    if (fs.existsSync(memoryMd)) {
      const content = fs.readFileSync(memoryMd, 'utf-8');
      const sections = content.split(/^##\s+/m).filter(Boolean);
      for (const section of sections) {
        const text = section.trim();
        if (text.length > 10) {
          if (!opts.dryRun) {
            await db.addMemory(text, { source: 'migration:openclaw:MEMORY.md' });
          }
          report.imported.memories++;
        }
      }
    }

    // Import memory/*.md
    const memDir = path.join(srcPath, 'memory');
    if (fs.existsSync(memDir)) {
      const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(memDir, file), 'utf-8');
          const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
          const ts = dateMatch ? new Date(dateMatch[1]).getTime() : Date.now();
          const sections = content.split(/^##?\s+/m).filter(s => s.trim().length > 10);
          if (sections.length === 0 && content.trim().length > 10) sections.push(content);
          for (const section of sections) {
            if (!opts.dryRun) {
              await db.addMemory(section.trim(), {
                source: `migration:openclaw:memory/${file}`,
                timestamp: ts,
              });
            }
            report.imported.memories++;
          }
        } catch (err) {
          report.errors.push(`memory/${file}: ${err.message}`);
        }
      }
    }

    // Import conversation history (if stored as JSON)
    const historyPaths = [
      path.join(srcPath, 'data', 'conversations'),
      path.join(srcPath, '.history'),
      path.join(srcPath, 'conversations'),
    ];
    for (const hp of historyPaths) {
      if (!fs.existsSync(hp)) continue;
      const files = fs.readdirSync(hp).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = readJsonSafe(path.join(hp, file));
          if (!data) continue;
          const messages = Array.isArray(data) ? data : (data.messages || []);
          for (const msg of messages) {
            if (msg.role && msg.content) {
              if (!opts.dryRun) {
                await db.addConversation(
                  msg.sessionId || file.replace('.json', ''),
                  msg.role,
                  typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                  msg.model || null
                );
              }
              report.imported.conversations++;
            }
          }
        } catch (err) {
          report.errors.push(`conversations/${file}: ${err.message}`);
        }
      }
    }

    // Import skills
    const skillsSrc = path.join(srcPath, 'skills');
    if (fs.existsSync(skillsSrc)) {
      const skillsDest = path.join(this.ariesDir, 'data', 'skills');
      if (opts.dryRun) {
        report.imported.skills = fs.readdirSync(skillsSrc).length;
      } else {
        report.imported.skills = copyRecursive(skillsSrc, skillsDest);
      }
    }

    // Import config
    const configPaths = [
      path.join(srcPath, 'config.json'),
      path.join(srcPath, 'SOUL.md'),
      path.join(srcPath, 'USER.md'),
    ];
    for (const cp of configPaths) {
      if (!fs.existsSync(cp)) continue;
      if (cp.endsWith('.json') && !opts.dryRun) {
        try {
          const srcConfig = readJsonSafe(cp);
          const destConfigPath = path.join(this.ariesDir, 'config.json');
          const destConfig = fs.existsSync(destConfigPath) ? readJsonSafe(destConfigPath) || {} : {};
          const merged = { ...destConfig, _imported_openclaw: srcConfig };
          fs.writeFileSync(destConfigPath, JSON.stringify(merged, null, 2));
        } catch (err) {
          report.errors.push(`config merge: ${err.message}`);
        }
      } else if (!opts.dryRun) {
        // Copy personality files as memories
        const content = fs.readFileSync(cp, 'utf-8');
        await db.addMemory(content, {
          source: `migration:openclaw:${path.basename(cp)}`,
          category: 'reference',
          priority: 5,
        });
      }
      report.imported.configs++;
    }

    return report;
  }

  // ── LangChain ──────────────────────────────────────────────────────────

  async _migrateLangChain(opts) {
    const report = { source: 'langchain', imported: { memories: 0, conversations: 0, skills: 0, configs: 0 }, errors: [] };
    const srcPath = opts.sourcePath;
    if (!srcPath || !fs.existsSync(srcPath)) {
      report.errors.push('LangChain source path required (options.sourcePath)');
      return report;
    }

    const db = opts.dryRun ? null : await getInstance(this.ariesDir);

    // Import checkpoints (common LangChain persistence pattern)
    const checkpointDirs = ['checkpoints', '.checkpoints', 'data'];
    for (const dir of checkpointDirs) {
      const cp = path.join(srcPath, dir);
      if (!fs.existsSync(cp)) continue;
      const files = fs.readdirSync(cp).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = readJsonSafe(path.join(cp, file));
          if (!data) continue;

          // LangChain checkpoint format: { messages: [...], metadata: {...} }
          const messages = data.messages || data.chat_history || data.history || [];
          for (const msg of (Array.isArray(messages) ? messages : [])) {
            const role = msg.type === 'human' ? 'user'
              : msg.type === 'ai' ? 'assistant'
              : msg.role || msg.type || 'unknown';
            const content = msg.content || msg.text || '';
            if (content) {
              if (!opts.dryRun) {
                await db.addConversation(file.replace('.json', ''), role, content, null);
              }
              report.imported.conversations++;
            }
          }
        } catch (err) {
          report.errors.push(`langchain/${dir}/${file}: ${err.message}`);
        }
      }
    }

    // Import tool definitions → convert to Aries skill stubs
    const toolFiles = ['tools.json', 'tools.yaml', 'config/tools.json'];
    for (const tf of toolFiles) {
      const toolPath = path.join(srcPath, tf);
      if (!fs.existsSync(toolPath) || !toolPath.endsWith('.json')) continue;
      try {
        const tools = readJsonSafe(toolPath);
        if (!Array.isArray(tools)) continue;
        for (const tool of tools) {
          if (!opts.dryRun) {
            const skillDir = path.join(this.ariesDir, 'data', 'skills', tool.name || 'unnamed-tool');
            ensureDir(skillDir);
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
              `# ${tool.name || 'Imported Tool'}`,
              '', tool.description || '',
              '', '## Parameters',
              '', JSON.stringify(tool.parameters || tool.args || {}, null, 2),
              '', `_Imported from LangChain on ${new Date().toISOString()}_`,
            ].join('\n'));
          }
          report.imported.skills++;
        }
      } catch (err) {
        report.errors.push(`langchain tools: ${err.message}`);
      }
    }

    // Import memory (LangChain memory stores)
    const memFiles = ['memory.json', 'data/memory.json', 'vector_store.json'];
    for (const mf of memFiles) {
      const mp = path.join(srcPath, mf);
      if (!fs.existsSync(mp)) continue;
      try {
        const data = readJsonSafe(mp);
        if (!data) continue;
        const entries = Array.isArray(data) ? data : (data.memories || data.entries || []);
        for (const entry of entries) {
          const text = entry.text || entry.content || entry.page_content || '';
          if (text.length > 5) {
            if (!opts.dryRun) {
              await db.addMemory(text, { source: 'migration:langchain' });
            }
            report.imported.memories++;
          }
        }
      } catch (err) {
        report.errors.push(`langchain memory: ${err.message}`);
      }
    }

    return report;
  }

  // ── CrewAI ─────────────────────────────────────────────────────────────

  async _migrateCrewAI(opts) {
    const report = { source: 'crewai', imported: { memories: 0, conversations: 0, skills: 0, configs: 0 }, errors: [] };
    const srcPath = opts.sourcePath;
    if (!srcPath || !fs.existsSync(srcPath)) {
      report.errors.push('CrewAI source path required (options.sourcePath)');
      return report;
    }

    const db = opts.dryRun ? null : await getInstance(this.ariesDir);

    // CrewAI stores agent configs, task results, and crew outputs
    // Import crew config as reference memory
    for (const configFile of ['crew.json', 'crew.yaml', 'config/agents.json']) {
      const cp = path.join(srcPath, configFile);
      if (!fs.existsSync(cp) || !cp.endsWith('.json')) continue;
      try {
        const config = readJsonSafe(cp);
        if (config && !opts.dryRun) {
          await db.addMemory(JSON.stringify(config, null, 2), {
            source: 'migration:crewai:config',
            category: 'reference',
            tags: ['crewai', 'config', 'agents'],
          });
        }
        report.imported.configs++;
      } catch (err) {
        report.errors.push(`crewai config: ${err.message}`);
      }
    }

    // Import task outputs
    const outputDirs = ['output', 'outputs', 'results'];
    for (const dir of outputDirs) {
      const op = path.join(srcPath, dir);
      if (!fs.existsSync(op)) continue;
      const files = fs.readdirSync(op);
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(op, file), 'utf-8');
          if (content.length > 10) {
            if (!opts.dryRun) {
              await db.addMemory(content.slice(0, 5000), {
                source: `migration:crewai:output/${file}`,
                category: 'project',
              });
            }
            report.imported.memories++;
          }
        } catch (err) {
          report.errors.push(`crewai output/${file}: ${err.message}`);
        }
      }
    }

    return report;
  }

  // ── AutoGen ────────────────────────────────────────────────────────────

  async _migrateAutoGen(opts) {
    const report = { source: 'autogen', imported: { memories: 0, conversations: 0, skills: 0, configs: 0 }, errors: [] };
    const srcPath = opts.sourcePath;
    if (!srcPath || !fs.existsSync(srcPath)) {
      report.errors.push('AutoGen source path required (options.sourcePath)');
      return report;
    }

    const db = opts.dryRun ? null : await getInstance(this.ariesDir);

    // AutoGen stores conversations in JSON logs
    const logDirs = ['.cache', 'logs', 'runtime_logs'];
    for (const dir of logDirs) {
      const lp = path.join(srcPath, dir);
      if (!fs.existsSync(lp)) continue;
      const files = fs.readdirSync(lp).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = readJsonSafe(path.join(lp, file));
          if (!data) continue;
          const messages = Array.isArray(data) ? data : (data.messages || data.chat_history || []);
          for (const msg of messages) {
            if (msg.content) {
              if (!opts.dryRun) {
                await db.addConversation(
                  file.replace('.json', ''),
                  msg.role || msg.name || 'unknown',
                  typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                  msg.model || null
                );
              }
              report.imported.conversations++;
            }
          }
        } catch (err) {
          report.errors.push(`autogen ${dir}/${file}: ${err.message}`);
        }
      }
    }

    // Import OAI config
    const oaiConfig = path.join(srcPath, 'OAI_CONFIG_LIST');
    if (fs.existsSync(oaiConfig)) {
      try {
        const config = readJsonSafe(oaiConfig);
        if (config && !opts.dryRun) {
          await db.addMemory(JSON.stringify(config, null, 2), {
            source: 'migration:autogen:config',
            category: 'reference',
            tags: ['autogen', 'config', 'models'],
          });
        }
        report.imported.configs++;
      } catch (err) {
        report.errors.push(`autogen config: ${err.message}`);
      }
    }

    return report;
  }
}

// ─── Convenience ────────────────────────────────────────────────────────────

async function migrate(source, options = {}) {
  const engine = new MigrationEngine(options.ariesDir || process.cwd());
  return engine.migrateFrom(source, options);
}

module.exports = { MigrationEngine, migrate };
