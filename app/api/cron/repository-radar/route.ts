import { NextResponse } from 'next/server';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getOwnerProfileId } from '@/lib/owner';
import { runRepositoryRadar } from '@/lib/repository-radar';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const profileId = getOwnerProfileId();
  if (!profileId) {
    return NextResponse.json(
      { ok: false, error: 'Repository Radar requires ELP_SINGLE_USER_MODE=true.' },
      { status: 503 },
    );
  }

  try {
    const snapshot = await runRepositoryRadar(profileId);
    return NextResponse.json({
      ok: true,
      generatedAt: snapshot.generatedAt,
      queryCount: snapshot.queryCount,
      candidateCount: snapshot.candidates.length,
      priorityCount: snapshot.candidates.filter((item) => item.recommendation === 'priority').length,
      investigateCount: snapshot.candidates.filter((item) => item.recommendation === 'investigate').length,
      tasksCreated: snapshot.tasksCreated,
      errors: snapshot.errors,
      safety: 'Discovery and research only. No third-party repository was installed or executed.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP repository radar failed', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Repository Radar failed.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
