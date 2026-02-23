"use client";
import { seedData } from "@/lib/data";
import { cn, getStatusColor, formatDateTime } from "@/lib/utils";
import { Lock, Users, ShieldAlert, Key, Shield } from "lucide-react";

export default function Security() {
  const { users, accessPolicy, events } = seedData;
  const sodEvents = events.filter(e => e.type === 'SOD_VIOLATION_BLOCKED');

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Lock className="text-emerald-400" size={24}/> Security &amp; RBAC</h1>
        <p className="text-sm text-muted-foreground">Role-based access, attribute policies, segregation of duties</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><Users size={16}/> Users</h3>
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.userId} className="flex items-center gap-3 p-3 rounded bg-background border">
                <div className="h-9 w-9 rounded-full bg-emerald-400/10 flex items-center justify-center text-emerald-400 text-sm font-bold">{u.name.split(' ').map(n=>n[0]).join('')}</div>
                <div className="flex-1"><p className="text-sm font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.operator||'External'}{u.county?` • ${u.county}`:''}</p></div>
                <span className="text-[10px] px-2 py-0.5 rounded border border-border">{u.role}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><Key size={16}/> RBAC Permission Matrix</h3>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-[10px] text-muted-foreground"><th className="text-left py-2">Role</th><th className="text-center">Create</th><th className="text-center">Submit</th><th className="text-center">Approve</th><th className="text-center">View</th><th className="text-center">Export</th><th className="text-center">Admin</th></tr></thead>
            <tbody>{accessPolicy.rolePolicies.map(rp => (
              <tr key={rp.role} className="border-b hover:bg-accent/30">
                <td className="py-2.5 font-medium">{rp.role}</td>
                {[rp.canCreate,rp.canSubmit,rp.canApprove,rp.canView,rp.canExport,rp.canAdmin].map((v,i)=><td key={i} className="text-center">{v?<span className="text-emerald-400 font-bold">✓</span>:<span className="text-zinc-600">✗</span>}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><Shield size={16}/> ABAC Attributes</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {['Operator','AssetGroup','County','Field','Lease','Well'].map(attr => (
            <div key={attr} className="p-3 rounded bg-background border text-center">
              <p className="text-xs font-medium">{attr}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{attr==='Operator'?'Permian Energy Corp':attr==='County'?'Reeves, Loving, Ward':attr==='Field'?'Wolfcamp, Bone Spring':'Scoped by hierarchy'}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3"><ShieldAlert size={16} className="text-red-400"/> Segregation of Duties</h3>
          <div className="space-y-2">
            {accessPolicy.sodRules.map(r => (
              <div key={r.ruleId} className="p-3 rounded bg-background border">
                <p className="text-sm font-medium">{r.description}</p>
                <code className="text-[10px] text-amber-400 mt-1 block">{r.constraint}</code>
              </div>
            ))}
          </div>
          <div className="mt-3 p-3 rounded bg-background border">
            <p className="text-xs font-medium mb-2">Policy Enforcement</p>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>• Submitter cannot approve their own artifacts</p>
              <p>• At least 2 distinct roles in submit→approve chain</p>
              <p>• Admin can override with audit trail entry</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">🚫 SoD Violation Log</h3>
          {sodEvents.length === 0 ? <p className="text-sm text-muted-foreground">No violations recorded</p> : (
            <div className="space-y-2">
              {sodEvents.map(ev => (
                <div key={ev.eventId} className="p-3 rounded bg-red-400/5 border border-red-400/20">
                  <p className="text-sm font-medium">{ev.description}</p>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                    <span>{ev.actor} ({ev.actorRole})</span><span>•</span><span>{formatDateTime(ev.timestamp)}</span>
                  </div>
                  <p className="text-[10px] text-red-400 mt-1">Action: BLOCKED — artifact approval denied</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}