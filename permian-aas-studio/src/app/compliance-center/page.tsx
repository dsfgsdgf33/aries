"use client";
import { seedData } from "@/lib/data";
import { cn, getStatusColor, formatDate, getAssetIcon, statusBg } from "@/lib/utils";
import { useState } from "react";
import { Filter, Upload, FileText, CheckCircle, XCircle, AlertTriangle, ArrowRight } from "lucide-react";

export default function ComplianceCenter() {
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterType, setFilterType] = useState("ALL");
  const [tab, setTab] = useState<'register'|'gating'|'workflow'>('register');
  const { artifacts, envelopes, evidenceRequirements, approvals } = seedData;

  const filtered = artifacts.filter(a => {
    if (filterStatus !== "ALL" && a.status !== filterStatus) return false;
    if (filterType !== "ALL" && a.artifactType !== filterType) return false;
    return true;
  });
  const types = [...new Set(artifacts.map(a => a.artifactType))].sort();
  const statuses = ['ALL','APPROVED','PENDING','REJECTED','DRAFT'];

  const workflowSteps = [
    { step: 1, label: 'Create / Upload', desc: 'Create artifact, upload file, link to asset' },
    { step: 2, label: 'Validate Metadata', desc: 'Check completeness of required fields' },
    { step: 3, label: 'Submit for Approval', desc: 'OperatorUser or Admin submits' },
    { step: 4, label: 'Approve / Reject', desc: 'Admin or Auditor reviews (SoD enforced)' },
    { step: 5, label: 'Finalize', desc: 'Write immutable event, update gating status' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="text-emerald-400" size={24}/> Compliance Center</h1>
          <p className="text-sm text-muted-foreground">Portfolio-level artifact register, evidence gating &amp; approval workflows</p>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-400/20 text-emerald-400 text-sm hover:bg-emerald-400/30 transition-colors"><Upload size={14}/> Upload Artifact</button>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(['register','gating','workflow'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-2 text-sm border-b-2 -mb-px capitalize", tab===t?"border-emerald-400 text-emerald-400":"border-transparent text-muted-foreground hover:text-foreground")}>{t === 'register' ? 'Artifact Register' : t === 'gating' ? 'Evidence Gating' : 'Workflow'}</button>)}
      </div>

      {tab === 'register' && (<div className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2"><Filter size={14} className="text-muted-foreground"/><span className="text-sm text-muted-foreground">Status:</span>
              <div className="flex gap-1">{statuses.map(s => <button key={s} onClick={() => setFilterStatus(s)} className={cn("px-2 py-1 rounded text-xs transition-colors", filterStatus===s?"bg-emerald-400/20 text-emerald-400":"bg-secondary text-muted-foreground hover:text-foreground")}>{s}</button>)}</div>
            </div>
            <div className="flex items-center gap-2"><span className="text-sm text-muted-foreground">Type:</span>
              <select value={filterType} onChange={e => setFilterType(e.target.value)} className="bg-secondary text-foreground text-xs rounded px-2 py-1 border border-border">
                <option value="ALL">All Types</option>{types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <span className="text-xs text-muted-foreground ml-auto">{filtered.length} artifacts</span>
          </div>
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-background/50 text-muted-foreground text-xs">
              <th className="text-left py-3 px-4">Artifact</th><th className="text-left px-3">Type</th><th className="text-left px-3">Asset</th><th className="text-left px-3">Submitted</th><th className="text-left px-3">Status</th><th className="text-left px-3">Reviewer</th>
            </tr></thead>
            <tbody>{filtered.map(a => {
              const env = envelopes.find(e => e.aasId === a.aasId);
              return (
                <tr key={a.artifactId} className="border-b hover:bg-accent/30 transition-colors">
                  <td className="py-3 px-4"><p className="font-medium">{a.title}</p><p className="text-[10px] text-muted-foreground font-mono">{a.fileName} • {a.fileHash}</p></td>
                  <td className="px-3"><span className="text-xs px-2 py-0.5 rounded bg-secondary">{a.artifactType}</span></td>
                  <td className="px-3 text-xs">{env ? <span>{getAssetIcon(env.assetType)} {env.name}</span> : a.aasId}</td>
                  <td className="px-3"><p className="text-xs">{a.submittedBy}</p><p className="text-[10px] text-muted-foreground">{formatDate(a.submittedAt)}</p></td>
                  <td className="px-3"><span className={cn("text-[10px] px-2 py-0.5 rounded border", statusBg(a.status))}>{a.status}</span></td>
                  <td className="px-3 text-xs">{a.approvedBy || a.rejectedBy || '—'}{a.rejectionNote && <p className="text-[10px] text-red-400 max-w-[200px] truncate mt-0.5" title={a.rejectionNote}>{a.rejectionNote}</p>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>)}

      {tab === 'gating' && (<div className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Evidence Gating Rules by Asset Type</h3>
          <p className="text-xs text-muted-foreground mb-4">Defines which artifacts are required for compliance status and submodel approval per asset type.</p>
          {(['LEASE','PAD','WELL','EQUIPMENT'] as const).map(at => {
            const reqs = evidenceRequirements.filter(r => r.appliesToAssetTypes.includes(at));
            return (
              <div key={at} className="mb-4">
                <h4 className="text-sm font-medium flex items-center gap-2 mb-2">{getAssetIcon(at)} {at}</h4>
                <div className="grid gap-2">
                  {reqs.map(r => (
                    <div key={r.requirementId} className="flex items-center gap-3 p-3 rounded bg-background border">
                      <span className={cn("h-2 w-2 rounded-full", r.mandatory ? 'bg-red-400' : 'bg-amber-400')}/>
                      <div className="flex-1">
                        <p className="text-sm"><span className="font-medium">{r.artifactType}</span> — {r.description}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{r.rules}</p>
                      </div>
                      <div className="flex gap-1">
                        {r.requiredFor.map(rf => <span key={rf} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary">{rf}</span>)}
                      </div>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded", r.mandatory ? 'bg-red-400/10 text-red-400' : 'bg-amber-400/10 text-amber-400')}>{r.mandatory ? 'MANDATORY' : 'OPTIONAL'}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="mt-6 p-4 rounded bg-background border">
            <h4 className="text-sm font-medium mb-2">Inheritance Rules</h4>
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2"><span className="text-emerald-400">✓</span><p>Pad-level artifacts (e.g. SharedEquipmentDoc) satisfy shared equipment requirements for <strong>all child wells</strong></p></div>
              <div className="flex items-start gap-2"><span className="text-red-400">✗</span><p>Well-level artifacts do <strong>not</strong> automatically satisfy pad-level requirements</p></div>
              <div className="flex items-start gap-2"><span className="text-amber-400">⚡</span><p>AllocationMethodology only required at PAD level if emissions tracking is active</p></div>
            </div>
          </div>
        </div>
      </div>)}

      {tab === 'workflow' && (<div className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">Artifact Approval Workflow</h3>
          <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
            {workflowSteps.map((ws, i) => (
              <div key={ws.step} className="flex items-center gap-2">
                <div className="flex flex-col items-center min-w-[140px]">
                  <div className="h-10 w-10 rounded-full bg-emerald-400/20 text-emerald-400 flex items-center justify-center font-bold">{ws.step}</div>
                  <p className="text-xs font-medium mt-2 text-center">{ws.label}</p>
                  <p className="text-[10px] text-muted-foreground text-center mt-1">{ws.desc}</p>
                </div>
                {i < workflowSteps.length - 1 && <ArrowRight size={16} className="text-muted-foreground mt-[-20px]"/>}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Recent Approvals</h3>
          <div className="space-y-2">
            {approvals.map(apr => {
              const art = artifacts.find(a => a.artifactId === apr.artifactId);
              return (
                <div key={apr.approvalId} className="flex items-center gap-3 p-3 rounded bg-background border">
                  <span>{apr.decision === 'APPROVED' ? <CheckCircle size={16} className="text-emerald-400"/> : <XCircle size={16} className="text-red-400"/>}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{art?.title || apr.artifactId}</p>
                    <p className="text-[10px] text-muted-foreground">{apr.submittedBy} → {apr.approvedBy} • {formatDate(apr.timestamp)}</p>
                  </div>
                  <span className={cn("text-[10px] px-2 py-0.5 rounded border", statusBg(apr.decision))}>{apr.decision}</span>
                  <p className="text-xs text-muted-foreground max-w-[200px] truncate">{apr.notes}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>)}
    </div>
  );
}