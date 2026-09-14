import { NextResponse } from 'next/server';
import { consumeCompanionEnrollment } from '@/lib/principal-authority';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const token = typeof body?.enrollmentToken === 'string' ? body.enrollmentToken : '';
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
  if (!token || !deviceId) return NextResponse.json({ error: 'enrollmentToken and deviceId are required.' }, { status: 400 });
  try {
    const enrolled = await consumeCompanionEnrollment({
      token,
      deviceId,
      label: typeof body?.label === 'string' ? body.label : undefined,
      platform: typeof body?.platform === 'string' ? body.platform : undefined,
      agentVersion: typeof body?.agentVersion === 'string' ? body.agentVersion : undefined,
    });
    return NextResponse.json({
      ok: true,
      companionToken: enrolled.companionToken,
      device: enrolled.device,
      principal: { id: enrolled.principal.id, displayName: enrolled.principal.displayName, role: enrolled.principal.role },
    }, { status: 201, headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Companion enrollment failed.' }, { status: 401 });
  }
}
