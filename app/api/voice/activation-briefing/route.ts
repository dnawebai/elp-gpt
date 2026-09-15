import { NextResponse } from 'next/server';
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
    return NextResponse.json(briefing, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('ELP voice activation briefing failed', error);
    return NextResponse.json({ error: 'Activation briefing is temporarily unavailable.' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store, private' },
    });
  }
}
