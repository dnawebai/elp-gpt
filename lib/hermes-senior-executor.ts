import { executeComposioTool, isComposioConfigured, searchComposioTools } from '@/lib/composio';
import { getReasoningProviders } from '@/lib/reasoning-providers';
import { HERMES_CREATIVE_SKILLS } from '@/lib/creative-skills';

export type SeniorHermesAgentRole =
  | 'brand-strategist'
  | 'competitor-intelligence'
  | 'growth-strategist'
  | 'copy-chief'
  | 'art-director'
  | 'creative-technologist'
  | 'compliance-qa'
  | 'experiment-lead'
  | 'execution-controller'
  | 'chief-executor';

export type SeniorHermesAgent = {
  id: SeniorHermesAgentRole;
  name: string;
  mission: string;
};

export type CreativeMission = {
  objective: string;
  brand?: string;
  website?: string;
  audience?: string;
  offer?: string;
  channels?: string;
  competitors?: string;
  assetCount?: number;
  context?: string;
};

export type CreativeEvidence = {
  source: string;
  query: string;
  status: 'verified-tool-output' | 'unavailable';
  data?: unknown;
  error?: string;
};

export type ProposedExternalAction = {
  purpose: 'render' | 'publish' | 'ads-analysis';
  status: 'requires-approval' | 'connector-missing' | 'ready-to-plan';
  toolCandidates: Array<{ slug: string; name: string; toolkit?: string }>;
  reason: string;
};

export type SeniorHermesMissionResult = {
  mode: 'senior-creative-execution';
  objective: string;
  videoPattern: string;
  agents: SeniorHermesAgent[];
  evidence: CreativeEvidence[];
  findings: Array<{ agentId: SeniorHermesAgentRole; agentName: string; output: string }>;
  synthesis: string;
  proposedActions: ProposedExternalAction[];
  skills: typeof HERMES_CREATIVE_SKILLS;
  generatedAt: string;
};

export const SENIOR_HERMES_AGENTS: readonly SeniorHermesAgent[] = [
  { id: 'brand-strategist', name: 'Brand Brain Strategist', mission: 'Build the operating brand model: positioning, audience, promise, proof, offer, tone, visual codes, constraints and claims that are actually supported.' },
  { id: 'competitor-intelligence', name: 'Competitor Creative Intelligence Lead', mission: 'Map competitor hooks, offers, formats, landing-page patterns and category conventions. Extract patterns without copying creative expression.' },
  { id: 'growth-strategist', name: 'Growth & Offer Strategist', mission: 'Translate the objective into differentiated campaign hypotheses tied to audience motivation, offer structure and measurable business outcomes.' },
  { id: 'copy-chief', name: 'Performance Copy Chief', mission: 'Create distinct hooks, headlines, proof structures and calls to action. Reject invented claims and vague generic copy.' },
  { id: 'art-director', name: 'Senior Art Director', mission: 'Turn each hypothesis into a production-ready visual system: composition, hierarchy, typography, product treatment, scene, aspect ratio and generation prompt.' },
  { id: 'creative-technologist', name: 'Creative Technologist', mission: 'Choose the strongest available rendering workflow and exact connector/tool candidates; make missing dependencies explicit.' },
  { id: 'compliance-qa', name: 'Creative QA & Compliance Director', mission: 'Challenge brand fidelity, unsupported claims, illegible layouts, platform readiness, accidental imitation and insufficient variation. Veto weak assets.' },
  { id: 'experiment-lead', name: 'Experiment & Learning Lead', mission: 'Design a controlled creative test matrix with variables, metrics, sample logic, learning objectives and stop/iterate rules.' },
  { id: 'execution-controller', name: 'Execution Controller', mission: 'Separate safe autonomous reads from consequential writes, route external mutations through the existing ELP approval system, and verify every claimed completion.' },
  { id: 'chief-executor', name: 'Senior Hermes Chief Executor', mission: 'Own the outcome end-to-end, reconcile specialist disagreements, select the strongest concepts and return an execution-ready campaign package plus explicit next actions.' },
] as const;

export const VIDEO_CREATIVE_PATTERN =
  'Video-derived pattern: begin with one campaign request; load or infer a brand brain from evidence; inspect competitor advertising and market patterns; form differentiated creative hypotheses; convert them into production prompts; use a connected creative-generation tool to render multiple variants; review the outputs; and leave the operator with finished assets or precise blockers. The agent should behave as an operator, not merely as a chat assistant.';

const EXECUTION_POLICY =
  'Execution policy: autonomous research and analysis are allowed when read-only and relevant. Paid generation, public publishing, campaign mutation, deployment, purchases and other external writes must use ELP approval/standing-authority controls. Never claim a render or publish completed without verified tool output. Never invent brand claims, competitor data, connector availability or results.';

function clean(value: unknown, max = 1200) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

async function callHermes(system: string, user: string) {
  const provider = getReasoningProviders().find((item) => item.name === 'hermes') || getReasoningProviders()[0];
  if (!provider) throw new Error('Hermes is not configured. Set HERMES_BASE_URL or a fallback reasoning provider.');
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.22,
      max_tokens: 1500,
    }),
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) throw new Error(`Hermes failed (${response.status}).`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Hermes returned an empty response.');
  return text;
}

async function gatherCreativeEvidence(profileId: string, mission: CreativeMission): Promise<CreativeEvidence[]> {
  if (!isComposioConfigured()) {
    return [{ source: 'Composio', query: 'brand and competitor research', status: 'unavailable', error: 'COMPOSIO_API_KEY is not configured in the ELP runtime.' }];
  }

  const queries = [
    mission.website ? `${mission.website} brand products positioning offer reviews` : `${mission.brand || mission.objective} official website brand products positioning offer`,
    `${mission.brand || mission.objective} competitors advertising campaign creative examples`,
    mission.competitors ? `${mission.competitors} ads offers landing pages creative` : `${mission.brand || mission.objective} category competitor ads offers landing pages`,
  ].map((query) => clean(query, 300)).filter(Boolean);

  const evidence = await Promise.all(queries.map(async (query): Promise<CreativeEvidence> => {
    try {
      const data = await executeComposioTool({ toolSlug: 'COMPOSIO_SEARCH_WEB', arguments: { query }, profileId });
      return { source: 'COMPOSIO_SEARCH_WEB', query, status: 'verified-tool-output', data };
    } catch (error) {
      return { source: 'COMPOSIO_SEARCH_WEB', query, status: 'unavailable', error: error instanceof Error ? error.message : 'Search failed.' };
    }
  }));
  return evidence;
}

async function discoverExecutionTools(): Promise<ProposedExternalAction[]> {
  if (!isComposioConfigured()) {
    return [
      { purpose: 'render', status: 'connector-missing', toolCandidates: [], reason: 'Composio is not configured, so creative rendering tools cannot be discovered at runtime.' },
      { purpose: 'publish', status: 'connector-missing', toolCandidates: [], reason: 'Composio is not configured, so publishing tools cannot be discovered at runtime.' },
    ];
  }

  const [render, publish, ads] = await Promise.all([
    searchComposioTools('generate marketing image creative advertisement product campaign'),
    searchComposioTools('publish approved Instagram image reel campaign'),
    searchComposioTools('list or inspect Meta Ads creatives and advertising assets'),
  ]);

  const compact = (items: Awaited<ReturnType<typeof searchComposioTools>>) => items.slice(0, 5).map((tool) => ({ slug: tool.slug, name: tool.name, toolkit: tool.toolkit }));
  return [
    {
      purpose: 'render',
      status: render.length ? 'ready-to-plan' : 'connector-missing',
      toolCandidates: compact(render),
      reason: render.length ? 'Rendering candidates discovered. Paid/external generation should be planned through ELP action approval before execution.' : 'No creative rendering tool was discovered.'
    },
    {
      purpose: 'publish',
      status: publish.length ? 'requires-approval' : 'connector-missing',
      toolCandidates: compact(publish),
      reason: publish.length ? 'Public publishing is consequential and must use ELP approval or explicit standing authority.' : 'No social publishing tool was discovered.'
    },
    {
      purpose: 'ads-analysis',
      status: ads.length ? 'ready-to-plan' : 'connector-missing',
      toolCandidates: compact(ads),
      reason: ads.length ? 'Ad-intelligence tools are available for authorized accounts; public web research remains the fallback.' : 'No dedicated ads connector was discovered; use verified public-web evidence instead.'
    },
  ];
}

function compactEvidence(evidence: CreativeEvidence[]) {
  return evidence.map((item) => ({
    source: item.source,
    query: item.query,
    status: item.status,
    data: item.data ? JSON.stringify(item.data).slice(0, 9000) : undefined,
    error: item.error,
  }));
}

export async function runSeniorHermesCreativeMission(profileId: string, mission: CreativeMission): Promise<SeniorHermesMissionResult> {
  const objective = clean(mission.objective, 2200);
  if (!objective) throw new Error('Creative execution objective is required.');

  const assetCount = Math.max(1, Math.min(Number(mission.assetCount) || 5, 12));
  const [evidence, proposedActions] = await Promise.all([
    gatherCreativeEvidence(profileId, mission),
    discoverExecutionTools(),
  ]);

  const context = [
    `Objective: ${objective}`,
    mission.brand ? `Brand: ${clean(mission.brand)}` : '',
    mission.website ? `Website: ${clean(mission.website)}` : '',
    mission.audience ? `Audience: ${clean(mission.audience)}` : '',
    mission.offer ? `Offer: ${clean(mission.offer)}` : '',
    mission.channels ? `Channels: ${clean(mission.channels)}` : '',
    mission.competitors ? `Known competitors: ${clean(mission.competitors)}` : '',
    `Requested creative variants: ${assetCount}`,
    mission.context ? `Additional context: ${clean(mission.context, 2200)}` : '',
    `VERIFIED RESEARCH EVIDENCE:\n${JSON.stringify(compactEvidence(evidence))}`,
    `RUNTIME TOOL DISCOVERY:\n${JSON.stringify(proposedActions)}`,
  ].filter(Boolean).join('\n\n');

  const workers = SENIOR_HERMES_AGENTS.filter((agent) => !['chief-executor', 'execution-controller'].includes(agent.id));
  const findings = await Promise.all(workers.map(async (agent) => ({
    agentId: agent.id,
    agentName: agent.name,
    output: await callHermes(
      `You are ${agent.name}, a senior specialist inside ELP's Senior Hermes Creative Execution system. ${agent.mission}\n${VIDEO_CREATIVE_PATTERN}\n${EXECUTION_POLICY}\nSeparate verified evidence, inference and unknowns. Produce useful work product rather than commentary.`,
      `${context}\n\nReturn concise, execution-grade output for your specialty. Where applicable provide concrete concepts, prompts, copy, QA criteria, or test design.`,
    ),
  })));

  const specialistWork = findings.map((item) => `## ${item.agentName}\n${item.output}`).join('\n\n');
  const synthesis = await callHermes(
    `You are the Senior Hermes Chief Executor. ${VIDEO_CREATIVE_PATTERN}\n${EXECUTION_POLICY}\nYou own the result. Reconcile specialists, reject weak or duplicative concepts, and create a production-ready campaign package. The QA director may veto unsupported claims or imitation.`,
    `${context}\n\nSPECIALIST WORK:\n${specialistWork}\n\nProduce exactly these sections: 1) Brand Brain, 2) Competitor Pattern Map, 3) Creative Strategy, 4) ${assetCount} DISTINCT Creative Concepts, each with hook, copy, art direction and generation prompt, 5) Creative QA checklist and vetoes, 6) Experiment Matrix, 7) Execution Pipeline showing safe reads already completed and external actions that still require approval, 8) Missing connectors/data, 9) Definition of Done. Do not state that an image was rendered or published unless verified tool evidence says so.`,
  );

  return {
    mode: 'senior-creative-execution',
    objective,
    videoPattern: VIDEO_CREATIVE_PATTERN,
    agents: [...SENIOR_HERMES_AGENTS],
    evidence,
    findings,
    synthesis,
    proposedActions,
    skills: HERMES_CREATIVE_SKILLS,
    generatedAt: new Date().toISOString(),
  };
}

export function seniorHermesCreativePrompt() {
  return `SENIOR HERMES CREATIVE EXECUTION\n${VIDEO_CREATIVE_PATTERN}\n${EXECUTION_POLICY}\nSkills:\n${HERMES_CREATIVE_SKILLS.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n')}`;
}
