import { NextResponse } from 'next/server';
import { actionDigest, normalizeToolSlug, sanitizeActionArguments } from '@/lib/actions';
import { recordActionExecuted, recordActionExecuting, recordActionFailed } from '@/lib/approval-ledger';
import { executeComposioTool, isComposioConfigured } from '@/lib/composio';
import { PROFILE_COOKIE, sanitizeId, verifyActionToken, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 60;

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

function evidencePreview(value: unknown) {
  try {
    const text = JSON.stringify(value);
    return text.length <= 1800 ? text : `${text.slice(0, 1800)}…`;
  } catch {
    return 'Execution completed; result was not serializable.';
  }
}

export async function POST(request: Request) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
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
    token.profileId !== profile.profileId ||
    (suppliedSession && token.sessionId !== suppliedSession)
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

  try {
    await recordActionExecuting(profile.profileId, token.nonce);
  } catch (error) {
    console.error('JARBIS execution-start audit failed', error);
  }

  try {
    const result = await executeComposioTool({
      toolSlug,
      arguments: argumentsValue,
      profileId: profile.profileId,
      connectedAccountId,
    });
    try {
      await recordActionExecuted(profile.profileId, token.nonce, evidencePreview(result));
    } catch (error) {
      console.error('JARBIS execution-success audit failed', error);
    }
    return NextResponse.json({ ok: true, toolSlug, risk: token.risk, result }, {
      headers: { 'Cache-Control': 'no-store, private' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action execution failed.';
    console.error('ELP action execution failed', toolSlug, error);
    try {
      await recordActionFailed(profile.profileId, token.nonce, message);
    } catch (auditError) {
      console.error('JARBIS execution-failure audit failed', auditError);
    }
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
