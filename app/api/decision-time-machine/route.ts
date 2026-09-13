import { NextResponse } from 'next/server';
import { getDecisionTimeMachineRecord, listDecisionTimeMachineRecords, replayDecisionAtPresent } from '@/lib/decision-time-machine';
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
  try {
    const url = new URL(request.url);
    const simulationId = url.searchParams.get('simulationId')?.trim();
    const data = simulationId ? await getDecisionTimeMachineRecord(profile.profileId, simulationId) : await listDecisionTimeMachineRecords(profile.profileId);
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Decision history could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { simulationId?: unknown; sessionId?: unknown } | null;
  const simulationId = typeof body?.simulationId === 'string' ? body.simulationId.trim() : '';
  if (!simulationId) return NextResponse.json({ error: 'simulationId is required.' }, { status: 400 });
  try {
    const replay = await replayDecisionAtPresent(profile.profileId, simulationId, sanitizeId(body?.sessionId, 'decision-time-machine'));
    return NextResponse.json({ ok: true, replay }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Decision replay failed.' }, { status: 500 });
  }
}
