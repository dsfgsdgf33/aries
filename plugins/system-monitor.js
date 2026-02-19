/**
 * ARIES Plugin: System Monitor
 * Reports system health, processes, disk usage.
 */
module.exports = {
  name: 'system-monitor',
  description: 'Get detailed system information (CPU, RAM, disk, GPU, processes)',
  version: '1.0.0',

  init(ctx) {
    ctx.log('System monitor plugin initialized');
  },

  async execute(args, ctx) {
    const si = require('systeminformation');
    const [cpu, mem, disk, time] = await Promise.all([
      si.currentLoad(), si.mem(), si.fsSize(), si.time()
    ]);

    const fmt = (bytes) => {
      if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
      if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
      return (bytes / 1024).toFixed(0) + ' KB';
    };

    let report = `System Report:\n`;
    report += `  CPU: ${Math.round(cpu.currentLoad)}%\n`;
    report += `  RAM: ${fmt(mem.used)} / ${fmt(mem.total)} (${Math.round(mem.used/mem.total*100)}%)\n`;
    if (disk.length) report += `  Disk: ${fmt(disk[0].used)} / ${fmt(disk[0].size)} (${Math.round(disk[0].used/disk[0].size*100)}%)\n`;
    report += `  Uptime: ${Math.floor(time.uptime / 3600)}h ${Math.floor((time.uptime % 3600) / 60)}m`;
    return report;
  }
};
