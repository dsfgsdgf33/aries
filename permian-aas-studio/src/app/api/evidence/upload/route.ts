import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const newArt = {
    artifactId: `art-${Date.now()}`,
    aasId: body.aasId,
    artifactType: body.artifactType,
    title: body.title || `${body.artifactType} Upload`,
    fileHash: `sha256:${Math.random().toString(36).slice(2, 14)}`,
    fileName: body.fileName || 'upload.pdf',
    status: 'PENDING' as const,
    submittedBy: body.submittedBy || 'Sarah Chen',
    submittedAt: new Date().toISOString().split('T')[0],
    version: 1,
  };
  return NextResponse.json({ success: true, artifact: newArt });
}
