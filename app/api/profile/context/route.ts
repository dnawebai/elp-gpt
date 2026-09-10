import { NextResponse } from 'next/server';
import { getMemorySnapshot } from '@/lib/memory';
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

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

  const url = new URL(request.url);
  const sessionId = sanitizeId(url.searchParams.get('sessionId'), 'web');
  const memory = await getMemorySnapshot(profile.profileId, sessionId);

  return NextResponse.json(
    { profileId: profile.profileId, ...memory },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
