import { NextResponse } from 'next/server';
import { getPhoneReadiness, prepareOutboundPhoneAction } from '@/lib/phone-control';
import { requireZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'read_context');
  if (!context) return NextResponse.json({ error: 'Authorized principal session is required.' }, { status: 401 });
  return NextResponse.json(await getPhoneReadiness(context.profileId), { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'make_calls');
  if (!context) return NextResponse.json({ error: 'Active principal session with call permission is required.' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (body?.action !== 'prepare-call') return NextResponse.json({ error: 'Unsupported phone action.' }, { status: 400 });
  try {
    const action = prepareOutboundPhoneAction({ fromNumber: typeof body.fromNumber === 'string' ? body.fromNumber : '', toNumber: typeof body.toNumber === 'string' ? body.toNumber : '', agentId: typeof body.agentId === 'string' ? body.agentId : undefined, purpose: typeof body.purpose === 'string' ? body.purpose : undefined });
    return NextResponse.json({ ok: true, pendingAction: action, preparedByPrincipalId: context.principal.id, policy: 'Outbound calls remain external commitments and require the signed ELP approval flow.' });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not prepare outbound call.' }, { status: 400 }); }
}
