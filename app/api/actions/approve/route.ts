import { NextResponse } from 'next/server';
import { recordActionApproved } from '@/lib/approval-ledger';
import { hasCapability, requiredApprovalCapability } from '@/lib/authority-policy';
import { resolveAuthorityContext } from '@/lib/principal-authority';
import { createActionToken, sanitizeId, verifyActionToken } from '@/lib/security';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const context = await resolveAuthorityContext(request);
  if (!context) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { proposalToken?: unknown; sessionId?: unknown } | null;
  const proposal = verifyActionToken(typeof body?.proposalToken === 'string' ? body.proposalToken : undefined);
  const suppliedSession = typeof body?.sessionId === 'string' ? sanitizeId(body.sessionId, 'web') : null;
  if (
    !proposal ||
    proposal.stage !== 'proposal' ||
    proposal.profileId !== context.profileId ||
    (suppliedSession && proposal.sessionId !== suppliedSession)
  ) {
    return NextResponse.json({ error: 'Invalid or expired action proposal.' }, { status: 401 });
  }

  const capability = requiredApprovalCapability(proposal.risk);
  if (capability && !hasCapability(context.principal.role, capability, context.principal.capabilities)) {
    return NextResponse.json({ error: `Principal is not authorized to approve ${proposal.risk}-risk actions.` }, { status: 403 });
  }

  const executionToken = createActionToken({
    stage: 'approved',
    profileId: proposal.profileId,
    sessionId: proposal.sessionId,
    digest: proposal.digest,
    risk: proposal.risk,
    nonce: proposal.nonce,
    principalId: context.principal.id,
    ttlSeconds: 90,
  });

  try {
    await recordActionApproved(context.profileId, proposal.nonce);
  } catch (error) {
    console.error('ELP approval audit failed', error);
  }

  return NextResponse.json({
    approved: true,
    risk: proposal.risk,
    approvedByPrincipalId: context.principal.id,
    executionToken,
    expiresInSeconds: 90,
  }, { headers: { 'Cache-Control': 'no-store, private' } });
}
