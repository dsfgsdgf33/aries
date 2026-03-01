/**
 * ARIES — Approval Packets v1.0
 * The atomic unit of decision-making for R1+ actions.
 * Enterprise Intelligence: DigDev v1.3 Operating Model
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'governance');
const PACKETS_FILE = path.join(DATA_DIR, 'packets.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJSON(p, data) { ensureDir(); fs.writeFileSync(p, JSON.stringify(data, null, 2)); }

function hashFields(obj) {
  const sorted = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

class ApprovalPackets {
  constructor(opts) {
    this._governance = (opts && opts.governance) || null;
    ensureDir();
    console.log('[APPROVAL-PACKETS] Approval packet system initialized');
  }

  /** Create a new approval packet */
  createPacket(agentId, action, memo, evidence) {
    if (!agentId || !action) throw new Error('agentId and action are required');

    const riskClass = this._governance ? this._governance.classifyRisk(action) : 'R1';
    const timestamp = new Date().toISOString();
    const id = 'ap_' + crypto.randomUUID();

    const srd = {
      type: action.type || 'unknown',
      target: action.target || null,
      diff: action.params ? JSON.stringify(action.params) : null,
    };

    const packetCore = { agentId, action, riskClass, memo: memo || {}, srd, evidence: evidence || [] };
    const fieldsHash = hashFields(packetCore);
    const manifestData = JSON.stringify(packetCore);
    const sha256 = crypto.createHash('sha256').update(manifestData).digest('hex');

    const packet = {
      id,
      timestamp,
      agentId,
      action,
      riskClass,
      memo: {
        intent: (memo && memo.intent) || '',
        justification: (memo && memo.justification) || '',
        citations: (memo && memo.citations) || [],
      },
      srd,
      evidence: evidence || [],
      manifest: { sha256, fields_hash: fieldsHash },
      status: riskClass === 'R0' ? 'approved' : 'pending',
      approvals: [],
      result: null,
    };

    // Auto-approve R0
    if (riskClass === 'R0') {
      packet.approvals.push({
        by: 'system',
        at: timestamp,
        signature: crypto.createHash('sha256').update('system:' + id).digest('hex'),
      });
    }

    const packets = readJSON(PACKETS_FILE, []);
    packets.push(packet);
    writeJSON(PACKETS_FILE, packets);

    console.log(`[APPROVAL-PACKETS] Created ${id} (${riskClass}) for agent ${agentId}`);
    return packet;
  }

  /** Approve a packet */
  approvePacket(packetId, approverId) {
    const packets = readJSON(PACKETS_FILE, []);
    const packet = packets.find(p => p.id === packetId);
    if (!packet) return { error: 'Packet not found' };
    if (packet.status !== 'pending') return { error: `Packet is ${packet.status}, cannot approve` };

    // Check for duplicate approver
    if (packet.approvals.some(a => a.by === approverId)) {
      return { error: 'Already approved by this approver' };
    }

    const approval = {
      by: approverId,
      at: new Date().toISOString(),
      signature: crypto.createHash('sha256').update(approverId + ':' + packetId + ':' + Date.now()).digest('hex'),
    };
    packet.approvals.push(approval);

    // Check if fully approved
    const requiredApprovals = packet.riskClass === 'R2' ? 2 : (packet.riskClass === 'R3' ? 1 : 1);
    const hasHuman = packet.approvals.some(a => a.by === 'human' || a.by.startsWith('human:'));

    if (packet.riskClass === 'R3' && !hasHuman) {
      // R3 requires human — stays pending
    } else if (packet.approvals.length >= requiredApprovals) {
      packet.status = 'approved';
    }

    writeJSON(PACKETS_FILE, packets);
    console.log(`[APPROVAL-PACKETS] ${packetId} approved by ${approverId} (${packet.approvals.length}/${requiredApprovals})`);
    return packet;
  }

  /** Reject a packet */
  rejectPacket(packetId, reason) {
    const packets = readJSON(PACKETS_FILE, []);
    const packet = packets.find(p => p.id === packetId);
    if (!packet) return { error: 'Packet not found' };
    if (packet.status !== 'pending') return { error: `Packet is ${packet.status}, cannot reject` };

    packet.status = 'rejected';
    packet.result = { rejectedBy: reason || 'unspecified', at: new Date().toISOString() };
    writeJSON(PACKETS_FILE, packets);

    console.log(`[APPROVAL-PACKETS] ${packetId} rejected: ${reason}`);
    return packet;
  }

  /** Execute an approved packet */
  executePacket(packetId) {
    const packets = readJSON(PACKETS_FILE, []);
    const packet = packets.find(p => p.id === packetId);
    if (!packet) return { error: 'Packet not found' };
    if (packet.status !== 'approved') return { error: `Packet must be approved to execute (currently: ${packet.status})` };

    packet.status = 'executed';
    packet.result = { executedAt: new Date().toISOString(), success: true };
    writeJSON(PACKETS_FILE, packets);

    console.log(`[APPROVAL-PACKETS] ${packetId} executed`);
    return packet;
  }

  /** Get a single packet */
  getPacket(id) {
    const packets = readJSON(PACKETS_FILE, []);
    return packets.find(p => p.id === id) || null;
  }

  /** List packets with optional filters */
  listPackets(filters) {
    let packets = readJSON(PACKETS_FILE, []);
    if (filters) {
      if (filters.status) packets = packets.filter(p => p.status === filters.status);
      if (filters.riskClass) packets = packets.filter(p => p.riskClass === filters.riskClass);
      if (filters.agentId) packets = packets.filter(p => p.agentId === filters.agentId);
      if (filters.limit) packets = packets.slice(-filters.limit);
    }
    return packets;
  }

  /** Get summary stats */
  getStats() {
    const packets = readJSON(PACKETS_FILE, []);
    const byStatus = { pending: 0, approved: 0, rejected: 0, executed: 0 };
    const byRisk = { R0: 0, R1: 0, R2: 0, R3: 0 };
    for (const p of packets) {
      if (byStatus[p.status] !== undefined) byStatus[p.status]++;
      if (byRisk[p.riskClass] !== undefined) byRisk[p.riskClass]++;
    }
    return { total: packets.length, byStatus, byRisk };
  }
}

module.exports = ApprovalPackets;
