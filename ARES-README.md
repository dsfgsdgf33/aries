# ARES — Aries Recursive Evolution System

Self-training AI pipeline that uses Claude Opus for data generation, the Aries swarm for distributed training compute, and LoRA adapter stacking for parameter growth.

## Architecture

```
Opus API → Distiller → Training Data → Trainer → LoRA Adapter → Growth Engine
                                          ↑                          ↓
                                    Swarm Workers ←── Coordinator ──→ Credits
```

### Core Files (`core/ares/`)

| File | Purpose |
|------|---------|
| `ares-coordinator.js` | Central brain — manages the full training pipeline loop |
| `ares-distiller.js` | Queries Claude Opus to generate diverse training data across 8 categories |
| `ares-trainer.js` | Generates QLoRA training scripts, manages local fine-tuning |
| `ares-swarm-trainer.js` | Distributes training across swarm GPU nodes (Hivemind-style) |
| `ares-growth.js` | Tracks effective params, manages LoRA stacking & periodic merging |
| `ares-credits.js` | Credit system with 4 tiers: FREE → CONTRIBUTOR → TRAINER → CORE |
| `index.js` | Entry point — initializes all subsystems, registers API routes |

### Training Pipeline

1. **Data Generation** — Opus distills knowledge across: reasoning, code, creative writing, tool use, long context, problem solving, instruction following, roleplay
2. **Dataset Prep** — Formats to ChatML/Alpaca, splits train/eval (90/10)
3. **Training** — QLoRA fine-tuning (4-bit quantized). Local or distributed via swarm
4. **Adapter Stacking** — Each cycle adds a LoRA adapter (~84-336M params depending on rank)
5. **Merge & Grow** — When stack reaches threshold, merge into new base
6. **Evaluate** — Score model on held-out eval set

### Growth Strategy

- Cycles 1-10: LoRA rank 64 → ~71B effective
- Cycles 11-50: LoRA rank 128, stacking → ~75-80B
- Cycles 51+: Merge, rank 256 → 90B+

### API Endpoints

```
GET  /api/ares/status          — Full system status
GET  /api/ares/model           — Model info (params, version, adapters)
GET  /api/ares/growth          — Growth history + 6-month projection
GET  /api/ares/training        — Training cycle status
POST /api/ares/training/start  — Start new cycle
POST /api/ares/training/stop   — Stop current cycle
GET  /api/ares/data            — Distillation dataset stats
POST /api/ares/data/generate   — Generate data from Opus {category, count}
POST /api/ares/schedule        — Set schedule {schedule: "daily"|"weekly"|null}
GET  /api/ares/credits         — Tier breakdown (or ?workerId=X for specific)
GET  /api/ares/leaderboard     — Top contributors
GET  /api/ares/swarm/training  — Swarm training stats
POST /api/ares/swarm/register  — Register GPU worker
POST /api/ares/swarm/training/gradient — Submit gradient (workers)
GET  /api/ares/export          — Export model manifest
```

### Dashboard

🧠 Evolution tab in the web dashboard with:
- Model status (params, cycle, adapters, version)
- Training controls (start cycle, generate data, schedule)
- Dataset breakdown by category with progress bars
- Swarm GPU worker status
- 6-month growth projection bar chart
- Leaderboard and tier breakdown

### State Files (`data/`)

- `ares-state.json` — Coordinator state (cycles, params, history)
- `ares-growth.json` — Growth engine state (adapters, merges, timeline)
- `ares-credits.json` — Worker credits and tiers
- `ares-distiller-stats.json` — Distillation statistics
- `ares-swarm-training.json` — Swarm training state
- `ares-training-data/` — Generated training examples by cycle
- `ares-datasets/` — Formatted train/eval JSONL files
- `ares-adapters/` — LoRA adapter weights by cycle
- `ares-scripts/` — Generated training shell/batch scripts

### Integration

- Initialized in `headless.js` during boot sequence
- API routes registered via `addPluginRoute` pattern
- WebSocket events broadcast for real-time dashboard updates
- Anthropic API key pulled from `config.json` → `ariesGateway.providers.anthropic.apiKey`
- Zero npm dependencies — pure Node.js
