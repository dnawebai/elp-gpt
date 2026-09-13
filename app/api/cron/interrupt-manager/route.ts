import { NextResponse } from 'next/server';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getOwnerProfileId } from '@/lib/owner';
import { runInterruptManager } from '@/lib/interrupt-manager';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Interrupt Manager requires ELP single-user mode.' }, { status: 503 });
  try {
    const snapshot = await runInterruptManager({ profileId, persist: true });
    return NextResponse.json({
      ok: true,
      generatedAt: snapshot.generatedAt,
      interruptNow: snapshot.stats.interruptNow,
      queued: snapshot.stats.queued,
      monitored: snapshot.stats.monitored,
      replanned: snapshot.replanned,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP interrupt manager cron failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Interrupt analysis failed.' }, { status: 503 });
  }
}
