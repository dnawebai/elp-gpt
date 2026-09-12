import { NextResponse } from 'next/server';
import { LIFE_OPERATOR_DOMAINS, matchLifeOperatorCapabilities } from '@/lib/life-operator';
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
  const domains = query ? matchLifeOperatorCapabilities(query, 12) : LIFE_OPERATOR_DOMAINS;

  return NextResponse.json(
    {
      count: domains.length,
      total: LIFE_OPERATOR_DOMAINS.length,
      query: query || null,
      domains,
      autonomy: {
        0: 'Observe',
        1: 'Recommend',
        2: 'Prepare',
        3: 'Execute pre-authorized low-risk work',
        4: 'Execute after explicit approval',
        5: 'Hand off to a human or licensed professional',
      },
    },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
