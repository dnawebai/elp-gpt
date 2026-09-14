import { NextResponse } from 'next/server';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { runIntegrationHealth } from '@/lib/integration-health';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Integration health requires ELP single-user mode.' }, { status: 503 });
  try {
    const snapshot = await runIntegrationHealth({ profileId, persist: true, refreshProviders: true });
    return NextResponse.json({
      ok: true,
      generatedAt: snapshot.generatedAt,
      score: snapshot.score,
      broken: snapshot.stats.broken,
      degraded: snapshot.stats.degraded,
      reconnectRequired: snapshot.stats.reconnectRequired,
      automaticRepairs: snapshot.stats.automaticRepairs,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP integration health cron failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message.slice(0, 500) : 'Integration health failed.' }, { status: 503 });
  }
}
