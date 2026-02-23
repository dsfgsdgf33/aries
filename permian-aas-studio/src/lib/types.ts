// Core Type Definitions for Permian AAS Studio

export interface User {
  userId: string;
  name: string;
  role: 'Admin' | 'OperatorUser' | 'Analyst' | 'Auditor' | 'ReadOnly';
  operator?: string;
  county?: string;
}

export interface RolePolicy {
  role: string;
  canCreate: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canView: boolean;
  canExport: boolean;
  canAdmin: boolean;
}

export interface SodRule {
  ruleId: string;
  description: string;
  constraint: string;
}

export interface AccessPolicy {
  policyId: string;
  rolePolicies: RolePolicy[];
  sodRules: SodRule[];
}

export interface EvidenceRequirement {
  requirementId: string;
  artifactType: string;
  requiredFor: string[];
  appliesToAssetTypes: string[];
  mandatory: boolean;
  description: string;
  rules: string;
}

export interface Submodel {
  type: string;
  version: number;
  status: 'ACTIVE' | 'DRAFT' | 'PENDING';
  met: number;
  total: number;
  missing: string[];
}

export interface AASEnvelope {
  aasId: string;
  assetType: 'BASIN' | 'FIELD' | 'LEASE' | 'PAD' | 'WELL' | 'EQUIPMENT';
  name: string;
  operator: string;
  county: string;
  identifiers: {
    globalId: string;
    rrcId: string;
    apiNumber: string;
  };
  relations: {
    parent: string | null;
    children: string[];
  };
  submodels: Submodel[];
  events: string[];
  evidenceArtifacts: string[];
  complianceStatus: 'COMPLIANT' | 'NON_COMPLIANT' | 'PARTIAL';
  compliancePct: number;
}

export interface Artifact {
  artifactId: string;
  aasId: string;
  artifactType: string;
  title: string;
  fileHash: string;
  fileName: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'DRAFT';
  submittedBy: string;
  submittedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionNote?: string;
  version: number;
}

export interface Approval {
  approvalId: string;
  artifactId: string;
  submittedBy: string;
  approvedBy: string;
  decision: 'APPROVED' | 'REJECTED';
  timestamp: string;
  notes: string;
}

export interface AuditEvent {
  eventId: string;
  aasId: string;
  type: string;
  timestamp: string;
  actor: string;
  actorRole: string;
  description: string;
  data: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export interface Connector {
  connectorId: string;
  name: string;
  type: string;
  status: 'ACTIVE' | 'ERROR' | 'INACTIVE';
  lastSync: string;
  recordCount: number;
  cadence: string;
  scope: string;
}

export interface SeedData {
  users: User[];
  accessPolicy: AccessPolicy;
  evidenceRequirements: EvidenceRequirement[];
  envelopes: AASEnvelope[];
  artifacts: Artifact[];
  approvals: Approval[];
  events: AuditEvent[];
  connectors: Connector[];
}
