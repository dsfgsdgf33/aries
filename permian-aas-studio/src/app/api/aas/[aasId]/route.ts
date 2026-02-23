import { NextRequest, NextResponse } from 'next/server';
import { seedData } from '@/lib/seed-data';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ aasId: string }> }) {
  const { aasId } = await params;
  const envelope = seedData.envelopes.find(e => e.aasId === aasId);
  if (!envelope) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const artifacts = seedData.artifacts.filter(a => a.aasId === aasId);
  const events = seedData.events.filter(ev => ev.aasId === aasId);
  return NextResponse.json({ envelope, artifacts, events });
}
