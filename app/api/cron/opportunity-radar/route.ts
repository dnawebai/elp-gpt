import { NextResponse } from 'next/server';
import { getBriefingTimezone, getOwnerProfileId, localDateParts } from '@/lib/owner';
import { hasCompletedRadarRun, scanOpportunityRadar } from '@/lib/radar';

export const runtime = 'nodejs';
export const maxDuration = 300;

function isAuthorised(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const profileId = getOwnerProfileId();
  if (!profileId) {
    return NextResponse.json(
      { ok: false, error: 'Opportunity Radar requires LUKE_SINGLE_USER_MODE=true.' },
      { status: 503 },
    );
  }

  const timezone = getBriefingTimezone();
  const local = localDateParts(timezone);
  const bucket = Math.floor(local.hour / 4) * 4;
  const runKey = `auto-${local.date}-${String(bucket).padStart(2, '0')}`;

  if (await hasCompletedRadarRun(profileId, runKey)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'radar-bucket-already-completed',
      runKey,
      timezone,
      localDate: local.date,
      localHour: local.hour,
    });
  }

  const result = await scanOpportunityRadar({
    profileId,
    sessionId: `autonomous-radar-${runKey}`,
    timezone,
    runKey,
  });

  return NextResponse.json({
    ok: result.ok,
    runKey,
    result,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
