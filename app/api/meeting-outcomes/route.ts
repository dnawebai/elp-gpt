import { NextResponse } from 'next/server';
import { evaluateMeetingOutcome } from '@/lib/meeting-outcome-evaluator';
import { getMeeting, listMeetings } from '@/lib/meeting-copilot';
import { createMeetingOutcome, getMeetingOutcome, getMeetingOutcomeSnapshot, updateMeetingOutcome, type MeetingOutcomeStatus } from '@/lib/outcome-memory';
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

async function ensureCompletedMeetingOutcomes(profileId: string) {
  const meetings = await listMeetings(profileId);
  for (const meeting of meetings.filter((item) => item.status === 'completed')) {
    const existing = await getMeetingOutcome(profileId, meeting.id);
    if (existing) continue;
    await createMeetingOutcome(profileId, {
      meetingId: meeting.id,
      title: meeting.title,
      objective: meeting.objective || `Verify whether the decisions, commitments and intended next steps from ${meeting.title} produced a successful result.`,
      initialEvidence: meeting.finalInsights?.summary ? [`Meeting record: ${meeting.finalInsights.summary}`] : [],
    });
  }
}

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const url = new URL(request.url);
  const meetingId = sanitizeId(url.searchParams.get('meetingId'), '');
  try {
    await ensureCompletedMeetingOutcomes(profile.profileId);
    if (meetingId) {
      const outcome = await getMeetingOutcome(profile.profileId, meetingId);
      return NextResponse.json({ outcome }, { headers: { 'Cache-Control': 'no-store, private' } });
    }
    const snapshot = await getMeetingOutcomeSnapshot(profile.profileId);
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Outcome read failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  const meetingId = sanitizeId(body?.meetingId, '');
  if (!meetingId) return NextResponse.json({ error: 'A valid meetingId is required.' }, { status: 400 });
  try {
    let outcome = await getMeetingOutcome(profile.profileId, meetingId);
    if (!outcome) {
      const meeting = await getMeeting(profile.profileId, meetingId);
      if (meeting.status !== 'completed') return NextResponse.json({ error: 'Meeting must be completed before outcome tracking.' }, { status: 409 });
      outcome = await createMeetingOutcome(profile.profileId, {
        meetingId,
        title: meeting.title,
        objective: meeting.objective || `Verify whether the decisions, commitments and intended next steps from ${meeting.title} produced a successful result.`,
        initialEvidence: meeting.finalInsights?.summary ? [`Meeting record: ${meeting.finalInsights.summary}`] : [],
      });
    }

    if (action === 'evaluate') {
      const sessionId = sanitizeId(body?.sessionId, `outcome-${meetingId}`);
      const result = await evaluateMeetingOutcome({ profileId: profile.profileId, meetingId, sessionId });
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (action === 'override') {
      const status = typeof body?.status === 'string' ? body.status as MeetingOutcomeStatus : undefined;
      const score = typeof body?.score === 'number' ? body.score : undefined;
      const summary = typeof body?.summary === 'string' ? body.summary : undefined;
      const updated = await updateMeetingOutcome(profile.profileId, meetingId, { status, score, summary, confidence: 1, lastEvaluatedAt: new Date().toISOString(), nextReviewAt: null, incrementEvaluation: true });
      return NextResponse.json({ ok: true, outcome: updated }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    return NextResponse.json({ error: 'Unsupported outcome action.' }, { status: 400 });
  } catch (error) {
    console.error('JARBIS meeting outcome request failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Outcome operation failed.' }, { status: 500 });
  }
}
