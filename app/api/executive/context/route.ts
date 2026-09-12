import { NextResponse } from 'next/server';
import { getExecutiveMemorySnapshot } from '@/lib/executive-memory';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

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

  const snapshot = await getExecutiveMemorySnapshot(profile.profileId);
  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
}
