import { NextResponse } from 'next/server';
import { LUKE_SKILLS, matchSkills } from '@/lib/skills';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

export async function GET(request: Request) {
  if (!profileFrom(request)) {
    return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim();
  const skills = query ? matchSkills(query, 12) : LUKE_SKILLS;

  return NextResponse.json(
    {
      count: skills.length,
      total: LUKE_SKILLS.length,
      query: query || null,
      skills,
    },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
