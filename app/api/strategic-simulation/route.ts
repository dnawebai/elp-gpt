import { NextResponse } from 'next/server';
import { getStrategicSimulation, listStrategicSimulations, promoteStrategicSimulation, runStrategicSimulation } from '@/lib/strategic-simulation';
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
  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.trim();
  const data = id ? await getStrategicSimulation(profile.profileId, id) : await listStrategicSimulations(profile.profileId);
  return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store, private' } });
}

export async function POST(request: Request) {
  const profile = readProfile(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    decision?: unknown;
    objective?: unknown;
    context?: unknown;
    options?: unknown;
    sessionId?: unknown;
    simulationId?: unknown;
  } | null;
  const action = typeof body?.action === 'string' ? body.action : 'run';
  try {
    if (action === 'promote') {
      const simulationId = typeof body?.simulationId === 'string' ? body.simulationId.trim() : '';
      if (!simulationId) return NextResponse.json({ error: 'simulationId is required.' }, { status: 400 });
      const result = await promoteStrategicSimulation(profile.profileId, simulationId);
      return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store, private' } });
    }
    const decision = typeof body?.decision === 'string' ? body.decision.trim() : '';
    if (!decision) return NextResponse.json({ error: 'A decision to simulate is required.' }, { status: 400 });
    const options = Array.isArray(body?.options) ? body.options.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const obj = item as Record<string, unknown>;
      if (typeof obj.description !== 'string' || !obj.description.trim()) return [];
      return [{ label: typeof obj.label === 'string' ? obj.label : undefined, description: obj.description }];
    }) : undefined;
    const simulation = await runStrategicSimulation({
      decision,
      objective: typeof body?.objective === 'string' ? body.objective : undefined,
      context: typeof body?.context === 'string' ? body.context : undefined,
      options,
      profileId: profile.profileId,
      sessionId: sanitizeId(body?.sessionId, 'strategic-simulation'),
      persist: true,
    });
    return NextResponse.json({ ok: true, simulation }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Strategic simulation failed.' }, { status: 500 });
  }
}
