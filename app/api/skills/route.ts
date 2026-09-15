import { NextResponse } from 'next/server';
import { ALL_ELP_SKILLS, matchAllSkills } from '@/lib/skill-registry';
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
  const skills = query ? matchAllSkills(query, 32) : ALL_ELP_SKILLS;

  return NextResponse.json(
    {
      count: skills.length,
      total: ALL_ELP_SKILLS.length,
      query: query || null,
      skills,
    },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
