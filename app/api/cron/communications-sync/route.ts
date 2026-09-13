import { NextResponse } from 'next/server';
import { runCommunicationsSync } from '@/lib/communications-sync';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Communications sync requires ELP single-user mode.' }, { status: 503 });
  try {
    const run = await runCommunicationsSync({ profileId, persist: true });
    return NextResponse.json({ ok: true, generatedAt: run.generatedAt, newEvents: run.newEvents, degraded: run.degraded, providers: run.results.map((item) => ({ provider: item.provider, accountLabel: item.accountLabel, status: item.status, newEvents: item.newEvents })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP communications sync cron failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Communications sync failed.' }, { status: 503 });
  }
}
