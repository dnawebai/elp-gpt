import { NextResponse } from 'next/server';
import { recordActionApproved } from '@/lib/approval-ledger';
import { hasCapability, requiredApprovalCapability } from '@/lib/authority-policy';
import { listActivePasskeys } from '@/lib/passkey-memory';
import { validatePrincipalSession } from '@/lib/principal-sessions';
import { createActionToken, sanitizeId, verifyActionToken, verifyPrincipalStepUpToken } from '@/lib/security';
import { recordSecurityEventSafe } from '@/lib/security-audit';
import { resolveZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const context = await resolveZeroTrustAuthority(request);
  if (!context) return NextResponse.json({ error: 'Identity not established or delegated session revoked.' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { proposalToken?: unknown; sessionId?: unknown; stepUpToken?: unknown } | null;
  const proposal = verifyActionToken(typeof body?.proposalToken === 'string' ? body.proposalToken : undefined);
  const suppliedSession = typeof body?.sessionId === 'string' ? sanitizeId(body.sessionId, 'web') : null;
  if (!proposal || proposal.stage !== 'proposal' || proposal.profileId !== context.profileId || (suppliedSession && proposal.sessionId !== suppliedSession)) {
    return NextResponse.json({ error: 'Invalid or expired action proposal.' }, { status: 401 });
  }

  const capability = requiredApprovalCapability(proposal.risk);
  if (capability && !hasCapability(context.principal.role, capability, context.principal.capabilities)) {
    return NextResponse.json({ error: `Principal is not authorized to approve ${proposal.risk}-risk actions.` }, { status: 403 });
  }

  if (proposal.risk === 'high') {
    const passkeys = await listActivePasskeys(context.profileId, context.principal.id);
    const requireStepUp = context.delegated || passkeys.length > 0;
    if (requireStepUp) {
      const stepUp = verifyPrincipalStepUpToken(typeof body?.stepUpToken === 'string' ? body.stepUpToken : undefined);
      if (!stepUp || stepUp.purpose !== 'high-risk-approval' || stepUp.profileId !== context.profileId || stepUp.principalId !== context.principal.id) {
        return NextResponse.json({ error: 'Fresh step-up authorization is required for this high-risk approval.', stepUpRequired: true, stepUpMethod: passkeys.length ? 'passkey' : 'access-grant' }, { status: 428 });
      }
      if (passkeys.length && stepUp.method !== 'passkey') {
        return NextResponse.json({ error: 'A registered passkey is required for this high-risk approval.', stepUpRequired: true, stepUpMethod: 'passkey' }, { status: 428 });
      }
      if (context.delegated) {
        if (!context.session) return NextResponse.json({ error: 'Delegated session is unavailable.' }, { status: 401 });
        const liveSession = await validatePrincipalSession({ profileId: context.profileId, principalId: context.principal.id, sessionId: context.session.id, tokenVersion: context.session.tokenVersion });
        if (!liveSession || stepUp.sessionId !== liveSession.id || stepUp.tokenVersion !== liveSession.tokenVersion) {
          return NextResponse.json({ error: 'Step-up authorization is not bound to the active delegated session.', stepUpRequired: true, stepUpMethod: passkeys.length ? 'passkey' : 'access-grant' }, { status: 428 });
        }
      } else if (stepUp.sessionId !== 'owner' || stepUp.tokenVersion !== 'owner') {
        return NextResponse.json({ error: 'Passkey authorization is not bound to the owner session.', stepUpRequired: true, stepUpMethod: 'passkey' }, { status: 428 });
      }
    }
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
  if (proposal.risk === 'high') {
    await recordSecurityEventSafe(context.profileId, {
      category: 'action',
      action: 'action.high_risk_approved',
      outcome: 'success',
      severity: 'high',
      actorPrincipalId: context.principal.id,
      sessionId: context.session?.id,
      subjectId: proposal.nonce,
      detail: proposal.digest,
    });
  }

  return NextResponse.json({
    approved: true,
    risk: proposal.risk,
    approvedByPrincipalId: context.principal.id,
    executionToken,
    expiresInSeconds: 90,
  }, { headers: { 'Cache-Control': 'no-store, private' } });
}
