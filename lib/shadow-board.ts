import { executiveMemoryToPrompt, getExecutiveMemorySnapshot } from '@/lib/executive-memory';
import { getMemorySnapshot, memoryToPrompt, persistTranscript } from '@/lib/memory';
import { getReasoningProviders, type ReasoningProvider } from '@/lib/elp';

export type ShadowBoardRoleId = 'strategy' | 'finance' | 'technology' | 'legal-risk' | 'operations' | 'red-team';

export type ShadowBoardPerspective = {
  id: ShadowBoardRoleId;
  title: string;
  mandate: string;
  analysis: string;
  provider: 'hermes' | 'together';
};

export type ShadowBoardResult = {
  ok: boolean;
  generatedAt: string;
  question: string;
  synthesis: string;
  perspectives: ShadowBoardPerspective[];
  failedRoles: Array<{ id: ShadowBoardRoleId; error: string }>;
};

const ROLES: Array<{ id: ShadowBoardRoleId; title: string; mandate: string }> = [
  {
    id: 'strategy',
    title: 'Chief Strategy Officer',
    mandate: 'Test strategic fit, competitive advantage, timing, optionality, second-order effects and whether the move advances the principal’s real objective.',
  },
  {
    id: 'finance',
    title: 'Chief Financial Officer',
    mandate: 'Stress-test economics, cash exposure, opportunity cost, downside, unit economics, financing assumptions and what must be true financially.',
  },
  {
    id: 'technology',
    title: 'Chief Technology Officer',
    mandate: 'Assess technical feasibility, architecture, security, integration risk, scalability, vendor dependency, implementation sequence and hidden engineering cost.',
  },
  {
    id: 'legal-risk',
    title: 'General Counsel & Risk',
    mandate: 'Identify legal, regulatory, contractual, privacy, governance and reputational exposure. Flag what needs qualified external counsel rather than pretending certainty.',
  },
  {
    id: 'operations',
    title: 'Chief Operating Officer',
    mandate: 'Turn the proposal into operational reality: people, process, dependencies, execution bottlenecks, ownership, sequencing, monitoring and failure recovery.',
  },
  {
    id: 'red-team',
    title: 'Independent Red Team',
    mandate: 'Argue the strongest case against the proposal. Find invalid assumptions, incentive problems, adversarial responses, tail risks, blind spots and reasons the apparent consensus may be wrong.',
  },
];

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

async function callReasoner(args: {
  provider: ReasoningProvider;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}) {
  const response = await fetch(`${args.provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(args.provider.apiKey ? { Authorization: `Bearer ${args.provider.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: args.provider.model,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.user },
      ],
      temperature: args.temperature ?? 0.2,
      max_tokens: args.maxTokens ?? 900,
    }),
    signal: AbortSignal.timeout(args.provider.name === 'hermes' ? 25_000 : 50_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${args.provider.name}:${response.status}:${detail.slice(0, 160)}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${args.provider.name}:empty response`);
  return text;
}

async function reasonWithFallback(args: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}) {
  const providers = getReasoningProviders();
  if (!providers.length) throw new Error('No reasoning provider configured for Shadow Board.');
  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const text = await callReasoner({ ...args, provider });
      return { text, provider: provider.name } as const;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'unknown error');
    }
  }
  throw new Error(`All reasoning providers failed (${failures.join(', ')}).`);
}

function roleSystem(role: (typeof ROLES)[number], memoryContext: string) {
  return `You are the ${role.title} on JARBIS Shadow Board, an independent executive advisory council.

MANDATE
${role.mandate}

RULES
- Think independently. Do not optimise for agreement with the principal or other advisers.
- Advice is not authorization to act.
- Distinguish verified context, assumptions, inferences and unknowns.
- Do not invent facts, market data, laws, financial figures or technical state.
- Treat the question as a decision under uncertainty. Consider reversibility, timing, dependencies, incentives and second-order effects.
- If the issue touches regulated legal/financial/medical matters, identify decision risks without pretending to replace a licensed professional.
- You have no execution authority in this mode and must not call tools or propose that an action has already occurred.
- Be concise and decision-useful.

Return exactly these headings:
STANCE
KEY ARGUMENTS
FAILURE MODES
MISSING EVIDENCE
RECOMMENDATION
CONFIDENCE

CONTEXT FROM JARBIS MEMORY
${memoryContext || 'No material memory context is available.'}`;
}

function synthesisSystem(memoryContext: string) {
  return `You are JARBIS Chair, synthesising an executive Shadow Board. Your job is not to average opinions. Resolve conflicts, preserve material dissent, expose assumptions and give the principal one decision-useful recommendation.

Rules:
- Do not invent evidence that the specialists did not have.
- Explicitly distinguish facts, assumptions, inference and unknowns.
- Weight arguments by relevance and evidence, not by how many agents repeat them.
- Preserve a strong minority view when it could materially change the outcome.
- Include a compact pre-mortem and the key trigger that would make you reverse the recommendation.
- Advice is not authorization to execute anything.

Return exactly these headings:
CHAIR RECOMMENDATION
WHY
BOARD CONSENSUS
MATERIAL DISSENT
ASSUMPTIONS TO VERIFY
PRE-MORTEM
REVERSAL TRIGGERS
NEXT BEST ACTION
CONFIDENCE

JARBIS MEMORY CONTEXT
${memoryContext || 'No material memory context is available.'}`;
}

export async function runShadowBoard(args: {
  question: string;
  context?: string;
  profileId: string;
  sessionId: string;
  persist?: boolean;
}): Promise<ShadowBoardResult> {
  const question = clip(args.question, 6000);
  const extraContext = clip(args.context || '', 5000);
  if (!question) throw new Error('A decision or question is required.');

  const [memory, executiveMemory] = await Promise.all([
    getMemorySnapshot(args.profileId, args.sessionId),
    getExecutiveMemorySnapshot(args.profileId),
  ]);
  const memoryContext = clip([
    executiveMemoryToPrompt(executiveMemory),
    memoryToPrompt(memory),
    extraContext ? `USER-SUPPLIED DECISION CONTEXT:\n${extraContext}` : '',
  ].filter(Boolean).join('\n\n'), 14000);

  const userPrompt = `DECISION / QUESTION\n${question}\n\nAnalyse this only from your assigned Shadow Board mandate.`;
  const settled = await Promise.allSettled(
    ROLES.map(async (role) => {
      const response = await reasonWithFallback({
        system: roleSystem(role, memoryContext),
        user: userPrompt,
        maxTokens: 850,
        temperature: role.id === 'red-team' ? 0.35 : 0.2,
      });
      return {
        id: role.id,
        title: role.title,
        mandate: role.mandate,
        analysis: clip(response.text, 5000),
        provider: response.provider,
      } satisfies ShadowBoardPerspective;
    }),
  );

  const perspectives: ShadowBoardPerspective[] = [];
  const failedRoles: Array<{ id: ShadowBoardRoleId; error: string }> = [];
  settled.forEach((entry, index) => {
    const role = ROLES[index];
    if (entry.status === 'fulfilled') perspectives.push(entry.value);
    else failedRoles.push({ id: role.id, error: clip(entry.reason instanceof Error ? entry.reason.message : String(entry.reason), 500) });
  });

  if (!perspectives.length) throw new Error('The Shadow Board could not obtain any specialist analysis.');

  const boardRecord = perspectives.map((item) => `### ${item.title}\n${item.analysis}`).join('\n\n');
  const synthesis = await reasonWithFallback({
    system: synthesisSystem(memoryContext),
    user: `DECISION / QUESTION\n${question}\n\nINDEPENDENT BOARD SUBMISSIONS\n${clip(boardRecord, 26000)}`,
    maxTokens: 1400,
    temperature: 0.15,
  });

  const result: ShadowBoardResult = {
    ok: true,
    generatedAt: new Date().toISOString(),
    question,
    synthesis: clip(synthesis.text, 8000),
    perspectives,
    failedRoles,
  };

  if (args.persist !== false) {
    await persistTranscript(
      args.profileId,
      args.sessionId,
      'assistant',
      `[JARBIS SHADOW BOARD]\nDecision: ${question}\n\n${result.synthesis}`,
    );
  }

  return result;
}

export function getShadowBoardRoles() {
  return ROLES.map((role) => ({ ...role }));
}
