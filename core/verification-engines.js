/**
 * ARIES — Verification Engines v1.0
 * Three-stage validation pipeline for approval packets.
 * V-MEMO → V-SRD → V-CONS
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'governance');
const PACKETS_FILE = path.join(DATA_DIR, 'packets.json');

function readJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }

class VerificationEngines {
  constructor() {
    console.log('[VERIFICATION] Verification engines initialized (V-MEMO, V-SRD, V-CONS)');
  }

  /** Run full verification pipeline on a packet */
  verify(packet) {
    const vMemo = this.verifyMemo(packet);
    const vSrd = this.verifySrd(packet);
    const vCons = this.verifyConsistency(packet);

    return {
      pass: vMemo.pass && vSrd.pass && vCons.pass,
      stages: { 'V-MEMO': vMemo, 'V-SRD': vSrd, 'V-CONS': vCons },
      timestamp: new Date().toISOString(),
    };
  }

  /** V-MEMO: Validate memo completeness */
  verifyMemo(packet) {
    const blockers = [];
    const memo = packet.memo || {};

    if (!memo.intent || memo.intent.trim().length < 3) {
      blockers.push('Memo intent is missing or too short');
    }
    if (!memo.justification || memo.justification.trim().length < 3) {
      blockers.push('Memo justification is missing or too short');
    }
    // R2+ require citations
    if ((packet.riskClass === 'R2' || packet.riskClass === 'R3') && (!memo.citations || memo.citations.length === 0)) {
      blockers.push('R2/R3 actions require at least one citation');
    }

    return { pass: blockers.length === 0, blockers, stage: 'V-MEMO' };
  }

  /** V-SRD: Validate structured resource descriptor */
  verifySrd(packet) {
    const blockers = [];
    const srd = packet.srd || {};

    if (!srd.type) {
      blockers.push('SRD type is missing');
    }
    if (!srd.target && packet.riskClass !== 'R0') {
      blockers.push('SRD target is required for R1+ actions');
    }
    // Check diff exists for modify/delete operations
    if ((srd.type === 'modify' || srd.type === 'delete') && !srd.diff) {
      blockers.push('SRD diff is required for modify/delete operations');
    }

    return { pass: blockers.length === 0, blockers, stage: 'V-SRD' };
  }

  /** V-CONS: Consistency check against pending actions */
  verifyConsistency(packet) {
    const blockers = [];
    const packets = readJSON(PACKETS_FILE, []);

    // Check for conflicting pending actions on the same target
    const pending = packets.filter(p =>
      p.id !== packet.id &&
      p.status === 'pending' &&
      p.srd && packet.srd &&
      p.srd.target === packet.srd.target
    );

    if (pending.length > 0) {
      blockers.push(`${pending.length} conflicting pending action(s) on target "${packet.srd.target}": ${pending.map(p => p.id).join(', ')}`);
    }

    // Check manifest integrity
    if (!packet.manifest || !packet.manifest.sha256) {
      blockers.push('Manifest SHA-256 hash is missing');
    }

    return { pass: blockers.length === 0, blockers, stage: 'V-CONS' };
  }
}

module.exports = VerificationEngines;
