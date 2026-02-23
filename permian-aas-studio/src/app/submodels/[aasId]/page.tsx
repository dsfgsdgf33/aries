"use client";
import { Shell } from "@/components/shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { seedData } from "@/lib/seed-data";
import { cn, getStatusColor, getAssetIcon, formatDate } from "@/lib/utils";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function SubmodelsPage({ params }: { params: Promise<{ aasId: string }> }) {
  const { aasId } = use(params);
  const env = seedData.envelopes.find(e => e.aasId === aasId);
  if (!env) return <Shell><div className="p-6"><h1>Not Found</h1></div></Shell>;

  const arts = seedData.artifacts.filter(a => a.aasId === aasId);
  const reqs = seedData.evidenceRequirements.filter(r => r.appliesToAssetTypes.includes(env.assetType));

  return (
    <Shell>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/aas-explorer" className="text-muted-foreground hover:text-foreground"><ArrowLeft size={18} /></Link>
          <span className="text-2xl">{getAssetIcon(env.assetType)}</span>
          <div>
            <h1 className="text-xl font-bold">{env.name} — Submodels</h1>
            <p className="text-sm text-muted-foreground">{env.assetType} • {env.operator}</p>
          </div>
          <Badge variant="outline" className={cn("ml-auto", getStatusColor(env.complianceStatus))}>{env.compliancePct}%</Badge>
        </div>

        <div className="grid gap-4">
          {env.submodels.map(sm => {
            const pct = sm.total > 0 ? Math.round((sm.met / sm.total) * 100) : 0;
            const isRegulatory = sm.type === 'Regulatory';
            return (
              <Card key={sm.type} className={isRegulatory ? 'border-emerald-400/30 glow-green' : ''}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      {sm.type.replace(/_/g, ' / ')}
                      {isRegulatory && <Badge className="text-[10px] bg-emerald-400/20 text-emerald-400 border-0">PRIMARY</Badge>}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">v{sm.version}</Badge>
                      <Badge variant="outline" className={cn("text-[10px]", getStatusColor(sm.status))}>{sm.status}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Progress value={pct} className="flex-1 h-2" indicatorClassName={pct === 100 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500"} />
                    <span className="text-sm font-mono w-16 text-right">{sm.met}/{sm.total}</span>
                  </div>

                  {sm.missing.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {sm.missing.map((m, i) => <Badge key={i} variant="outline" className="text-[10px] text-red-400 border-red-400/30">⚠ Missing: {m}</Badge>)}
                    </div>
                  )}

                  {isRegulatory && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Artifact Register</p>
                      {reqs.filter(r => r.requiredFor.includes('COMPLIANCE_STATUS')).map(r => {
                        const art = arts.find(a => a.artifactType === r.artifactType);
                        return (
                          <div key={r.requirementId} className="flex items-center gap-2 p-2 rounded bg-background border text-sm">
                            <span>{art?.status === 'APPROVED' ? '✅' : art?.status === 'PENDING' ? '⏳' : art?.status === 'REJECTED' ? '❌' : '⬜'}</span>
                            <span className="font-medium flex-1">{r.artifactType}</span>
                            <span className="text-xs text-muted-foreground">{r.description}</span>
                            {art && <Badge variant="outline" className={cn("text-[10px]", getStatusColor(art.status))}>{art.status}</Badge>}
                            {!art && r.mandatory && <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">Missing</Badge>}
                            {r.mandatory && <span className="text-[10px] text-amber-400">Required</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
