import { NextRequest, NextResponse } from 'next/server';
import { runSlashyMission } from '@/lib/slashy-agent';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

export async function POST(request: NextRequest) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  try {
    const body = await request.json().catch(() => null) as { objective?: unknown; sessionId?: unknown; context?: unknown; refreshCommunications?: unknown } | null;
    const objective = typeof body?.objective === 'string' ? body.objective.trim().slice(0, 2200) : '';
    if (!objective) return NextResponse.json({ error: 'objective is required' }, { status: 400 });
    const result = await runSlashyMission(profile.profileId, {
      objective,
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId.slice(0, 120) : undefined,
      context: typeof body?.context === 'string' ? body.context.slice(0, 1800) : undefined,
      refreshCommunications: body?.refreshCommunications === true,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Slashy Agent failed.' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
