import { NextResponse } from 'next/server';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getOwnerProfileId } from '@/lib/owner';
import { runSubscriptionLifecycle } from '@/lib/subscription-lifecycle';

export const runtime = 'nodejs';
export const maxDuration = 180;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Subscription lifecycle requires ELP single-user mode.' }, { status: 503 });
  try {
    const snapshot = await runSubscriptionLifecycle({ profileId, persist: true });
    return NextResponse.json({ ok: true, generatedAt: snapshot.generatedAt, stats: snapshot.stats }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP subscription lifecycle cron failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Subscription lifecycle failed.' }, { status: 503 });
  }
}
