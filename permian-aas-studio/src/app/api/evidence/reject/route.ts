import { NextRequest, NextResponse } from 'next/server';
import { seedData } from '@/lib/seed-data';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { artifactId, rejectedBy, note } = body;
  const artifact = seedData.artifacts.find(a => a.artifactId === artifactId);
  if (!artifact) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, artifact: { ...artifact, status: 'REJECTED', rejectedBy, rejectedAt: new Date().toISOString().split('T')[0], rejectionNote: note } });
}
