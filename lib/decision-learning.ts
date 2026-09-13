import { randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { addEvidenceRecord } from '@/lib/cognitive-policy';
import { getReasoningProviders } from '@/lib/elp';
import { runOperatorMission } from '@/lib/operator';
import { listStrategicSimulations, type StrategicSimulation } from '@/lib/strategic-simulation';

export type DecisionOutcomeStatus = 'pending' | 'on_track' | 'mixed' | 'succeeded' | 'failed' | 'abandoned';
export type AssumptionStatus = 'open' | 'supported' | 'contradicted' | 'unknown';

export type DecisionAssumption = {
  id: string;
  text: string;
  status: AssumptionStatus;
  confidence: number;
  evidence: string[];
};

export type DecisionOutcomeRecord = {
  id: string;
  messageId?: string;
  simulationId: string;
  ledgerId?: string;
  decision: string;
  selectedOptionLabel: string;
  status: DecisionOutcomeStatus;
  outcomeScore: number;
  forecastAccuracy: number;
  confidence: number;
  summary: string;
  evidence: string[];
  assumptions: DecisionAssumption[];
  lessons: string[];
  nextActions: string[];
  createdAt: string;
  updatedAt: string;
  lastEvaluatedAt?: string;
  nextReviewAt?: string;
  evaluationCount: number;
};

export type StrategyCalibration = {
  sampleSize: number;
  resolvedDecisions: number;
  averageForecastAccuracy: number;
  averageOutcomeScore: number;
  assumptionHitRate: number;
  dimensions: {
    strategicFit: number;
    expectedValue: number;
    downsideRisk: number;
    reversibility: number;
    executionComplexity: number;
    evidenceStrength: number;
    relationshipImpact: number;
  };
  recurringLessons: string[];
  generatedAt: string;
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
function clip(value: string, max: number) { const clean = value.trim(); return clean.length <= max ? clean : `${clean.slice(0, max)}…`; }
function text(value: unknown, max = 1200) { return typeof value === 'string' && value.trim() ? clip(value, max) : ''; }
function strings(value: unknown, max = 20, itemMax = 1200) {
  if (!Array.isArray(value)) return [] as string[];
  return value.flatMap((item) => { const clean = text(item, itemMax); return clean ? [clean] : []; }).slice(0, max);
}
function num(value: unknown, fallback = 0) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}
function score(value: unknown, fallback = 0) { return Math.max(0, Math.min(100, Math.round(num(value, fallback)))); }
function confidence(value: unknown, fallback = 0.5) { return Math.max(0, Math.min(1, num(value, fallback))); }
function status(value: unknown): DecisionOutcomeStatus {
  return ['pending', 'on_track', 'mixed', 'succeeded', 'failed', 'abandoned'].includes(String(value)) ? value as DecisionOutcomeStatus : 'pending';
}
function assumptionStatus(value: unknown): AssumptionStatus {
  return ['open', 'supported', 'contradicted', 'unknown'].includes(String(value)) ? value as AssumptionStatus : 'unknown';
}

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`decision-outcomes-${profileId}`);
  await session.addPeers([elp]);
  return { elp, session };
}

function parseRecord(message: { id: string; createdAt: string; metadata: Record<string, unknown> }): DecisionOutcomeRecord | null {
  const metadata = message.metadata || {};
  if (metadata.jarbisDecisionOutcome !== true || typeof metadata.recordJson !== 'string') return null;
  try {
    const parsed = JSON.parse(metadata.recordJson) as DecisionOutcomeRecord;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.simulationId !== 'string') return null;
    return { ...parsed, messageId: message.id };
  } catch { return null; }
}

async function saveRecord(profileId: string, record: DecisionOutcomeRecord) {
  const handles = await getSession(profileId);
  if (!handles) return record;
  const metadata = { jarbisDecisionOutcome: true, recordVersion: 1, outcomeId: record.id, simulationId: record.simulationId, updatedAt: record.updatedAt, recordJson: JSON.stringify(record) };
  if (record.messageId) {
    await handles.session.updateMessage(record.messageId, metadata);
    return record;
  }
  const created = await handles.session.addMessages([{ peerId: handles.elp.id, content: `[DECISION_OUTCOME][${record.status.toUpperCase()}] ${record.decision}\n${record.summary}`, metadata }]);
  return { ...record, ...(created[0]?.id ? { messageId: created[0].id } : {}) };
}

export async function listDecisionOutcomes(profileId: string) {
  const handles = await getSession(profileId);
  if (!handles) return [] as DecisionOutcomeRecord[];
  const page = await handles.session.messages({ size: 100, reverse: true });
  return page.items.map((item) => parseRecord(item)).filter((item): item is DecisionOutcomeRecord => Boolean(item));
}

function initialAssumptions(simulation: StrategicSimulation): DecisionAssumption[] {
  return simulation.recommendation.assumptionsToVerify.slice(0, 12).map((item) => ({ id: randomUUID(), text: item, status: 'open' as const, confidence: 0.35, evidence: [] }));
}

export async function ensureDecisionOutcomes(profileId: string) {
  const [simulations, existing] = await Promise.all([listStrategicSimulations(profileId), listDecisionOutcomes(profileId)]);
  const bySimulation = new Set(existing.map((item) => item.simulationId));
  const created: DecisionOutcomeRecord[] = [];
  for (const simulation of simulations.filter((item) => item.promotedLedgerId && !bySimulation.has(item.id)).slice(0, 40)) {
    const now = new Date();
    const record: DecisionOutcomeRecord = {
      id: randomUUID(),
      simulationId: simulation.id,
      ledgerId: simulation.promotedLedgerId,
      decision: simulation.decision,
      selectedOptionLabel: simulation.recommendation.selectedOptionLabel,
      status: 'pending',
      outcomeScore: 0,
      forecastAccuracy: 0,
      confidence: 0.25,
      summary: 'Decision promoted; outcome evidence has not yet been evaluated.',
      evidence: [],
      assumptions: initialAssumptions(simulation),
      lessons: [],
      nextActions: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextReviewAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      evaluationCount: 0,
    };
    created.push(await saveRecord(profileId, record));
  }
  return [...existing, ...created];
}

async function readOnlyEvidence(profileId: string, sessionId: string, simulation: StrategicSimulation) {
  const mission = await runOperatorMission({
    objective: `READ-ONLY DECISION OUTCOME REVIEW. Inspect available connected evidence relevant to the decision below. Use only read/search/list/get/fetch capabilities. Do not draft, send, create, update, delete, publish, purchase, deploy, book, cancel, RSVP, change permissions, or otherwise mutate an external system. Report concrete evidence, dates, replies, commitments fulfilled or missed, calendar evidence, measurable progress, and missing evidence. Distinguish observed facts from inference.\n\nDecision: ${simulation.decision}\nSelected option: ${simulation.recommendation.selectedOptionLabel}\nRecommendation: ${simulation.recommendation.recommendation}\nExpected/base case: ${simulation.options.find((item) => item.id === simulation.recommendation.selectedOptionId)?.baseCase || 'not recorded'}\nWorst case: ${simulation.options.find((item) => item.id === simulation.recommendation.selectedOptionId)?.worstCase || 'not recorded'}\nAssumptions: ${simulation.recommendation.assumptionsToVerify.join(' | ') || 'none recorded'}`,
    profileId,
    sessionId,
    state: null,
  });
  if (mission.status === 'approval_required') return `Evidence review stopped because a write action was proposed. No write was approved or executed. Summary: ${mission.summary}`;
  return mission.summary || mission.question || 'No connected evidence was returned.';
}

async function reasonJson(system: string, user: string, maxTokens = 2200) {
  const providers = getReasoningProviders();
  if (!providers.length) throw new Error('No reasoning provider configured for decision learning.');
  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
        body: JSON.stringify({ model: provider.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.1, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(provider.name === 'hermes' ? 30_000 : 55_000),
      });
      if (!response.ok) { failures.push(`${provider.name}:${response.status}`); continue; }
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const raw = data.choices?.[0]?.message?.content?.trim() || '';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const start = clean.indexOf('{'); const end = clean.lastIndexOf('}');
      if (start < 0 || end <= start) { failures.push(`${provider.name}:invalid-json`); continue; }
      return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
    } catch (error) { failures.push(`${provider.name}:${error instanceof Error ? error.name : 'error'}`); }
  }
  throw new Error(`Decision outcome reasoning failed (${failures.join(', ') || 'unknown error'}).`);
}

export async function evaluateDecisionOutcome(profileId: string, simulationId: string, sessionId: string) {
  const [simulations, records] = await Promise.all([listStrategicSimulations(profileId), ensureDecisionOutcomes(profileId)]);
  const simulation = simulations.find((item) => item.id === simulationId);
  if (!simulation) throw new Error('Strategic simulation not found.');
  let record = records.find((item) => item.simulationId === simulationId);
  if (!record) throw new Error('Decision outcome record could not be created.');
  if (['succeeded', 'failed', 'abandoned'].includes(record.status)) return record;

  const connectedEvidence = await readOnlyEvidence(profileId, `${sessionId}-evidence`, simulation);
  const selected = simulation.options.find((item) => item.id === simulation.recommendation.selectedOptionId) || simulation.options[0];
  const system = `You are ELP Decision Outcome Auditor. Compare what was predicted with observed evidence. Activity is not success. A sent email, meeting booked, or task completed is only execution evidence unless the decision objective was actually achieved. Preserve uncertainty. Do not infer intent. Return exactly one JSON object: {"status":"pending|on_track|mixed|succeeded|failed|abandoned","outcomeScore":0,"forecastAccuracy":0,"confidence":0.0,"summary":"","evidence":[],"assumptions":[{"text":"","status":"open|supported|contradicted|unknown","confidence":0.0,"evidence":[]}],"lessons":[],"nextActions":[]}. outcomeScore measures realized quality 0-100. forecastAccuracy measures how closely the simulation matched observed reality 0-100.`;
  const user = `DECISION\n${simulation.decision}\n\nSELECTED OPTION\n${selected.label}: ${selected.description}\n\nPREDICTED BASE CASE\n${selected.baseCase}\n\nPREDICTED BEST CASE\n${selected.bestCase}\n\nPREDICTED WORST CASE\n${selected.worstCase}\n\nPRE-MORTEM\n${simulation.recommendation.preMortem.join(' | ')}\n\nASSUMPTIONS TO VERIFY\n${simulation.recommendation.assumptionsToVerify.join(' | ')}\n\nCONNECTED READ-ONLY EVIDENCE\n${clip(connectedEvidence, 14000)}\n\nPRIOR OUTCOME RECORD\n${clip(JSON.stringify(record), 9000)}`;
  const raw = await reasonJson(system, user, 2400);
  const assumptionsRaw = Array.isArray(raw.assumptions) ? raw.assumptions : [];
  const assumptions: DecisionAssumption[] = assumptionsRaw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const assumptionText = text(obj.text, 1200);
    if (!assumptionText) return [];
    const prior = record!.assumptions.find((entry) => entry.text.toLowerCase() === assumptionText.toLowerCase());
    return [{ id: prior?.id || randomUUID(), text: assumptionText, status: assumptionStatus(obj.status), confidence: confidence(obj.confidence), evidence: strings(obj.evidence, 8, 1200) }];
  }).slice(0, 16);
  const now = new Date();
  const nextStatus = status(raw.status);
  record = {
    ...record,
    status: nextStatus,
    outcomeScore: score(raw.outcomeScore),
    forecastAccuracy: score(raw.forecastAccuracy),
    confidence: confidence(raw.confidence),
    summary: text(raw.summary, 4000) || record.summary,
    evidence: [...new Set([...record.evidence, ...strings(raw.evidence, 20, 1800)])].slice(0, 40),
    assumptions: assumptions.length ? assumptions : record.assumptions,
    lessons: [...new Set([...record.lessons, ...strings(raw.lessons, 16, 1600)])].slice(0, 30),
    nextActions: strings(raw.nextActions, 12, 1600),
    updatedAt: now.toISOString(),
    lastEvaluatedAt: now.toISOString(),
    nextReviewAt: ['succeeded', 'failed', 'abandoned'].includes(nextStatus) ? undefined : new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    evaluationCount: record.evaluationCount + 1,
  };
  const saved = await saveRecord(profileId, record);

  for (const assumption of saved.assumptions.filter((item) => item.status === 'supported' || item.status === 'contradicted').slice(0, 8)) {
    await addEvidenceRecord(profileId, {
      claim: assumption.text,
      evidence: assumption.evidence.join(' | ') || saved.summary,
      source: `decision-outcome:${saved.id}`,
      sourceType: 'internal',
      status: assumption.status === 'supported' ? 'supported' : 'contradicted',
      confidence: assumption.confidence,
      relatedIds: [simulation.id, saved.id],
      verifiedAt: now.toISOString(),
    }).catch(() => undefined);
  }
  return saved;
}

export async function evaluateDueDecisionOutcomes(profileId: string, sessionPrefix: string, limit = 4) {
  const records = await ensureDecisionOutcomes(profileId);
  const now = Date.now();
  const due = records.filter((item) => !['succeeded', 'failed', 'abandoned'].includes(item.status) && (!item.nextReviewAt || Date.parse(item.nextReviewAt) <= now)).slice(0, Math.max(1, Math.min(limit, 8)));
  const results: DecisionOutcomeRecord[] = [];
  for (const item of due) {
    try { results.push(await evaluateDecisionOutcome(profileId, item.simulationId, `${sessionPrefix}-${item.id}`)); }
    catch (error) { console.error('ELP decision outcome review failed', item.id, error); }
  }
  return results;
}

export async function getStrategyCalibration(profileId: string): Promise<StrategyCalibration> {
  const [records, simulations] = await Promise.all([listDecisionOutcomes(profileId), listStrategicSimulations(profileId)]);
  const resolved = records.filter((item) => ['succeeded', 'failed', 'abandoned', 'mixed'].includes(item.status) && item.evaluationCount > 0);
  const simulationById = new Map(simulations.map((item) => [item.id, item]));
  const avg = (values: number[], fallback = 50) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : fallback;
  const supported = resolved.flatMap((item) => item.assumptions).filter((item) => item.status === 'supported').length;
  const contradicted = resolved.flatMap((item) => item.assumptions).filter((item) => item.status === 'contradicted').length;
  const dimensions = { strategicFit: [] as number[], expectedValue: [] as number[], downsideRisk: [] as number[], reversibility: [] as number[], executionComplexity: [] as number[], evidenceStrength: [] as number[], relationshipImpact: [] as number[] };
  for (const record of resolved) {
    const simulation = simulationById.get(record.simulationId);
    const option = simulation?.options.find((item) => item.id === simulation.recommendation.selectedOptionId);
    if (!option) continue;
    const realized = record.outcomeScore;
    dimensions.strategicFit.push(100 - Math.abs(option.scorecard.strategicFit - realized));
    dimensions.expectedValue.push(100 - Math.abs(option.scorecard.expectedValue - realized));
    dimensions.downsideRisk.push(100 - Math.abs((100 - option.scorecard.downsideRisk) - realized));
    dimensions.reversibility.push(100 - Math.abs(option.scorecard.reversibility - realized));
    dimensions.executionComplexity.push(100 - Math.abs((100 - option.scorecard.executionComplexity) - realized));
    dimensions.evidenceStrength.push(100 - Math.abs(option.scorecard.evidenceStrength - record.forecastAccuracy));
    dimensions.relationshipImpact.push(100 - Math.abs(option.scorecard.relationshipImpact - realized));
  }
  const lessons = new Map<string, number>();
  for (const lesson of resolved.flatMap((item) => item.lessons)) {
    const key = lesson.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    if (key) lessons.set(lesson, (lessons.get(lesson) || 0) + 1);
  }
  return {
    sampleSize: records.length,
    resolvedDecisions: resolved.length,
    averageForecastAccuracy: avg(resolved.map((item) => item.forecastAccuracy), 0),
    averageOutcomeScore: avg(resolved.map((item) => item.outcomeScore), 0),
    assumptionHitRate: supported + contradicted ? Math.round((supported / (supported + contradicted)) * 100) : 0,
    dimensions: {
      strategicFit: avg(dimensions.strategicFit),
      expectedValue: avg(dimensions.expectedValue),
      downsideRisk: avg(dimensions.downsideRisk),
      reversibility: avg(dimensions.reversibility),
      executionComplexity: avg(dimensions.executionComplexity),
      evidenceStrength: avg(dimensions.evidenceStrength),
      relationshipImpact: avg(dimensions.relationshipImpact),
    },
    recurringLessons: [...lessons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([lesson]) => lesson),
    generatedAt: new Date().toISOString(),
  };
}
