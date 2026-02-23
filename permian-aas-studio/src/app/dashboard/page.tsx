'use client';
import { getComplianceStats, getEnvelopes, getArtifacts, getEvents, getConnectors } from '@/lib/data';
import { cn, statusColor, statusBg, assetIcon, timeAgo, formatDate, staleness } from '@/lib/utils';
import { ShieldCheck, Clock, XCircle, Ban, AlertTriangle, Activity } from 'lucide-react';

function KCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub: string; color: string }) {
  const c = color === 'emerald' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : color === 'amber' ? 'text-amber-400 bg-amber-400/10 border-amber-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20';
  return (
    <div className={cn("rounded-lg border p-4", c.split(' ').slice(1).join(' '))}>
      <div className="flex items-center gap-2 mb-2">
        <span className={c.split(' ')[0]}>{icon}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={cn("text-2xl font-bold", c.split(' ')[0])}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </div>
  );
}

export default function Dashboard() {
  const stats = getComplianceStats();
  const envelopes = getEnvelopes();
  const allArtifacts = getArtifacts();
  const allEvents = getEvents();
  const connectors = getConnectors();

  const pendingArts = allArtifacts.filter(a => a.status === 'PENDING');
  const rejectedArts = allArtifacts.filter(a => a.status === 'REJECTED');
  const sodEvents = allEvents.filter(e => e.type === 'SOD_VIOLATION_BLOCKED');
  const recentEvents = [...allEvents].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 6);

  const missingList: { asset: string; aasId: string; missing: string[] }[] = [];
  envelopes.forEach(env => {
    const m = env.submodels.flatMap(s => s.missingArtifacts);
    if (m.length > 0) missingList.push({ asset: env.name, aasId: env.aasId, missing: [...new Set(m)] });
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Compliance posture &amp; operational overview</p>
        </div>
        <div className="text-xs text-muted-foreground">Last updated: Feb 22, 2026 9:29 PM CT</div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KCard icon={<ShieldCheck size={20}/>} label="Portfolio Compliance" value={`${stats.avgCompliance}%`} sub={`${stats.compliant}/${stats.total} fully compliant`} color={stats.avgCompliance > 80 ? 'emerald' : stats.avgCompliance > 50 ? 'amber' : 'red'} />
        <KCard icon={<Clock size={20}/>} label="Pending Approvals" value={String(stats.pending)} sub="Awaiting review" color="amber" />
        <KCard icon={<XCircle size={20}/>} label="Rejected Artifacts" value={String(stats.rejected)} sub="Require resubmission" color="red" />
        <KCard icon={<Ban size={20}/>} label="SoD Violations" value={String(stats.sodViolations)} sub="Blocked by policy" color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Asset Compliance */}
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-4">
          <h3 className="font-semibold mb-3 text-sm">Asset Compliance Status</h3>
          <div className="space-y-2">
            {envelopes.map(env => (
              <div key={env.aasId} className="flex items-center gap-3 p-2 rounded bg-background/50">
                <span className="text-lg w-8 text-center">{assetIcon(env.assetType)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{env.name}</span>
                    <span className="text-[10px] text-muted-foreground">{env.assetType}</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-1.5 mt-1">
                    <div className={cn('h-1.5 rounded-full transition-all', env.compliancePct >= 80 ? 'bg-emerald-500' : env.compliancePct >= 40 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${env.compliancePct}%` }} />
                  </div>
                </div>
                <span className={cn('text-sm font-mono font-bold w-10 text-right', statusColor(env.complianceStatus))}>{env.compliancePct}%</span>
                <span className={cn('text-[10px] px-2 py-0.5 rounded border whitespace-nowrap', statusBg(env.complianceStatus))}>{env.complianceStatus}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Alerts */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2"><AlertTriangle size={14} className="text-amber-400" /> Alerts</h3>

          {missingList.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Missing Artifacts</p>
              {missingList.map(m => (
                <div key={m.aasId} className="p-2 rounded bg-red-400/5 border border-red-400/20 mb-2">
                  <p className="text-sm font-medium">{m.asset}</p>
                  <div className="flex gap-1 flex-wrap mt-1">
                    {m.missing.map(a => <span key={a} className="text-[10px] px-1.5 py-0.5 rounded bg-red-400/10 text-red-400">{a}</span>)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {rejectedArts.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Rejected Evidence</p>
              {rejectedArts.map(a => (
                <div key={a.artifactId} className="p-2 rounded bg-red-400/5 border border-red-400/20 mb-2">
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-red-400 mt-0.5">{a.rejectionNote}</p>
                </div>
              ))}
            </div>
          )}

          {sodEvents.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">SoD Violations</p>
              {sodEvents.map(e => (
                <div key={e.eventId} className="p-2 rounded bg-red-400/5 border border-red-400/20 mb-2">
                  <p className="text-sm">{e.description}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{e.actor} • {timeAgo(e.timestamp)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Data Freshness + Recent Events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="font-semibold text-sm flex items-center gap-2 mb-3"><Activity size={14} className="text-emerald-400" /> Data Freshness</h3>
          <div className="space-y-2">
            {connectors.map(c => {
              const s = staleness(c.lastSync);
              return (
                <div key={c.connectorId} className="flex items-center gap-3 p-2 rounded bg-background/50">
                  <div className={cn("h-2 w-2 rounded-full", c.status === 'ACTIVE' ? 'bg-emerald-400' : 'bg-red-400')} />
                  <span className="text-sm flex-1">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.cadence}</span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded", s === 'FRESH' ? 'bg-emerald-400/10 text-emerald-400' : s === 'STALE' ? 'bg-amber-400/10 text-amber-400' : 'bg-red-400/10 text-red-400')}>{s}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="font-semibold text-sm mb-3">Recent Events</h3>
          <div className="space-y-2">
            {recentEvents.map(ev => (
              <div key={ev.eventId} className="flex items-start gap-3 p-2 rounded bg-background/50">
                <span className="text-sm mt-0.5">{ev.type.includes('APPROVED') ? '✅' : ev.type.includes('REJECTED') ? '❌' : ev.type.includes('SOD') ? '🚫' : ev.type.includes('INGESTION') ? '📥' : '📌'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{ev.description}</p>
                  <p className="text-[10px] text-muted-foreground">{ev.actor} • {timeAgo(ev.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}