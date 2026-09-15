import { randomUUID } from 'node:crypto';
import { persistAgentRun } from '@/lib/agent-run-memory';
import { runCognitiveMesh } from '@/lib/cognitive-mesh';
import { runSlashyMission } from '@/lib/slashy-agent';
import { runVellumWorkflow, type VellumWorkflow } from '@/lib/vellum-agent';

type CoreAgentMode = 'slashy' | 'vellum' | 'mesh';

export type CoreAgentRouteResult =
  | { handled: false }
  | {
      handled: true;
      mode: CoreAgentMode;
      text: string;
      metadata: Record<string, unknown>;
    };

function cleanObjective(input: string, mode: CoreAgentMode) {
  const prefixes = mode === 'slashy'
    ? [/^\s*\/slashy\s*/i, /^\s*(use|ask|run)\s+slashy(?:\s+agent)?\s*[:,-]?\s*/i, /^\s*slashy\s*[:,-]?\s*/i]
    : mode === 'vellum'
      ? [/^\s*\/vellum\s*/i, /^\s*(use|ask|run)\s+(this\s+through\s+)?vellum(?:\s+agent)?\s*[:,-]?\s*/i, /^\s*vellum\s*[:,-]?\s*/i]
      : [/^\s*\/mesh\s*/i, /^\s*(use|ask|run)\s+(the\s+)?(?:elp\s+)?(?:cognitive\s+)?mesh\s*[:,-]?\s*/i, /^\s*(?:elp\s+)?(?:cognitive\s+)?mesh\s*[:,-]?\s*/i];
  let value = input.trim();
  for (const pattern of prefixes) value = value.replace(pattern, '');
  return value.trim() || input.trim();
}

function detectMode(input: string): CoreAgentMode | null {
  const q = input.trim().toLowerCase();
  if (/^\/slashy\b|\b(?:use|ask|run)\s+slashy\b|^slashy\s*[:,-]/i.test(input)) return 'slashy';
  if (/^\/vellum\b|\b(?:use|ask)\s+vellum\b|\brun\s+(?:this\s+)?through\s+vellum\b|^vellum\s*[:,-]/i.test(input)) return 'vellum';
  if (/^\/mesh\b|\b(?:use|ask|run)\s+(?:the\s+)?(?:elp\s+)?(?:cognitive\s+)?mesh\b|\b(?:cognitive mesh|multi[- ]agent|agent swarm)\b/i.test(input)) return 'mesh';

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

  const meshSignals = [
    /\bfirst agi\b/,
    /\bbuild (?:an?|the)?\s*agi\b/,
    /\belp ventures\b.*\b(?:agent|intelligence|research|repository|repositories|build)\b/,
    /\b(?:analy[sz]e|scan|research)\b.*\b(?:github|git)\b.*\b(?:repo|repository|repositories)\b/,
    /\b(?:all|multiple)\s+(?:ai\s+)?agents?\b.*\b(?:work|working|together|orchestrat)/,
  ];
  if (meshSignals.some((pattern) => pattern.test(q))) return 'mesh';

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

  if (mode === 'mesh') {
    const result = await runCognitiveMesh({
      profileId: args.profileId,
      objective,
      maxSpecialists: 5,
    });
    await persistAgentRun(args.profileId, {
      id: result.id,
      mode: 'mesh',
      objective,
      status: result.execution.status,
      summary: result.answer,
      trace: result.execution.trace,
      metadata: {
        selectedAgents: result.selectedAgents,
        workflowId: result.execution.workflowId,
        workflowVersion: result.execution.workflowVersion,
        iterations: result.execution.iterations,
        totalLatencyMs: result.execution.totalLatencyMs,
        tokenUsage: result.execution.tokenUsage || null,
      },
      generatedAt: result.execution.generatedAt,
    });
    return {
      handled: true,
      mode: 'mesh',
      text: result.answer,
      metadata: {
        runId: result.id,
        selectedAgents: result.selectedAgents,
        status: result.execution.status,
        iterations: result.execution.iterations,
        totalLatencyMs: result.execution.totalLatencyMs,
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
