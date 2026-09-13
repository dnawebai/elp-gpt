import { NextResponse } from 'next/server';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getOwnerProfileId } from '@/lib/owner';
import { runPortfolioReview } from '@/lib/portfolio-review';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Portfolio Control requires ELP_SINGLE_USER_MODE=true.' }, { status: 503 });
  try {
    const slot = Math.floor(Date.now() / (4 * 60 * 60 * 1000));
    const review = await runPortfolioReview(profileId);
    return NextResponse.json({
      ok: true,
      slot,
      createdTasks: review.createdTasks,
      stats: review.snapshot.stats,
      exceptions: review.snapshot.delegationExceptions.slice(0, 8).map((item) => ({ id: item.delegation.id, severity: item.severity, delegatee: item.delegation.delegatee, reason: item.reason })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP portfolio control cron failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Portfolio control review failed.' }, { status: 503 });
  }
}
