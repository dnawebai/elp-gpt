import { NextResponse } from 'next/server';
import { generateProactiveBriefing, type BriefingKind } from '@/lib/proactive';
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
    kind?: unknown;
    sessionId?: unknown;
    timezone?: unknown;
    meeting?: unknown;
  } | null;

  const kind = body?.kind;
  if (kind !== 'daily' && kind !== 'attention' && kind !== 'meeting-prep') {
    return NextResponse.json({ error: 'Invalid briefing kind.' }, { status: 400 });
  }

  try {
    const briefing = await generateProactiveBriefing({
      kind: kind as BriefingKind,
      profileId: profile.profileId,
      sessionId: sanitizeId(body?.sessionId, 'briefings'),
      timezone: typeof body?.timezone === 'string' ? body.timezone : undefined,
      meeting: typeof body?.meeting === 'string' ? body.meeting : undefined,
      persist: true,
    });
    return NextResponse.json(briefing, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Briefing generation failed.' },
      { status: 500 },
    );
  }
}
