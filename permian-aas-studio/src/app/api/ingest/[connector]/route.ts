import { NextRequest, NextResponse } from 'next/server';
import { seedData } from '@/lib/seed-data';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ connector: string }> }) {
  const { connector } = await params;
  const conn = seedData.connectors.find(c => c.connectorId === connector);
  if (!conn) return NextResponse.json({ error: 'Connector not found' }, { status: 404 });
  const newRecords = Math.floor(Math.random() * 500) + 50;
  return NextResponse.json({ success: true, connector: conn.name, newRecords, preview: { added: newRecords, updated: Math.floor(newRecords * 0.1), conflicts: Math.floor(Math.random() * 3) } });
}
