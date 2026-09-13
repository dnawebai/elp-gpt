import { randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';

export type PersonalConstitution = {
  principles: string[];
  hardConstraints: string[];
  preferences: string[];
  approvalPolicyNotes: string[];
  updatedAt: string;
};

export type CommandersIntent = {
  objective: string;
  purpose: string;
  endState: string;
  priorities: string[];
  constraints: string[];
  nonGoals: string[];
  timeHorizon?: string;
  updatedAt: string;
};

export type EvidenceStatus = 'supported' | 'contradicted' | 'unverified';
export type EvidenceSourceType = 'user' | 'internal' | 'connector' | 'external';

export type EvidenceRecord = {
  id: string;
  claim: string;
  evidence: string;
  source?: string;
  sourceType: EvidenceSourceType;
  status: EvidenceStatus;
  confidence: number;
  relatedIds: string[];
  createdAt: string;
  verifiedAt?: string;
};

export type CognitivePolicySnapshot = {
  configured: boolean;
  constitution: PersonalConstitution | null;
  intent: CommandersIntent | null;
  evidence: EvidenceRecord[];
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
function clip(value: string, max: number) { const clean = value.trim(); return clean.length <= max ? clean : `${clean.slice(0, max)}…`; }
function text(value: unknown, max = 1200) { return typeof value === 'string' && value.trim() ? clip(value, max) : ''; }
function strings(value: unknown, max = 20, itemMax = 1000) {
  if (!Array.isArray(value)) return [] as string[];
  return value.flatMap((item) => { const clean = text(item, itemMax); return clean ? [clean] : []; }).slice(0, max);
}
function confidence(value: unknown, fallback = 0.5) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`cognitive-policy-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function parseConstitution(metadata: Record<string, unknown>): PersonalConstitution | null {
  if (metadata.jarbisPersonalConstitution !== true || typeof metadata.payloadJson !== 'string') return null;
  try {
    const raw = JSON.parse(metadata.payloadJson) as Record<string, unknown>;
    return {
      principles: strings(raw.principles, 24),
      hardConstraints: strings(raw.hardConstraints, 24),
      preferences: strings(raw.preferences, 24),
      approvalPolicyNotes: strings(raw.approvalPolicyNotes, 24),
      updatedAt: text(raw.updatedAt, 80) || new Date().toISOString(),
    };
  } catch { return null; }
}

function parseIntent(metadata: Record<string, unknown>): CommandersIntent | null {
  if (metadata.jarbisCommandersIntent !== true || typeof metadata.payloadJson !== 'string') return null;
  try {
    const raw = JSON.parse(metadata.payloadJson) as Record<string, unknown>;
    const objective = text(raw.objective, 2400);
    const purpose = text(raw.purpose, 2400);
    const endState = text(raw.endState, 2400);
    if (!objective && !purpose && !endState) return null;
    const timeHorizon = text(raw.timeHorizon, 300);
    return {
      objective,
      purpose,
      endState,
      priorities: strings(raw.priorities, 20),
      constraints: strings(raw.constraints, 20),
      nonGoals: strings(raw.nonGoals, 20),
      ...(timeHorizon ? { timeHorizon } : {}),
      updatedAt: text(raw.updatedAt, 80) || new Date().toISOString(),
    };
  } catch { return null; }
}

function parseEvidence(message: { id: string; createdAt: string; metadata: Record<string, unknown> }): EvidenceRecord | null {
  const metadata = message.metadata || {};
  if (metadata.jarbisEvidenceRecord !== true) return null;
  const claim = text(metadata.claim, 2400);
  const evidence = text(metadata.evidence, 5000);
  if (!claim || !evidence) return null;
  const sourceTypeRaw = text(metadata.sourceType, 30) as EvidenceSourceType;
  const statusRaw = text(metadata.evidenceStatus, 30) as EvidenceStatus;
  const source = text(metadata.source, 1200);
  const verifiedAt = text(metadata.verifiedAt, 80);
  let relatedIds: string[] = [];
  if (typeof metadata.relatedIdsJson === 'string') {
    try { relatedIds = strings(JSON.parse(metadata.relatedIdsJson), 20, 200); } catch {}
  }
  return {
    id: text(metadata.evidenceId, 100) || message.id,
    claim,
    evidence,
    ...(source ? { source } : {}),
    sourceType: ['user', 'internal', 'connector', 'external'].includes(sourceTypeRaw) ? sourceTypeRaw : 'internal',
    status: ['supported', 'contradicted', 'unverified'].includes(statusRaw) ? statusRaw : 'unverified',
    confidence: confidence(metadata.confidence),
    relatedIds,
    createdAt: text(metadata.createdAt, 80) || message.createdAt,
    ...(verifiedAt ? { verifiedAt } : {}),
  };
}

export async function getCognitivePolicySnapshot(profileId: string): Promise<CognitivePolicySnapshot> {
  const handles = await getSession(profileId);
  if (!handles) return { configured: false, constitution: null, intent: null, evidence: [] };
  try {
    const page = await handles.session.messages({ size: 100, reverse: true });
    const constitution = page.items.map((item) => parseConstitution(item.metadata || {})).find(Boolean) || null;
    const intent = page.items.map((item) => parseIntent(item.metadata || {})).find(Boolean) || null;
    const evidence = page.items.map((item) => parseEvidence(item)).filter((item): item is EvidenceRecord => Boolean(item)).slice(0, 60);
    return { configured: true, constitution, intent, evidence };
  } catch (error) {
    console.error('ELP cognitive policy snapshot failed', error);
    return { configured: true, constitution: null, intent: null, evidence: [] };
  }
}

export async function savePersonalConstitution(profileId: string, input: Partial<Omit<PersonalConstitution, 'updatedAt'>>) {
  const handles = await getSession(profileId);
  if (!handles) throw new Error('Cognitive policy memory is unavailable.');
  const constitution: PersonalConstitution = {
    principles: strings(input.principles, 24),
    hardConstraints: strings(input.hardConstraints, 24),
    preferences: strings(input.preferences, 24),
    approvalPolicyNotes: strings(input.approvalPolicyNotes, 24),
    updatedAt: new Date().toISOString(),
  };
  await handles.session.addMessages([{ peerId: handles.user.id, content: `[PERSONAL_CONSTITUTION] ${constitution.updatedAt}`, metadata: { jarbisPersonalConstitution: true, recordVersion: 1, payloadJson: JSON.stringify(constitution) } }]);
  return constitution;
}

export async function saveCommandersIntent(profileId: string, input: Partial<Omit<CommandersIntent, 'updatedAt'>>) {
  const handles = await getSession(profileId);
  if (!handles) throw new Error('Cognitive policy memory is unavailable.');
  const intent: CommandersIntent = {
    objective: text(input.objective, 2400),
    purpose: text(input.purpose, 2400),
    endState: text(input.endState, 2400),
    priorities: strings(input.priorities, 20),
    constraints: strings(input.constraints, 20),
    nonGoals: strings(input.nonGoals, 20),
    ...(text(input.timeHorizon, 300) ? { timeHorizon: text(input.timeHorizon, 300) } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (!intent.objective && !intent.purpose && !intent.endState) throw new Error('Commander’s Intent needs an objective, purpose, or end state.');
  await handles.session.addMessages([{ peerId: handles.user.id, content: `[COMMANDERS_INTENT] ${intent.updatedAt}\n${intent.objective || intent.endState || intent.purpose}`, metadata: { jarbisCommandersIntent: true, recordVersion: 1, payloadJson: JSON.stringify(intent) } }]);
  return intent;
}

export async function addEvidenceRecord(profileId: string, input: {
  claim: string;
  evidence: string;
  source?: string;
  sourceType?: EvidenceSourceType;
  status?: EvidenceStatus;
  confidence?: number;
  relatedIds?: string[];
  verifiedAt?: string;
}) {
  const handles = await getSession(profileId);
  if (!handles) throw new Error('Evidence memory is unavailable.');
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const record: EvidenceRecord = {
    id,
    claim: text(input.claim, 2400),
    evidence: text(input.evidence, 5000),
    ...(text(input.source, 1200) ? { source: text(input.source, 1200) } : {}),
    sourceType: input.sourceType || 'internal',
    status: input.status || 'unverified',
    confidence: confidence(input.confidence, 0.5),
    relatedIds: strings(input.relatedIds, 20, 200),
    createdAt,
    ...(text(input.verifiedAt, 80) ? { verifiedAt: text(input.verifiedAt, 80) } : {}),
  };
  if (!record.claim || !record.evidence) throw new Error('Evidence requires both a claim and supporting/contradicting material.');
  await handles.session.addMessages([{ peerId: handles.elp.id, content: `[EVIDENCE][${record.status.toUpperCase()}] ${record.claim}\n${record.evidence}`, metadata: { jarbisEvidenceRecord: true, recordVersion: 1, evidenceId: id, claim: record.claim, evidence: record.evidence, source: record.source || '', sourceType: record.sourceType, evidenceStatus: record.status, confidence: record.confidence, relatedIdsJson: JSON.stringify(record.relatedIds), createdAt, verifiedAt: record.verifiedAt || '' } }]);
  return record;
}

export function cognitivePolicyToPrompt(snapshot: CognitivePolicySnapshot) {
  const sections: string[] = [];
  if (snapshot.constitution) {
    const c = snapshot.constitution;
    sections.push([
      'PERSONAL CONSTITUTION — explicit user policy; never infer additional values:',
      c.principles.length ? `Principles: ${c.principles.join(' | ')}` : '',
      c.hardConstraints.length ? `Hard constraints: ${c.hardConstraints.join(' | ')}` : '',
      c.preferences.length ? `Preferences: ${c.preferences.join(' | ')}` : '',
      c.approvalPolicyNotes.length ? `Approval notes: ${c.approvalPolicyNotes.join(' | ')}` : '',
    ].filter(Boolean).join('\n'));
  }
  if (snapshot.intent) {
    const i = snapshot.intent;
    sections.push([
      'COMMANDER’S INTENT:',
      i.objective ? `Objective: ${i.objective}` : '',
      i.purpose ? `Purpose: ${i.purpose}` : '',
      i.endState ? `End state: ${i.endState}` : '',
      i.priorities.length ? `Priorities: ${i.priorities.join(' | ')}` : '',
      i.constraints.length ? `Constraints: ${i.constraints.join(' | ')}` : '',
      i.nonGoals.length ? `Non-goals: ${i.nonGoals.join(' | ')}` : '',
      i.timeHorizon ? `Time horizon: ${i.timeHorizon}` : '',
    ].filter(Boolean).join('\n'));
  }
  const evidence = snapshot.evidence.filter((item) => item.status !== 'unverified' || item.confidence >= 0.7).slice(0, 12);
  if (evidence.length) sections.push(`EVIDENCE REGISTRY:\n${evidence.map((item) => `- [${item.status.toUpperCase()} ${Math.round(item.confidence * 100)}%] ${item.claim}: ${item.evidence}`).join('\n')}`);
  return sections.join('\n\n');
}
