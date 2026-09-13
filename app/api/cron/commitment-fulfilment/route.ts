import { NextResponse } from 'next/server';
import { runCommitmentFulfilmentCycle } from '@/lib/commitment-fulfilment';
import { getOwnerProfileId } from '@/lib/owner';

export const runtime = 'nodejs';
export const maxDuration = 300;

function authorised(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const profileId = getOwnerProfileId();
  if (!profileId) return NextResponse.json({ error: 'Stable owner mode is required.' }, { status: 503 });

  try {
    const slot = Math.floor(Date.now() / (2 * 60 * 60 * 1000));
    const result = await runCommitmentFulfilmentCycle({
      profileId,
      sessionPrefix: `autonomous-fulfilment-${slot}`,
      limit: 4,
      force: false,
    });
    return NextResponse.json({ ok: true, slot, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('ELP commitment fulfilment cron failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Commitment fulfilment cycle failed.' }, { status: 500 });
  }
}
