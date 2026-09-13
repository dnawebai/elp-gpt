import { NextResponse } from 'next/server';
import { cognitivePolicyToPrompt, getCognitivePolicySnapshot } from '@/lib/cognitive-policy';
import { ensureDecisionOutcomes } from '@/lib/decision-learning';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';
import { getStoredStrategyCalibration, strategyCalibrationToPrompt } from '@/lib/strategy-calibration-memory';
import { getStrategicSimulation, listStrategicSimulations, promoteStrategicSimulation, runStrategicSimulation } from '@/lib/strategic-simulation';

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
      await ensureDecisionOutcomes(profile.profileId).catch(() => undefined);
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
    const [policy, calibration] = await Promise.all([
      getCognitivePolicySnapshot(profile.profileId),
      getStoredStrategyCalibration(profile.profileId),
    ]);
    const suppliedContext = typeof body?.context === 'string' ? body.context.trim() : '';
    const enrichedContext = [
      suppliedContext,
      cognitivePolicyToPrompt(policy),
      strategyCalibrationToPrompt(calibration),
    ].filter(Boolean).join('\n\n');
    const simulation = await runStrategicSimulation({
      decision,
      objective: typeof body?.objective === 'string' ? body.objective : undefined,
      context: enrichedContext || undefined,
      options,
      profileId: profile.profileId,
      sessionId: sanitizeId(body?.sessionId, 'strategic-simulation'),
      persist: true,
    });
    return NextResponse.json({ ok: true, simulation, cognitiveContextApplied: Boolean(policy.constitution || policy.intent || policy.evidence.length || calibration) }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Strategic simulation failed.' }, { status: 500 });
  }
}
