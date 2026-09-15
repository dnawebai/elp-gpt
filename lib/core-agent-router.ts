import { randomUUID } from 'node:crypto';
import { persistAgentRun } from '@/lib/agent-run-memory';
import { runUnifiedAgentSwarm } from '@/lib/agent-swarm';
import { runSlashyMission } from '@/lib/slashy-agent';
import { runVellumWorkflow, type VellumWorkflow } from '@/lib/vellum-agent';

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
      : [/^\s*\/serious\s*/i, /^\s*(?:use|run|activate|enable)\s+serious(?:\s+multi[- ]?agent)?\s+mode\s*[:,-]?\s*/i, /^\s*serious(?:\s+mode)?\s*[:,-]?\s*/i];
  let value = input.trim();
  for (const pattern of prefixes) value = value.replace(pattern, '');
  return value.trim() || input.trim();
}

function detectMode(input: string): CoreAgentMode | null {
  const q = input.trim().toLowerCase();
  if (/^\/slashy\b|\b(?:use|ask|run)\s+slashy\b|^slashy\s*[:,-]/i.test(input)) return 'slashy';
  if (/^\/vellum\b|\b(?:use|ask)\s+vellum\b|\brun\s+(?:this\s+)?through\s+vellum\b|^vellum\s*[:,-]/i.test(input)) return 'vellum';
  if (/^\/serious\b|\b(?:use|run|activate|enable)\s+serious(?:\s+multi[- ]?agent)?\s+mode\b|^serious(?:\s+mode)?\s*[:,-]/i.test(input)) return 'serious';

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
    const result = await runUnifiedAgentSwarm({ objective });
    const runId = randomUUID();
    await persistAgentRun(args.profileId, {
      id: runId,
      mode: 'serious',
      objective,
      status: result.findings.some((finding) => finding.status === 'failed') ? 'completed-with-partial-agent-failures' : 'completed',
      summary: result.synthesis,
      trace: result.trace,
      metadata: {
        agents: result.agents.map((agent) => ({ id: agent.id, name: agent.name, domain: agent.domain })),
        relevantSkills: result.relevantSkills,
        skillCandidates: result.skillCandidates,
        failedAgents: result.findings.filter((finding) => finding.status === 'failed').map((finding) => finding.agentId),
      },
      generatedAt: result.generatedAt,
    });
    return {
      handled: true,
      mode: 'serious',
      text: result.synthesis,
      metadata: {
        runId,
        agentCount: result.agents.length,
        completedAgents: result.findings.filter((finding) => finding.status === 'completed').length,
        failedAgents: result.findings.filter((finding) => finding.status === 'failed').length,
        skillCandidates: result.skillCandidates,
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
