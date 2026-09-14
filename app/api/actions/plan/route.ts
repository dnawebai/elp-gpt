import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { actionDigest, approvalCopy, classifyActionRisk, normalizeToolSlug, sanitizeActionArguments } from '@/lib/actions';
import { recordActionApproved, recordActionProposal } from '@/lib/approval-ledger';
import { hasCapability, requiredApprovalCapability } from '@/lib/authority-policy';
import { isComposioConfigured } from '@/lib/composio';
import { createActionToken, sanitizeId } from '@/lib/security';
import { recordSecurityEventSafe } from '@/lib/security-audit';
import { evaluateStandingAuthority, recordStandingAuthorityUse } from '@/lib/standing-authority';
import { resolveZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const context = await resolveZeroTrustAuthority(request);
  if (!context) return NextResponse.json({ error: 'Identity not established or principal session revoked.' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown; toolSlug?: unknown; arguments?: unknown; summary?: unknown; connectedAccountId?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid action request.' }, { status: 400 });
  const toolSlug = normalizeToolSlug(body.toolSlug); const argumentsValue = sanitizeActionArguments(body.arguments);
  if (!toolSlug || !argumentsValue) return NextResponse.json({ error: 'Invalid tool or arguments.' }, { status: 400 });

  const sessionId = sanitizeId(body.sessionId, 'web');
  const connectedAccountId = typeof body.connectedAccountId === 'string' ? body.connectedAccountId.trim().slice(0,160) : undefined;
  const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0,500) : toolSlug.replaceAll('_',' ').toLowerCase();
  const risk = classifyActionRisk(toolSlug);
  if (risk === 'read' && !hasCapability(context.principal.role, 'read_context', context.principal.capabilities)) return NextResponse.json({ error: 'Principal is not authorized to read connected context.' }, { status: 403 });
  const approvalCapability = requiredApprovalCapability(risk);
  if (approvalCapability && !hasCapability(context.principal.role, approvalCapability, context.principal.capabilities)) return NextResponse.json({ error: `Principal is not authorized to plan ${risk}-risk connected actions.` }, { status: 403 });

  const digest = actionDigest({ toolSlug, arguments: argumentsValue, connectedAccountId }); const nonce = randomUUID();
  const proposalTtl = 300; const expiresAt = new Date(Date.now() + proposalTtl * 1000).toISOString();
  try { await recordActionProposal(context.profileId, { nonce, digest, sessionId, toolSlug, summary, risk, expiresAt }); } catch (error) { console.error('ELP approval proposal audit failed', error); }

  const standing = risk === 'read' ? null : await evaluateStandingAuthority({ profileId: context.profileId, principalId: context.principal.id, toolSlug, arguments: argumentsValue, risk, connectedAccountId });
  if (standing?.allowed && standing.policy) {
    const executionTtl = 90;
    const executionToken = createActionToken({ stage: 'approved', profileId: context.profileId, sessionId, digest, risk, nonce, principalId: context.principal.id, ttlSeconds: executionTtl });
    try {
      await recordActionApproved(context.profileId, nonce);
      await recordStandingAuthorityUse(context.profileId, standing.policy, context.principal.id, toolSlug, digest);
      await recordSecurityEventSafe(context.profileId, { category: 'action', action: 'action.authorized_by_standing_policy', outcome: 'success', severity: risk === 'high' ? 'critical' : 'high', actorPrincipalId: context.principal.id, subjectId: standing.policy.id, sessionId: context.session?.id, detail: `${toolSlug}: ${summary}` });
    } catch (error) { console.error('ELP standing-authority audit failed', error); }
    return NextResponse.json({ configured: isComposioConfigured(), action: { toolSlug, arguments: argumentsValue, connectedAccountId, summary }, risk, requiresApproval: false, standingAuthorityAuthorized: true, standingAuthorityPolicy: { id: standing.policy.id, name: standing.policy.name }, executionToken, expiresInSeconds: executionTtl, proposedByPrincipalId: context.principal.id }, { headers: { 'Cache-Control': 'no-store, private' } });
  }

  const proposalToken = createActionToken({ stage: 'proposal', profileId: context.profileId, sessionId, digest, risk, nonce, principalId: context.principal.id, ttlSeconds: proposalTtl });
  return NextResponse.json({ configured: isComposioConfigured(), action: { toolSlug, arguments: argumentsValue, connectedAccountId, summary }, risk, requiresApproval: risk !== 'read', policy: approvalCopy(risk), proposedByPrincipalId: context.principal.id, proposalToken, expiresInSeconds: proposalTtl, ...(standing ? { standingAuthorityReason: standing.reason } : {}) }, { headers: { 'Cache-Control': 'no-store, private' } });
}
