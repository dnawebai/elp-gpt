import { getReasoningProviders } from '@/lib/reasoning-providers';
import { matchAllSkills } from '@/lib/skill-registry';

export type AgentDomain =
  | 'strategy'
  | 'research'
  | 'marketing'
  | 'sales'
  | 'content'
  | 'product'
  | 'engineering'
  | 'automation'
  | 'finance'
  | 'legal'
  | 'security'
  | 'operations';

export type SwarmAgent = {
  id: string;
  name: string;
  domain: AgentDomain;
  mission: string;
  keywords: string[];
};

export type SwarmFinding = {
  agentId: string;
  agentName: string;
  domain: AgentDomain;
  status: 'completed' | 'failed';
  output: string;
  provider?: string;
  latencyMs: number;
  error?: string;
};

export type SkillCandidate = {
  name: string;
  purpose: string;
  domain: string;
  inputs: string[];
  outputs: string[];
  connectors: string[];
  validation: string[];
};

export type UnifiedSwarmResult = {
  mode: 'serious-multi-agent-swarm';
  objective: string;
  agents: SwarmAgent[];
  findings: SwarmFinding[];
  synthesis: string;
  skillCandidates: SkillCandidate[];
  relevantSkills: string[];
  trace: Array<{
    agentId: string;
    agentName: string;
    domain: AgentDomain;
    status: 'completed' | 'failed';
    provider?: string;
    latencyMs: number;
    error?: string;
  }>;
  generatedAt: string;
};

export const ELP_SWARM_AGENTS: readonly SwarmAgent[] = [
  {
    id: 'chief-strategist',
    name: 'Chief Strategist',
    domain: 'strategy',
    mission: 'Turn the objective into a measurable strategy with assumptions, constraints, milestones, tradeoffs and kill criteria.',
    keywords: ['strategy', 'business model', 'prioritize', 'roadmap', 'decision', 'scenario'],
  },
  {
    id: 'market-intelligence',
    name: 'Market Intelligence',
    domain: 'research',
    mission: 'Analyse evidence, market structure, competitors, demand, positioning, information gaps and confidence.',
    keywords: ['research', 'market', 'competitor', 'evidence', 'trend', 'benchmark'],
  },
  {
    id: 'growth-architect',
    name: 'Growth Architect',
    domain: 'marketing',
    mission: 'Design acquisition loops, offers, channels, experiments, retention mechanics and measurable growth systems.',
    keywords: ['growth', 'marketing', 'acquisition', 'funnel', 'retention', 'viral', 'seo'],
  },
  {
    id: 'revenue-operator',
    name: 'Revenue Operator',
    domain: 'sales',
    mission: 'Find practical paths to revenue, pricing, pipeline, conversion, distribution and commercial execution.',
    keywords: ['sales', 'revenue', 'pricing', 'pipeline', 'conversion', 'subscription', 'monetize'],
  },
  {
    id: 'content-studio',
    name: 'Content Studio',
    domain: 'content',
    mission: 'Create communication angles, scripts, hooks, editorial systems and channel-specific content plans.',
    keywords: ['content', 'video', 'social', 'script', 'copy', 'campaign', 'creative'],
  },
  {
    id: 'product-architect',
    name: 'Product Architect',
    domain: 'product',
    mission: 'Translate user needs into product requirements, UX flows, experiments, prioritisation and product decisions.',
    keywords: ['product', 'ux', 'feature', 'user', 'app', 'onboarding', 'roadmap'],
  },
  {
    id: 'software-engineer',
    name: 'Software Engineer',
    domain: 'engineering',
    mission: 'Design implementation architecture, code changes, tests, migrations, reliability controls and deployment plans.',
    keywords: ['code', 'developer', 'engineering', 'api', 'database', 'deploy', 'github', 'vercel'],
  },
  {
    id: 'automation-engineer',
    name: 'Automation Engineer',
    domain: 'automation',
    mission: 'Connect APIs and workflows, remove manual work, define triggers and design observable reliable automations.',
    keywords: ['automation', 'workflow', 'connector', 'composio', 'agent', 'mcp', 'integration'],
  },
  {
    id: 'finance-analyst',
    name: 'Finance Analyst',
    domain: 'finance',
    mission: 'Model unit economics, budgets, ROI, scenarios, cash impact, sensitivities and financial constraints.',
    keywords: ['finance', 'cost', 'roi', 'budget', 'margin', 'unit economics', 'forecast'],
  },
  {
    id: 'legal-risk',
    name: 'Legal & Risk',
    domain: 'legal',
    mission: 'Identify legal, regulatory, contractual and compliance issues without pretending to replace qualified counsel.',
    keywords: ['legal', 'law', 'contract', 'compliance', 'regulation', 'privacy', 'terms'],
  },
  {
    id: 'security-reviewer',
    name: 'Security Reviewer',
    domain: 'security',
    mission: 'Threat-model the proposal and identify identity, data, authorization, abuse, privacy and operational security risks.',
    keywords: ['security', 'auth', 'passkey', 'secret', 'permission', 'zero trust', 'risk'],
  },
  {
    id: 'operations-chief',
    name: 'Operations Chief',
    domain: 'operations',
    mission: 'Convert the plan into sequence, owners, dependencies, checkpoints, SOPs, verification and execution cadence.',
    keywords: ['operations', 'execute', 'implementation', 'process', 'sop', 'owner', 'deadline'],
  },
] as const;

const MAX_AGENTS = 8;
const MIN_AGENTS = 3;

const SWARM_POLICY = `You are a bounded specialist inside ELP Serious Multi-Agent Mode. Analyse only your assigned domain. Distinguish verified facts supplied in context from assumptions and recommendations. Never claim an external action was executed. Consequential writes, communications, purchases, deployments, financial actions, legal commitments, security changes and irreversible operations remain behind ELP's approval and standing-authority controls. Identify missing evidence explicitly.`;

function clean(value: unknown, max = 6000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function chooseAgents(objective: string, context: string, requestedMax?: number) {
  const text = normalize(`${objective} ${context}`);
  const maxAgents = Math.max(MIN_AGENTS, Math.min(Number(requestedMax) || 6, MAX_AGENTS));
  const mandatory = new Set(['chief-strategist', 'market-intelligence', 'operations-chief']);
  return ELP_SWARM_AGENTS
    .map((agent) => {
      let score = mandatory.has(agent.id) ? 8 : 0;
      if (text.includes(agent.domain)) score += 6;
      for (const keyword of agent.keywords) if (text.includes(normalize(keyword))) score += keyword.includes(' ') ? 5 : 3;
      return { agent, score };
    })
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name))
    .slice(0, maxAgents)
    .map((entry) => entry.agent);
}

async function callReasoner(system: string, user: string, maxTokens = 1100) {
  const providers = getReasoningProviders();
  if (!providers.length) throw new Error('No reasoning provider configured for ELP Serious Mode.');
  const failures: string[] = [];
  for (const provider of providers) {
    const started = Date.now();
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0.2,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(provider.name === 'hermes' ? 30_000 : 45_000),
      });
      if (!response.ok) {
        failures.push(`${provider.name}:${response.status}`);
        continue;
      }
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) {
        failures.push(`${provider.name}:empty`);
        continue;
      }
      return { text, provider: provider.name, latencyMs: Date.now() - started };
    } catch (error) {
      failures.push(`${provider.name}:${error instanceof Error ? error.name : 'error'}`);
    }
  }
  throw new Error(`All reasoning providers failed (${failures.join(', ') || 'unknown error'}).`);
}

function extractSkillCandidates(text: string): SkillCandidate[] {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)].map((match) => match[1]);
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block) as { skillCandidates?: unknown } | unknown[];
      const candidates = Array.isArray(parsed) ? parsed : (parsed as { skillCandidates?: unknown }).skillCandidates;
      if (!Array.isArray(candidates)) continue;
      return candidates
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          name: clean(item.name, 120),
          purpose: clean(item.purpose, 500),
          domain: clean(item.domain, 80),
          inputs: Array.isArray(item.inputs) ? item.inputs.map((value) => clean(value, 160)).filter(Boolean).slice(0, 12) : [],
          outputs: Array.isArray(item.outputs) ? item.outputs.map((value) => clean(value, 160)).filter(Boolean).slice(0, 12) : [],
          connectors: Array.isArray(item.connectors) ? item.connectors.map((value) => clean(value, 120)).filter(Boolean).slice(0, 12) : [],
          validation: Array.isArray(item.validation) ? item.validation.map((value) => clean(value, 220)).filter(Boolean).slice(0, 12) : [],
        }))
        .filter((item) => item.name && item.purpose)
        .slice(0, 10);
    } catch {
      continue;
    }
  }
  return [];
}

export async function runUnifiedAgentSwarm(args: {
  objective: string;
  context?: string;
  maxAgents?: number;
}): Promise<UnifiedSwarmResult> {
  const objective = clean(args.objective, 3000);
  const context = clean(args.context, 6000);
  if (!objective) throw new Error('Serious Mode objective is required.');

  const agents = chooseAgents(objective, context, args.maxAgents);
  const relevantSkills = matchAllSkills(objective, 10).map((skill) => `${skill.name} [${skill.risk}]`);
  const sharedContext = [
    `OBJECTIVE:\n${objective}`,
    context ? `CONTEXT:\n${context}` : '',
    relevantSkills.length ? `RELEVANT EXISTING ELP SKILLS:\n${relevantSkills.map((skill) => `- ${skill}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const findings = await Promise.all(agents.map(async (agent): Promise<SwarmFinding> => {
    const started = Date.now();
    try {
      const result = await callReasoner(
        `${SWARM_POLICY}\n\nYou are the ${agent.name}. Domain: ${agent.domain}. Mission: ${agent.mission}`,
        `${sharedContext}\n\nReturn concise specialist findings with these headings: Evidence, Assumptions, Highest-Leverage Actions, Risks, Measurable Tests, Missing Capability. Challenge weak premises rather than agreeing automatically.`,
      );
      return {
        agentId: agent.id,
        agentName: agent.name,
        domain: agent.domain,
        status: 'completed',
        output: result.text,
        provider: result.provider,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        domain: agent.domain,
        status: 'failed',
        output: '',
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : 'Agent execution failed.',
      };
    }
  }));

  const completed = findings.filter((finding) => finding.status === 'completed');
  if (!completed.length) throw new Error('All Serious Mode specialists failed.');

  const specialistWork = findings.map((finding) => finding.status === 'completed'
    ? `## ${finding.agentName} (${finding.domain})\n${finding.output}`
    : `## ${finding.agentName} (${finding.domain})\nFAILED: ${finding.error}`
  ).join('\n\n');

  const synthesis = await callReasoner(
    `You are ELP's Chief Synthesizer for Serious Multi-Agent Mode. Reconcile specialist outputs into one rigorous plan. Do not average disagreements away: identify conflicts, decide which position is stronger and explain what evidence would resolve uncertainty. Existing skills may be reused; proposed skills are specifications only and must never be treated as installed. External writes and consequential actions remain behind ELP approval controls.`,
    `${sharedContext}\n\nSPECIALIST WORK:\n${specialistWork}\n\nReturn: 1) Executive Answer, 2) Evidence vs Assumptions, 3) Cross-Agent Agreements, 4) Material Disagreements, 5) Integrated Execution Plan with owners and sequence, 6) Metrics and Stop Conditions, 7) Risks and Approval Boundaries, 8) Missing Evidence, 9) Reusable Skill Candidates. In section 9, if new reusable capabilities are genuinely missing, include one JSON code block shaped as {"skillCandidates":[{"name":"...","purpose":"...","domain":"...","inputs":[],"outputs":[],"connectors":[],"validation":[]}]}. If none are needed, use {"skillCandidates":[]}.`,
    1800,
  );

  return {
    mode: 'serious-multi-agent-swarm',
    objective,
    agents,
    findings,
    synthesis: synthesis.text,
    skillCandidates: extractSkillCandidates(synthesis.text),
    relevantSkills,
    trace: findings.map((finding) => ({
      agentId: finding.agentId,
      agentName: finding.agentName,
      domain: finding.domain,
      status: finding.status,
      ...(finding.provider ? { provider: finding.provider } : {}),
      latencyMs: finding.latencyMs,
      ...(finding.error ? { error: finding.error } : {}),
    })),
    generatedAt: new Date().toISOString(),
  };
}

export function seriousModePrompt() {
  return `SERIOUS MULTI-AGENT MODE\n${ELP_SWARM_AGENTS.map((agent) => `- ${agent.name} (${agent.domain}): ${agent.mission}`).join('\n')}\nUse this mode only for complex multi-domain objectives or when explicitly requested. It is bounded, evidence-aware, approval-governed and may propose—but never silently install—new reusable skills.`;
}
