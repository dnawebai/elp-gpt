import { NextResponse } from 'next/server';
import { getPhoneReadiness, prepareOutboundPhoneAction } from '@/lib/phone-control';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 60;

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${PROFILE_COOKIE}=`))?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

export async function GET(request: Request) {
  const profile = profileFrom(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  return NextResponse.json(await getPhoneReadiness(profile.profileId), { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = profileFrom(request); if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (body?.action !== 'prepare-call') return NextResponse.json({ error: 'Unsupported phone action.' }, { status: 400 });
  try {
    const action = prepareOutboundPhoneAction({ fromNumber: typeof body.fromNumber === 'string' ? body.fromNumber : '', toNumber: typeof body.toNumber === 'string' ? body.toNumber : '', agentId: typeof body.agentId === 'string' ? body.agentId : undefined, purpose: typeof body.purpose === 'string' ? body.purpose : undefined });
    return NextResponse.json({ ok: true, pendingAction: action, policy: 'Outbound calls are external commitments and require the normal signed ELP approval flow.' });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not prepare outbound call.' }, { status: 400 }); }
}
