import { NextRequest, NextResponse } from 'next/server';
import { evaluateVellumWorkflow, replayVellumWorkflow, runVellumWorkflow, type VellumExecution, type VellumScenario, type VellumWorkflow } from '@/lib/vellum-agent';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function profileFrom(request: Request) {
  const token = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(token);
}

function workflowFrom(value: unknown): VellumWorkflow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('workflow is required');
  const encoded = JSON.stringify(value);
  if (encoded.length > 80_000) throw new Error('workflow exceeds size limit');
  return value as VellumWorkflow;
}

export async function POST(request: NextRequest) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });
  try {
    const body = await request.json().catch(() => null) as { action?: unknown; workflow?: unknown; inputs?: unknown; scenarios?: unknown; prior?: unknown } | null;
    const action = body?.action === 'evaluate' || body?.action === 'replay' ? body.action : 'run';
    const workflow = workflowFrom(body?.workflow);
    if (action === 'evaluate') {
      const scenarios = Array.isArray(body?.scenarios) ? body.scenarios.slice(0, 12) as VellumScenario[] : [];
      const result = await evaluateVellumWorkflow(profile.profileId, workflow, scenarios);
      return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (action === 'replay') {
      const prior = body?.prior as Pick<VellumExecution, 'id' | 'inputs'> | undefined;
      if (!prior || typeof prior.id !== 'string' || !prior.inputs || typeof prior.inputs !== 'object') return NextResponse.json({ error: 'prior execution id and inputs are required for replay' }, { status: 400 });
      const result = await replayVellumWorkflow(profile.profileId, workflow, { id: prior.id.slice(0, 160), inputs: prior.inputs });
      return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const inputs = body?.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs) ? body.inputs as Record<string, unknown> : {};
    if (JSON.stringify(inputs).length > 40_000) return NextResponse.json({ error: 'inputs exceed size limit' }, { status: 400 });
    const result = await runVellumWorkflow(profile.profileId, workflow, inputs);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Vellum Agent failed.' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
