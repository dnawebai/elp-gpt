import { NextResponse } from 'next/server';
import { getCommitmentFulfilmentSnapshot, getFulfilmentPendingAction, recordFulfilmentExecuted, runCommitmentFulfilmentCycle } from '@/lib/commitment-fulfilment';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const maxDuration = 300;

function readProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

export async function GET(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const snapshot = await getCommitmentFulfilmentSnapshot(profile.profileId);
  return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : 'run';

  try {
    if (action === 'run') {
      const limit = typeof body?.limit === 'number' ? body.limit : 4;
      const force = body?.force === true;
      const sessionPrefix = sanitizeId(body?.sessionId, 'manual-fulfilment');
      const result = await runCommitmentFulfilmentCycle({ profileId: profile.profileId, sessionPrefix, limit, force });
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (action === 'pending') {
      const recordId = sanitizeId(body?.recordId, '');
      if (!recordId) return NextResponse.json({ error: 'recordId is required.' }, { status: 400 });
      const pendingAction = await getFulfilmentPendingAction(profile.profileId, recordId);
      if (!pendingAction) return NextResponse.json({ error: 'No approval-required action is available for this record.' }, { status: 404 });
      return NextResponse.json({ ok: true, status: 'approval_required', pendingAction: { ...pendingAction, postExecution: { kind: 'commitment-fulfilment', recordId } } }, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    if (action === 'executed') {
      const recordId = sanitizeId(body?.recordId, '');
      if (!recordId) return NextResponse.json({ error: 'recordId is required.' }, { status: 400 });
      const evidence = typeof body?.evidence === 'string' ? body.evidence.slice(0, 3000) : undefined;
      const result = await recordFulfilmentExecuted(profile.profileId, recordId, evidence);
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
    }

    return NextResponse.json({ error: 'Unsupported fulfilment action.' }, { status: 400 });
  } catch (error) {
    console.error('ELP commitment fulfilment API failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Commitment fulfilment failed.' }, { status: 500 });
  }
}
