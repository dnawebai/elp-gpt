import { NextResponse } from 'next/server';
import { getBriefingTimezone, getOwnerProfileId } from '@/lib/owner';
import { hasCompletedRelationshipRun } from '@/lib/relationship-memory';
import { scanRelationshipIntelligence } from '@/lib/relationship-intelligence';

export const runtime = 'nodejs';
export const maxDuration = 300;

function isAuthorised(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

function currentRunKey() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const slot = Math.floor(now.getUTCHours() / 8);
  return `relationship-${date}-slot-${slot}`;
}

export async function GET(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const profileId = getOwnerProfileId();
  if (!profileId) {
    return NextResponse.json(
      { ok: false, error: 'Autonomous relationship intelligence requires ELP_SINGLE_USER_MODE=true.' },
      { status: 503 },
    );
  }

  const runKey = currentRunKey();
  if (await hasCompletedRelationshipRun(profileId, runKey)) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'already-completed', runKey });
  }

  const timezone = getBriefingTimezone();
  const result = await scanRelationshipIntelligence({
    profileId,
    sessionId: `autonomous-${runKey}`,
    timezone,
    runKey,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status === 'needs_input' ? 409 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
