/**
 * ARIES — Virtual Employees Framework
 * Strategy-aligned agents with roles, mandates, KPIs, tool permissions, and risk classification.
 * Layer 10 Agents — Enterprise Intelligence (DigDev v1.3)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'employees');
const EMPLOYEES_PATH = path.join(DATA_DIR, 'employees.json');
const TEMPLATES_PATH = path.join(DATA_DIR, 'templates.json');
const KPI_HISTORY_PATH = path.join(DATA_DIR, 'kpi-history.json');
const TASKS_PATH = path.join(DATA_DIR, 'tasks.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function writeJSON(p, d) { ensureDir(); fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
function uuid() { return crypto.randomUUID(); }

class VirtualEmployees {
  constructor() {
    ensureDir();
  }

  // ── CRUD ──

  createEmployee(config) {
    const employees = readJSON(EMPLOYEES_PATH, []);
    const emp = {
      id: uuid(),
      name: config.name || 'Unnamed Employee',
      role: config.role || config.name || 'Agent',
      mandate: config.mandate || '',
      status: config.status || 'active',
      maturityGrade: config.maturityGrade || 'G0',
      riskClass: config.riskClass || 'R0',
      kpis: (config.kpis || []).map(k => ({
        name: k.name,
        target: k.target,
        unit: k.unit || '',
        direction: k.direction || 'above',
        current: k.current !== undefined ? k.current : null
      })),
      toolAllowlist: config.toolAllowlist || [],
      toolDenylist: config.toolDenylist || [],
      schedule: config.schedule || { active_hours: '00:00-23:59', timezone: 'America/Chicago' },
      created: new Date().toISOString(),
      metrics: {
        actionsCompleted: 0,
        successRate: 0,
        avgResponseTime: 0,
        kpiHistory: []
      }
    };
    employees.push(emp);
    writeJSON(EMPLOYEES_PATH, employees);
    return emp;
  }

  getEmployee(id) {
    const employees = readJSON(EMPLOYEES_PATH, []);
    return employees.find(e => e.id === id) || null;
  }

  listEmployees(filters) {
    let employees = readJSON(EMPLOYEES_PATH, []);
    if (filters) {
      if (filters.status) employees = employees.filter(e => e.status === filters.status);
      if (filters.role) employees = employees.filter(e => e.role === filters.role);
      if (filters.riskClass) employees = employees.filter(e => e.riskClass === filters.riskClass);
      if (filters.maturityGrade) employees = employees.filter(e => e.maturityGrade === filters.maturityGrade);
    }
    return employees;
  }

  updateEmployee(id, patch) {
    const employees = readJSON(EMPLOYEES_PATH, []);
    const idx = employees.findIndex(e => e.id === id);
    if (idx === -1) return null;
    const forbidden = ['id', 'created'];
    for (const key of Object.keys(patch)) {
      if (!forbidden.includes(key)) employees[idx][key] = patch[key];
    }
    writeJSON(EMPLOYEES_PATH, employees);
    return employees[idx];
  }

  retireEmployee(id) {
    return this.updateEmployee(id, { status: 'retired' });
  }

  // ── Tool Permissions ──

  checkToolPermission(employeeId, toolName) {
    const emp = this.getEmployee(employeeId);
    if (!emp) return { allowed: false, reason: 'Employee not found' };
    if (emp.toolDenylist && emp.toolDenylist.includes(toolName)) {
      return { allowed: false, reason: 'Tool is on denylist' };
    }
    if (emp.toolAllowlist && emp.toolAllowlist.length > 0) {
      if (!emp.toolAllowlist.includes(toolName)) {
        return { allowed: false, reason: 'Tool not on allowlist' };
      }
    }
    return { allowed: true, reason: 'Permitted' };
  }

  // ── Task Assignment ──

  assignTask(employeeId, task) {
    const emp = this.getEmployee(employeeId);
    if (!emp) return { error: 'Employee not found' };
    if (emp.status !== 'active') return { error: 'Employee is not active (status: ' + emp.status + ')' };

    // Check tool permissions for required tools
    if (task.requiredTools) {
      for (const tool of task.requiredTools) {
        const perm = this.checkToolPermission(employeeId, tool);
        if (!perm.allowed) return { error: 'Tool permission denied: ' + tool + ' — ' + perm.reason };
      }
    }

    const tasks = readJSON(TASKS_PATH, []);
    const t = {
      id: uuid(),
      employeeId,
      description: task.description || '',
      requiredTools: task.requiredTools || [],
      priority: task.priority || 'normal',
      status: 'assigned',
      assignedAt: new Date().toISOString(),
      completedAt: null,
      result: null
    };
    tasks.push(t);
    writeJSON(TASKS_PATH, tasks);

    // Update metrics
    const employees = readJSON(EMPLOYEES_PATH, []);
    const idx = employees.findIndex(e => e.id === employeeId);
    if (idx !== -1) {
      employees[idx].metrics.actionsCompleted = (employees[idx].metrics.actionsCompleted || 0) + 1;
      writeJSON(EMPLOYEES_PATH, employees);
    }

    return t;
  }

  // ── KPI Management ──

  recordKPI(employeeId, kpiName, value) {
    const employees = readJSON(EMPLOYEES_PATH, []);
    const idx = employees.findIndex(e => e.id === employeeId);
    if (idx === -1) return { error: 'Employee not found' };

    const kpi = employees[idx].kpis.find(k => k.name === kpiName);
    if (!kpi) return { error: 'KPI not found: ' + kpiName };

    kpi.current = value;

    // Add to history
    const history = readJSON(KPI_HISTORY_PATH, []);
    history.push({
      id: uuid(),
      employeeId,
      kpiName,
      value,
      target: kpi.target,
      direction: kpi.direction,
      timestamp: new Date().toISOString()
    });
    writeJSON(KPI_HISTORY_PATH, history);

    // Update employee KPI history
    if (!employees[idx].metrics.kpiHistory) employees[idx].metrics.kpiHistory = [];
    employees[idx].metrics.kpiHistory.push({ kpiName, value, timestamp: new Date().toISOString() });
    // Keep last 100 entries
    if (employees[idx].metrics.kpiHistory.length > 100) {
      employees[idx].metrics.kpiHistory = employees[idx].metrics.kpiHistory.slice(-100);
    }

    writeJSON(EMPLOYEES_PATH, employees);
    return { recorded: true, kpiName, value, target: kpi.target, direction: kpi.direction };
  }

  getKPIReport(employeeId) {
    const emp = this.getEmployee(employeeId);
    if (!emp) return { error: 'Employee not found' };

    const report = emp.kpis.map(kpi => {
      const achievement = this._calcAchievement(kpi);
      return {
        name: kpi.name,
        target: kpi.target,
        current: kpi.current,
        unit: kpi.unit,
        direction: kpi.direction,
        achievement,
        status: achievement >= 100 ? 'meeting' : achievement >= 75 ? 'close' : 'behind'
      };
    });

    return {
      employeeId,
      employeeName: emp.name,
      kpis: report,
      overallScore: this._calcPerformanceScore(emp)
    };
  }

  // ── Performance ──

  evaluatePerformance(employeeId) {
    const emp = this.getEmployee(employeeId);
    if (!emp) return { error: 'Employee not found' };

    const score = this._calcPerformanceScore(emp);
    const kpiDetails = emp.kpis.map(kpi => ({
      name: kpi.name,
      target: kpi.target,
      current: kpi.current,
      achievement: this._calcAchievement(kpi),
      status: this._calcAchievement(kpi) >= 100 ? 'meeting' : 'behind'
    }));

    const grade = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 50 ? 'Needs Improvement' : 'Critical';

    return {
      employeeId,
      employeeName: emp.name,
      role: emp.role,
      score,
      grade,
      kpis: kpiDetails,
      metrics: emp.metrics,
      evaluatedAt: new Date().toISOString()
    };
  }

  _calcAchievement(kpi) {
    if (kpi.current === null || kpi.current === undefined) return 0;
    if (kpi.direction === 'below') {
      // Lower is better: 100% if at or below target
      if (kpi.current <= kpi.target) return 100;
      return Math.max(0, Math.round((kpi.target / kpi.current) * 100));
    }
    // Higher is better
    if (kpi.current >= kpi.target) return 100;
    return Math.max(0, Math.round((kpi.current / kpi.target) * 100));
  }

  _calcPerformanceScore(emp) {
    if (!emp.kpis || emp.kpis.length === 0) return 0;
    const achievements = emp.kpis.map(k => this._calcAchievement(k));
    return Math.round(achievements.reduce((a, b) => a + b, 0) / achievements.length);
  }

  // ── Templates ──

  getTemplates() {
    return readJSON(TEMPLATES_PATH, []);
  }

  createFromTemplate(templateName, overrides) {
    const templates = this.getTemplates();
    const tmpl = templates.find(t => t.template === templateName);
    if (!tmpl) return { error: 'Template not found: ' + templateName };

    const config = {
      name: tmpl.name,
      role: tmpl.name,
      mandate: tmpl.mandate,
      kpis: tmpl.kpis,
      toolAllowlist: tmpl.toolAllowlist || [],
      toolDenylist: [],
      riskClass: tmpl.riskClass || 'R0',
      maturityGrade: 'G1',
      ...overrides
    };

    return this.createEmployee(config);
  }

  // ── Aggregate Stats ──

  getEmployeeStats() {
    const employees = readJSON(EMPLOYEES_PATH, []);
    const active = employees.filter(e => e.status === 'active');
    const paused = employees.filter(e => e.status === 'paused');
    const retired = employees.filter(e => e.status === 'retired');

    let totalKpis = 0;
    let totalScore = 0;
    let alerts = 0;

    for (const emp of active) {
      totalKpis += (emp.kpis || []).length;
      const score = this._calcPerformanceScore(emp);
      totalScore += score;
      // Alert if any KPI is behind (<75%)
      for (const kpi of (emp.kpis || [])) {
        if (this._calcAchievement(kpi) < 75 && kpi.current !== null) alerts++;
      }
    }

    return {
      total: employees.length,
      active: active.length,
      paused: paused.length,
      retired: retired.length,
      avgPerformance: active.length > 0 ? Math.round(totalScore / active.length) : 0,
      totalKpis,
      alerts,
      byRisk: {
        R0: employees.filter(e => e.riskClass === 'R0').length,
        R1: employees.filter(e => e.riskClass === 'R1').length,
        R2: employees.filter(e => e.riskClass === 'R2').length,
        R3: employees.filter(e => e.riskClass === 'R3').length
      },
      byMaturity: {
        G0: employees.filter(e => e.maturityGrade === 'G0').length,
        G1: employees.filter(e => e.maturityGrade === 'G1').length,
        G2: employees.filter(e => e.maturityGrade === 'G2').length,
        G3: employees.filter(e => e.maturityGrade === 'G3').length
      }
    };
  }

  getTasks(employeeId) {
    const tasks = readJSON(TASKS_PATH, []);
    if (employeeId) return tasks.filter(t => t.employeeId === employeeId);
    return tasks;
  }
}

module.exports = VirtualEmployees;
