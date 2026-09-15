import { NextResponse } from 'next/server';
import { buildVoiceActivationBriefing } from '@/lib/voice-activation-briefing';
import {
  acknowledgeAdaptiveVoiceActivationBriefing,
  prepareAdaptiveVoiceActivationBriefing,
} from '@/lib/voice-activation-briefing-memory';
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

  const body = await request.json().catch(() => null) as {
    timezone?: unknown;
    action?: unknown;
    acknowledgement?: unknown;
  } | null;

  try {
    if (body?.action === 'acknowledge') {
      const acknowledgement = typeof body.acknowledgement === 'string'
        ? clip(body.acknowledgement, 32_000)
        : '';
      if (!acknowledgement) {
        return NextResponse.json({ error: 'Briefing acknowledgement is required.' }, {
          status: 400,
          headers: { 'Cache-Control': 'no-store, private' },
        });
      }
      const stored = await acknowledgeAdaptiveVoiceActivationBriefing(context, acknowledgement);
      return NextResponse.json({ ok: stored }, {
        status: stored ? 200 : 400,
        headers: { 'Cache-Control': 'no-store, private' },
      });
    }

    const timezone = typeof body?.timezone === 'string' ? clip(body.timezone, 100) : undefined;
    const briefing = await buildVoiceActivationBriefing(context, timezone);
    const adaptive = await prepareAdaptiveVoiceActivationBriefing(context, briefing);
    return NextResponse.json(adaptive, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    console.error('ELP voice activation briefing failed', error);
    return NextResponse.json({ error: 'Activation briefing is temporarily unavailable.' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store, private' },
    });
  }
}
