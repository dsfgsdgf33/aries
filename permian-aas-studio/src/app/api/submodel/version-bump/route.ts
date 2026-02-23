import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  return NextResponse.json({ success: true, aasId: body.aasId, submodelType: body.submodelType, newVersion: (body.currentVersion || 1) + 1, timestamp: new Date().toISOString() });
}
