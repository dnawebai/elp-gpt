import { NextResponse } from 'next/server';
import { recordInboundEvent, verifyGoogleCalendarWebhook } from '@/lib/event-fabric';
import { runInterruptManager } from '@/lib/interrupt-manager';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  const profileId = getOwnerProfileId(); if (!profileId) return NextResponse.json({ ok: false }, { status: 503 });
  const channelId = request.headers.get('x-goog-channel-id') || ''; const token = request.headers.get('x-goog-channel-token') || ''; const resourceState = request.headers.get('x-goog-resource-state') || 'change'; const resourceId = request.headers.get('x-goog-resource-id') || undefined;
  if (!channelId || !token || !(await verifyGoogleCalendarWebhook(profileId, channelId, token))) return NextResponse.json({ ok: false }, { status: 401 });
  await recordInboundEvent(profileId, { provider: 'google_calendar', type: resourceState, sourceId: resourceId, summary: 'Google Calendar reported a calendar-event change.', metadata: { channelId } });
  if (resourceState !== 'sync') await runInterruptManager({ profileId, persist: true }).catch((error) => console.error('ELP realtime calendar replanning failed', error));
  return NextResponse.json({ ok: true });
}
