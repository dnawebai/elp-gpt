import { NextResponse } from 'next/server';
import { createActionToken, PROFILE_COOKIE, sanitizeId, verifyActionToken, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

export async function POST(request: Request) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { proposalToken?: unknown; sessionId?: unknown } | null;
  const proposal = verifyActionToken(typeof body?.proposalToken === 'string' ? body.proposalToken : undefined);
  const suppliedSession = typeof body?.sessionId === 'string' ? sanitizeId(body.sessionId, 'web') : null;
  if (
    !proposal ||
    proposal.stage !== 'proposal' ||
    proposal.profileId !== profile.profileId ||
    (suppliedSession && proposal.sessionId !== suppliedSession)
  ) {
    return NextResponse.json({ error: 'Invalid or expired action proposal.' }, { status: 401 });
  }

  const executionToken = createActionToken({
    stage: 'approved',
    profileId: proposal.profileId,
    sessionId: proposal.sessionId,
    digest: proposal.digest,
    risk: proposal.risk,
    nonce: proposal.nonce,
    ttlSeconds: 90,
  });

  return NextResponse.json({
    approved: true,
    risk: proposal.risk,
    executionToken,
    expiresInSeconds: 90,
  }, { headers: { 'Cache-Control': 'no-store, private' } });
}
