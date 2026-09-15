import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runAgiCore } from '@/lib/agi-core';
import { governedActionExecutionSummary, orchestrateAgentActions, summarizeGovernedAgentActions } from '@/lib/agent-action-orchestrator';
import { persistAgentRun } from '@/lib/agent-run-memory';
import { PROFILE_COOKIE, sanitizeId, verifyProfileToken } from '@/lib/security';
import { resolveZeroTrustAuthority } from '@/lib/zero-trust-authority';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
      sessionId?: unknown;
      autoExecuteRead?: unknown;
      autoExecuteStandingWrite?: unknown;
    } | null;
    const objective = typeof body?.objective === 'string' ? body.objective.trim().slice(0, 3000) : '';
    if (!objective) return NextResponse.json({ error: 'objective is required' }, { status: 400 });
    const context = typeof body?.context === 'string' ? body.context.trim().slice(0, 6000) : undefined;
    const maxAgents = typeof body?.maxAgents === 'number' ? Math.max(3, Math.min(body.maxAgents, 8)) : undefined;
    const sessionId = sanitizeId(body?.sessionId, 'serious');
    const runId = randomUUID();

    const result = await runAgiCore({ profileId: profile.profileId, objective, context, maxAgents });
    const authority = await resolveZeroTrustAuthority(request).catch(() => null);
    const governedActions = authority && result.actionIntents.length
      ? await orchestrateAgentActions({
          authority,
          sessionId,
          objective,
          context,
          intents: result.actionIntents,
          sourceRunId: runId,
          autoExecuteRead: body?.autoExecuteRead !== false,
          autoExecuteStandingWrite: body?.autoExecuteStandingWrite !== false,
        })
      : null;
    const executionSummary = governedActionExecutionSummary(governedActions);
    const authorityNotice = !authority && result.actionIntents.length
      ? 'Governed execution: an authenticated authority session is required before action intents can be planned or executed.'
      : '';
    const responseText = [result.synthesis, executionSummary || authorityNotice].filter(Boolean).join('\n\n');

    await persistAgentRun(profile.profileId, {
      id: runId,
      mode: 'serious',
      objective,
      status: result.findings.some((finding) => finding.status === 'failed') ? 'completed-with-partial-agent-failures' : 'completed',
      summary: responseText,
      trace: result.trace,
      metadata: {
        relevantSkills: result.relevantSkills,
        skillCandidates: result.skillCandidates,
        actionIntents: result.actionIntents,
        governedActions: summarizeGovernedAgentActions(governedActions),
        cognitiveLenses: result.cognitiveLenses.map((lens) => ({ id: lens.id, name: lens.name, provider: lens.provider, latencyMs: lens.latencyMs })),
        verifier: result.verifier,
        agents: result.agents.map((agent) => ({ id: agent.id, name: agent.name, domain: agent.domain })),
      },
      generatedAt: result.generatedAt,
    });

    return NextResponse.json({
      runId,
      ...result,
      synthesis: responseText,
      governedActions: governedActions || (result.actionIntents.length ? { identityRequired: true } : null),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Serious Mode failed.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
