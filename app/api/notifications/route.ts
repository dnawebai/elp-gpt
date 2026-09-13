import { NextResponse } from 'next/server';
import { getNotificationCenter, refreshNotifications, updateNotification, type NotificationStatus } from '@/lib/notifications';
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
  const center = await getNotificationCenter(profile.profileId);
  return NextResponse.json(center, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  try {
    const result = await refreshNotifications(profile.profileId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('Notification refresh failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Notification refresh failed.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { id?: unknown; status?: NotificationStatus } | null;
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  const status = body?.status;
  if (!id || !status) return NextResponse.json({ error: 'id and status are required.' }, { status: 400 });
  try {
    await updateNotification(profile.profileId, id, status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Notification update failed.' }, { status: 400 });
  }
}
