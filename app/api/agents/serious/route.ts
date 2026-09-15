import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { runUnifiedAgentSwarm } from '@/lib/agent-swarm';
import { persistAgentRun } from '@/lib/agent-run-memory';
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

export async function POST(request: NextRequest) {
  const profile = profileFrom(request);
  if (!profile) return NextResponse.json({ error: 'Identity not established.' }, { status: 401 });

  try {
    const body = await request.json().catch(() => null) as {
      objective?: unknown;
      context?: unknown;
      maxAgents?: unknown;
    } | null;
    const objective = typeof body?.objective === 'string' ? body.objective.trim().slice(0, 3000) : '';
    if (!objective) return NextResponse.json({ error: 'objective is required' }, { status: 400 });
    const context = typeof body?.context === 'string' ? body.context.trim().slice(0, 6000) : undefined;
    const maxAgents = typeof body?.maxAgents === 'number' ? Math.max(3, Math.min(body.maxAgents, 8)) : undefined;

    const result = await runUnifiedAgentSwarm({ objective, context, maxAgents });
    const runId = randomUUID();
    await persistAgentRun(profile.profileId, {
      id: runId,
      mode: 'serious',
      objective,
      status: result.findings.some((finding) => finding.status === 'failed') ? 'completed-with-partial-agent-failures' : 'completed',
      summary: result.synthesis,
      trace: result.trace,
      metadata: {
        relevantSkills: result.relevantSkills,
        skillCandidates: result.skillCandidates,
        agents: result.agents.map((agent) => ({ id: agent.id, name: agent.name, domain: agent.domain })),
      },
      generatedAt: result.generatedAt,
    });

    return NextResponse.json({ runId, ...result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Serious Mode failed.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
