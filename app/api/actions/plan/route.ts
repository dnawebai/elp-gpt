import { NextResponse } from 'next/server';
import { actionDigest, approvalCopy, classifyActionRisk, normalizeToolSlug, sanitizeActionArguments } from '@/lib/actions';
import { isComposioConfigured } from '@/lib/composio';
import { createActionToken, PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';

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
  const digest = actionDigest({ toolSlug, arguments: argumentsValue, connectedAccountId });
  const proposalToken = createActionToken({
    stage: 'proposal',
    profileId: profile.profileId,
    sessionId,
    digest,
    risk,
    ttlSeconds: 300,
  });

  return NextResponse.json({
    configured: isComposioConfigured(),
    action: { toolSlug, arguments: argumentsValue, connectedAccountId, summary },
    risk,
    requiresApproval: risk !== 'read',
    policy: approvalCopy(risk),
    proposalToken,
    expiresInSeconds: 300,
  }, { headers: { 'Cache-Control': 'no-store, private' } });
}
