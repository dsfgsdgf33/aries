import { NextRequest, NextResponse } from 'next/server';
import { seedData } from '@/lib/seed-data';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const assetType = sp.get('assetType');
  const operator = sp.get('operator');
  let results = seedData.envelopes;
  if (assetType) results = results.filter(e => e.assetType === assetType);
  if (operator) results = results.filter(e => e.operator.toLowerCase().includes(operator.toLowerCase()));
  return NextResponse.json({ count: results.length, envelopes: results });
}
