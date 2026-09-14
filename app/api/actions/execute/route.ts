import { NextResponse } from 'next/server';
import { actionDigest, normalizeToolSlug, sanitizeActionArguments } from '@/lib/actions';
import { recordActionExecuted, recordActionExecuting, recordActionFailed } from '@/lib/approval-ledger';
import { hasCapability, requiredApprovalCapability } from '@/lib/authority-policy';
import { executeComposioTool, isComposioConfigured } from '@/lib/composio';
import { sanitizeId, verifyActionToken } from '@/lib/security';
import { recordSecurityEventSafe } from '@/lib/security-audit';
import { resolveZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const maxDuration = 60;

function evidencePreview(value: unknown) {
  try {
    const text = JSON.stringify(value);
    return text.length <= 1800 ? text : `${text.slice(0, 1800)}…`;
  } catch {
    return 'Execution completed; result was not serializable.';
  }
}

export async function POST(request: Request) {
  const context = await resolveZeroTrustAuthority(request);
  if (!context) return NextResponse.json({ error: 'Identity not established or delegated session revoked.' }, { status: 401 });
  if (!isComposioConfigured()) return NextResponse.json({ error: 'Composio is not configured.' }, { status: 503 });

  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    sessionId?: unknown;
    toolSlug?: unknown;
    arguments?: unknown;
    connectedAccountId?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid execution request.' }, { status: 400 });

  const token = verifyActionToken(typeof body.token === 'string' ? body.token : undefined);
  const suppliedSession = typeof body.sessionId === 'string' ? sanitizeId(body.sessionId, 'web') : null;
  const toolSlug = normalizeToolSlug(body.toolSlug);
  const argumentsValue = sanitizeActionArguments(body.arguments);
  const connectedAccountId = typeof body.connectedAccountId === 'string' ? body.connectedAccountId.trim().slice(0, 160) : undefined;

  if (
    !token ||
    !toolSlug ||
    !argumentsValue ||
    token.profileId !== context.profileId ||
    (suppliedSession && token.sessionId !== suppliedSession) ||
    (token.principalId && token.principalId !== context.principal.id)
  ) {
    return NextResponse.json({ error: 'Invalid or expired action authorization.' }, { status: 401 });
  }

  const digest = actionDigest({ toolSlug, arguments: argumentsValue, connectedAccountId });
  if (digest !== token.digest) {
    return NextResponse.json({ error: 'Action changed after authorization. Re-plan and approve it.' }, { status: 409 });
  }

  if (token.risk !== 'read' && token.stage !== 'approved') {
    return NextResponse.json({ error: 'Explicit approval is required for this action.' }, { status: 403 });
  }

  const capability = requiredApprovalCapability(token.risk);
  if (capability && !hasCapability(context.principal.role, capability, context.principal.capabilities)) {
    return NextResponse.json({ error: `Principal no longer has permission to execute this ${token.risk}-risk action.` }, { status: 403 });
  }
  if (token.risk === 'read' && !hasCapability(context.principal.role, 'read_context', context.principal.capabilities)) {
    return NextResponse.json({ error: 'Principal is not authorized to read connected context.' }, { status: 403 });
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
    return NextResponse.json({ ok: true, toolSlug, risk: token.risk, executedByPrincipalId: context.principal.id, result }, {
      headers: { 'Cache-Control': 'no-store, private' },
    });
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
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
