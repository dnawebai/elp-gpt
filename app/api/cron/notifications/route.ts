import { NextResponse } from 'next/server';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { deliverPriorityNotifications } from '@/lib/notification-delivery';
import { refreshNotifications } from '@/lib/notifications';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) {
    return NextResponse.json({ ok: false, error: 'Autonomous notifications require ELP_SINGLE_USER_MODE=true.' }, { status: 503 });
  }
  try {
    const result = await refreshNotifications(profileId);
    const delivery = await deliverPriorityNotifications(profileId);
    return NextResponse.json({
      ok: result.ok,
      newCount: result.newCount,
      updatedCount: result.updatedCount,
      unread: result.center.stats.unread,
      critical: result.center.stats.critical,
      high: result.center.stats.high,
      delivery: {
        attempted: delivery.attempted,
        sent: delivery.sent,
        failed: delivery.failed,
        channels: delivery.channels,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Autonomous notification refresh failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Notification refresh failed.' }, { status: 503 });
  }
}
