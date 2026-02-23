"use client";
import { Shell } from "@/components/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Code2, Layers, GitBranch, Radio } from "lucide-react";

const schemas = [
  { name: 'AASEnvelope', fields: ['aasId','assetType','name','operator','identifiers','relations','submodels','events','evidenceArtifacts','complianceStatus'], status: 'ACTIVE' },
  { name: 'Artifact', fields: ['artifactId','aasId','artifactType','title','fileHash','status','submittedBy','approvedBy','version'], status: 'ACTIVE' },
  { name: 'AuditEvent', fields: ['eventId','aasId','type','timestamp','actor','data','previousHash','hash'], status: 'ACTIVE' },
  { name: 'EvidenceRequirement', fields: ['requirementId','artifactType','requiredFor','appliesToAssetTypes','mandatory','rules'], status: 'ACTIVE' },
];
const integrations = [
  { source: 'Enverus API', target: 'Production Submodel', mapping: 'API14→apiNumber, WellName→name', freq: 'Daily' },
  { source: 'SCADA/OPC-UA', target: 'Operations Submodel', mapping: 'ns=2 tags→scada.*', freq: 'Real-time' },
  { source: 'SAP RFC', target: 'Accounting Submodel', mapping: 'AUFNR→afe, KOSTL→costCenter', freq: 'Nightly' },
  { source: 'RRC REST', target: 'Regulatory Submodel', mapping: 'permitNo→permit.id', freq: 'Weekly' },
];
const policies = [
  { name: 'RBAC Enforcement', type: 'Access', rule: 'Role-based permissions on all endpoints' },
  { name: 'SoD Check', type: 'Workflow', rule: 'submittedBy != approvedBy at approval' },
  { name: 'Evidence Gating', type: 'Compliance', rule: 'Submodel blocked until required artifacts approved' },
  { name: 'Hash Chain', type: 'Audit', rule: 'Each event references previous hash' },
];
const signals = [
  { name: 'SCADA.pressure', type: 'Float', unit: 'psi', freq: '5min', source: 'Ignition' },
  { name: 'SCADA.temperature', type: 'Float', unit: '°F', freq: '5min', source: 'Ignition' },
  { name: 'SCADA.flowRate', type: 'Float', unit: 'bbl/d', freq: '5min', source: 'Ignition' },
  { name: 'compliance.check', type: 'Event', unit: '—', freq: 'Daily', source: 'System' },
  { name: 'artifact.statusChange', type: 'Event', unit: '—', freq: 'On-demand', source: 'Workflow' },
];

export default function DigDev() {
  return (
    <Shell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Code2 className="text-emerald-400" /> DigDev Panel</h1>
          <p className="text-sm text-muted-foreground">Schema, Integration, Policy, and Signal mapping</p>
        </div>
        <Tabs defaultValue="schema">
          <TabsList>
            <TabsTrigger value="schema"><Layers size={14} className="mr-1" />Schema</TabsTrigger>
            <TabsTrigger value="integration"><GitBranch size={14} className="mr-1" />Integration</TabsTrigger>
            <TabsTrigger value="policy">Policy</TabsTrigger>
            <TabsTrigger value="signal"><Radio size={14} className="mr-1" />Signal</TabsTrigger>
          </TabsList>

          <TabsContent value="schema" className="space-y-3">
            {schemas.map(s => (
              <Card key={s.name}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <code className="text-sm font-mono font-bold text-emerald-400">{s.name}</code>
                    <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">{s.status}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {s.fields.map(f => <code key={f} className="text-[11px] px-2 py-0.5 rounded bg-background border font-mono">{f}</code>)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="integration" className="space-y-3">
            {integrations.map((ig, i) => (
              <Card key={i}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="px-3 py-1.5 rounded bg-blue-400/10 border border-blue-400/20 text-sm text-blue-400">{ig.source}</div>
                    <span className="text-emerald-400 font-bold">→</span>
                    <div className="px-3 py-1.5 rounded bg-emerald-400/10 border border-emerald-400/20 text-sm text-emerald-400">{ig.target}</div>
                    <Badge variant="outline" className="text-[10px] ml-auto">{ig.freq}</Badge>
                  </div>
                  <code className="text-xs text-muted-foreground font-mono mt-2 block">{ig.mapping}</code>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="policy" className="space-y-3">
            {policies.map((p, i) => (
              <Card key={i}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{p.name}</span>
                    <Badge variant="outline" className="text-[10px]">{p.type}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{p.rule}</p>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="signal">
            <Card>
              <CardContent className="pt-4">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2">Signal</th><th className="text-left">Type</th><th className="text-left">Unit</th><th className="text-left">Frequency</th><th className="text-left">Source</th>
                  </tr></thead>
                  <tbody>
                    {signals.map(s => (
                      <tr key={s.name} className="border-b">
                        <td className="py-2 font-mono text-emerald-400 text-xs">{s.name}</td>
                        <td><Badge variant="outline" className="text-[10px]">{s.type}</Badge></td>
                        <td className="text-xs text-muted-foreground">{s.unit}</td>
                        <td className="text-xs">{s.freq}</td>
                        <td className="text-xs text-muted-foreground">{s.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Shell>
  );
}
