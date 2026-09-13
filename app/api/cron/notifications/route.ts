import { NextResponse } from 'next/server';
import { refreshNotifications } from '@/lib/notifications';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

function isAuthorised(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) {
    return NextResponse.json({ ok: false, error: 'Autonomous notifications require ELP_SINGLE_USER_MODE=true.' }, { status: 503 });
  }
  try {
    const result = await refreshNotifications(profileId);
    return NextResponse.json({
      ok: result.ok,
      newCount: result.newCount,
      updatedCount: result.updatedCount,
      unread: result.center.stats.unread,
      critical: result.center.stats.critical,
      high: result.center.stats.high,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Autonomous notification refresh failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Notification refresh failed.' }, { status: 503 });
  }
}
