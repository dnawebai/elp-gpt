import { NextResponse } from 'next/server';
import { getPhoneReadiness, prepareOutboundPhoneAction } from '@/lib/phone-control';
import { requireZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'read_context');
  if (!context) return NextResponse.json({ error: 'Authorized principal session is required.' }, { status: 401 });
  return NextResponse.json(await getPhoneReadiness(context.profileId), {
    headers: { 'Cache-Control': 'no-store, private' },
  });
}

export async function POST(request: Request) {
  const context = await requireZeroTrustAuthority(request, 'make_calls');
  if (!context) {
    return NextResponse.json(
      { error: 'Active principal session with call permission is required.' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (body?.action !== 'prepare-call') {
    return NextResponse.json({ error: 'Unsupported phone action.' }, { status: 400 });
  }

  try {
    const readiness = await getPhoneReadiness(context.profileId);
    const requestedFrom = typeof body.fromNumber === 'string' ? body.fromNumber.trim() : '';
    const preferred = readiness.phoneNumbers.find((number) => number.number === requestedFrom && number.outboundAgentId)
      || readiness.phoneNumbers.find((number) => Boolean(number.outboundAgentId));
    const fromNumber = requestedFrom || preferred?.number || process.env.ELP_RETELL_FROM_NUMBER?.trim() || '';
    const agentId = typeof body.agentId === 'string' && body.agentId.trim()
      ? body.agentId.trim()
      : preferred?.outboundAgentId;

    if (!fromNumber) {
      return NextResponse.json(
        { error: 'No outbound ELP caller ID is configured.' },
        { status: 503, headers: { 'Cache-Control': 'no-store, private' } },
      );
    }

    const candidateSlots = Array.isArray(body.candidateSlots)
      ? body.candidateSlots.filter((value): value is string => typeof value === 'string')
      : [];
    const action = prepareOutboundPhoneAction({
      fromNumber,
      toNumber: typeof body.toNumber === 'string' ? body.toNumber : '',
      agentId,
      purpose: typeof body.purpose === 'string' ? body.purpose : undefined,
      principalName: typeof body.principalName === 'string' ? body.principalName : undefined,
      businessName: typeof body.businessName === 'string' ? body.businessName : undefined,
      timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
      candidateSlots,
      appointmentDurationMinutes:
        typeof body.appointmentDurationMinutes === 'number' && Number.isFinite(body.appointmentDurationMinutes)
          ? body.appointmentDurationMinutes
          : undefined,
      metadata: {
        prepared_by_principal_id: context.principal.id,
        profile_id: context.profileId,
      },
    });
    return NextResponse.json({
      ok: true,
      pendingAction: action,
      callerId: fromNumber,
      preparedByPrincipalId: context.principal.id,
      policy: 'Outbound calls remain external commitments and require the signed ELP approval flow.',
    }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not prepare outbound call.' },
      { status: 400 },
    );
  }
}
