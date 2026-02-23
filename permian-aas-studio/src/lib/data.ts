import * as seed from './seed-data';

// Unified seedData object used by most pages
export const seedData = {
  users: seed.users,
  envelopes: seed.envelopes,
  artifacts: seed.artifacts,
  events: seed.events,
  connectors: seed.connectors,
  evidenceRequirements: seed.evidenceRequirements,
  approvals: seed.approvals,
  accessPolicy: {
    policyId: 'pol-001',
    rolePolicies: seed.rolePolicies,
    sodRules: seed.sodRules,
  },
};

// Individual accessors for dashboard
export const getEnvelopes = () => seed.envelopes;
export const getEnvelope = (id: string) => seed.envelopes.find(e => e.aasId === id);
export const getArtifacts = (aasId?: string) => aasId ? seed.artifacts.filter(a => a.aasId === aasId) : seed.artifacts;
export const getEvents = (aasId?: string) => aasId ? seed.events.filter(e => e.aasId === aasId) : seed.events;
export const getConnectors = () => seed.connectors;
export const getRequirements = (at?: seed.AssetType) => at ? seed.evidenceRequirements.filter(r => r.appliesToAssetTypes.includes(at)) : seed.evidenceRequirements;
export const getApprovals = () => seed.approvals;
export const getUsers = () => seed.users;
export const getRolePolicies = () => seed.rolePolicies;
export const getSodRules = () => seed.sodRules;

export function getComplianceStats() {
  const total = seed.envelopes.length;
  const compliant = seed.envelopes.filter(e => e.complianceStatus === 'COMPLIANT').length;
  const partial = seed.envelopes.filter(e => e.complianceStatus === 'PARTIAL').length;
  const nonCompliant = seed.envelopes.filter(e => e.complianceStatus === 'NON_COMPLIANT').length;
  const pending = seed.artifacts.filter(a => a.status === 'PENDING').length;
  const rejected = seed.artifacts.filter(a => a.status === 'REJECTED').length;
  const sodViolations = seed.events.filter(e => e.type === 'SOD_VIOLATION_BLOCKED').length;
  const avgCompliance = Math.round(seed.envelopes.reduce((a, e) => a + e.compliancePct, 0) / total);
  const missingCount = seed.envelopes.reduce((a, e) => a + e.submodels.reduce((b, s) => b + s.missingArtifacts.length, 0), 0);
  return { total, compliant, partial, nonCompliant, pending, rejected, sodViolations, avgCompliance, missingCount };
}