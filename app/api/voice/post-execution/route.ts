import { NextResponse } from 'next/server';
import { recordFulfilmentExecuted } from '@/lib/commitment-fulfilment';
import { recordMeetingFollowUpExecuted } from '@/lib/meeting-follow-up';
import { addMeetingOutcomeEvidence } from '@/lib/outcome-memory';
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
  const kind = typeof body?.kind === 'string' ? body.kind : '';
  const evidence = typeof body?.evidence === 'string' ? body.evidence.slice(0, 3000) : undefined;

  try {
    if (kind === 'commitment-fulfilment') {
      const recordId = sanitizeId(body?.recordId, '');
      if (!recordId) return NextResponse.json({ error: 'A valid recordId is required.' }, { status: 400 });
      const result = await recordFulfilmentExecuted(profile.profileId, recordId, evidence);
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    const meetingId = sanitizeId(body?.meetingId, '');
    if (!meetingId) return NextResponse.json({ error: 'A valid meetingId is required.' }, { status: 400 });

    if (kind === 'meeting-follow-up') {
      const index = typeof body?.index === 'number' && Number.isInteger(body.index) ? body.index : -1;
      if (index < 0) return NextResponse.json({ error: 'A valid follow-up index is required.' }, { status: 400 });
      const result = await recordMeetingFollowUpExecuted(profile.profileId, meetingId, index, evidence);
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (kind === 'meeting-calendar') {
      const summary = typeof body?.summary === 'string' ? body.summary.trim().slice(0, 900) : 'Approved follow-up calendar event was created.';
      const detail = evidence ? `${summary} Evidence: ${evidence}` : summary;
      await addMeetingOutcomeEvidence(profile.profileId, meetingId, detail);
      return NextResponse.json({ ok: true, evidence: detail }, { headers: { 'Cache-Control': 'no-store, private' } });
    }
    return NextResponse.json({ error: 'Unsupported post-execution action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Post-execution recording failed.' }, { status: 500 });
  }
}
