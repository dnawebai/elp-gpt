import { NextResponse } from 'next/server';
import { buildNextBestActionQueue } from '@/lib/next-best-action';
import { buildVoiceActivationBriefing } from '@/lib/voice-activation-briefing';
import { requireZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const maxDuration = 60;

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : clean.slice(0, max);
}

export async function POST(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'read_context');
  if (!context) {
    return NextResponse.json({ error: 'Authenticated read authority is required.' }, {
      status: 401,
      headers: { 'Cache-Control': 'no-store, private' },
    });
  }

  const body = await request.json().catch(() => null) as { timezone?: unknown } | null;
  const timezone = typeof body?.timezone === 'string' ? clip(body.timezone, 100) : undefined;

  try {
    const briefing = await buildVoiceActivationBriefing(context, timezone);
    const queue = buildNextBestActionQueue(context, briefing);
    return NextResponse.json({ ok: true, ...queue }, {
      headers: { 'Cache-Control': 'no-store, private' },
    });
  } catch (error) {
    console.error('ELP next-best-action queue failed', error);
    return NextResponse.json({ error: 'Next-best-action queue is temporarily unavailable.' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store, private' },
    });
  }
}
