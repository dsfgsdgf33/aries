const fs = require('fs');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');

class NativeToolsVerifier {
  constructor() {
    this.dataDir = path.join(__dirname, '..', 'data');
    this.auditFile = path.join(this.dataDir, 'native-audit.json');
    this.performanceFile = path.join(this.dataDir, 'tool-performance.json');
    this.failureFile = path.join(this.dataDir, 'tool-failures.json');
    
    this.shellUsageCount = 0;
    this.nativeToolsUsage = new Map();
    this.performanceMetrics = new Map();
    this.failureRates = new Map();
    
    this.ensureDataDir();
    this.loadExistingData();
  }

  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  loadExistingData() {
    try {
      if (fs.existsSync(this.auditFile)) {
        const audit = JSON.parse(fs.readFileSync(this.auditFile, 'utf8'));
        this.shellUsageCount = audit.shellUsageCount || 0;
        this.nativeToolsUsage = new Map(audit.nativeToolsUsage || []);
      }
    } catch (error) {
      console.warn('Failed to load audit data:', error.message);
    }

    try {
      if (fs.existsSync(this.performanceFile)) {
        const perf = JSON.parse(fs.readFileSync(this.performanceFile, 'utf8'));
        this.performanceMetrics = new Map(perf.metrics || []);
      }
    } catch (error) {
      console.warn('Failed to load performance data:', error.message);
    }

    try {
      if (fs.existsSync(this.failureFile)) {
        const failures = JSON.parse(fs.readFileSync(this.failureFile, 'utf8'));
        this.failureRates = new Map(failures.rates || []);
      }
    } catch (error) {
      console.warn('Failed to load failure data:', error.message);
    }
  }

  saveData() {
    try {
      // Save audit data
      const auditData = {
        shellUsageCount: this.shellUsageCount,
        nativeToolsUsage: Array.from(this.nativeToolsUsage.entries()),
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(this.auditFile, JSON.stringify(auditData, null, 2));

      // Save performance data
      const perfData = {
        metrics: Array.from(this.performanceMetrics.entries()),
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(this.performanceFile, JSON.stringify(perfData, null, 2));

      // Save failure data
      const failureData = {
        rates: Array.from(this.failureRates.entries()),
        lastUpdated: new Date().toISOString()
      };
      fs.writeFileSync(this.failureFile, JSON.stringify(failureData, null, 2));
    } catch (error) {
      console.error('Failed to save verification data:', error.message);
    }
  }

  trackToolUsage(toolName, isShell = false) {
    if (isShell) {
      this.shellUsageCount++;
    } else {
      const current = this.nativeToolsUsage.get(toolName) || 0;
      this.nativeToolsUsage.set(toolName, current + 1);
    }
  }

  trackPerformance(toolName, duration, success) {
    const key = toolName;
    const existing = this.performanceMetrics.get(key) || {
      totalCalls: 0,
      totalDuration: 0,
      averageDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
      successCount: 0,
      failureCount: 0
    };

    existing.totalCalls++;
    existing.totalDuration += duration;
    existing.averageDuration = existing.totalDuration / existing.totalCalls;
    existing.minDuration = Math.min(existing.minDuration, duration);
    existing.maxDuration = Math.max(existing.maxDuration, duration);
    
    if (success) {
      existing.successCount++;
    } else {
      existing.failureCount++;
    }

    this.performanceMetrics.set(key, existing);
  }

  updateFailureRate(toolName, success) {
    const existing = this.failureRates.get(toolName) || {
      total: 0,
      failures: 0,
      rate: 0,
      lastFailure: null
    };

    existing.total++;
    if (!success) {
      existing.failures++;
      existing.lastFailure = new Date().toISOString();
    }
    existing.rate = existing.failures / existing.total;

    this.failureRates.set(toolName, existing);
  }

  validateNativeImplementation() {
    const nativeTools = [
      'read', 'write', 'list', 'delete', 'mkdir', 'rmdir',
      'copy', 'move', 'exists', 'size', 'stats', 'chmod',
      'http', 'download', 'upload'
    ];

    const validation = {
      timestamp: new Date().toISOString(),
      shellUsage: this.shellUsageCount,
      nativeUsage: Object.fromEntries(this.nativeToolsUsage),
      nativeToolsCoverage: [],
      shellEliminationProgress: 0,
      recommendations: []
    };

    // Check which native tools are being used
    for (const tool of nativeTools) {
      const usage = this.nativeToolsUsage.get(tool) || 0;
      validation.nativeToolsCoverage.push({
        tool,
        usage,
        implemented: usage > 0
      });
    }

    // Calculate shell elimination progress
    const totalNativeUsage = Array.from(this.nativeToolsUsage.values()).reduce((a, b) => a + b, 0);
    const totalUsage = this.shellUsageCount + totalNativeUsage;
    validation.shellEliminationProgress = totalUsage > 0 ? 
      (totalNativeUsage / totalUsage * 100).toFixed(2) : 0;

    // Generate recommendations
    if (this.shellUsageCount > totalNativeUsage) {
      validation.recommendations.push('High shell usage detected - consider implementing more native tools');
    }

    const unusedTools = nativeTools.filter(tool => (this.nativeToolsUsage.get(tool) || 0) === 0);
    if (unusedTools.length > 0) {
      validation.recommendations.push(`Unused native tools: ${unusedTools.join(', ')}`);
    }

    return validation;
  }

  getPerformanceComparison() {
    const comparison = {
      timestamp: new Date().toISOString(),
      toolPerformance: [],
      insights: []
    };

    for (const [tool, metrics] of this.performanceMetrics) {
      comparison.toolPerformance.push({
        tool,
        averageDuration: Math.round(metrics.averageDuration * 100) / 100,
        minDuration: Math.round(metrics.minDuration * 100) / 100,
        maxDuration: Math.round(metrics.maxDuration * 100) / 100,
        totalCalls: metrics.totalCalls,
        successRate: ((metrics.successCount / metrics.totalCalls) * 100).toFixed(2),
        reliability: metrics.failureCount === 0 ? 'High' : 
                    metrics.failureCount < metrics.totalCalls * 0.1 ? 'Medium' : 'Low'
      });
    }

    // Sort by usage
    comparison.toolPerformance.sort((a, b) => b.totalCalls - a.totalCalls);

    // Generate insights
    const slowTools = comparison.toolPerformance.filter(t => t.averageDuration > 1000);
    if (slowTools.length > 0) {
      comparison.insights.push(`Slow tools detected: ${slowTools.map(t => t.tool).join(', ')}`);
    }

    const unreliableTools = comparison.toolPerformance.filter(t => parseFloat(t.successRate) < 95);
    if (unreliableTools.length > 0) {
      comparison.insights.push(`Unreliable tools: ${unreliableTools.map(t => t.tool).join(', ')}`);
    }

    return comparison;
  }

  getFailureAnalysis() {
    const analysis = {
      timestamp: new Date().toISOString(),
      failureRates: [],
      criticalIssues: [],
      summary: {
        totalTools: this.failureRates.size,
        healthyTools: 0,
        warningTools: 0,
        criticalTools: 0
      }
    };

    for (const [tool, data] of this.failureRates) {
      const ratePercent = (data.rate * 100).toFixed(2);
      const status = data.rate < 0.05 ? 'healthy' : 
                    data.rate < 0.15 ? 'warning' : 'critical';

      analysis.failureRates.push({
        tool,
        rate: ratePercent,
        total: data.total,
        failures: data.failures,
        status,
        lastFailure: data.lastFailure
      });

      analysis.summary[status + 'Tools']++;

      if (status === 'critical') {
        analysis.criticalIssues.push({
          tool,
          rate: ratePercent,
          lastFailure: data.lastFailure
        });
      }
    }

    analysis.failureRates.sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate));

    return analysis;
  }

  getFullReport() {
    return {
      timestamp: new Date().toISOString(),
      validation: this.validateNativeImplementation(),
      performance: this.getPerformanceComparison(),
      failures: this.getFailureAnalysis(),
      systemInfo: {
        platform: os.platform(),
        nodeVersion: process.version,
        uptime: Math.round(process.uptime())
      }
    };
  }

  // Auto-save every 5 minutes
  startAutoSave() {
    setInterval(() => {
      this.saveData();
    }, 5 * 60 * 1000);
  }
}

module.exports = new NativeToolsVerifier();