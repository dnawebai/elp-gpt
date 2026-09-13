import { NextResponse } from 'next/server';
import { getAnticipatorySnapshot, runAnticipatoryScan } from '@/lib/anticipatory-chief-of-staff';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 300;

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const snapshot = await getAnticipatorySnapshot(profile.profileId);
  return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { sessionId?: unknown; timezone?: unknown } | null;
  const sessionId = sanitizeId(body?.sessionId, 'anticipatory');
  const timezone = typeof body?.timezone === 'string' ? body.timezone.trim().slice(0, 100) : undefined;
  try {
    const result = await runAnticipatoryScan({ profileId: profile.profileId, sessionId, timezone, persist: true });
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('ELP anticipatory scan failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Anticipatory scan failed.' }, { status: 500 });
  }
}
