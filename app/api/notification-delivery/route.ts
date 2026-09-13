import { NextResponse } from 'next/server';
import {
  deliverPriorityNotifications,
  getNotificationDeliverySnapshot,
  removePushSubscription,
  savePushSubscription,
  setDeliveryPreferences,
} from '@/lib/notification-delivery';
import type { NotificationDeliveryPreferences } from '@/lib/notification-delivery-policy';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 120;

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  try {
    const snapshot = await getNotificationDeliverySnapshot(profile.profileId);
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('Notification delivery snapshot failed', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Notification delivery snapshot failed.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store, private' } });
  }
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  try {
    if (action === 'preferences') {
      const preferences = body?.preferences as NotificationDeliveryPreferences | undefined;
      if (!preferences || typeof preferences !== 'object') return NextResponse.json({ error: 'preferences are required.' }, { status: 400 });
      return NextResponse.json({ ok: true, preferences: await setDeliveryPreferences(profile.profileId, preferences) }, { headers: { 'Cache-Control': 'no-store, private' } });
    }
    if (action === 'subscribe_push') {
      const subscription = body?.subscription as { endpoint?: unknown; expirationTime?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
      if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.keys || typeof subscription.keys.p256dh !== 'string' || typeof subscription.keys.auth !== 'string') {
        return NextResponse.json({ error: 'A valid push subscription is required.' }, { status: 400 });
      }
      await savePushSubscription(profile.profileId, {
        endpoint: subscription.endpoint,
        expirationTime: typeof subscription.expirationTime === 'number' ? subscription.expirationTime : null,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      });
      return NextResponse.json({ ok: true });
    }
    if (action === 'unsubscribe_push') {
      const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
      if (!endpoint) return NextResponse.json({ error: 'endpoint is required.' }, { status: 400 });
      await removePushSubscription(profile.profileId, endpoint);
      return NextResponse.json({ ok: true });
    }
    if (action === 'deliver_now') {
      return NextResponse.json(await deliverPriorityNotifications(profile.profileId), { headers: { 'Cache-Control': 'no-store, private' } });
    }
    return NextResponse.json({ error: 'Unsupported notification delivery action.' }, { status: 400 });
  } catch (error) {
    console.error('Notification delivery API failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Notification delivery failed.' }, { status: 500 });
  }
}
