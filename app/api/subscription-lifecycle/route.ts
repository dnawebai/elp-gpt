import { NextResponse } from 'next/server';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';
import { getSubscriptionLifecycleSnapshot, runSubscriptionLifecycle } from '@/lib/subscription-lifecycle';

export const runtime = 'nodejs';
export const maxDuration = 180;

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

export async function GET(request: Request) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  return NextResponse.json({ snapshot: await getSubscriptionLifecycleSnapshot(profile.profileId) }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (body?.action !== 'refresh') return NextResponse.json({ error: 'Unsupported lifecycle action.' }, { status: 400 });
  try {
    const snapshot = await runSubscriptionLifecycle({ profileId: profile.profileId, persist: true });
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Subscription lifecycle refresh failed.' }, { status: 500 });
  }
}
