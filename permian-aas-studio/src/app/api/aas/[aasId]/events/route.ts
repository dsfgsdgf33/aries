import { NextRequest, NextResponse } from 'next/server';
import { seedData } from '@/lib/seed-data';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ aasId: string }> }) {
  const { aasId } = await params;
  const events = seedData.events.filter(ev => ev.aasId === aasId);
  return NextResponse.json({ aasId, events });
}
