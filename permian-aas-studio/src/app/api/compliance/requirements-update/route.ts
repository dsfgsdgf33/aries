import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  return NextResponse.json({ success: true, updated: body, timestamp: new Date().toISOString() });
}
