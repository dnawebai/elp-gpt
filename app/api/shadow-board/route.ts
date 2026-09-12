import { NextResponse } from 'next/server';
import { runShadowBoard } from '@/lib/shadow-board';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    context?: unknown;
    sessionId?: unknown;
  } | null;

  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question) return NextResponse.json({ error: 'A decision or question is required.' }, { status: 400 });

  try {
    const result = await runShadowBoard({
      question,
      context: typeof body?.context === 'string' ? body.context : undefined,
      profileId: profile.profileId,
      sessionId: sanitizeId(body?.sessionId, 'shadow-board'),
      persist: true,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Shadow Board failed.' },
      { status: 500 },
    );
  }
}
