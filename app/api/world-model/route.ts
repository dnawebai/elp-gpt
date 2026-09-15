import { NextResponse } from 'next/server';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';
import { getWorldModel, searchWorldModel } from '@/lib/world-model';

export const runtime = 'nodejs';
export const maxDuration = 300;

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

export async function GET(request: Request) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  try {
    const model = await getWorldModel(profile.profileId);
    const url = new URL(request.url);
    const query = (url.searchParams.get('q') || '').trim();
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 40) || 40));
    return NextResponse.json(
      query ? { ...model, search: searchWorldModel(model, query, limit) } : model,
      { headers: { 'Cache-Control': 'no-store, private' } },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'World model failed.' }, { status: 500 });
  }
}
