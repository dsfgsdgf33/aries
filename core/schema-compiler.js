/**
 * Schema Compiler — Layer 9
 * Takes DDD schema definitions and compiles them into full-stack application blueprints.
 * Pure JS, no dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'compiler');
const SCHEMAS_FILE = path.join(DATA_DIR, 'schemas.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

function ensureDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function loadJSON(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}
function saveJSON(fp, data) {
  ensureDir();
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

class SchemaCompiler {
  constructor() {
    ensureDir();
  }

  // ── Validate ──
  validateSchema(schema) {
    const errors = [];
    if (!schema) return { valid: false, errors: ['Schema is null/undefined'] };
    if (!schema.schema) errors.push('Missing "schema" version field');
    if (!schema.domain) errors.push('Missing "domain" field');
    if (!Array.isArray(schema.entities) || schema.entities.length === 0)
      errors.push('Missing or empty "entities" array');

    const entityNames = new Set();
    if (Array.isArray(schema.entities)) {
      for (const e of schema.entities) {
        if (!e.name) { errors.push('Entity missing "name"'); continue; }
        if (entityNames.has(e.name)) errors.push(`Duplicate entity: ${e.name}`);
        entityNames.add(e.name);
        if (!Array.isArray(e.fields) || e.fields.length === 0)
          errors.push(`Entity "${e.name}" has no fields`);
        if (Array.isArray(e.fields)) {
          const hasPrimary = e.fields.some(f => f.primary);
          if (!hasPrimary) errors.push(`Entity "${e.name}" has no primary key`);
          for (const f of e.fields) {
            if (!f.name) errors.push(`Field in "${e.name}" missing name`);
            if (!f.type) errors.push(`Field "${f.name}" in "${e.name}" missing type`);
            if (f.type === 'ref' && !f.ref) errors.push(`Ref field "${f.name}" in "${e.name}" missing ref target`);
            if (f.type === 'ref' && f.ref && !entityNames.has(f.ref) && !schema.entities.some(en => en.name === f.ref))
              errors.push(`Ref "${f.ref}" in "${e.name}.${f.name}" not found in entities`);
            if (f.type === 'enum' && (!Array.isArray(f.values) || f.values.length === 0))
              errors.push(`Enum field "${f.name}" in "${e.name}" missing values`);
          }
        }
      }
    }

    if (Array.isArray(schema.relationships)) {
      for (const r of schema.relationships) {
        if (!r.from || !r.to) errors.push('Relationship missing from/to');
        if (r.from && !entityNames.has(r.from)) errors.push(`Relationship from "${r.from}" — entity not found`);
        if (r.to && !entityNames.has(r.to)) errors.push(`Relationship to "${r.to}" — entity not found`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ── Generate Database ──
  generateDatabase(entities, relationships) {
    const tables = [];
    const indexes = [];
    const rls_policies = [];

    for (const e of entities) {
      const cols = [];
      for (const f of e.fields) {
        const col = { name: f.name, type: this._mapDbType(f.type), nullable: !f.required && !f.primary };
        if (f.primary) col.primaryKey = true;
        if (f.type === 'ref') { col.type = 'uuid'; col.foreignKey = { table: this._tableName(f.ref), column: 'id' }; }
        if (f.type === 'enum') col.check = f.values;
        cols.push(col);
      }
      // Add timestamps
      cols.push({ name: 'created_at', type: 'timestamp', nullable: false, default: 'NOW()' });
      cols.push({ name: 'updated_at', type: 'timestamp', nullable: false, default: 'NOW()' });

      const tName = this._tableName(e.name);
      tables.push({ name: tName, columns: cols });

      // Indexes on foreign keys and required fields
      for (const f of e.fields) {
        if (f.type === 'ref') indexes.push({ table: tName, column: f.name, type: 'btree' });
        if (f.type === 'enum') indexes.push({ table: tName, column: f.name, type: 'btree' });
      }

      // RLS
      if (e.rls) {
        if (e.rls.read) rls_policies.push({ table: tName, action: 'SELECT', roles: this._parseRoles(e.rls.read) });
        if (e.rls.write) rls_policies.push({ table: tName, action: 'INSERT', roles: this._parseRoles(e.rls.write) });
        if (e.rls.write) rls_policies.push({ table: tName, action: 'UPDATE', roles: this._parseRoles(e.rls.write) });
        if (e.rls.write) rls_policies.push({ table: tName, action: 'DELETE', roles: this._parseRoles(e.rls.write) });
      }
    }

    return { tables, indexes, rls_policies };
  }

  // ── Generate API ──
  generateAPI(entities) {
    const endpoints = [];
    const validation = [];

    for (const e of entities) {
      const base = `/api/${this._tableName(e.name)}`;
      const reqFields = e.fields.filter(f => f.required && !f.primary).map(f => f.name);

      endpoints.push({ method: 'GET', path: base, description: `List all ${e.name}` });
      endpoints.push({ method: 'GET', path: `${base}/:id`, description: `Get ${e.name} by ID` });
      endpoints.push({ method: 'POST', path: base, description: `Create ${e.name}`, requiredFields: reqFields });
      endpoints.push({ method: 'PUT', path: `${base}/:id`, description: `Update ${e.name}` });
      endpoints.push({ method: 'DELETE', path: `${base}/:id`, description: `Delete ${e.name}` });

      // Validation rules
      for (const f of e.fields) {
        const rule = { entity: e.name, field: f.name, type: f.type };
        if (f.required) rule.required = true;
        if (f.type === 'enum') rule.allowedValues = f.values;
        if (f.type === 'ref') rule.refEntity = f.ref;
        validation.push(rule);
      }
    }

    return { endpoints, validation };
  }

  // ── Generate UI ──
  generateUI(entities) {
    const components = [];
    const forms = [];
    const tables = [];

    for (const e of entities) {
      components.push({ name: `${e.name}List`, type: 'list-view', entity: e.name });
      components.push({ name: `${e.name}Detail`, type: 'detail-view', entity: e.name });
      components.push({ name: `${e.name}Form`, type: 'form', entity: e.name });

      const formFields = [];
      const tableCols = [];

      for (const f of e.fields) {
        if (f.primary) { tableCols.push({ field: f.name, label: 'ID', sortable: true }); continue; }
        const input = { field: f.name, label: this._humanize(f.name), required: !!f.required };
        if (f.type === 'enum') { input.inputType = 'select'; input.options = f.values; }
        else if (f.type === 'ref') { input.inputType = 'reference-picker'; input.refEntity = f.ref; }
        else if (f.type === 'number') input.inputType = 'number';
        else if (f.type === 'boolean') input.inputType = 'checkbox';
        else input.inputType = 'text';
        formFields.push(input);
        tableCols.push({ field: f.name, label: this._humanize(f.name), sortable: true });
      }

      forms.push({ entity: e.name, fields: formFields });
      tables.push({ entity: e.name, columns: tableCols });
    }

    return { components, forms, tables };
  }

  // ── Generate Security ──
  generateSecurity(entities, sops) {
    const rolesSet = new Set();
    const permissions = [];
    const rls_rules = [];

    for (const e of entities) {
      if (e.rls) {
        if (e.rls.read) {
          const roles = this._parseRoles(e.rls.read);
          roles.forEach(r => rolesSet.add(r));
          permissions.push({ entity: e.name, action: 'read', roles });
        }
        if (e.rls.write) {
          const roles = this._parseRoles(e.rls.write);
          roles.forEach(r => rolesSet.add(r));
          permissions.push({ entity: e.name, action: 'write', roles });
        }
        rls_rules.push({ entity: e.name, read: e.rls.read, write: e.rls.write });
      }
    }

    if (Array.isArray(sops)) {
      for (const s of sops) {
        if (s.riskClass === 'R2' || s.riskClass === 'R3') {
          permissions.push({ sop: s.name, action: s.action, requiresApproval: true, riskClass: s.riskClass });
        }
      }
    }

    return { roles: Array.from(rolesSet), permissions, rls_rules };
  }

  // ── Generate Agents ──
  generateAgents(sops, entities) {
    if (!Array.isArray(sops) || sops.length === 0) return [];
    const agents = [];
    for (const sop of sops) {
      const [entityName] = (sop.trigger || '').split('.');
      const entity = entities.find(e => e.name === entityName);
      agents.push({
        role: this._humanize(sop.name).replace(/-/g, ' '),
        mandate: `Automatically handle "${sop.action}" when ${sop.trigger}`,
        trigger: sop.trigger,
        action: sop.action,
        riskClass: sop.riskClass || 'R1',
        kpis: [
          `${sop.action} completion rate`,
          `Average ${sop.action} response time`,
          `Error rate for ${sop.action}`
        ],
        entity: entity ? entity.name : entityName
      });
    }
    return agents;
  }

  // ── Full Compile ──
  compile(schema) {
    const validation = this.validateSchema(schema);
    if (!validation.valid) return { compiled: false, errors: validation.errors };

    const entities = schema.entities || [];
    const relationships = schema.relationships || [];
    const sops = schema.sops || [];

    const database = this.generateDatabase(entities, relationships);
    const api = this.generateAPI(entities);
    const ui = this.generateUI(entities);
    const security = this.generateSecurity(entities, sops);
    const agents = this.generateAgents(sops, entities);

    const outputs = { database, api, ui, security, agents };
    const outputStr = JSON.stringify(outputs);
    const sha256 = crypto.createHash('sha256').update(outputStr).digest('hex');

    const result = {
      compiled: true,
      domain: schema.domain,
      schema: schema.schema,
      outputs,
      manifest: {
        sha256,
        entityCount: entities.length,
        endpointCount: api.endpoints.length,
        compiledAt: new Date().toISOString()
      }
    };

    // Save to history
    const history = loadJSON(HISTORY_FILE, []);
    history.push({
      id: crypto.randomUUID(),
      domain: schema.domain,
      compiledAt: result.manifest.compiledAt,
      sha256,
      entityCount: result.manifest.entityCount,
      endpointCount: result.manifest.endpointCount
    });
    saveJSON(HISTORY_FILE, history);

    return result;
  }

  // ── Schema CRUD ──
  saveSchema(schema) {
    const schemas = loadJSON(SCHEMAS_FILE, []);
    const id = schema.id || crypto.randomUUID();
    schema.id = id;
    schema.savedAt = new Date().toISOString();
    const idx = schemas.findIndex(s => s.id === id);
    if (idx >= 0) schemas[idx] = schema; else schemas.push(schema);
    saveJSON(SCHEMAS_FILE, schemas);
    return schema;
  }

  listSchemas() { return loadJSON(SCHEMAS_FILE, []); }

  getSchema(id) {
    return loadJSON(SCHEMAS_FILE, []).find(s => s.id === id) || null;
  }

  deleteSchema(id) {
    const schemas = loadJSON(SCHEMAS_FILE, []);
    const filtered = schemas.filter(s => s.id !== id);
    saveJSON(SCHEMAS_FILE, filtered);
    return filtered.length < schemas.length;
  }

  getCompilationHistory() { return loadJSON(HISTORY_FILE, []); }

  // ── Helpers ──
  _tableName(name) { return name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() + 's'; }
  _humanize(name) { return name.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
  _parseRoles(str) { return str.replace(/^role:/, '').split(',').map(r => r.trim()).filter(Boolean); }
  _mapDbType(type) {
    const map = { uuid: 'UUID', string: 'VARCHAR(255)', number: 'NUMERIC', boolean: 'BOOLEAN', enum: 'VARCHAR(50)', ref: 'UUID', text: 'TEXT', date: 'DATE', datetime: 'TIMESTAMP' };
    return map[type] || 'TEXT';
  }
}

module.exports = SchemaCompiler;
