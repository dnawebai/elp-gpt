import { NextResponse } from 'next/server';
import { actionDigest, normalizeToolSlug, sanitizeActionArguments } from '@/lib/actions';
import { executeComposioTool, isComposioConfigured } from '@/lib/composio';
import { PROFILE_COOKIE, verifyActionToken, verifyProfileToken } from '@/lib/security';

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

export async function POST(request: Request) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  if (!isComposioConfigured()) return NextResponse.json({ error: 'Composio is not configured.' }, { status: 503 });

  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    toolSlug?: unknown;
    arguments?: unknown;
    connectedAccountId?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid execution request.' }, { status: 400 });

  const token = verifyActionToken(typeof body.token === 'string' ? body.token : undefined);
  const toolSlug = normalizeToolSlug(body.toolSlug);
  const argumentsValue = sanitizeActionArguments(body.arguments);
  const connectedAccountId = typeof body.connectedAccountId === 'string' ? body.connectedAccountId.trim().slice(0, 160) : undefined;

  if (!token || !toolSlug || !argumentsValue || token.profileId !== profile.profileId) {
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
    const result = await executeComposioTool({
      toolSlug,
      arguments: argumentsValue,
      profileId: profile.profileId,
      connectedAccountId,
    });
    return NextResponse.json({ ok: true, toolSlug, risk: token.risk, result }, {
      headers: { 'Cache-Control': 'no-store, private' },
    });
  } catch (error) {
    console.error('LUKE action execution failed', toolSlug, error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Action execution failed.',
    }, { status: 502 });
  }
}
