import { NextResponse } from 'next/server';
import { getApprovalLedger } from '@/lib/approval-ledger';
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
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const ledger = await getApprovalLedger(profile.profileId);
  return NextResponse.json(ledger, { headers: { 'Cache-Control': 'no-store, private' } });
}
