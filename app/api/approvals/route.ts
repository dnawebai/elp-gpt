import { NextResponse } from 'next/server';
import { listApprovalContinuations } from '@/lib/approval-continuations';
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
  const [ledger, continuations] = await Promise.all([
    getApprovalLedger(profile.profileId),
    listApprovalContinuations(profile.profileId).catch(() => []),
  ]);
  return NextResponse.json({
    ...ledger,
    continuations,
    resumablePending: continuations.filter((item) => item.status === 'pending').length,
  }, { headers: { 'Cache-Control': 'no-store, private' } });
}
