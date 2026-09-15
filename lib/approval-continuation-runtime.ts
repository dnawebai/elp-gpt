import { actionDigest } from '@/lib/actions';
import { approveGovernedAction } from '@/lib/action-approval';
import { executeGovernedAction } from '@/lib/action-governor';
import { loadApprovalContinuation, updateApprovalContinuation } from '@/lib/approval-continuations';
import { recordActionRejected } from '@/lib/approval-ledger';
import { hasCapability, requiredApprovalCapability } from '@/lib/authority-policy';
import { createActionToken } from '@/lib/security';
import type { ZeroTrustAuthorityContext } from '@/lib/zero-trust-authority';

export type ApprovalContinuationCommand = {
  continuationId?: unknown;
  action?: unknown;
  stepUpToken?: unknown;
};

export type ApprovalContinuationResponse = {
  status: number;
  body: Record<string, unknown>;
};

function idValue(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 160) : '';
}

export async function runApprovalContinuation(
  context: ZeroTrustAuthorityContext,
  input: ApprovalContinuationCommand,
): Promise<ApprovalContinuationResponse> {
  const continuationId = idValue(input.continuationId);
  const action = input.action === 'reject' ? 'reject' : input.action === 'approve' ? 'approve' : null;
  if (!continuationId || !action) return { status: 400, body: { error: 'continuationId and action are required.' } };

  const loaded = await loadApprovalContinuation(context.profileId, continuationId);
  if (!loaded) return { status: 404, body: { error: 'Pending approval continuation was not found, has expired, or is no longer resumable.' } };
  const { record, envelope } = loaded;

  const capability = requiredApprovalCapability(envelope.risk);
  if (capability && !hasCapability(context.principal.role, capability, context.principal.capabilities)) {
    return { status: 403, body: { error: `Principal is not authorized to ${action} this ${envelope.risk}-risk action.` } };
  }

  const digest = actionDigest({
    toolSlug: envelope.toolSlug,
    arguments: envelope.arguments,
    connectedAccountId: envelope.connectedAccountId,
  });
  if (digest !== envelope.digest || digest !== record.digest) {
    await updateApprovalContinuation(context.profileId, continuationId, { status: 'failed', error: 'Continuation digest mismatch.' }).catch(() => undefined);
    return { status: 409, body: { error: 'The pending action no longer matches its original approval digest.' } };
  }

  if (action === 'reject') {
    await Promise.all([
      recordActionRejected(context.profileId, envelope.nonce).catch(() => null),
      updateApprovalContinuation(context.profileId, continuationId, { status: 'rejected' }).catch(() => null),
    ]);
    return {
      status: 200,
      body: {
        ok: true,
        rejected: true,
        continuationId: record.id,
        summary: record.summary,
        toolSlug: record.toolSlug,
        risk: record.risk,
      },
    };
  }

  const proposalToken = createActionToken({
    stage: 'proposal',
    profileId: context.profileId,
    sessionId: envelope.sessionId,
    digest: envelope.digest,
    risk: envelope.risk,
    nonce: envelope.nonce,
    ...(envelope.proposedByPrincipalId ? { principalId: envelope.proposedByPrincipalId } : {}),
    ttlSeconds: 300,
  });

  const approval = await approveGovernedAction(context, {
    proposalToken,
    sessionId: envelope.sessionId,
    stepUpToken: input.stepUpToken,
  });
  if (approval.status !== 200) return approval;

  const executionToken = typeof approval.body.executionToken === 'string' ? approval.body.executionToken : '';
  if (!executionToken) {
    await updateApprovalContinuation(context.profileId, continuationId, { status: 'failed', error: 'Approval did not return an execution token.' }).catch(() => undefined);
    return { status: 500, body: { error: 'Approval succeeded but no execution token was issued.' } };
  }

  const execution = await executeGovernedAction(context, {
    token: executionToken,
    sessionId: envelope.sessionId,
    toolSlug: envelope.toolSlug,
    arguments: envelope.arguments,
    connectedAccountId: envelope.connectedAccountId,
  });

  if (execution.status === 200 && execution.body.ok === true) {
    await updateApprovalContinuation(context.profileId, continuationId, { status: 'executed' }).catch(() => undefined);
    return {
      status: 200,
      body: {
        ok: true,
        executed: true,
        continuationId: record.id,
        summary: record.summary,
        toolSlug: record.toolSlug,
        risk: record.risk,
        result: execution.body.result,
      },
    };
  }

  const error = typeof execution.body.error === 'string' ? execution.body.error : 'Execution failed after approval.';
  await updateApprovalContinuation(context.profileId, continuationId, { status: 'failed', error }).catch(() => undefined);
  return { status: execution.status, body: { ...execution.body, continuationId: record.id } };
}
