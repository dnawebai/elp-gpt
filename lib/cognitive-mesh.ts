import { randomUUID } from 'node:crypto';
import { runVellumWorkflow, type VellumExecution, type VellumNode, type VellumWorkflow } from '@/lib/vellum-agent';

export type CognitiveAgentId =
  | 'executive-orchestrator'
  | 'deep-research'
  | 'repository-scout'
  | 'software-engineer'
  | 'browser-operator'
  | 'communications-chief'
  | 'venture-intelligence'
  | 'memory-steward'
  | 'world-model'
  | 'strategist'
  | 'authority-guardian'
  | 'verifier';

export type CognitiveAgentDefinition = {
  id: CognitiveAgentId;
  name: string;
  mission: string;
  signals: RegExp[];
  capabilities: string[];
  executionClass: 'reasoning' | 'research' | 'execution-advisory' | 'control';
};

export type CognitiveMeshPlan = {
  objective: string;
  agents: CognitiveAgentDefinition[];
  specialistAgents: CognitiveAgentDefinition[];
  reason: string[];
};

export type CognitiveMeshResult = {
  id: string;
  answer: string;
  selectedAgents: CognitiveAgentId[];
  execution: VellumExecution;
};

const AGENTS: CognitiveAgentDefinition[] = [
  {
    id: 'executive-orchestrator',
    name: 'Executive Orchestrator',
    mission: 'Decompose the objective, identify dependencies, choose the minimum expert team, and keep the work aligned to the principal outcome.',
    signals: [],
    capabilities: ['planning', 'delegation', 'dependency mapping', 'priority control'],
    executionClass: 'control',
  },
  {
    id: 'deep-research',
    name: 'Deep Research Agent',
    mission: 'Establish facts, evidence, alternatives, uncertainty, and missing information without overstating confidence.',
    signals: [/research/i, /investigat/i, /compare/i, /evidence/i, /market/i, /competitor/i, /latest/i, /current/i],
    capabilities: ['research planning', 'evidence synthesis', 'competitive intelligence'],
    executionClass: 'research',
  },
  {
    id: 'repository-scout',
    name: 'Repository Intelligence Agent',
    mission: 'Identify reusable open-source architecture, protocols, libraries, and implementation patterns while evaluating fit, freshness, security, and dependency cost.',
    signals: [/github/i, /git\b/i, /repo/i, /open.?source/i, /framework/i, /mcp/i, /a2a/i, /sdk/i],
    capabilities: ['GitHub intelligence', 'architecture mining', 'dependency due diligence'],
    executionClass: 'research',
  },
  {
    id: 'software-engineer',
    name: 'Principal Software Engineer',
    mission: 'Translate the objective into production architecture, code changes, tests, observability, migration strategy, and rollback-safe execution.',
    signals: [/build/i, /implement/i, /code/i, /deploy/i, /api/i, /database/i, /test/i, /bug/i, /architecture/i, /developer/i],
    capabilities: ['software architecture', 'implementation design', 'testing', 'deployment'],
    executionClass: 'execution-advisory',
  },
  {
    id: 'browser-operator',
    name: 'Computer and Browser Operator',
    mission: 'Plan deterministic browser/computer execution only when direct APIs or structured tools are unavailable, with explicit verification after each consequential step.',
    signals: [/browser/i, /website/i, /click/i, /form/i, /computer/i, /screen/i, /login/i, /dashboard/i],
    capabilities: ['browser automation', 'computer use', 'visual verification'],
    executionClass: 'execution-advisory',
  },
  {
    id: 'communications-chief',
    name: 'Communications Chief',
    mission: 'Triage communications, identify dropped balls, prepare responses, protect relationships, and escalate only matters requiring principal judgment.',
    signals: [/email/i, /message/i, /reply/i, /inbox/i, /slack/i, /whatsapp/i, /follow.?up/i, /community/i],
    capabilities: ['communications triage', 'follow-up management', 'relationship continuity'],
    executionClass: 'execution-advisory',
  },
  {
    id: 'venture-intelligence',
    name: 'ELP Ventures Intelligence',
    mission: 'Evaluate technologies, companies, products, markets, and repositories as venture opportunities using product, technical, distribution, moat, timing, and execution lenses.',
    signals: [/venture/i, /startup/i, /invest/i, /opportunit/i, /business model/i, /revenue/i, /growth/i, /portfolio/i, /acqui/i],
    capabilities: ['venture scouting', 'commercial diligence', 'product-market analysis', 'portfolio intelligence'],
    executionClass: 'reasoning',
  },
  {
    id: 'memory-steward',
    name: 'Memory Steward',
    mission: 'Use relevant prior context, commitments, preferences, outcomes, and lessons while distinguishing stored fact from inference and avoiding unnecessary retention.',
    signals: [/remember/i, /memory/i, /previous/i, /last time/i, /preference/i, /history/i, /commitment/i],
    capabilities: ['long-term context', 'commitment continuity', 'outcome learning'],
    executionClass: 'reasoning',
  },
  {
    id: 'world-model',
    name: 'World Model Agent',
    mission: 'Model entities, dependencies, temporal state, external changes, second-order effects, and what must be re-verified before action.',
    signals: [/forecast/i, /scenario/i, /dependency/i, /risk/i, /change/i, /impact/i, /future/i, /what if/i],
    capabilities: ['state modelling', 'forecasting', 'dependency reasoning', 'causal analysis'],
    executionClass: 'reasoning',
  },
  {
    id: 'strategist',
    name: 'Strategy and Simulation Agent',
    mission: 'Generate competing strategies, simulate likely responses and failure modes, and recommend the option with the strongest risk-adjusted path to the objective.',
    signals: [/strategy/i, /plan/i, /decision/i, /negotia/i, /simulate/i, /option/i, /roadmap/i],
    capabilities: ['strategic planning', 'scenario simulation', 'decision analysis'],
    executionClass: 'reasoning',
  },
  {
    id: 'authority-guardian',
    name: 'Authority and Safety Guardian',
    mission: 'Check whether proposed actions cross financial, legal, privacy, security, destructive, publishing, messaging, account, or irreversible boundaries and require principal authority.',
    signals: [/send/i, /publish/i, /buy/i, /pay/i, /transfer/i, /delete/i, /cancel/i, /sign/i, /legal/i, /security/i, /credential/i, /permission/i, /call/i],
    capabilities: ['authority boundary review', 'risk classification', 'approval requirements'],
    executionClass: 'control',
  },
  {
    id: 'verifier',
    name: 'Independent Verifier',
    mission: 'Attack the proposed answer, expose unsupported claims and missing verification, and prevent ELP from reporting work as completed without evidence.',
    signals: [],
    capabilities: ['critique', 'fact/assumption separation', 'completion verification'],
    executionClass: 'control',
  },
];

const byId = new Map(AGENTS.map((agent) => [agent.id, agent] as const));

function scoreAgent(agent: CognitiveAgentDefinition, objective: string) {
  return agent.signals.reduce((score, pattern) => score + (pattern.test(objective) ? 1 : 0), 0);
}

export function listCognitiveAgents() {
  return AGENTS.map((agent) => ({ ...agent, signals: [...agent.signals], capabilities: [...agent.capabilities] }));
}

export function planCognitiveMesh(objective: string, maxSpecialists = 4): CognitiveMeshPlan {
  const text = objective.trim().slice(0, 12_000);
  const ranked = AGENTS
    .filter((agent) => !['executive-orchestrator', 'verifier'].includes(agent.id))
    .map((agent) => ({ agent, score: scoreAgent(agent, text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));

  const selected = ranked.slice(0, Math.max(2, Math.min(maxSpecialists, 5))).map((item) => item.agent);
  const ensure = (id: CognitiveAgentId) => {
    const agent = byId.get(id);
    if (agent && !selected.some((item) => item.id === id)) selected.push(agent);
  };

  if (!selected.length) {
    ensure('deep-research');
    ensure('strategist');
  } else if (selected.length === 1) {
    ensure('strategist');
  }

  if (/build|implement|deploy|code|app|website|api/i.test(text)) ensure('software-engineer');
  if (/repo|github|open.?source|framework|mcp|a2a/i.test(text)) ensure('repository-scout');
  if (/venture|startup|business|market|revenue|growth|portfolio|invest/i.test(text)) ensure('venture-intelligence');
  if (/send|publish|buy|pay|transfer|delete|cancel|sign|legal|credential|permission|call/i.test(text)) ensure('authority-guardian');

  const bounded = selected.slice(0, 5);
  const orchestrator = byId.get('executive-orchestrator')!;
  const verifier = byId.get('verifier')!;
  return {
    objective: text,
    agents: [orchestrator, ...bounded, verifier],
    specialistAgents: bounded,
    reason: bounded.map((agent) => `${agent.name}: ${agent.mission}`),
  };
}

function workflowFor(plan: CognitiveMeshPlan): VellumWorkflow {
  const nodes: VellumNode[] = [
    {
      id: 'orchestrator',
      type: 'agent',
      name: 'ELP Executive Orchestrator',
      prompt: `Objective: ${plan.objective}\n\nCreate a compact execution-grade reasoning plan for the expert panel. Identify the desired outcome, facts that must be established, assumptions, dependencies, authority boundaries, and the questions each specialist must answer. Do not pretend any external action has occurred.`,
      outputKey: 'meshPlan',
    },
  ];

  const specialistKeys: string[] = [];
  let previous = 'orchestrator';
  for (const [index, agent] of plan.specialistAgents.entries()) {
    const key = `specialist${index + 1}`;
    specialistKeys.push(key);
    nodes.push({
      id: key,
      type: 'agent',
      name: agent.name,
      prompt: `You are the ${agent.name} inside the ELP Cognitive Mesh.\nMission: ${agent.mission}\nCapabilities: ${agent.capabilities.join(', ')}.\n\nPrincipal objective: ${plan.objective}\n\nOrchestrator plan:\n{{meshPlan}}\n\nProduce your independent specialist analysis. Challenge assumptions. Separate verified facts from inferences. If execution would require an external tool or principal approval, say exactly what must be verified or approved; do not claim it was executed.`,
      outputKey: key,
    });
    previous = key;
  }

  const specialistContext = specialistKeys.map((key, index) => `SPECIALIST ${index + 1} — ${plan.specialistAgents[index]?.name}:\n{{${key}}}`).join('\n\n');
  nodes.push({
    id: 'synthesizer',
    type: 'agent',
    name: 'ELP Synthesis Agent',
    prompt: `Principal objective: ${plan.objective}\n\nORCHESTRATOR PLAN:\n{{meshPlan}}\n\n${specialistContext}\n\nSynthesize the strongest answer. Resolve disagreements explicitly. Optimize for correctness, actionability, verification, and minimal unnecessary complexity. Never imply that a real-world action was completed unless the supplied state contains direct evidence of execution.`,
    outputKey: 'synthesis',
  });
  nodes.push({
    id: 'verifier',
    type: 'agent',
    name: 'ELP Independent Verifier',
    prompt: `Objective: ${plan.objective}\n\nCandidate answer:\n{{synthesis}}\n\nAudit the answer aggressively for unsupported claims, missing evidence, hidden assumptions, security or authority violations, fake completion claims, and avoidable complexity. Return a corrected final answer only. When work is not actually executed, label it as a recommendation or next action rather than completion.`,
    outputKey: 'final',
  });
  nodes.push({ id: 'output', type: 'output', name: 'Verified Final Output', inputKey: 'final', outputKey: 'answer' });

  const edges = [{ from: 'orchestrator', to: specialistKeys[0] || 'synthesizer' }];
  for (let index = 0; index < specialistKeys.length; index += 1) {
    edges.push({ from: specialistKeys[index]!, to: specialistKeys[index + 1] || 'synthesizer' });
  }
  edges.push({ from: previous === 'orchestrator' ? 'orchestrator' : previous, to: 'synthesizer' });
  // Remove the duplicate edge created above when specialists exist; the ordered chain already links into synthesizer.
  const uniqueEdges = edges.filter((edge, index, all) => all.findIndex((candidate) => candidate.from === edge.from && candidate.to === edge.to) === index);
  uniqueEdges.push({ from: 'synthesizer', to: 'verifier' }, { from: 'verifier', to: 'output' });

  return {
    id: `elp-mesh-${randomUUID()}`,
    name: 'ELP Dynamic Cognitive Mesh',
    version: '1.0.0',
    entryNodeId: 'orchestrator',
    nodes,
    edges: uniqueEdges,
    maxIterations: Math.min(12, nodes.length + 1),
    evaluationThreshold: 0.85,
  };
}

export async function runCognitiveMesh(args: { profileId: string; objective: string; maxSpecialists?: number }): Promise<CognitiveMeshResult> {
  const plan = planCognitiveMesh(args.objective, args.maxSpecialists);
  const execution = await runVellumWorkflow(args.profileId, workflowFor(plan), { objective: plan.objective });
  const answer = typeof execution.outputs.answer === 'string'
    ? execution.outputs.answer
    : typeof execution.state.final === 'string'
      ? execution.state.final
      : `ELP Cognitive Mesh finished with status ${execution.status}.`;
  return {
    id: execution.id,
    answer,
    selectedAgents: plan.agents.map((agent) => agent.id),
    execution,
  };
}
