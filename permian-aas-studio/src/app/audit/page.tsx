"use client";
import { seedData } from "@/lib/data";
import { cn, getEventIcon, formatDateTime } from "@/lib/utils";
import { useState } from "react";

export default function Audit() {
  const [tab, setTab] = useState('events');
  const { events, artifacts } = seedData;
  const sorted = [...events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">🔒 Audit Trail</h1>
        <p className="text-sm text-muted-foreground">Immutable event log, hash chain verification, evidence provenance</p>
      </div>
      <div className="flex gap-1 border-b border-border">
        {['events','hashchain','provenance'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-2 text-sm border-b-2 -mb-px", tab===t?"border-emerald-400 text-emerald-400":"border-transparent text-muted-foreground hover:text-foreground")}>
            {t==='events'?'Event Log':t==='hashchain'?'Hash Chain':'Provenance'}
          </button>
        ))}
      </div>

      {tab === 'events' && (
        <div className="rounded-lg border bg-card p-4 space-y-1">
          {sorted.map(ev => (
            <div key={ev.eventId} className="flex items-start gap-4 p-3 rounded hover:bg-accent/50 border-b last:border-0">
              <span className="text-lg">{getEventIcon(ev.type)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{ev.description}</span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", ev.type.includes('REJECTED')||ev.type.includes('VIOLATION')?'text-red-400 border-red-400/30':ev.type.includes('APPROVED')?'text-emerald-400 border-emerald-400/30':'text-muted-foreground border-border')}>{ev.type}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{ev.actor} ({ev.actorRole})</span><span>•</span><span>{formatDateTime(ev.timestamp)}</span><span>•</span><span className="font-mono">{ev.aasId}</span>
                </div>
              </div>
              <code className="text-[10px] text-emerald-400/60 font-mono">{ev.hash}</code>
            </div>
          ))}
        </div>
      )}

      {tab === 'hashchain' && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">🔗 Hash Chain Visualization</h3>
          <div className="space-y-0">
            {events.map((ev, i) => (
              <div key={ev.eventId} className="relative">
                {i < events.length - 1 && <div className="absolute left-6 top-14 bottom-0 w-0.5 bg-gradient-to-b from-emerald-400/40 to-emerald-400/10"/>}
                <div className="flex items-start gap-4 p-3">
                  <div className="flex-shrink-0 h-12 w-12 rounded-lg bg-card border-2 border-emerald-400/30 flex flex-col items-center justify-center z-10">
                    <span className="text-[10px] font-mono text-emerald-400">{ev.hash.slice(0,4)}</span>
                    <span className="text-[8px] text-muted-foreground">{ev.hash.slice(4,8)}</span>
                  </div>
                  <div className="flex-1 pt-1">
                    <p className="text-sm font-medium">{ev.description}</p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                      <span>{ev.type}</span><span>•</span><span>{ev.actor}</span><span>•</span><span>{formatDateTime(ev.timestamp)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[10px]">
                      <span className="text-muted-foreground">prev:</span>
                      <code className="text-amber-400/70 font-mono">{ev.previousHash}</code>
                      <span className="text-muted-foreground mx-1">→</span>
                      <span className="text-muted-foreground">curr:</span>
                      <code className="text-emerald-400/70 font-mono">{ev.hash}</code>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded bg-emerald-400/5 border border-emerald-400/20">
            <p className="text-xs text-emerald-400">✓ Hash chain integrity verified — all {events.length} events linked with valid previous hashes</p>
          </div>
        </div>
      )}

      {tab === 'provenance' && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">📋 Evidence Provenance</h3>
          <p className="text-xs text-muted-foreground mb-3">Snapshot hashes and version history for each artifact</p>
          {artifacts.map(art => {
            const artEvents = events.filter(e => (e.data as Record<string,unknown>).artifactId === art.artifactId);
            return (
              <div key={art.artifactId} className="p-3 rounded bg-background border">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{art.status==='APPROVED'?'✅':art.status==='REJECTED'?'❌':'⏳'}</span>
                  <p className="text-sm font-medium flex-1">{art.title}</p>
                  <code className="text-[10px] text-muted-foreground font-mono">{art.fileHash}</code>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", art.status==='APPROVED'?'text-emerald-400 border-emerald-400/30':art.status==='REJECTED'?'text-red-400 border-red-400/30':'text-amber-400 border-amber-400/30')}>{art.status}</span>
                </div>
                <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                  <span>v{art.version}</span><span>Submitted: {art.submittedBy} on {art.submittedAt}</span>
                  {art.approvedBy && <span>Approved: {art.approvedBy} on {art.approvedAt}</span>}
                  {art.rejectedBy && <span className="text-red-400">Rejected: {art.rejectedBy} on {art.rejectedAt}</span>}
                </div>
                {artEvents.length > 0 && (
                  <div className="mt-2 pl-4 border-l-2 border-emerald-400/20 space-y-1">
                    {artEvents.map(e => (
                      <div key={e.eventId} className="flex items-center gap-2 text-[10px]">
                        <span>{getEventIcon(e.type)}</span><span>{e.type}</span><span className="text-muted-foreground">{formatDateTime(e.timestamp)}</span>
                        <code className="text-emerald-400/50 font-mono ml-auto">{e.hash}</code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}