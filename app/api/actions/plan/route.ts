import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { actionDigest, approvalCopy, classifyActionRisk, normalizeToolSlug, sanitizeActionArguments } from '@/lib/actions';
import { recordActionProposal } from '@/lib/approval-ledger';
import { hasCapability, requiredApprovalCapability } from '@/lib/authority-policy';
import { isComposioConfigured } from '@/lib/composio';
import { createActionToken, sanitizeId } from '@/lib/security';
import { resolveZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const context = await resolveZeroTrustAuthority(request);
  if (!context) return NextResponse.json({ error: 'Identity not established or delegated session revoked.' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
    toolSlug?: unknown;
    arguments?: unknown;
    summary?: unknown;
    connectedAccountId?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid action request.' }, { status: 400 });

  const toolSlug = normalizeToolSlug(body.toolSlug);
  const argumentsValue = sanitizeActionArguments(body.arguments);
  if (!toolSlug || !argumentsValue) return NextResponse.json({ error: 'Invalid tool or arguments.' }, { status: 400 });

  const sessionId = sanitizeId(body.sessionId, 'web');
  const connectedAccountId = typeof body.connectedAccountId === 'string' ? body.connectedAccountId.trim().slice(0, 160) : undefined;
  const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 500) : toolSlug.replaceAll('_', ' ').toLowerCase();
  const risk = classifyActionRisk(toolSlug);
  if (risk === 'read' && !hasCapability(context.principal.role, 'read_context', context.principal.capabilities)) {
    return NextResponse.json({ error: 'Principal is not authorized to read connected context.' }, { status: 403 });
  }
  const approvalCapability = requiredApprovalCapability(risk);
  if (approvalCapability && !hasCapability(context.principal.role, approvalCapability, context.principal.capabilities)) {
    return NextResponse.json({ error: `Principal is not authorized to plan ${risk}-risk connected actions.` }, { status: 403 });
  }

  const digest = actionDigest({ toolSlug, arguments: argumentsValue, connectedAccountId });
  const nonce = randomUUID();
  const ttlSeconds = 300;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const proposalToken = createActionToken({
    stage: 'proposal',
    profileId: context.profileId,
    sessionId,
    digest,
    risk,
    nonce,
    principalId: context.principal.id,
    ttlSeconds,
  });

  try {
    await recordActionProposal(context.profileId, { nonce, digest, sessionId, toolSlug, summary, risk, expiresAt });
  } catch (error) {
    console.error('ELP approval proposal audit failed', error);
  }

  return NextResponse.json({
    configured: isComposioConfigured(),
    action: { toolSlug, arguments: argumentsValue, connectedAccountId, summary },
    risk,
    requiresApproval: risk !== 'read',
    policy: approvalCopy(risk),
    proposedByPrincipalId: context.principal.id,
    proposalToken,
    expiresInSeconds: ttlSeconds,
  }, { headers: { 'Cache-Control': 'no-store, private' } });
}
