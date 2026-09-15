import { runUnifiedAgentSwarm, type UnifiedSwarmResult } from '@/lib/agent-swarm';
import { getExecutiveLedger } from '@/lib/executive-memory';
import { getReasoningProviders } from '@/lib/reasoning-providers';
import { getRepositoryRadarSnapshot, repositoryRadarToPrompt } from '@/lib/repository-radar';

export type CognitiveLens = {
  id: 'repository-intelligence' | 'world-model' | 'memory-steward';
  name: string;
  output: string;
  provider: string;
  latencyMs: number;
};

export type AgiCoreResult = UnifiedSwarmResult & {
  cognitiveLenses: CognitiveLens[];
  verifier: { provider: string; latencyMs: number };
};

const LENSES: Array<Pick<CognitiveLens, 'id' | 'name'> & { mission: string }> = [
  {
    id: 'repository-intelligence',
    name: 'Repository Intelligence',
    mission: 'Identify relevant open-source architectures, protocols, libraries and implementation patterns. Prefer maintained, secure, composable components. Use the Repository Intelligence Radar when supplied, but treat it as discovery evidence rather than permission to install or execute third-party code.',
  },
  {
    id: 'world-model',
    name: 'World Model',
    mission: 'Model entities, dependencies, temporal state, second-order effects, failure modes, uncertainty and what facts could change the recommendation.',
  },
  {
    id: 'memory-steward',
    name: 'Memory Steward',
    mission: 'Use supplied executive-memory anchors to preserve commitments, prior decisions and continuity. Treat memory as context, not unquestionable truth, and flag stale or uncertain assumptions.',
  },
];

function clip(value: unknown, max = 6000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function callReasoner(system: string, user: string, maxTokens = 1200) {
  const providers = getReasoningProviders();
  if (!providers.length) throw new Error('No reasoning provider configured for ELP AGI Core.');
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
          temperature: 0.15,
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
  throw new Error(`All AGI Core reasoning providers failed (${failures.join(', ') || 'unknown error'}).`);
}

async function memoryAnchors(profileId: string) {
  try {
    const ledger = await getExecutiveLedger(profileId);
    return ledger.items
      .filter((item) => item.status === 'active' || item.status === 'blocked')
      .slice(0, 24)
      .map((item) => `- [${item.primaryKind}] ${item.title}: ${clip(item.content, 500)}${item.note ? ` | Note: ${clip(item.note, 300)}` : ''}`)
      .join('\n');
  } catch {
    return '';
  }
}

export async function runAgiCore(args: {
  profileId: string;
  objective: string;
  context?: string;
  maxAgents?: number;
}): Promise<AgiCoreResult> {
  const objective = clip(args.objective, 3000);
  if (!objective) throw new Error('ELP AGI Core objective is required.');

  const [anchors, repositoryRadar] = await Promise.all([
    memoryAnchors(args.profileId),
    getRepositoryRadarSnapshot(args.profileId),
  ]);
  const radarContext = repositoryRadarToPrompt(repositoryRadar);
  const baseContext = [
    clip(args.context, 6000),
    anchors ? `EXECUTIVE MEMORY ANCHORS:\n${anchors}` : '',
    radarContext ? `LIVE REPOSITORY INTELLIGENCE:\n${radarContext}` : '',
  ].filter(Boolean).join('\n\n');

  const cognitiveLenses = await Promise.all(LENSES.map(async (lens): Promise<CognitiveLens> => {
    const result = await callReasoner(
      `You are ELP's ${lens.name}. ${lens.mission} You are advisory only. Never claim an external action was executed without direct tool evidence.`,
      `OBJECTIVE:\n${objective}\n\n${baseContext || 'No additional context supplied.'}\n\nReturn the highest-value analysis for the orchestrating swarm. Be concise, evidence-aware and explicit about uncertainty.`,
      900,
    );
    return { id: lens.id, name: lens.name, output: result.text, provider: result.provider, latencyMs: result.latencyMs };
  }));

  const lensContext = cognitiveLenses.map((lens) => `## ${lens.name}\n${lens.output}`).join('\n\n');
  const swarm = await runUnifiedAgentSwarm({
    objective,
    context: [baseContext, `ELP COGNITIVE LENSES:\n${lensContext}`].filter(Boolean).join('\n\n'),
    maxAgents: args.maxAgents ?? 8,
  });

  const verified = await callReasoner(
    'You are ELP Independent Verifier. Audit the candidate answer aggressively. Correct unsupported claims, hidden assumptions, fake completion claims, unsafe authority crossings and contradictions. Preserve useful detail. Never say ELP completed a real-world action unless direct execution evidence is present. Return the corrected final answer only.',
    `OBJECTIVE:\n${objective}\n\nCANDIDATE ANSWER:\n${swarm.synthesis}`,
    1900,
  );

  return {
    ...swarm,
    synthesis: verified.text,
    cognitiveLenses,
    verifier: { provider: verified.provider, latencyMs: verified.latencyMs },
  };
}
