import { recordActionApproved } from '@/lib/approval-ledger';
import { hasCapability, requiredApprovalCapability } from '@/lib/authority-policy';
import { listActivePasskeys } from '@/lib/passkey-memory';
import { validatePrincipalSession } from '@/lib/principal-sessions';
import { createActionToken, sanitizeId, verifyActionToken, verifyPrincipalStepUpToken } from '@/lib/security';
import { recordSecurityEventSafe } from '@/lib/security-audit';
import type { ZeroTrustAuthorityContext } from '@/lib/zero-trust-authority';

export type GovernedApprovalInput = {
  proposalToken?: unknown;
  sessionId?: unknown;
  stepUpToken?: unknown;
};

export type GovernedApprovalResponse = {
  status: number;
  body: Record<string, unknown>;
};

export async function approveGovernedAction(
  context: ZeroTrustAuthorityContext,
  input: GovernedApprovalInput,
): Promise<GovernedApprovalResponse> {
  const proposal = verifyActionToken(typeof input.proposalToken === 'string' ? input.proposalToken : undefined);
  const suppliedSession = typeof input.sessionId === 'string' ? sanitizeId(input.sessionId, 'web') : null;
  if (!proposal || proposal.stage !== 'proposal' || proposal.profileId !== context.profileId || (suppliedSession && proposal.sessionId !== suppliedSession)) {
    return { status: 401, body: { error: 'Invalid or expired action proposal.' } };
  }

  const capability = requiredApprovalCapability(proposal.risk);
  if (capability && !hasCapability(context.principal.role, capability, context.principal.capabilities)) {
    return { status: 403, body: { error: `Principal is not authorized to approve ${proposal.risk}-risk actions.` } };
  }

  if (proposal.risk === 'high') {
    const passkeys = await listActivePasskeys(context.profileId, context.principal.id);
    const requireStepUp = context.delegated || passkeys.length > 0;
    if (requireStepUp) {
      const stepUp = verifyPrincipalStepUpToken(typeof input.stepUpToken === 'string' ? input.stepUpToken : undefined);
      if (!stepUp || stepUp.purpose !== 'high-risk-approval' || stepUp.profileId !== context.profileId || stepUp.principalId !== context.principal.id) {
        return { status: 428, body: { error: 'Fresh step-up authorization is required for this high-risk approval.', stepUpRequired: true, stepUpMethod: passkeys.length ? 'passkey' : 'access-grant' } };
      }
      if (passkeys.length && stepUp.method !== 'passkey') {
        return { status: 428, body: { error: 'A registered passkey is required for this high-risk approval.', stepUpRequired: true, stepUpMethod: 'passkey' } };
      }
      if (context.delegated) {
        if (!context.session) return { status: 401, body: { error: 'Delegated session is unavailable.' } };
        const liveSession = await validatePrincipalSession({
          profileId: context.profileId,
          principalId: context.principal.id,
          sessionId: context.session.id,
          tokenVersion: context.session.tokenVersion,
        });
        if (!liveSession || stepUp.sessionId !== liveSession.id || stepUp.tokenVersion !== liveSession.tokenVersion) {
          return { status: 428, body: { error: 'Step-up authorization is not bound to the active delegated session.', stepUpRequired: true, stepUpMethod: passkeys.length ? 'passkey' : 'access-grant' } };
        }
      } else if (stepUp.sessionId !== 'owner' || stepUp.tokenVersion !== 'owner') {
        return { status: 428, body: { error: 'Passkey authorization is not bound to the owner session.', stepUpRequired: true, stepUpMethod: 'passkey' } };
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

  return {
    status: 200,
    body: {
      approved: true,
      risk: proposal.risk,
      approvedByPrincipalId: context.principal.id,
      executionToken,
      expiresInSeconds: 90,
    },
  };
}
