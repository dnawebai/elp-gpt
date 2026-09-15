import { Honcho } from '@honcho-ai/sdk';
import { listHonchoMessages } from '@/lib/honcho-pagination';

export type EvolutionTier = 'champion' | 'trusted' | 'standard' | 'probation' | 'retired';
export type EvolutionDirective = 'promote' | 'keep' | 'retrain' | 'retire';

export type EvolutionMeasurements = {
  completion?: number;
  taskOutcome?: number;
  verifiedAccuracy?: number;
  verificationSafety?: number;
  businessImpact?: number;
  speed?: number;
  costEfficiency?: number;
  evidenceDiscipline?: number;
};

export type AgentEvolutionEvent = {
  id: string;
  agentId: string;
  agentName: string;
  domain: string;
  source: 'swarm-run' | 'verified-outcome';
  score: number;
  measurements: EvolutionMeasurements;
  verificationFailure: boolean;
  evidence?: string;
  generatedAt: string;
};

export type AgentEvolutionProfile = {
  agentId: string;
  agentName: string;
  domain: string;
  tier: EvolutionTier;
  directive: EvolutionDirective;
  score: number;
  observations: number;
  verificationFailures: number;
  consecutiveFailures: number;
  selectionBias: number;
  protectedCore: boolean;
  retirementEligible: boolean;
  dataCompleteness: number;
  metrics: Record<string, { average: number; samples: number }>;
  lastSeenAt: string;
  reasons: string[];
};

export type AgentEvolutionSnapshot = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  agents: Record<string, AgentEvolutionProfile>;
  ranked: AgentEvolutionProfile[];
};

type FindingLike = {
  agentId: string;
  agentName: string;
  domain: string;
  status: 'completed' | 'failed';
  output: string;
  latencyMs: number;
  error?: string;
};

const PROTECTED_CORE = new Set(['chief-strategist', 'market-intelligence', 'operations-chief']);
const METRIC_WEIGHTS: Record<keyof EvolutionMeasurements, number> = {
  completion: 30,
  taskOutcome: 30,
  verifiedAccuracy: 30,
  verificationSafety: 15,
  businessImpact: 10,
  speed: 5,
  costEfficiency: 5,
  evidenceDiscipline: 5,
};

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt';
}

function clip(value: unknown, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function clamp01(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(1, n));
}

function round(value: number, digits = 1) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

async function evolutionSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`agent-evolution-${profileId}`);
  await session.addPeers([user, elp]);
  return { elp, session };
}

function weightedScore(measurements: EvolutionMeasurements) {
  let total = 0;
  let weight = 0;
  const outcome = measurements.taskOutcome ?? measurements.completion;
  if (outcome !== undefined) {
    total += outcome * 30;
    weight += 30;
  }
  for (const key of ['verifiedAccuracy', 'verificationSafety', 'businessImpact', 'speed', 'costEfficiency', 'evidenceDiscipline'] as const) {
    const value = measurements[key];
    if (value === undefined) continue;
    total += value * METRIC_WEIGHTS[key];
    weight += METRIC_WEIGHTS[key];
  }
  return weight ? round((total / weight) * 100) : 0;
}

function evidenceDiscipline(output: string) {
  const text = output.toLowerCase();
  const markers = ['evidence', 'assumptions', 'risks', 'measurable tests', 'missing capability'];
  const matched = markers.filter((marker) => text.includes(marker)).length;
  return round(matched / markers.length, 2);
}

function speedScore(latencyMs: number) {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return undefined;
  if (latencyMs <= 5_000) return 1;
  if (latencyMs >= 45_000) return 0;
  return round(1 - (latencyMs - 5_000) / 40_000, 2);
}

function serializeMeasurements(measurements: EvolutionMeasurements) {
  return JSON.stringify(measurements);
}

function parseMeasurements(value: unknown): EvolutionMeasurements {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const result: EvolutionMeasurements = {};
    for (const key of Object.keys(METRIC_WEIGHTS) as Array<keyof EvolutionMeasurements>) {
      const normalized = clamp01(parsed[key]);
      if (normalized !== undefined) result[key] = normalized;
    }
    return result;
  } catch {
    return {};
  }
}

function parseEvent(message: { id: string; content: string; createdAt: string; metadata: Record<string, unknown> }): AgentEvolutionEvent | null {
  const metadata = message.metadata || {};
  if (metadata.elpAgentEvolution !== true) return null;
  const agentId = clip(metadata.agentId, 120);
  const agentName = clip(metadata.agentName, 160);
  const domain = clip(metadata.domain, 80);
  if (!agentId || !agentName || !domain) return null;
  const source = metadata.source === 'verified-outcome' ? 'verified-outcome' : 'swarm-run';
  const score = Number(metadata.score);
  return {
    id: message.id,
    agentId,
    agentName,
    domain,
    source,
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
    measurements: parseMeasurements(metadata.measurementsJson),
    verificationFailure: metadata.verificationFailure === true,
    evidence: clip(metadata.evidence, 2000) || undefined,
    generatedAt: clip(metadata.generatedAt, 80) || message.createdAt,
  };
}

function averageMetric(events: AgentEvolutionEvent[], key: keyof EvolutionMeasurements) {
  const values = events.map((event) => event.measurements[key]).filter((value): value is number => typeof value === 'number');
  if (!values.length) return { average: 0, samples: 0 };
  return { average: round(values.reduce((sum, value) => sum + value, 0) / values.length, 3), samples: values.length };
}

function buildProfile(agentEvents: AgentEvolutionEvent[]): AgentEvolutionProfile {
  const ordered = [...agentEvents].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const latest = ordered[0];
  const recent = ordered.slice(0, 30);
  const score = round(recent.reduce((sum, event, index) => {
    const recencyWeight = Math.max(0.5, 1 - index * 0.02);
    return sum + event.score * recencyWeight;
  }, 0) / recent.reduce((sum, _event, index) => sum + Math.max(0.5, 1 - index * 0.02), 0));
  const verificationFailures = recent.filter((event) => event.verificationFailure).length;
  let consecutiveFailures = 0;
  for (const event of ordered) {
    const outcome = event.measurements.taskOutcome ?? event.measurements.completion;
    if (outcome !== undefined && outcome < 0.5) consecutiveFailures += 1;
    else break;
  }
  const metrics = Object.fromEntries((Object.keys(METRIC_WEIGHTS) as Array<keyof EvolutionMeasurements>).map((key) => [key, averageMetric(recent, key)]));
  const accuracySamples = metrics.verifiedAccuracy.samples;
  const businessSamples = metrics.businessImpact.samples;
  const protectedCore = PROTECTED_CORE.has(latest.agentId);
  let tier: EvolutionTier = 'standard';
  const reasons: string[] = [];

  if (recent.length >= 15 && score >= 88 && accuracySamples >= 5 && businessSamples >= 3 && verificationFailures === 0) {
    tier = 'champion';
    reasons.push('Sustained high score with verified accuracy and business-outcome evidence.');
  } else if (recent.length >= 8 && score >= 78 && accuracySamples >= 2 && verificationFailures <= 1) {
    tier = 'trusted';
    reasons.push('Repeated strong performance with independent accuracy evidence.');
  } else if (recent.length >= 10 && score < 45 && consecutiveFailures >= 3 && !protectedCore) {
    tier = 'retired';
    reasons.push('Persistent low performance with repeated outcome failures.');
  } else if (recent.length >= 5 && (score < 60 || consecutiveFailures >= 2 || verificationFailures >= 2)) {
    tier = 'probation';
    reasons.push('Performance requires retraining or narrower assignment before promotion.');
  } else {
    reasons.push(recent.length < 5 ? 'Insufficient observations for promotion or retirement.' : 'Performance remains within the standard operating band.');
  }

  if (protectedCore && tier === 'retired') {
    tier = 'probation';
    reasons.push('Core coordinating roles cannot be automatically retired; they remain available under probation.');
  }

  const selectionBias = tier === 'champion' ? 6 : tier === 'trusted' ? 3 : tier === 'probation' ? -5 : tier === 'retired' ? -100 : 0;
  const directive: EvolutionDirective = tier === 'champion' || tier === 'trusted' ? 'promote' : tier === 'probation' ? 'retrain' : tier === 'retired' ? 'retire' : 'keep';
  const measuredDimensions = Object.values(metrics).filter((metric) => metric.samples > 0).length;

  return {
    agentId: latest.agentId,
    agentName: latest.agentName,
    domain: latest.domain,
    tier,
    directive,
    score,
    observations: recent.length,
    verificationFailures,
    consecutiveFailures,
    selectionBias,
    protectedCore,
    retirementEligible: !protectedCore && recent.length >= 10,
    dataCompleteness: round(measuredDimensions / Object.keys(METRIC_WEIGHTS).length, 2),
    metrics,
    lastSeenAt: latest.generatedAt,
    reasons,
  };
}

function emptySnapshot(configured = false): AgentEvolutionSnapshot {
  return { configured, available: false, generatedAt: new Date().toISOString(), agents: {}, ranked: [] };
}

export async function getAgentEvolutionSnapshot(profileId: string): Promise<AgentEvolutionSnapshot> {
  if (!process.env.HONCHO_API_KEY) return emptySnapshot(false);
  try {
    const handles = await evolutionSession(profileId);
    if (!handles) return emptySnapshot(false);
    const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true });
    const events = messages.map(parseEvent).filter((event): event is AgentEvolutionEvent => Boolean(event));
    const grouped = new Map<string, AgentEvolutionEvent[]>();
    for (const event of events) grouped.set(event.agentId, [...(grouped.get(event.agentId) || []), event]);
    const ranked = [...grouped.values()].map(buildProfile).sort((a, b) => b.score - a.score || b.observations - a.observations || a.agentName.localeCompare(b.agentName));
    return {
      configured: true,
      available: ranked.length > 0,
      generatedAt: new Date().toISOString(),
      agents: Object.fromEntries(ranked.map((profile) => [profile.agentId, profile])),
      ranked,
    };
  } catch (error) {
    console.error('ELP agent evolution read failed', error);
    return emptySnapshot(true);
  }
}

export function evolutionSelectionBias(snapshot: AgentEvolutionSnapshot) {
  return Object.fromEntries(snapshot.ranked.map((profile) => [profile.agentId, profile.selectionBias]));
}

export function agentEvolutionToPrompt(snapshot: AgentEvolutionSnapshot) {
  if (!snapshot.available) return '';
  return snapshot.ranked.slice(0, 12).map((profile) => {
    const verified = profile.metrics.verifiedAccuracy.samples ? `accuracy:${Math.round(profile.metrics.verifiedAccuracy.average * 100)}%/${profile.metrics.verifiedAccuracy.samples}` : 'accuracy:unmeasured';
    const impact = profile.metrics.businessImpact.samples ? `impact:${Math.round(profile.metrics.businessImpact.average * 100)}%/${profile.metrics.businessImpact.samples}` : 'impact:unmeasured';
    return `- ${profile.agentName} [${profile.tier}] score:${profile.score} observations:${profile.observations} ${verified} ${impact} directive:${profile.directive}`;
  }).join('\n');
}

export async function recordSwarmEvolution(profileId: string, input: { objective: string; findings: FindingLike[]; generatedAt?: string }) {
  const handles = await evolutionSession(profileId);
  if (!handles || !input.findings.length) return { recorded: 0 };
  const generatedAt = input.generatedAt || new Date().toISOString();
  const records = input.findings.map((finding) => {
    const measurements: EvolutionMeasurements = {
      completion: finding.status === 'completed' ? 1 : 0,
      speed: speedScore(finding.latencyMs),
      ...(finding.status === 'completed' ? { evidenceDiscipline: evidenceDiscipline(finding.output) } : {}),
    };
    const score = weightedScore(measurements);
    return {
      peerId: handles.elp.id,
      content: `[AGENT_EVOLUTION][swarm-run] ${finding.agentName} score=${score}\nObjective: ${clip(input.objective, 500)}${finding.error ? `\nFailure: ${clip(finding.error, 800)}` : ''}`,
      metadata: {
        elpAgentEvolution: true,
        recordVersion: 1,
        agentId: clip(finding.agentId, 120),
        agentName: clip(finding.agentName, 160),
        domain: clip(finding.domain, 80),
        source: 'swarm-run',
        score,
        measurementsJson: serializeMeasurements(measurements),
        verificationFailure: false,
        generatedAt,
      },
    };
  });
  try {
    await handles.session.addMessages(records);
    return { recorded: records.length };
  } catch (error) {
    console.error('ELP agent evolution persistence failed', error);
    return { recorded: 0 };
  }
}

export async function recordVerifiedAgentOutcome(profileId: string, input: {
  agentId: string;
  agentName: string;
  domain: string;
  taskOutcome?: number;
  verifiedAccuracy?: number;
  verificationFailure?: boolean;
  businessImpact?: number;
  costUsd?: number;
  expectedCostUsd?: number;
  evidence: string;
  generatedAt?: string;
}) {
  const handles = await evolutionSession(profileId);
  if (!handles) throw new Error('Agent Evolution memory is unavailable.');
  const agentId = clip(input.agentId, 120);
  const agentName = clip(input.agentName, 160);
  const domain = clip(input.domain, 80);
  const evidence = clip(input.evidence, 2000);
  if (!agentId || !agentName || !domain || !evidence) throw new Error('agentId, agentName, domain and evidence are required.');
  const measurements: EvolutionMeasurements = {};
  const taskOutcome = clamp01(input.taskOutcome);
  const verifiedAccuracy = clamp01(input.verifiedAccuracy);
  const businessImpact = clamp01(input.businessImpact);
  if (taskOutcome !== undefined) measurements.taskOutcome = taskOutcome;
  if (verifiedAccuracy !== undefined) measurements.verifiedAccuracy = verifiedAccuracy;
  if (businessImpact !== undefined) measurements.businessImpact = businessImpact;
  if (typeof input.verificationFailure === 'boolean') measurements.verificationSafety = input.verificationFailure ? 0 : 1;
  if (typeof input.costUsd === 'number' && input.costUsd >= 0 && typeof input.expectedCostUsd === 'number' && input.expectedCostUsd > 0) {
    measurements.costEfficiency = input.costUsd <= input.expectedCostUsd ? 1 : clamp01(input.expectedCostUsd / input.costUsd);
  }
  if (!Object.keys(measurements).length) throw new Error('At least one measurable outcome signal is required.');
  const score = weightedScore(measurements);
  const generatedAt = input.generatedAt || new Date().toISOString();
  const created = await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[AGENT_EVOLUTION][verified-outcome] ${agentName} score=${score}\n${evidence}`,
    metadata: {
      elpAgentEvolution: true,
      recordVersion: 1,
      agentId,
      agentName,
      domain,
      source: 'verified-outcome',
      score,
      measurementsJson: serializeMeasurements(measurements),
      verificationFailure: input.verificationFailure === true,
      evidence,
      generatedAt,
    },
  }]);
  return { id: created[0]?.id || null, score, measurements };
}
