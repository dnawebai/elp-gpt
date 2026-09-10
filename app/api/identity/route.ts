import { NextResponse } from 'next/server';
import { createProfileToken, getSecurityMode, PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';

function identityResponse(request: Request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const token = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);

  const existing = verifyProfileToken(token);
  const profileToken = existing ? token! : createProfileToken();
  const profile = verifyProfileToken(profileToken)!;

  const response = NextResponse.json(
    { profileId: profile.profileId, securityMode: getSecurityMode() },
    { headers: { 'Cache-Control': 'no-store' } },
  );

  if (!existing) {
    response.cookies.set(PROFILE_COOKIE, profileToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}

export async function GET(request: Request) {
  return identityResponse(request);
}

export async function POST(request: Request) {
  return identityResponse(request);
}
