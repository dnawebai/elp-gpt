import { NextResponse } from 'next/server';
import {
  getRadarSnapshot,
  promoteRadarSignal,
  scanOpportunityRadar,
  updateRadarSignal,
  type RadarSignalStatus,
} from '@/lib/radar';
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
  const snapshot = await getRadarSnapshot(profile.profileId);
  return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
    timezone?: unknown;
  } | null;

  try {
    const result = await scanOpportunityRadar({
      profileId: profile.profileId,
      sessionId: sanitizeId(body?.sessionId, 'radar'),
      timezone: typeof body?.timezone === 'string' ? body.timezone : undefined,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Radar scan failed.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    messageId?: unknown;
    status?: unknown;
    promoteKind?: unknown;
  } | null;

  const messageId = sanitizeId(body?.messageId, '');
  if (!messageId) return NextResponse.json({ error: 'A valid messageId is required.' }, { status: 400 });

  try {
    if (body?.promoteKind !== undefined) {
      const kind = body.promoteKind;
      if (kind !== 'decision' && kind !== 'commitment' && kind !== 'assumption' && kind !== 'objective') {
        return NextResponse.json({ error: 'Invalid promotion kind.' }, { status: 400 });
      }
      const ledgerId = await promoteRadarSignal(profile.profileId, messageId, kind);
      return NextResponse.json({ ok: true, ledgerId });
    }

    const status = body?.status;
    if (status !== 'open' && status !== 'acknowledged' && status !== 'dismissed') {
      return NextResponse.json({ error: 'Invalid radar status.' }, { status: 400 });
    }
    await updateRadarSignal(profile.profileId, messageId, status as RadarSignalStatus);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Radar update failed.' }, { status: 500 });
  }
}
