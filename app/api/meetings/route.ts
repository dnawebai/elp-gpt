import { NextResponse } from 'next/server';
import {
  analyseLiveMeeting,
  appendMeetingTranscript,
  cancelMeeting,
  createMeeting,
  finalizeMeeting,
  getMeeting,
  getMeetingTranscript,
  listMeetings,
  prepareMeeting,
  startMeeting,
  type MeetingParticipant,
} from '@/lib/meeting-copilot';
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

function meetingId(value: unknown) {
  return sanitizeId(value, '');
}

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const url = new URL(request.url);
  const id = meetingId(url.searchParams.get('meetingId'));
  try {
    if (!id) {
      const meetings = await listMeetings(profile.profileId);
      return NextResponse.json({ meetings }, { headers: { 'Cache-Control': 'no-store, private' } });
    }
    const [meeting, transcript] = await Promise.all([
      getMeeting(profile.profileId, id),
      getMeetingTranscript(profile.profileId, id),
    ]);
    return NextResponse.json({ meeting, transcript }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Meeting read failed.' }, { status: 404 });
  }
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';

  try {
    if (action === 'create') {
      const title = typeof body?.title === 'string' ? body.title.trim() : '';
      if (!title) return NextResponse.json({ error: 'Meeting title is required.' }, { status: 400 });
      const participants = Array.isArray(body?.participants) ? body.participants as MeetingParticipant[] : [];
      const result = await createMeeting(profile.profileId, {
        title,
        objective: typeof body?.objective === 'string' ? body.objective : undefined,
        participants,
      });
      return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const id = meetingId(body?.meetingId);
    if (!id) return NextResponse.json({ error: 'A valid meetingId is required.' }, { status: 400 });
    const sessionId = sanitizeId(body?.sessionId, id);

    if (action === 'prepare') {
      const result = await prepareMeeting(profile.profileId, id, sessionId, typeof body?.timezone === 'string' ? body.timezone : undefined);
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'start') {
      const meeting = await startMeeting(profile.profileId, id);
      return NextResponse.json({ ok: true, meeting }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'transcript') {
      const text = typeof body?.text === 'string' ? body.text : '';
      const result = await appendMeetingTranscript(profile.profileId, id, {
        text,
        speaker: typeof body?.speaker === 'string' ? body.speaker : undefined,
        sequence: typeof body?.sequence === 'number' ? body.sequence : undefined,
        capturedAt: typeof body?.capturedAt === 'string' ? body.capturedAt : undefined,
      });
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'analyse-live') {
      const transcript = typeof body?.transcript === 'string' ? body.transcript : '';
      if (!transcript.trim()) return NextResponse.json({ error: 'Transcript is required.' }, { status: 400 });
      const result = await analyseLiveMeeting(profile.profileId, id, transcript);
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'finalize') {
      const result = await finalizeMeeting(profile.profileId, id, {
        transcript: typeof body?.transcript === 'string' ? body.transcript : undefined,
        sessionId,
      });
      return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'cancel') {
      const meeting = await cancelMeeting(profile.profileId, id);
      return NextResponse.json({ ok: true, meeting }, { headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({ error: 'Unsupported meeting action.' }, { status: 400 });
  } catch (error) {
    console.error('JARBIS meeting request failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Meeting operation failed.' }, { status: 500 });
  }
}
