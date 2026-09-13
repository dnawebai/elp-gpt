import { NextResponse } from 'next/server';
import { runDueAutonomousJobs } from '@/lib/autonomous-jobs';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Autonomous jobs require ELP_SINGLE_USER_MODE=true.' }, { status: 503 });
  try {
    const result = await runDueAutonomousJobs(profileId, new Date(), 6);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP autonomous jobs cron failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Autonomous jobs cycle failed.' }, { status: 503 });
  }
}
