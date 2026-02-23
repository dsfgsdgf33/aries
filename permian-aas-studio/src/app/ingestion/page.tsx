"use client";
import { seedData } from "@/lib/data";
import { cn, getStatusColor, formatDateTime, staleness } from "@/lib/utils";
import { Database, RefreshCw, Settings, Zap, AlertTriangle } from "lucide-react";

const mappings: Record<string,string[][]> = {
  'API': [['API14','apiNumber'],['WellName','name'],['Operator','operator'],['County','county'],['ProdDate','production.date'],['Oil_BBL','production.oil'],['Gas_MCF','production.gas']],
  'OPC-UA': [['ns=2;s=WHP','scada.pressure'],['ns=2;s=WHT','scada.temperature'],['ns=2;s=FlowRate','scada.flowRate'],['ns=2;s=Status','scada.pumpStatus']],
  'RFC': [['AUFNR','accounting.afe'],['KOSTL','accounting.costCenter'],['NETWR','accounting.revenue'],['DMBTR','accounting.cost']],
  'File': [['fileName','artifact.fileName'],['fileType','artifact.artifactType'],['uploadDate','artifact.submittedAt']],
  'REST': [['permitNumber','regulatory.permitId'],['status','regulatory.status'],['violationId','regulatory.violationId']],
};

export default function Ingestion() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Database className="text-emerald-400" size={24}/> Data Ingestion</h1>
        <p className="text-sm text-muted-foreground">Connector management, field mapping, and ingest preview</p>
      </div>
      <div className="space-y-4">
        {seedData.connectors.map(c => {
          const s = staleness(c.lastSync);
          const maps = mappings[c.type] || [];
          return (
            <div key={c.connectorId} className={cn("rounded-lg border bg-card p-4", c.status==='ERROR'&&'border-red-400/20')}>
              <div className="flex items-start gap-4">
                <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center", c.status==='ACTIVE'?'bg-emerald-400/10':'bg-red-400/10')}>
                  {c.type==='OPC-UA'?<Zap size={20} className={c.status==='ERROR'?'text-red-400':'text-emerald-400'}/>:<Database size={20} className={c.status==='ERROR'?'text-red-400':'text-emerald-400'}/>}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{c.name}</h3>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", c.status==='ACTIVE'?'text-emerald-400 border-emerald-400/30':'text-red-400 border-red-400/30')}>{c.status}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary">{c.type}</span>
                    {c.status==='ERROR' && <AlertTriangle size={14} className="text-red-400"/>}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{c.scope}</p>
                  <div className="flex items-center gap-6 mt-2 text-xs text-muted-foreground">
                    <span>Cadence: <strong className="text-foreground">{c.cadence}</strong></span>
                    <span>Records: <strong className="text-foreground">{c.recordCount.toLocaleString()}</strong></span>
                    <span>Last: <strong className={cn(s==='FRESH'?'text-emerald-400':s==='STALE'?'text-amber-400':'text-red-400')}>{formatDateTime(c.lastSync)}</strong></span>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded", s==='FRESH'?'bg-emerald-400/10 text-emerald-400':s==='STALE'?'bg-amber-400/10 text-amber-400':'bg-red-400/10 text-red-400')}>{s}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex items-center gap-1 px-3 py-1.5 rounded border text-xs hover:bg-accent"><RefreshCw size={12}/> Sync</button>
                  <button className="p-1.5 rounded border hover:bg-accent"><Settings size={14}/></button>
                </div>
              </div>
              {maps.length > 0 && (
                <div className="mt-4 p-3 rounded bg-background border">
                  <p className="text-xs font-medium mb-2">Field Mapping</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {maps.map(([src,dst]) => (
                      <div key={src} className="flex items-center gap-1 p-1.5 bg-card rounded text-[11px]">
                        <code className="text-muted-foreground">{src}</code><span className="text-emerald-400">→</span><code>{dst}</code>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {c.status === 'ERROR' && (
                <div className="mt-3 p-3 rounded bg-red-400/5 border border-red-400/20">
                  <p className="text-xs text-red-400">⚠ Connection failed: HTTP 503 — RRC API maintenance window. Next retry: Sunday 4:00 AM CT</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}