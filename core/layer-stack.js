/**
 * Layer Stack Registry — 13-layer architecture representation
 * Maps every Aries module to its architectural layer.
 * No external dependencies.
 */
'use strict';

const LAYERS = [
  { layer: 0,  name: 'Infrastructure',    cluster: 'Inference Core',  modules: ['system', 'headless'] },
  { layer: 1,  name: 'Token I/O',         cluster: 'Inference Core',  modules: ['ai'] },
  { layer: 2,  name: 'Memory/Context',    cluster: 'Inference Core',  modules: ['persistent-memory', 'conversation-engine'] },
  { layer: 3,  name: 'Risk Detection',    cluster: 'Inference Core',  modules: ['threat-intel', 'immune-system'] },
  { layer: 4,  name: 'Decision Engine',   cluster: 'Inference Core',  modules: ['decision-lineage', 'earned-autonomy'] },
  { layer: 5,  name: 'Router',            cluster: 'Inference Core',  modules: ['ai-gateway', 'provider-manager'] },
  { layer: 6,  name: 'Governance',        cluster: 'Orchestration',   modules: ['governance', 'approval-packet', 'verification-engines'] },
  { layer: 7,  name: 'Retrieval',         cluster: 'Orchestration',   modules: ['knowledge-hub', 'persistent-memory'] },
  { layer: 8,  name: 'Ingestion',         cluster: 'Orchestration',   modules: ['knowledge-hub'] },
  { layer: 9,  name: 'Compiler',          cluster: 'Orchestration',   modules: ['schema-compiler'] },
  { layer: 10, name: 'Agents',            cluster: 'Application',     modules: ['virtual-employees', 'swarm'] },
  { layer: 11, name: 'Knowledge',         cluster: 'Application',     modules: ['knowledge-hub', 'knowledge-graph'] },
  { layer: 12, name: 'App UI',            cluster: 'Application',     modules: ['web/index.html', 'web/app.js', 'web/style.css'] }
];

// Map module names to ref keys (strip path prefix, convert hyphens)
function moduleToRefKey(mod) {
  // web/ files aren't refs
  if (mod.startsWith('web/')) return null;
  // Convert kebab-case to camelCase for ref lookup
  return mod.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

class LayerStack {
  constructor(refs) {
    this._refs = refs || {};
  }

  /** Full 13-layer stack */
  getStack() {
    return LAYERS.map(l => ({ ...l }));
  }

  /** Specific layer detail */
  getLayer(num) {
    const n = parseInt(num, 10);
    return LAYERS.find(l => l.layer === n) || null;
  }

  /** Check health of each layer */
  getLayerHealth() {
    return LAYERS.map(l => {
      const moduleHealth = l.modules.map(mod => {
        const refKey = moduleToRefKey(mod);
        if (!refKey) return { module: mod, status: 'static', loaded: true };
        const loaded = !!this._refs[refKey];
        return { module: mod, refKey, status: loaded ? 'healthy' : 'missing', loaded };
      });
      const allLoaded = moduleHealth.every(m => m.loaded);
      const someLoaded = moduleHealth.some(m => m.loaded);
      return {
        layer: l.layer,
        name: l.name,
        cluster: l.cluster,
        status: allLoaded ? 'healthy' : someLoaded ? 'degraded' : 'down',
        modules: moduleHealth
      };
    });
  }

  /** Find which layer a module belongs to */
  getModuleLayer(moduleName) {
    const results = [];
    for (const l of LAYERS) {
      if (l.modules.includes(moduleName)) {
        results.push({ layer: l.layer, name: l.name, cluster: l.cluster });
      }
    }
    return results.length ? results : null;
  }

  /** Overall system health */
  getStackStatus() {
    const health = this.getLayerHealth();
    const healthy = health.filter(h => h.status === 'healthy').length;
    const degraded = health.filter(h => h.status === 'degraded').length;
    const down = health.filter(h => h.status === 'down').length;
    return {
      totalLayers: 13,
      healthy,
      degraded,
      down,
      overall: down > 0 ? 'critical' : degraded > 0 ? 'degraded' : 'healthy',
      layers: health
    };
  }
}

module.exports = LayerStack;
