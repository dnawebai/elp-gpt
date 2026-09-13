import { NextResponse } from 'next/server';
import { evaluateDueMeetingOutcomes } from '@/lib/meeting-outcome-evaluator';
import { getMeetingOutcome, createMeetingOutcome } from '@/lib/outcome-memory';
import { listMeetings } from '@/lib/meeting-copilot';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

function authorised(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ error: 'Stable owner mode is required.' }, { status: 503 });
  try {
    const meetings = await listMeetings(profileId);
    let created = 0;
    for (const meeting of meetings.filter((item) => item.status === 'completed').slice(0, 40)) {
      const existing = await getMeetingOutcome(profileId, meeting.id);
      if (existing) continue;
      const outcome = await createMeetingOutcome(profileId, {
        meetingId: meeting.id,
        title: meeting.title,
        objective: meeting.objective || `Verify whether the decisions, commitments and intended next steps from ${meeting.title} produced a successful result.`,
        initialEvidence: meeting.finalInsights?.summary ? [`Meeting record: ${meeting.finalInsights.summary}`] : [],
      });
      if (outcome) created += 1;
    }
    const result = await evaluateDueMeetingOutcomes({ profileId, sessionPrefix: 'autonomous-outcome-review', limit: 4 });
    return NextResponse.json({ ok: true, created, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('JARBIS meeting outcome cron failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Meeting outcome review failed.' }, { status: 500 });
  }
}
