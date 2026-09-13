import { NextResponse } from 'next/server';
import { runCommitmentFulfilmentCycle } from '@/lib/commitment-fulfilment';
import { isCronRequestAuthorised } from '@/lib/cron-auth';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorised(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ ok: false, error: 'Autonomous commitment fulfilment requires ELP_SINGLE_USER_MODE=true.' }, { status: 503 });

  try {
    const slot = Math.floor(Date.now() / (2 * 60 * 60 * 1000));
    const result = await runCommitmentFulfilmentCycle({ profileId, sessionPrefix: `autonomous-fulfilment-${slot}`, limit: 4, force: false });
    return NextResponse.json({ ok: true, slot, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP commitment fulfilment cron failed', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Commitment fulfilment cycle failed.' }, { status: 503 });
  }
}
