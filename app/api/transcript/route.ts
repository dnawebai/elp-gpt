import { NextResponse } from 'next/server';
import { persistTranscript, type MemoryRole } from '@/lib/memory';
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
    sessionId?: unknown;
    role?: unknown;
    content?: unknown;
  } | null;

  if (!body || (body.role !== 'user' && body.role !== 'assistant') || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'Invalid transcript event.' }, { status: 400 });
  }

  const content = body.content.trim().slice(0, 12_000);
  if (!content) return NextResponse.json({ saved: false });

  const sessionId = sanitizeId(body.sessionId, 'web');
  const saved = await persistTranscript(profile.profileId, sessionId, body.role as MemoryRole, content);
  return NextResponse.json({ saved }, { headers: { 'Cache-Control': 'no-store' } });
}
