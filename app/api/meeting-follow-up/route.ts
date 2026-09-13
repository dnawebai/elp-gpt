import { NextResponse } from 'next/server';
import { prepareMeetingFollowUp, recordMeetingFollowUpExecuted } from '@/lib/meeting-follow-up';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  const meetingId = sanitizeId(body?.meetingId, '');
  const index = typeof body?.index === 'number' && Number.isInteger(body.index) ? body.index : -1;
  if (!meetingId || index < 0) return NextResponse.json({ error: 'Valid meetingId and follow-up index are required.' }, { status: 400 });

  try {
    if (action === 'prepare') {
      const prepared = await prepareMeetingFollowUp(profile.profileId, meetingId, index);
      return NextResponse.json({ ok: true, status: 'approval_required', pendingAction: {
        toolSlug: prepared.toolSlug,
        arguments: prepared.arguments,
        summary: prepared.summary,
        risk: 'write',
      }, followUp: prepared }, { headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (action === 'record-executed') {
      const evidence = typeof body?.evidence === 'string' ? body.evidence : undefined;
      const result = await recordMeetingFollowUpExecuted(profile.profileId, meetingId, index, evidence);
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
    }
    return NextResponse.json({ error: 'Unsupported follow-up action.' }, { status: 400 });
  } catch (error) {
    console.error('JARBIS meeting follow-up request failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Meeting follow-up operation failed.' }, { status: 500 });
  }
}
