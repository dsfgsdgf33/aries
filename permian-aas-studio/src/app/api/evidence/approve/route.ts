import { NextRequest, NextResponse } from 'next/server';
import { seedData } from '@/lib/seed-data';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { artifactId, approvedBy } = body;
  const artifact = seedData.artifacts.find(a => a.artifactId === artifactId);
  if (!artifact) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (artifact.submittedBy === approvedBy) {
    return NextResponse.json({ error: 'SoD Violation: submitter cannot approve own artifact', violation: 'sod-001', blocked: true }, { status: 403 });
  }
  return NextResponse.json({ success: true, artifact: { ...artifact, status: 'APPROVED', approvedBy, approvedAt: new Date().toISOString().split('T')[0] } });
}
