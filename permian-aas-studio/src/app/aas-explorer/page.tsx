"use client";
import { seedData } from "@/lib/data";
import { cn, getStatusColor, getAssetIcon, getEventIcon, formatDate, formatDateTime, statusBg } from "@/lib/utils";
import { useState } from "react";
import { ChevronRight, ChevronDown, ExternalLink } from "lucide-react";
import Link from "next/link";

function TreeNode({ aasId, depth, selected, onSelect }: { aasId: string; depth: number; selected: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(depth < 3);
  const env = seedData.envelopes.find(e => e.aasId === aasId);
  if (!env) return null;
  return (
    <div>
      <div className={cn("flex items-center gap-1 py-1.5 px-2 rounded text-sm cursor-pointer hover:bg-accent", selected === aasId && "bg-emerald-400/10 text-emerald-400")} style={{ paddingLeft: depth * 16 + 8 }} onClick={() => onSelect(aasId)}>
        {env.relations.children.length > 0 ? <button onClick={e => { e.stopPropagation(); setOpen(!open); }} className="p-0.5">{open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button> : <span className="w-5"/>}
        <span>{getAssetIcon(env.assetType)}</span>
        <span className="truncate flex-1">{env.name}</span>
        <span className={cn("h-2 w-2 rounded-full", env.complianceStatus==='COMPLIANT'?'bg-emerald-400':env.complianceStatus==='NON_COMPLIANT'?'bg-red-400':'bg-amber-400')}/>
      </div>
      {open && env.relations.children.map(c => <TreeNode key={c} aasId={c} depth={depth+1} selected={selected} onSelect={onSelect}/>)}
    </div>
  );
}

export default function AASExplorer() {
  const [selected, setSelected] = useState("well-001");
  const [tab, setTab] = useState("identifiers");
  const env = seedData.envelopes.find(e => e.aasId === selected)!;
  const arts = seedData.artifacts.filter(a => a.aasId === selected);
  const evts = seedData.events.filter(e => e.aasId === selected);
  const reqs = seedData.evidenceRequirements.filter(r => env && r.appliesToAssetTypes.includes(env.assetType));
  if (!env) return <div className="p-6">Select an asset</div>;

  const tabList = ['identifiers','relations','submodels','events','evidence','access'];

  return (
    <div className="flex h-screen">
      <div className="w-72 border-r bg-card overflow-y-auto flex-shrink-0">
        <div className="p-4 border-b"><h2 className="text-sm font-bold">Asset Hierarchy</h2><p className="text-[10px] text-muted-foreground">Basin → Field → Lease → Pad → Well → Equipment</p></div>
        <div className="p-2"><TreeNode aasId="basin-001" depth={0} selected={selected} onSelect={setSelected}/></div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{getAssetIcon(env.assetType)}</span>
          <div><h1 className="text-xl font-bold">{env.name}</h1><p className="text-sm text-muted-foreground">{env.assetType} • {env.operator} • {env.county}</p></div>
          <span className={cn("ml-auto text-xs px-2 py-1 rounded border", statusBg(env.complianceStatus))}>{env.complianceStatus} ({env.compliancePct}%)</span>
          <Link href={`/submodels/${env.aasId}`} className="text-xs text-emerald-400 hover:underline flex items-center gap-1">Submodels <ExternalLink size={12}/></Link>
        </div>

        <div className="flex gap-1 border-b border-border">
          {tabList.map(t => <button key={t} onClick={() => setTab(t)} className={cn("px-3 py-2 text-sm border-b-2 -mb-px capitalize", tab===t?"border-emerald-400 text-emerald-400":"border-transparent text-muted-foreground hover:text-foreground")}>{t}{t==='events'?` (${evts.length})`:t==='evidence'?` (${arts.length})`:''}</button>)}
        </div>

        {tab === 'identifiers' && (
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Identifiers</h3>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(env.identifiers).map(([k,v]) => (
                <div key={k} className="p-3 rounded bg-background border">
                  <p className="text-[10px] text-muted-foreground uppercase">{k}</p>
                  <p className="text-sm font-mono mt-1">{v || '—'}</p>
                </div>
              ))}
              <div className="p-3 rounded bg-background border"><p className="text-[10px] text-muted-foreground uppercase">AAS ID</p><p className="text-sm font-mono mt-1">{env.aasId}</p></div>
              <div className="p-3 rounded bg-background border"><p className="text-[10px] text-muted-foreground uppercase">Asset Type</p><p className="text-sm font-mono mt-1">{env.assetType}</p></div>
            </div>
          </div>
        )}

        {tab === 'relations' && (
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Relations</h3>
            <div className="space-y-2">
              <div className="p-3 rounded bg-background border">
                <p className="text-[10px] text-muted-foreground">PARENT</p>
                {env.relations.parent ? <button onClick={() => {setSelected(env.relations.parent!); setTab('identifiers');}} className="text-sm text-emerald-400 hover:underline mt-1">{seedData.envelopes.find(e=>e.aasId===env.relations.parent)?.name || env.relations.parent}</button> : <p className="text-sm text-muted-foreground mt-1">None (root)</p>}
              </div>
              <div className="p-3 rounded bg-background border">
                <p className="text-[10px] text-muted-foreground">CHILDREN ({env.relations.children.length})</p>
                <div className="mt-2 space-y-1">
                  {env.relations.children.map(c => { const ch = seedData.envelopes.find(e=>e.aasId===c); return ch ? (
                    <button key={c} onClick={() => {setSelected(c); setTab('identifiers');}} className="flex items-center gap-2 w-full text-left p-2 rounded hover:bg-accent text-sm">
                      <span>{getAssetIcon(ch.assetType)}</span><span className="text-emerald-400 hover:underline">{ch.name}</span><span className="text-[10px] text-muted-foreground ml-auto">{ch.assetType}</span>
                    </button>) : null; })}
                  {env.relations.children.length === 0 && <p className="text-sm text-muted-foreground">No children (leaf node)</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'submodels' && (
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Submodels ({env.submodels.length})</h3>
            <div className="space-y-2">
              {env.submodels.map(sm => {
                const pct = sm.evidenceTotal > 0 ? Math.round((sm.evidenceMet/sm.evidenceTotal)*100) : 100;
                return (
                  <div key={sm.type} className={cn("p-3 rounded bg-background border", sm.type==='Regulatory'&&'border-emerald-400/30')}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{sm.type.replace(/_/g,' / ')}</span>
                      {sm.type==='Regulatory' && <span className="text-[10px] bg-emerald-400/20 text-emerald-400 px-1.5 py-0.5 rounded">PRIMARY</span>}
                      <span className="ml-auto text-[10px] text-muted-foreground">v{sm.version}</span>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", statusBg(sm.status))}>{sm.status}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 bg-secondary rounded-full h-1.5"><div className={cn("h-1.5 rounded-full", pct===100?'bg-emerald-500':pct>=50?'bg-amber-500':'bg-red-500')} style={{width:`${pct}%`}}/></div>
                      <span className="text-xs font-mono">{sm.evidenceMet}/{sm.evidenceTotal}</span>
                    </div>
                    {sm.missingArtifacts.length > 0 && <div className="flex gap-1 mt-2 flex-wrap">{sm.missingArtifacts.map(m => <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-red-400/10 text-red-400 border border-red-400/20">⚠ {m}</span>)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'events' && (
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <h3 className="text-sm font-semibold">Events</h3>
            {evts.length === 0 && <p className="text-sm text-muted-foreground">No events for this asset</p>}
            {evts.map(ev => (
              <div key={ev.eventId} className="flex items-start gap-3 p-3 rounded bg-background border">
                <span className="text-sm mt-0.5">{getEventIcon(ev.type)}</span>
                <div className="flex-1">
                  <p className="text-sm">{ev.description}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    <span>{ev.actor} ({ev.actorRole})</span><span>•</span><span>{formatDateTime(ev.timestamp)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", ev.type.includes('REJECTED')||ev.type.includes('VIOLATION')?'text-red-400 border-red-400/30':'text-muted-foreground border-border')}>{ev.type}</span>
                  <p className="text-[9px] font-mono text-emerald-400/50 mt-1">{ev.hash}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'evidence' && (
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Evidence Artifacts</h3>
            <div className="space-y-2">
              {reqs.map(req => {
                const art = arts.find(a => a.artifactType === req.artifactType);
                return (
                  <div key={req.requirementId} className="flex items-center gap-3 p-3 rounded bg-background border">
                    <span className="text-sm">{art?.status==='APPROVED'?'✅':art?.status==='PENDING'?'⏳':art?.status==='REJECTED'?'❌':'⬜'}</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{req.artifactType} <span className="text-muted-foreground font-normal">— {req.description}</span></p>
                      {art && <p className="text-[10px] text-muted-foreground mt-0.5">{art.title} • {art.fileName} • <span className="font-mono">{art.fileHash}</span></p>}
                      {!art && req.mandatory && <p className="text-[10px] text-red-400 mt-0.5">⚠ Missing — mandatory requirement</p>}
                    </div>
                    <div className="text-right">
                      {art && <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", statusBg(art.status))}>{art.status}</span>}
                      {!art && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-400/10 text-zinc-500 border border-zinc-400/20">NOT UPLOADED</span>}
                    </div>
                  </div>
                );
              })}
              {arts.filter(a => !reqs.some(r => r.artifactType === a.artifactType)).map(a => (
                <div key={a.artifactId} className="flex items-center gap-3 p-3 rounded bg-background border">
                  <span className="text-sm">{a.status==='APPROVED'?'✅':'⏳'}</span>
                  <div className="flex-1"><p className="text-sm">{a.title}</p><p className="text-[10px] text-muted-foreground">{a.artifactType} • {a.fileName}</p></div>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", statusBg(a.status))}>{a.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'access' && (
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold">Access Control</h3>
            <p className="text-sm text-muted-foreground">Policy: <code className="text-emerald-400">{seedData.accessPolicy.policyId}</code></p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm"><thead><tr className="border-b text-[10px] text-muted-foreground"><th className="text-left py-2">Role</th><th className="text-center">Create</th><th className="text-center">Submit</th><th className="text-center">Approve</th><th className="text-center">View</th><th className="text-center">Export</th><th className="text-center">Admin</th></tr></thead>
              <tbody>{seedData.accessPolicy.rolePolicies.map(rp => (
                <tr key={rp.role} className="border-b"><td className="py-2 font-medium">{rp.role}</td>
                {[rp.canCreate,rp.canSubmit,rp.canApprove,rp.canView,rp.canExport,rp.canAdmin].map((v,i) => <td key={i} className="text-center">{v?<span className="text-emerald-400">✓</span>:<span className="text-zinc-600">✗</span>}</td>)}</tr>
              ))}</tbody></table>
            </div>
            <div className="mt-3"><p className="text-xs font-medium mb-2">Segregation of Duties</p>
              {seedData.accessPolicy.sodRules.map(r => <div key={r.ruleId} className="p-2 rounded bg-background border mb-1"><p className="text-sm">{r.description}</p><code className="text-[10px] text-amber-400">{r.constraint}</code></div>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}