import { randomUUID } from 'node:crypto';
import { runAgiCore } from '@/lib/agi-core';
import { governedActionExecutionSummary, orchestrateAgentActions, summarizeGovernedAgentActions } from '@/lib/agent-action-orchestrator';
import { persistAgentRun } from '@/lib/agent-run-memory';
import { runSlashyMission } from '@/lib/slashy-agent';
import { runVellumWorkflow, type VellumWorkflow } from '@/lib/vellum-agent';
import type { ZeroTrustAuthorityContext } from '@/lib/zero-trust-authority';

export type CoreAgentRouteResult =
  | { handled: false }
  | {
      handled: true;
      mode: 'slashy' | 'vellum' | 'serious';
      text: string;
      metadata: Record<string, unknown>;
    };

type CoreAgentMode = 'slashy' | 'vellum' | 'serious';

function cleanObjective(input: string, mode: CoreAgentMode) {
  const prefixes = mode === 'slashy'
    ? [/^\s*\/slashy\s*/i, /^\s*(use|ask|run)\s+slashy(?:\s+agent)?\s*[:,-]?\s*/i, /^\s*slashy\s*[:,-]?\s*/i]
    : mode === 'vellum'
      ? [/^\s*\/vellum\s*/i, /^\s*(use|ask|run)\s+(this\s+through\s+)?vellum(?:\s+agent)?\s*[:,-]?\s*/i, /^\s*vellum\s*[:,-]?\s*/i]
      : [/^\s*\/(?:serious|agi)\s*/i, /^\s*(?:use|run|activate|enable)\s+(?:elp\s+)?(?:agi|serious(?:\s+multi[- ]?agent)?\s+mode)\s*[:,-]?\s*/i, /^\s*(?:elp\s+)?(?:agi|serious(?:\s+mode)?)\s*[:,-]?\s*/i];
  let value = input.trim();
  for (const pattern of prefixes) value = value.replace(pattern, '');
  return value.trim() || input.trim();
}

function detectMode(input: string): CoreAgentMode | null {
  const q = input.trim().toLowerCase();
  if (/^\/slashy\b|\b(?:use|ask|run)\s+slashy\b|^slashy\s*[:,-]/i.test(input)) return 'slashy';
  if (/^\/vellum\b|\b(?:use|ask)\s+vellum\b|\brun\s+(?:this\s+)?through\s+vellum\b|^vellum\s*[:,-]/i.test(input)) return 'vellum';
  if (/^\/(?:serious|agi)\b|\b(?:use|run|activate|enable)\s+(?:elp\s+)?(?:agi|serious(?:\s+multi[- ]?agent)?\s+mode)\b|^serious(?:\s+mode)?\s*[:,-]/i.test(input)) return 'serious';

  const slashySignals = [
    /\bdropped balls?\b/,
    /\bwhat (?:emails?|messages?|follow[- ]?ups?) need my attention\b/,
    /\b(?:overdue|stale) follow[- ]?ups?\b/,
    /\bwhat have i forgotten to reply to\b/,
  ];
  if (slashySignals.some((pattern) => pattern.test(q))) return 'slashy';

  const vellumSignals = [
    /\bevaluate (?:this|the) workflow\b/,
    /\bworkflow regression (?:test|gate)\b/,
    /\breplay (?:this|the) agent workflow\b/,
    /\btrace (?:this|the) agent workflow\b/,
  ];
  if (vellumSignals.some((pattern) => pattern.test(q))) return 'vellum';

  const seriousSignals = [
    /\bmulti[- ]agent (?:analysis|strategy|review|plan)\b/,
    /\b(?:assemble|run|use) (?:the )?(?:expert|specialist) swarm\b/,
    /\bget (?:all|multiple) (?:experts|agents|specialists) to (?:analyse|analyze|review|solve)\b/,
    /\bfirst agi\b/,
    /\bbuild (?:an?|the)?\s*agi\b/,
    /\belp ventures\b.*\b(?:agent|intelligence|research|repository|repositories|build)\b/,
    /\b(?:analy[sz]e|scan|research)\b.*\b(?:github|git)\b.*\b(?:repo|repository|repositories)\b/,
    /\b(?:all|multiple)\s+(?:ai\s+)?agents?\b.*\b(?:work|working|together|orchestrat)/,
  ];
  if (seriousSignals.some((pattern) => pattern.test(q))) return 'serious';
  return null;
}

function defaultVellumWorkflow(objective: string): VellumWorkflow {
  return {
    id: `chat-${randomUUID()}`,
    name: 'ELP Vellum Chat Workflow',
    version: '1.0.0',
    entryNodeId: 'planner',
    maxIterations: 4,
    evaluationThreshold: 0.8,
    nodes: [
      {
        id: 'planner',
        type: 'agent',
        name: 'Vellum Planner',
        prompt: `Solve this objective as a bounded expert workflow. Separate facts, assumptions, risks and next actions. Objective: ${objective}`,
        outputKey: 'draft',
      },
      {
        id: 'reviewer',
        type: 'agent',
        name: 'Vellum Reviewer',
        prompt: 'Review the draft below for correctness, completeness, unsupported claims and execution risk. Return the improved final answer only.\n\nDRAFT:\n{{draft}}',
        outputKey: 'final',
      },
      {
        id: 'output',
        type: 'output',
        name: 'Final Output',
        inputKey: 'final',
        outputKey: 'answer',
      },
    ],
    edges: [
      { from: 'planner', to: 'reviewer' },
      { from: 'reviewer', to: 'output' },
    ],
  };
}

export async function routeCoreAgent(args: {
  profileId: string;
  sessionId: string;
  userText: string;
  authorityContext?: ZeroTrustAuthorityContext | null;
}): Promise<CoreAgentRouteResult> {
  const mode = detectMode(args.userText);
  if (!mode) return { handled: false };

  const objective = cleanObjective(args.userText, mode);

  if (mode === 'slashy') {
    const result = await runSlashyMission(args.profileId, {
      objective,
      sessionId: args.sessionId,
      refreshCommunications: true,
    });
    const runId = randomUUID();
    await persistAgentRun(args.profileId, {
      id: runId,
      mode: 'slashy',
      objective,
      status: 'completed',
      summary: result.synthesis,
      metadata: {
        droppedBallSignals: result.droppedBallSignals,
        memoryAnchors: result.memoryAnchors,
        proposedWriteTools: result.proposedWriteTools,
      },
      generatedAt: result.generatedAt,
    });
    return {
      handled: true,
      mode: 'slashy',
      text: result.synthesis,
      metadata: {
        runId,
        droppedBallCount: result.droppedBallSignals.length,
        proposedWriteCount: result.proposedWriteTools.length,
      },
    };
  }

  if (mode === 'serious') {
    const result = await runAgiCore({ profileId: args.profileId, objective, maxAgents: 8 });
    const runId = randomUUID();
    const governedActions = args.authorityContext && result.actionIntents.length
      ? await orchestrateAgentActions({
          authority: args.authorityContext,
          sessionId: args.sessionId,
          objective,
          intents: result.actionIntents,
          sourceRunId: runId,
          autoExecuteRead: true,
          autoExecuteStandingWrite: true,
        })
      : null;
    const executionSummary = governedActionExecutionSummary(governedActions);
    const authorityNotice = !args.authorityContext && result.actionIntents.length
      ? 'Governed execution: action intents were identified, but an authenticated authority session is required before they can be planned or executed.'
      : '';
    const responseText = [result.synthesis, executionSummary || authorityNotice].filter(Boolean).join('\n\n');
    await persistAgentRun(args.profileId, {
      id: runId,
      mode: 'serious',
      objective,
      status: result.findings.some((finding) => finding.status === 'failed') ? 'completed-with-partial-agent-failures' : 'completed',
      summary: responseText,
      trace: result.trace,
      metadata: {
        agents: result.agents.map((agent) => ({ id: agent.id, name: agent.name, domain: agent.domain })),
        cognitiveLenses: result.cognitiveLenses.map((lens) => ({ id: lens.id, name: lens.name, provider: lens.provider, latencyMs: lens.latencyMs })),
        verifier: result.verifier,
        relevantSkills: result.relevantSkills,
        skillCandidates: result.skillCandidates,
        actionIntents: result.actionIntents,
        governedActions: summarizeGovernedAgentActions(governedActions),
        failedAgents: result.findings.filter((finding) => finding.status === 'failed').map((finding) => finding.agentId),
      },
      generatedAt: result.generatedAt,
    });
    return {
      handled: true,
      mode: 'serious',
      text: responseText,
      metadata: {
        runId,
        agentCount: result.agents.length + result.cognitiveLenses.length + 2,
        specialistAgents: result.agents.length,
        cognitiveLenses: result.cognitiveLenses.map((lens) => lens.id),
        completedAgents: result.findings.filter((finding) => finding.status === 'completed').length,
        failedAgents: result.findings.filter((finding) => finding.status === 'failed').length,
        skillCandidates: result.skillCandidates,
        actionIntents: result.actionIntents,
        governedActions: governedActions || (result.actionIntents.length ? { identityRequired: true } : null),
      },
    };
  }

  const workflow = defaultVellumWorkflow(objective);
  const execution = await runVellumWorkflow(args.profileId, workflow, { objective });
  const answer = typeof execution.outputs.answer === 'string'
    ? execution.outputs.answer
    : typeof execution.state.final === 'string'
      ? execution.state.final
      : `Vellum workflow finished with status ${execution.status}.`;
  await persistAgentRun(args.profileId, {
    id: execution.id,
    mode: 'vellum',
    objective,
    status: execution.status,
    summary: answer,
    trace: execution.trace,
    metadata: {
      workflowId: execution.workflowId,
      workflowVersion: execution.workflowVersion,
      iterations: execution.iterations,
      totalLatencyMs: execution.totalLatencyMs,
      tokenUsage: execution.tokenUsage || null,
      costUsd: execution.costUsd,
    },
    generatedAt: execution.generatedAt,
  });
  return {
    handled: true,
    mode: 'vellum',
    text: answer,
    metadata: {
      runId: execution.id,
      status: execution.status,
      iterations: execution.iterations,
      totalLatencyMs: execution.totalLatencyMs,
    },
  };
}

export function classifyCoreAgentIntent(input: string) {
  return detectMode(input);
}
