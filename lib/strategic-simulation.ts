import { randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { getAnticipatorySnapshot, anticipatorySnapshotToPrompt } from '@/lib/anticipatory-chief-of-staff';
import { createExecutiveLedgerItem, getExecutiveLedger, executiveLedgerToPrompt } from '@/lib/executive-memory';
import { getReasoningProviders } from '@/lib/elp';
import { getRelationshipSnapshot, relationshipSnapshotToPrompt } from '@/lib/relationship-memory';
import { runShadowBoard, type ShadowBoardResult } from '@/lib/shadow-board';

export type SimulationScorecard = {
  strategicFit: number;
  expectedValue: number;
  downsideRisk: number;
  reversibility: number;
  executionComplexity: number;
  evidenceStrength: number;
  relationshipImpact: number;
  decisionScore: number;
};

export type SimulatedOption = {
  id: string;
  label: string;
  description: string;
  expectedOutcome: string;
  bestCase: string;
  baseCase: string;
  worstCase: string;
  upside: string[];
  downside: string[];
  failureModes: string[];
  secondOrderEffects: string[];
  dependencies: string[];
  relationshipEffects: string[];
  irreversibleMoves: string[];
  evidenceGaps: string[];
  reversalTriggers: string[];
  scorecard: SimulationScorecard;
};

export type StrategicSimulationRecommendation = {
  selectedOptionId: string;
  selectedOptionLabel: string;
  recommendation: string;
  why: string[];
  materialDissent: string[];
  assumptionsToVerify: string[];
  preMortem: string[];
  reversalTriggers: string[];
  nextBestAction: string;
  confidence: number;
};

export type StrategicSimulation = {
  id: string;
  messageId?: string;
  decision: string;
  objective?: string;
  context?: string;
  generatedAt: string;
  options: SimulatedOption[];
  recommendation: StrategicSimulationRecommendation;
  shadowBoard: ShadowBoardResult;
  contextSummary: string;
  provider: 'hermes' | 'together';
  promotedLedgerId?: string;
};

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt';
}

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function text(value: unknown, max = 1200) {
  return typeof value === 'string' && value.trim() ? clip(value, max) : '';
}

function strings(value: unknown, max = 12, itemMax = 900) {
  if (!Array.isArray(value)) return [] as string[];
  return value.flatMap((item) => {
    const clean = text(item, itemMax);
    return clean ? [clean] : [];
  }).slice(0, max);
}

function score(value: unknown, fallback = 50) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : fallback;
}

function confidence(value: unknown, fallback = 0.5) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function decisionScore(input: Omit<SimulationScorecard, 'decisionScore'>) {
  const result =
    input.strategicFit * 0.22 +
    input.expectedValue * 0.25 +
    input.reversibility * 0.15 +
    input.evidenceStrength * 0.15 +
    input.relationshipImpact * 0.08 +
    (100 - input.downsideRisk) * 0.10 +
    (100 - input.executionComplexity) * 0.05;
  return Math.max(0, Math.min(100, Math.round(result)));
}

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`strategic-simulations-${profileId}`);
  await session.addPeers([user, elp]);
  return { elp, session };
}

async function reasonJson(system: string, user: string, maxTokens = 2200) {
  const providers = getReasoningProviders();
  if (!providers.length) throw new Error('No reasoning provider is configured for strategic simulation.');
  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0.15,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(provider.name === 'hermes' ? 30_000 : 55_000),
      });
      if (!response.ok) {
        failures.push(`${provider.name}:${response.status}`);
        continue;
      }
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const raw = data.choices?.[0]?.message?.content?.trim() || '';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start < 0 || end <= start) {
        failures.push(`${provider.name}:invalid-json`);
        continue;
      }
      return { value: JSON.parse(clean.slice(start, end + 1)) as unknown, provider: provider.name };
    } catch (error) {
      failures.push(`${provider.name}:${error instanceof Error ? error.name : 'error'}`);
    }
  }
  throw new Error(`Strategic simulation reasoning failed (${failures.join(', ') || 'unknown error'}).`);
}

async function generateOptions(decision: string, objective: string, context: string) {
  const system = `You are ELP Decision Architect. Generate distinct, decision-relevant courses of action without pretending certainty. Include the status quo / defer option when it is genuinely meaningful. Do not invent facts, prices, laws, commitments or market data. Return exactly one JSON object and no prose: {"options":[{"label":"short unique label","description":"specific course of action"}]}. Return 2-4 options.`;
  const response = await reasonJson(system, `DECISION\n${decision}\n\nOBJECTIVE\n${objective || 'Not specified.'}\n\nCONTEXT\n${context || 'No additional context.'}`, 900);
  const raw = response.value && typeof response.value === 'object' ? response.value as Record<string, unknown> : {};
  const options = Array.isArray(raw.options) ? raw.options.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const label = text(obj.label, 120);
    const description = text(obj.description, 1200);
    return label && description ? [{ label, description }] : [];
  }).slice(0, 4) : [];
  if (options.length < 2) throw new Error('The simulator could not derive at least two distinct courses of action.');
  return options;
}

function parseOption(value: unknown, fallback: { label: string; description: string }): SimulatedOption {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const scoreRaw = raw.scorecard && typeof raw.scorecard === 'object' ? raw.scorecard as Record<string, unknown> : {};
  const base = {
    strategicFit: score(scoreRaw.strategicFit),
    expectedValue: score(scoreRaw.expectedValue),
    downsideRisk: score(scoreRaw.downsideRisk),
    reversibility: score(scoreRaw.reversibility),
    executionComplexity: score(scoreRaw.executionComplexity),
    evidenceStrength: score(scoreRaw.evidenceStrength),
    relationshipImpact: score(scoreRaw.relationshipImpact),
  };
  return {
    id: randomUUID(),
    label: text(raw.label, 120) || fallback.label,
    description: text(raw.description, 1600) || fallback.description,
    expectedOutcome: text(raw.expectedOutcome, 1800),
    bestCase: text(raw.bestCase, 1600),
    baseCase: text(raw.baseCase, 1600),
    worstCase: text(raw.worstCase, 1600),
    upside: strings(raw.upside),
    downside: strings(raw.downside),
    failureModes: strings(raw.failureModes),
    secondOrderEffects: strings(raw.secondOrderEffects),
    dependencies: strings(raw.dependencies),
    relationshipEffects: strings(raw.relationshipEffects),
    irreversibleMoves: strings(raw.irreversibleMoves),
    evidenceGaps: strings(raw.evidenceGaps),
    reversalTriggers: strings(raw.reversalTriggers),
    scorecard: { ...base, decisionScore: decisionScore(base) },
  };
}

async function simulateOption(input: {
  decision: string;
  objective: string;
  option: { label: string; description: string };
  liveContext: string;
}) {
  const system = `You are ELP Counterfactual Simulator. Stress-test ONE proposed course of action under uncertainty. This is advisory analysis, not authorization to act. Never invent evidence. Separate what follows from supplied context from assumptions. Scores are 0-100: strategicFit higher is better; expectedValue higher is better; downsideRisk higher is worse; reversibility higher is better; executionComplexity higher is worse; evidenceStrength higher means the conclusion is better supported; relationshipImpact higher is better. Return exactly one JSON object and no prose with this schema: {"label":"","description":"","expectedOutcome":"","bestCase":"","baseCase":"","worstCase":"","upside":[],"downside":[],"failureModes":[],"secondOrderEffects":[],"dependencies":[],"relationshipEffects":[],"irreversibleMoves":[],"evidenceGaps":[],"reversalTriggers":[],"scorecard":{"strategicFit":0,"expectedValue":0,"downsideRisk":0,"reversibility":0,"executionComplexity":0,"evidenceStrength":0,"relationshipImpact":0}}. A pre-mortem failure mode should explain how this option could fail even if execution initially appears successful.`;
  const user = `DECISION\n${input.decision}\n\nOBJECTIVE\n${input.objective || 'Not specified.'}\n\nOPTION\n${input.option.label}: ${input.option.description}\n\nLIVE DECISION CONTEXT\n${input.liveContext}`;
  const response = await reasonJson(system, user, 2600);
  return { option: parseOption(response.value, input.option), provider: response.provider };
}

function compactOptions(options: SimulatedOption[]) {
  return options.map((option) => [
    `${option.label} (decision score ${option.scorecard.decisionScore}/100)`,
    `Description: ${option.description}`,
    `Base case: ${option.baseCase}`,
    `Worst case: ${option.worstCase}`,
    option.failureModes.length ? `Failure modes: ${option.failureModes.join(' | ')}` : '',
    option.dependencies.length ? `Dependencies: ${option.dependencies.join(' | ')}` : '',
    option.reversalTriggers.length ? `Reversal triggers: ${option.reversalTriggers.join(' | ')}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

function parseRecommendation(value: unknown, options: SimulatedOption[]): StrategicSimulationRecommendation {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const requestedId = text(raw.selectedOptionId, 100);
  const requestedLabel = text(raw.selectedOptionLabel, 120);
  const selected = options.find((option) => option.id === requestedId)
    || options.find((option) => option.label.toLowerCase() === requestedLabel.toLowerCase())
    || [...options].sort((a, b) => b.scorecard.decisionScore - a.scorecard.decisionScore)[0];
  return {
    selectedOptionId: selected.id,
    selectedOptionLabel: selected.label,
    recommendation: text(raw.recommendation, 3000) || `Prefer ${selected.label}, subject to the identified assumptions and reversal triggers.`,
    why: strings(raw.why, 8, 1200),
    materialDissent: strings(raw.materialDissent, 8, 1200),
    assumptionsToVerify: strings(raw.assumptionsToVerify, 10, 1200),
    preMortem: strings(raw.preMortem, 10, 1200),
    reversalTriggers: strings(raw.reversalTriggers, 10, 1200),
    nextBestAction: text(raw.nextBestAction, 1400),
    confidence: confidence(raw.confidence),
  };
}

async function persistSimulation(profileId: string, simulation: StrategicSimulation) {
  const handles = await getSession(profileId);
  if (!handles) return simulation;
  const stored = JSON.stringify(simulation);
  const created = await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[STRATEGIC_SIMULATION] ${simulation.generatedAt}\nDecision: ${simulation.decision}\nRecommendation: ${simulation.recommendation.selectedOptionLabel}\n${simulation.recommendation.recommendation}`,
    metadata: {
      jarbisStrategicSimulation: true,
      recordVersion: 1,
      simulationId: simulation.id,
      generatedAt: simulation.generatedAt,
      decision: clip(simulation.decision, 2000),
      selectedOptionLabel: simulation.recommendation.selectedOptionLabel,
      confidence: simulation.recommendation.confidence,
      simulationJson: clip(stored, 60_000),
    },
  }]);
  return { ...simulation, ...(created[0]?.id ? { messageId: created[0].id } : {}) };
}

function parseStored(message: { id: string; metadata: Record<string, unknown> }): StrategicSimulation | null {
  if (message.metadata?.jarbisStrategicSimulation !== true || typeof message.metadata.simulationJson !== 'string') return null;
  try {
    const parsed = JSON.parse(message.metadata.simulationJson) as StrategicSimulation;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.decision !== 'string' || !Array.isArray(parsed.options)) return null;
    const promotedLedgerId = typeof message.metadata.promotedLedgerId === 'string' ? message.metadata.promotedLedgerId : parsed.promotedLedgerId;
    return { ...parsed, messageId: message.id, ...(promotedLedgerId ? { promotedLedgerId } : {}) };
  } catch {
    return null;
  }
}

export async function listStrategicSimulations(profileId: string) {
  const handles = await getSession(profileId);
  if (!handles) return [] as StrategicSimulation[];
  const page = await handles.session.messages({ size: 60, reverse: true });
  return page.items.map((message) => parseStored(message)).filter((item): item is StrategicSimulation => Boolean(item));
}

export async function getStrategicSimulation(profileId: string, simulationId: string) {
  const simulations = await listStrategicSimulations(profileId);
  return simulations.find((item) => item.id === simulationId) || null;
}

export async function runStrategicSimulation(args: {
  decision: string;
  objective?: string;
  context?: string;
  options?: Array<{ label?: string; description: string }>;
  profileId: string;
  sessionId: string;
  persist?: boolean;
}): Promise<StrategicSimulation> {
  const decision = clip(args.decision, 5000);
  const objective = clip(args.objective || '', 3000);
  const context = clip(args.context || '', 6000);
  if (!decision) throw new Error('A decision to simulate is required.');

  const [ledger, relationships, anticipatory] = await Promise.all([
    getExecutiveLedger(args.profileId),
    getRelationshipSnapshot(args.profileId),
    getAnticipatorySnapshot(args.profileId),
  ]);
  const liveContext = clip([
    context ? `USER CONTEXT\n${context}` : '',
    executiveLedgerToPrompt(ledger),
    relationshipSnapshotToPrompt(relationships),
    anticipatorySnapshotToPrompt(anticipatory),
  ].filter(Boolean).join('\n\n'), 24_000);

  let rawOptions = (args.options || []).flatMap((option, index) => {
    const description = text(option.description, 1600);
    if (!description) return [];
    const label = text(option.label, 120) || `Option ${index + 1}`;
    return [{ label, description }];
  }).slice(0, 5);
  if (rawOptions.length < 2) rawOptions = await generateOptions(decision, objective, liveContext);

  const settled = await Promise.all(rawOptions.map((option) => simulateOption({ decision, objective, option, liveContext })));
  const options = settled.map((entry) => entry.option).sort((a, b) => b.scorecard.decisionScore - a.scorecard.decisionScore);
  const provider = settled[0]?.provider || 'together';

  const board = await runShadowBoard({
    question: `Decision: ${decision}\nObjective: ${objective || 'Not specified.'}\n\nCompare these courses of action and preserve material dissent:\n${compactOptions(options)}`,
    context: liveContext,
    profileId: args.profileId,
    sessionId: `${args.sessionId}-simulation-board`,
    persist: false,
  });

  const recommendationSystem = `You are ELP Strategic Simulation Chair. Select a recommended course of action only after considering the structured counterfactuals and the independent Shadow Board. The numeric score is evidence, not authority. Preserve material dissent, unknowns and reversibility. Do not claim certainty or invent evidence. Return exactly one JSON object and no prose: {"selectedOptionLabel":"exact option label","recommendation":"clear recommendation","why":[],"materialDissent":[],"assumptionsToVerify":[],"preMortem":[],"reversalTriggers":[],"nextBestAction":"smallest useful next step before commitment","confidence":0.0}. Confidence is 0-1.`;
  const recommendationResponse = await reasonJson(
    recommendationSystem,
    `DECISION\n${decision}\n\nOBJECTIVE\n${objective || 'Not specified.'}\n\nCOUNTERFACTUAL OPTIONS\n${compactOptions(options)}\n\nSHADOW BOARD SYNTHESIS\n${clip(board.synthesis, 8000)}\n\nLIVE CONTEXT\n${liveContext}`,
    2200,
  );
  const recommendation = parseRecommendation(recommendationResponse.value, options);
  const generatedAt = new Date().toISOString();
  const simulation: StrategicSimulation = {
    id: randomUUID(),
    decision,
    ...(objective ? { objective } : {}),
    ...(context ? { context } : {}),
    generatedAt,
    options,
    recommendation,
    shadowBoard: board,
    contextSummary: clip(liveContext, 10_000),
    provider: recommendationResponse.provider || provider,
  };
  return args.persist === false ? simulation : persistSimulation(args.profileId, simulation);
}

export async function promoteStrategicSimulation(profileId: string, simulationId: string) {
  const handles = await getSession(profileId);
  if (!handles) throw new Error('Strategic simulation memory is unavailable.');
  const page = await handles.session.messages({ size: 60, reverse: true });
  const message = page.items.find((item) => item.metadata?.jarbisStrategicSimulation === true && item.metadata?.simulationId === simulationId);
  if (!message) throw new Error('Strategic simulation not found.');
  const simulation = parseStored(message);
  if (!simulation) throw new Error('Strategic simulation record is invalid.');
  if (simulation.promotedLedgerId) return { simulation, ledgerId: simulation.promotedLedgerId, alreadyPromoted: true };
  const ledgerId = await createExecutiveLedgerItem(profileId, {
    kind: 'decision',
    content: `[Strategic simulation: ${simulation.id}] ${simulation.decision}\nDecision: ${simulation.recommendation.selectedOptionLabel}. ${simulation.recommendation.recommendation}\nConfidence: ${Math.round(simulation.recommendation.confidence * 100)}%.\nReversal triggers: ${simulation.recommendation.reversalTriggers.join(' | ') || 'None recorded.'}`,
    priority: 'high',
  });
  if (!ledgerId) throw new Error('The decision could not be written to the Executive Ledger.');
  await handles.session.updateMessage(message.id, { ...message.metadata, promotedLedgerId: ledgerId, promotedAt: new Date().toISOString() });
  return { simulation: { ...simulation, promotedLedgerId: ledgerId }, ledgerId, alreadyPromoted: false };
}
