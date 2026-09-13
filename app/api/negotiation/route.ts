import { NextResponse } from 'next/server';
import { prepareNegotiationBrief } from '@/lib/relationship-intelligence';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 120;

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    target?: unknown;
    objective?: unknown;
    context?: unknown;
    sessionId?: unknown;
  } | null;
  const target = typeof body?.target === 'string' ? body.target.trim() : '';
  if (!target) return NextResponse.json({ error: 'A counterpart or negotiation target is required.' }, { status: 400 });
  // Session is currently advisory metadata only; sanitize it so this endpoint can
  // evolve to persisted negotiation sessions without accepting arbitrary IDs.
  sanitizeId(body?.sessionId, 'negotiation');

  try {
    const result = await prepareNegotiationBrief({
      profileId: profile.profileId,
      target,
      objective: typeof body?.objective === 'string' ? body.objective : undefined,
      context: typeof body?.context === 'string' ? body.context : undefined,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Negotiation brief failed.' }, { status: 500 });
  }
}
