import { NextResponse } from 'next/server';
import { runAnticipatoryScan } from '@/lib/anticipatory-chief-of-staff';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { refreshNotifications } from '@/lib/notifications';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Anticipatory Chief of Staff requires ELP_SINGLE_USER_MODE=true.' }, { status: 503 });
  try {
    const timezone = process.env.ELP_BRIEFING_TIMEZONE || 'America/Toronto';
    const slot = Math.floor(Date.now() / (3 * 60 * 60 * 1000));
    const forecast = await runAnticipatoryScan({ profileId, sessionId: `anticipatory-cron-${slot}`, timezone, persist: true });
    const notifications = await refreshNotifications(profileId);
    return NextResponse.json({ ok: true, slot, forecast: { generatedAt: forecast.generatedAt, stats: forecast.stats, createdTasks: forecast.createdTasks }, notifications: { newCount: notifications.newCount, updatedCount: notifications.updatedCount } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP anticipatory chief of staff cron failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Anticipatory scan failed.' }, { status: 503 });
  }
}
