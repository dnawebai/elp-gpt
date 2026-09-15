import { NextResponse } from 'next/server';
import { refreshApprovalEscalations } from '@/lib/approval-escalation';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { deliverMobilePriorityNotifications } from '@/lib/mobile-notification-delivery';
import { deliverPriorityNotifications } from '@/lib/notification-delivery';
import { refreshNotifications } from '@/lib/notifications';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Autonomous notifications require ELP single-user mode.' }, { status: 503 });
  try {
    const result = await refreshNotifications(profileId);
    const escalation = await refreshApprovalEscalations(profileId);
    const [delivery, mobile] = await Promise.all([
      deliverPriorityNotifications(profileId),
      deliverMobilePriorityNotifications(profileId),
    ]);
    return NextResponse.json({
      ok: result.ok,
      newCount: result.newCount,
      updatedCount: result.updatedCount,
      unread: result.center.stats.unread,
      critical: result.center.stats.critical,
      high: result.center.stats.high,
      approvalsEscalated: escalation.escalated,
      delivery: { attempted: delivery.attempted, sent: delivery.sent, failed: delivery.failed, channels: delivery.channels },
      mobile: { attempted: mobile.attempted, sent: mobile.sent, failed: mobile.failed },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Autonomous notification refresh failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Notification refresh failed.' }, { status: 503 });
  }
}
