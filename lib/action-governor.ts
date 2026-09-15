import { randomUUID } from 'node:crypto';
import { actionDigest, approvalCopy, classifyActionRisk, normalizeToolSlug, sanitizeActionArguments, type ActionRisk } from '@/lib/actions';
import { recordActionApproved, recordActionExecuted, recordActionExecuting, recordActionFailed, recordActionProposal } from '@/lib/approval-ledger';
import { hasCapability, requiredApprovalCapability } from '@/lib/authority-policy';
import { executeComposioTool, isComposioConfigured } from '@/lib/composio';
import { createActionToken, sanitizeId, verifyActionToken } from '@/lib/security';
import { recordSecurityEventSafe } from '@/lib/security-audit';
import { evaluateStandingAuthority, recordStandingAuthorityUse } from '@/lib/standing-authority';
import type { ZeroTrustAuthorityContext } from '@/lib/zero-trust-authority';

export type GovernedActionInput = {
  sessionId?: unknown;
  toolSlug?: unknown;
  arguments?: unknown;
  summary?: unknown;
  connectedAccountId?: unknown;
};

export type GovernedExecutionInput = {
  token?: unknown;
  sessionId?: unknown;
  toolSlug?: unknown;
  arguments?: unknown;
  connectedAccountId?: unknown;
};

export type GovernedActionResponse = {
  status: number;
  body: Record<string, unknown>;
};

export type PlanGovernedActionOptions = {
  forceExplicitApprovalForHigh?: boolean;
};

function evidencePreview(value: unknown) {
  try {
    const text = JSON.stringify(value);
    return text.length <= 1800 ? text : `${text.slice(0, 1800)}…`;
  } catch {
    return 'Execution completed; result was not serializable.';
  }
}

export async function planGovernedAction(
  context: ZeroTrustAuthorityContext,
  input: GovernedActionInput,
  options: PlanGovernedActionOptions = {},
): Promise<GovernedActionResponse> {
  const toolSlug = normalizeToolSlug(input.toolSlug);
  const argumentsValue = sanitizeActionArguments(input.arguments);
  if (!toolSlug || !argumentsValue) return { status: 400, body: { error: 'Invalid tool or arguments.' } };

  const sessionId = sanitizeId(input.sessionId, 'web');
  const connectedAccountId = typeof input.connectedAccountId === 'string'
    ? input.connectedAccountId.trim().slice(0, 160)
    : undefined;
  const summary = typeof input.summary === 'string'
    ? input.summary.trim().slice(0, 500)
    : toolSlug.replaceAll('_', ' ').toLowerCase();
  const risk = classifyActionRisk(toolSlug);

  if (risk === 'read' && !hasCapability(context.principal.role, 'read_context', context.principal.capabilities)) {
    return { status: 403, body: { error: 'Principal is not authorized to read connected context.' } };
  }
  const approvalCapability = requiredApprovalCapability(risk);
  if (approvalCapability && !hasCapability(context.principal.role, approvalCapability, context.principal.capabilities)) {
    return { status: 403, body: { error: `Principal is not authorized to plan ${risk}-risk connected actions.` } };
  }

  const digest = actionDigest({ toolSlug, arguments: argumentsValue, connectedAccountId });
  const nonce = randomUUID();
  const proposalTtl = 300;
  const expiresAt = new Date(Date.now() + proposalTtl * 1000).toISOString();
  try {
    await recordActionProposal(context.profileId, { nonce, digest, sessionId, toolSlug, summary, risk, expiresAt });
  } catch (error) {
    console.error('ELP approval proposal audit failed', error);
  }

  const forceExplicit = risk === 'high' && options.forceExplicitApprovalForHigh === true;
  const standing = risk === 'read' || forceExplicit
    ? null
    : await evaluateStandingAuthority({
        profileId: context.profileId,
        principalId: context.principal.id,
        toolSlug,
        arguments: argumentsValue,
        risk,
        connectedAccountId,
      });

  if (standing?.allowed && standing.policy) {
    const executionTtl = 90;
    const executionToken = createActionToken({
      stage: 'approved',
      profileId: context.profileId,
      sessionId,
      digest,
      risk,
      nonce,
      principalId: context.principal.id,
      ttlSeconds: executionTtl,
    });
    try {
      await recordActionApproved(context.profileId, nonce);
      await recordStandingAuthorityUse(context.profileId, standing.policy, context.principal.id, toolSlug, digest);
      await recordSecurityEventSafe(context.profileId, {
        category: 'action',
        action: 'action.authorized_by_standing_policy',
        outcome: 'success',
        severity: risk === 'high' ? 'critical' : 'high',
        actorPrincipalId: context.principal.id,
        subjectId: standing.policy.id,
        sessionId: context.session?.id,
        detail: `${toolSlug}: ${summary}`,
      });
    } catch (error) {
      console.error('ELP standing-authority audit failed', error);
    }
    return {
      status: 200,
      body: {
        configured: isComposioConfigured(),
        action: { toolSlug, arguments: argumentsValue, connectedAccountId, summary },
        risk,
        requiresApproval: false,
        standingAuthorityAuthorized: true,
        standingAuthorityPolicy: { id: standing.policy.id, name: standing.policy.name },
        executionToken,
        expiresInSeconds: executionTtl,
        proposedByPrincipalId: context.principal.id,
      },
    };
  }

  const proposalToken = createActionToken({
    stage: 'proposal',
    profileId: context.profileId,
    sessionId,
    digest,
    risk,
    nonce,
    principalId: context.principal.id,
    ttlSeconds: proposalTtl,
  });
  return {
    status: 200,
    body: {
      configured: isComposioConfigured(),
      action: { toolSlug, arguments: argumentsValue, connectedAccountId, summary },
      risk,
      requiresApproval: risk !== 'read' || forceExplicit,
      policy: forceExplicit
        ? 'Explicit approval is required for high-risk actions proposed by an autonomous agent.'
        : approvalCopy(risk),
      proposedByPrincipalId: context.principal.id,
      proposalToken,
      expiresInSeconds: proposalTtl,
      ...(standing ? { standingAuthorityReason: standing.reason } : {}),
      ...(forceExplicit ? { forcedExplicitApproval: true } : {}),
    },
  };
}

export async function executeGovernedAction(
  context: ZeroTrustAuthorityContext,
  input: GovernedExecutionInput,
): Promise<GovernedActionResponse> {
  if (!isComposioConfigured()) return { status: 503, body: { error: 'Composio is not configured.' } };

  const token = verifyActionToken(typeof input.token === 'string' ? input.token : undefined);
  const suppliedSession = typeof input.sessionId === 'string' ? sanitizeId(input.sessionId, 'web') : null;
  const toolSlug = normalizeToolSlug(input.toolSlug);
  const argumentsValue = sanitizeActionArguments(input.arguments);
  const connectedAccountId = typeof input.connectedAccountId === 'string'
    ? input.connectedAccountId.trim().slice(0, 160)
    : undefined;

  if (
    !token ||
    !toolSlug ||
    !argumentsValue ||
    token.profileId !== context.profileId ||
    (suppliedSession && token.sessionId !== suppliedSession) ||
    (token.principalId && token.principalId !== context.principal.id)
  ) {
    return { status: 401, body: { error: 'Invalid or expired action authorization.' } };
  }

  const digest = actionDigest({ toolSlug, arguments: argumentsValue, connectedAccountId });
  if (digest !== token.digest) {
    return { status: 409, body: { error: 'Action changed after authorization. Re-plan and approve it.' } };
  }
  if (token.risk !== 'read' && token.stage !== 'approved') {
    return { status: 403, body: { error: 'Explicit approval is required for this action.' } };
  }

  const capability = requiredApprovalCapability(token.risk);
  if (capability && !hasCapability(context.principal.role, capability, context.principal.capabilities)) {
    return { status: 403, body: { error: `Principal no longer has permission to execute this ${token.risk}-risk action.` } };
  }
  if (token.risk === 'read' && !hasCapability(context.principal.role, 'read_context', context.principal.capabilities)) {
    return { status: 403, body: { error: 'Principal is not authorized to read connected context.' } };
  }

  try {
    await recordActionExecuting(context.profileId, token.nonce);
  } catch (error) {
    console.error('ELP execution-start audit failed', error);
  }

  try {
    const result = await executeComposioTool({
      toolSlug,
      arguments: argumentsValue,
      profileId: context.profileId,
      connectedAccountId,
    });
    try {
      await recordActionExecuted(context.profileId, token.nonce, evidencePreview(result));
    } catch (error) {
      console.error('ELP execution-success audit failed', error);
    }
    if (token.risk === 'high') {
      await recordSecurityEventSafe(context.profileId, {
        category: 'action',
        action: 'action.high_risk_executed',
        outcome: 'success',
        severity: 'high',
        actorPrincipalId: context.principal.id,
        subjectId: token.nonce,
        sessionId: context.session?.id,
        detail: toolSlug,
      });
    }
    return {
      status: 200,
      body: { ok: true, toolSlug, risk: token.risk, executedByPrincipalId: context.principal.id, result },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action execution failed.';
    console.error('ELP action execution failed', toolSlug, error);
    try {
      await recordActionFailed(context.profileId, token.nonce, message);
    } catch (auditError) {
      console.error('ELP execution-failure audit failed', auditError);
    }
    if (token.risk === 'high') {
      await recordSecurityEventSafe(context.profileId, {
        category: 'action',
        action: 'action.high_risk_failed',
        outcome: 'failure',
        severity: 'critical',
        actorPrincipalId: context.principal.id,
        subjectId: token.nonce,
        sessionId: context.session?.id,
        detail: `${toolSlug}: ${message}`.slice(0, 900),
      });
    }
    return { status: 502, body: { ok: false, error: message } };
  }
}

export function governedActionRisk(toolSlug: string): ActionRisk {
  return classifyActionRisk(toolSlug);
}
