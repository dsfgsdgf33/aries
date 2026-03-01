/**
 * Industry Accelerators — Pre-built vertical configurations
 * Solves the "cold start problem" with ready-to-deploy schemas, SOPs, agents, and KPIs.
 * No external dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CATALOG_PATH = path.join(__dirname, '..', 'data', 'accelerators', 'catalog.json');
const DEPLOYED_PATH = path.join(__dirname, '..', 'data', 'accelerators', 'deployed.json');

class IndustryAccelerators {
  constructor() {
    this._catalog = this._loadCatalog();
    this._deployed = this._loadDeployed();
  }

  _loadCatalog() {
    try {
      return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    } catch {
      return [];
    }
  }

  _loadDeployed() {
    try {
      return JSON.parse(fs.readFileSync(DEPLOYED_PATH, 'utf8'));
    } catch {
      return [];
    }
  }

  _saveDeployed() {
    try {
      const dir = path.dirname(DEPLOYED_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DEPLOYED_PATH, JSON.stringify(this._deployed, null, 2));
    } catch (e) {
      console.error('[ACCELERATORS] Failed to save deployed:', e.message);
    }
  }

  /** List all available accelerators (summary) */
  getCatalog() {
    return this._catalog.map(a => ({
      id: a.id,
      industry: a.industry,
      name: a.name,
      version: a.version,
      description: a.description,
      entityCount: a.schemas ? a.schemas.length : 0,
      agentCount: a.agents ? a.agents.length : 0,
      sopCount: a.sops ? a.sops.length : 0,
      kpiCount: a.kpis ? a.kpis.length : 0,
      compliance: a.riskProfile ? a.riskProfile.compliance : [],
      deployed: this._deployed.some(d => d.industry === a.industry)
    }));
  }

  /** Get full accelerator config by industry key */
  getAccelerator(industry) {
    const acc = this._catalog.find(a => a.industry === industry);
    if (!acc) return null;
    return { ...acc, deployed: this._deployed.some(d => d.industry === industry) };
  }

  /** Deploy an accelerator */
  deployAccelerator(industry) {
    const acc = this._catalog.find(a => a.industry === industry);
    if (!acc) return { success: false, error: 'Accelerator not found: ' + industry };
    if (this._deployed.some(d => d.industry === industry)) {
      return { success: false, error: 'Already deployed: ' + industry };
    }
    const deployment = {
      id: crypto.randomUUID(),
      industry: acc.industry,
      name: acc.name,
      deployedAt: new Date().toISOString(),
      schemas: acc.schemas.length,
      agents: acc.agents.length,
      sops: acc.sops.length,
      kpis: acc.kpis.length
    };
    this._deployed.push(deployment);
    this._saveDeployed();
    console.log(`[ACCELERATORS] Deployed: ${acc.name} (${acc.industry})`);
    return { success: true, deployment };
  }

  /** Customize an accelerator before deploying */
  customizeAccelerator(industry, overrides) {
    const acc = this._catalog.find(a => a.industry === industry);
    if (!acc) return null;
    const customized = JSON.parse(JSON.stringify(acc));
    if (overrides) {
      if (overrides.schemas) customized.schemas = overrides.schemas;
      if (overrides.sops) customized.sops = overrides.sops;
      if (overrides.agents) customized.agents = overrides.agents;
      if (overrides.kpis) customized.kpis = overrides.kpis;
      if (overrides.riskProfile) Object.assign(customized.riskProfile, overrides.riskProfile);
      if (overrides.name) customized.name = overrides.name;
      if (overrides.description) customized.description = overrides.description;
    }
    customized.id = crypto.randomUUID();
    customized.customized = true;
    return customized;
  }

  /** List deployed accelerators */
  getDeployedAccelerators() {
    return this._deployed;
  }

  /** Undeploy an accelerator */
  undeployAccelerator(industry) {
    const idx = this._deployed.findIndex(d => d.industry === industry);
    if (idx === -1) return { success: false, error: 'Not deployed: ' + industry };
    const removed = this._deployed.splice(idx, 1)[0];
    this._saveDeployed();
    console.log(`[ACCELERATORS] Undeployed: ${industry}`);
    return { success: true, removed };
  }
}

module.exports = IndustryAccelerators;
