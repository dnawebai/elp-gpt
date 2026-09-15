import { NextResponse } from 'next/server';
import { ELP_SWARM_AGENTS } from '@/lib/agent-swarm';
import { getAgentEvolutionSnapshot, recordVerifiedAgentOutcome } from '@/lib/agent-evolution';
import { PROFILE_COOKIE, verifyProfileToken } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ownerProfile(request: Request) {
  const value = (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PROFILE_COOKIE}=`))
    ?.slice(PROFILE_COOKIE.length + 1);
  return verifyProfileToken(value);
}

function unauthorized() {
  return NextResponse.json({ error: 'Authenticated owner session is required.' }, { status: 401 });
}

export async function GET(request: Request) {
  const profile = ownerProfile(request);
  if (!profile) return unauthorized();
  const snapshot = await getAgentEvolutionSnapshot(profile.profileId);
  return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const profile = ownerProfile(request);
  if (!profile) return unauthorized();
  const body = await request.json().catch(() => null) as {
    agentId?: unknown;
    taskOutcome?: unknown;
    verifiedAccuracy?: unknown;
    verificationFailure?: unknown;
    businessImpact?: unknown;
    costUsd?: unknown;
    expectedCostUsd?: unknown;
    evidence?: unknown;
  } | null;
  const agentId = typeof body?.agentId === 'string' ? body.agentId.trim() : '';
  const agent = ELP_SWARM_AGENTS.find((candidate) => candidate.id === agentId);
  if (!agent) return NextResponse.json({ error: 'Unknown ELP specialist agent.' }, { status: 400 });
  const evidence = typeof body?.evidence === 'string' ? body.evidence.trim().slice(0, 2000) : '';
  if (!evidence) return NextResponse.json({ error: 'evidence is required.' }, { status: 400 });

  try {
    const result = await recordVerifiedAgentOutcome(profile.profileId, {
      agentId: agent.id,
      agentName: agent.name,
      domain: agent.domain,
      ...(typeof body?.taskOutcome === 'number' ? { taskOutcome: body.taskOutcome } : {}),
      ...(typeof body?.verifiedAccuracy === 'number' ? { verifiedAccuracy: body.verifiedAccuracy } : {}),
      ...(typeof body?.verificationFailure === 'boolean' ? { verificationFailure: body.verificationFailure } : {}),
      ...(typeof body?.businessImpact === 'number' ? { businessImpact: body.businessImpact } : {}),
      ...(typeof body?.costUsd === 'number' ? { costUsd: body.costUsd } : {}),
      ...(typeof body?.expectedCostUsd === 'number' ? { expectedCostUsd: body.expectedCostUsd } : {}),
      evidence,
    });
    const snapshot = await getAgentEvolutionSnapshot(profile.profileId);
    return NextResponse.json({ recorded: result, profile: snapshot.agents[agent.id] || null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Agent evolution evidence could not be recorded.' }, { status: 400 });
  }
}
