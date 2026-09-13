import { NextResponse } from 'next/server';
import { createGoogleCalendarWatch, ensureBaselineEventStatus, listEventSubscriptions } from '@/lib/event-fabric';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 60;

function profileFrom(request: Request) { const token = (request.headers.get('cookie') || '').split(';').map((p) => p.trim()).find((p) => p.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length + 1); return verifyProfileToken(token); }

export async function GET(request: Request) {
  const profile = profileFrom(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  await ensureBaselineEventStatus(profile.profileId);
  return NextResponse.json({ subscriptions: await listEventSubscriptions(profile.profileId) }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = profileFrom(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (body?.action !== 'watch-google-calendar') return NextResponse.json({ error: 'Unsupported subscription action.' }, { status: 400 });
  try {
    const origin = new URL(request.url).origin;
    const subscription = await createGoogleCalendarWatch(profile.profileId, `${origin}/api/webhooks/google-calendar`);
    return NextResponse.json({ ok: true, subscription });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Calendar watch creation failed.' }, { status: 500 }); }
}
