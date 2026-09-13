import { createHash } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';

export type RelationshipMomentum = 'warming' | 'steady' | 'cooling' | 'stalled' | 'unknown';
export type RelationshipValue = 'critical' | 'high' | 'normal' | 'low';
export type RelationshipStatus = 'active' | 'watch' | 'inactive';

export type RelationshipRecord = {
  id: string;
  messageId: string;
  key: string;
  name: string;
  organization?: string;
  role?: string;
  email?: string;
  status: RelationshipStatus;
  strategicValue: RelationshipValue;
  momentum: RelationshipMomentum;
  lastInteractionAt?: string;
  nextInteractionAt?: string;
  interactionCount: number;
  topics: string[];
  openLoops: string[];
  promisesByUs: string[];
  promisesByThem: string[];
  leverage: string[];
  objections: string[];
  evidence: string[];
  nextBestAction?: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  note?: string;
};

export type RelationshipSnapshot = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  relationships: RelationshipRecord[];
  stats: {
    total: number;
    active: number;
    critical: number;
    high: number;
    warming: number;
    cooling: number;
    stalled: number;
    openLoops: number;
  };
  lastScan?: {
    runKey: string;
    generatedAt: string;
    summary: string;
    newCount: number;
    updatedCount: number;
  };
};

export type RelationshipUpsertInput = {
  name: string;
  organization?: string;
  role?: string;
  email?: string;
  status?: RelationshipStatus;
  strategicValue?: RelationshipValue;
  momentum?: RelationshipMomentum;
  lastInteractionAt?: string;
  nextInteractionAt?: string;
  interactionCount?: number;
  topics?: string[];
  openLoops?: string[];
  promisesByUs?: string[];
  promisesByThem?: string[];
  leverage?: string[];
  objections?: string[];
  evidence?: string[];
  nextBestAction?: string;
  confidence?: number;
  note?: string;
};

const MOMENTUM = new Set<RelationshipMomentum>(['warming', 'steady', 'cooling', 'stalled', 'unknown']);
const VALUES = new Set<RelationshipValue>(['critical', 'high', 'normal', 'low']);
const STATUSES = new Set<RelationshipStatus>(['active', 'watch', 'inactive']);
const valueRank: Record<RelationshipValue, number> = { critical: 4, high: 3, normal: 2, low: 1 };
const momentumRank: Record<RelationshipMomentum, number> = { stalled: 5, cooling: 4, warming: 3, steady: 2, unknown: 1 };

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt';
}

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9@.+]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function relationshipKey(input: { name: string; organization?: string; email?: string }) {
  const email = input.email?.trim().toLowerCase();
  const source = email || `${normalizeText(input.name)}|${normalizeText(input.organization || '')}`;
  return createHash('sha256').update(source).digest('hex').slice(0, 24);
}

async function getRelationshipSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({
    apiKey: process.env.HONCHO_API_KEY,
    workspaceId: workspaceId(),
    environment: 'production',
  });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`relationships-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadataStrings(metadata: Record<string, unknown>, key: string, max = 12) {
  const value = metadata[key];
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => clip(item, 500))
    .slice(0, max);
}

function metadataNumber(metadata: Record<string, unknown>, key: string, fallback = 0) {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeIso(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function parseRelationship(message: { id: string; content: string; createdAt: string; metadata: Record<string, unknown> }): RelationshipRecord | null {
  const metadata = message.metadata || {};
  if (metadata.jarbisRelationship !== true) return null;
  const name = metadataString(metadata, 'name');
  const key = metadataString(metadata, 'relationshipKey');
  if (!name || !key) return null;

  const statusRaw = metadataString(metadata, 'status') as RelationshipStatus | undefined;
  const valueRaw = metadataString(metadata, 'strategicValue') as RelationshipValue | undefined;
  const momentumRaw = metadataString(metadata, 'momentum') as RelationshipMomentum | undefined;
  const createdAt = metadataString(metadata, 'createdAt') || message.createdAt;
  const updatedAt = metadataString(metadata, 'updatedAt') || createdAt;
  const organization = metadataString(metadata, 'organization');
  const role = metadataString(metadata, 'role');
  const email = metadataString(metadata, 'email');
  const lastInteractionAt = safeIso(metadataString(metadata, 'lastInteractionAt'));
  const nextInteractionAt = safeIso(metadataString(metadata, 'nextInteractionAt'));
  const nextBestAction = metadataString(metadata, 'nextBestAction');
  const note = metadataString(metadata, 'note');

  return {
    id: message.id,
    messageId: message.id,
    key,
    name: clip(name, 140),
    ...(organization ? { organization: clip(organization, 140) } : {}),
    ...(role ? { role: clip(role, 140) } : {}),
    ...(email ? { email: clip(email, 180) } : {}),
    status: statusRaw && STATUSES.has(statusRaw) ? statusRaw : 'active',
    strategicValue: valueRaw && VALUES.has(valueRaw) ? valueRaw : 'normal',
    momentum: momentumRaw && MOMENTUM.has(momentumRaw) ? momentumRaw : 'unknown',
    ...(lastInteractionAt ? { lastInteractionAt } : {}),
    ...(nextInteractionAt ? { nextInteractionAt } : {}),
    interactionCount: Math.max(0, Math.round(metadataNumber(metadata, 'interactionCount', 0))),
    topics: metadataStrings(metadata, 'topics', 10),
    openLoops: metadataStrings(metadata, 'openLoops', 12),
    promisesByUs: metadataStrings(metadata, 'promisesByUs', 10),
    promisesByThem: metadataStrings(metadata, 'promisesByThem', 10),
    leverage: metadataStrings(metadata, 'leverage', 10),
    objections: metadataStrings(metadata, 'objections', 10),
    evidence: metadataStrings(metadata, 'evidence', 10),
    ...(nextBestAction ? { nextBestAction: clip(nextBestAction, 800) } : {}),
    confidence: Math.max(0, Math.min(1, metadataNumber(metadata, 'confidence', 0.5))),
    createdAt,
    updatedAt,
    ...(note ? { note: clip(note, 1200) } : {}),
  };
}

function parseScanEvent(message: { createdAt: string; metadata: Record<string, unknown> }) {
  const metadata = message.metadata || {};
  if (metadata.jarbisRelationshipScan !== true) return null;
  const runKey = metadataString(metadata, 'runKey');
  if (!runKey) return null;
  return {
    runKey,
    generatedAt: metadataString(metadata, 'generatedAt') || message.createdAt,
    summary: metadataString(metadata, 'summary') || '',
    newCount: Math.max(0, Math.round(metadataNumber(metadata, 'newCount', 0))),
    updatedCount: Math.max(0, Math.round(metadataNumber(metadata, 'updatedCount', 0))),
  };
}

function combineUnique(previous: string[], incoming: string[] | undefined, max = 12) {
  if (!incoming?.length) return previous.slice(0, max);
  const seen = new Set<string>();
  const combined: string[] = [];
  for (const value of [...incoming, ...previous]) {
    const clean = clip(value, 500);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    combined.push(clean);
    if (combined.length >= max) break;
  }
  return combined;
}

function stats(records: RelationshipRecord[]) {
  const active = records.filter((record) => record.status !== 'inactive');
  return {
    total: records.length,
    active: active.length,
    critical: active.filter((record) => record.strategicValue === 'critical').length,
    high: active.filter((record) => record.strategicValue === 'high').length,
    warming: active.filter((record) => record.momentum === 'warming').length,
    cooling: active.filter((record) => record.momentum === 'cooling').length,
    stalled: active.filter((record) => record.momentum === 'stalled').length,
    openLoops: active.reduce((sum, record) => sum + record.openLoops.length, 0),
  };
}

export async function getRelationshipSnapshot(profileId: string): Promise<RelationshipSnapshot> {
  if (!process.env.HONCHO_API_KEY) {
    return {
      configured: false,
      available: false,
      generatedAt: new Date().toISOString(),
      relationships: [],
      stats: { total: 0, active: 0, critical: 0, high: 0, warming: 0, cooling: 0, stalled: 0, openLoops: 0 },
    };
  }
  try {
    const handles = await getRelationshipSession(profileId);
    if (!handles) throw new Error('Relationship memory is unavailable.');
    const page = await handles.session.messages({ size: 100, reverse: true });
    const relationships = page.items
      .map((message) => parseRelationship(message))
      .filter((record): record is RelationshipRecord => Boolean(record))
      .sort((a, b) => {
        const statusA = a.status === 'active' ? 2 : a.status === 'watch' ? 1 : 0;
        const statusB = b.status === 'active' ? 2 : b.status === 'watch' ? 1 : 0;
        return statusB - statusA || valueRank[b.strategicValue] - valueRank[a.strategicValue] || momentumRank[b.momentum] - momentumRank[a.momentum] || b.updatedAt.localeCompare(a.updatedAt);
      });
    const lastScan = page.items.map((message) => parseScanEvent(message)).find(Boolean) || undefined;
    return {
      configured: true,
      available: Boolean(relationships.length || lastScan),
      generatedAt: new Date().toISOString(),
      relationships,
      stats: stats(relationships),
      ...(lastScan ? { lastScan } : {}),
    };
  } catch (error) {
    console.error('JARBIS relationship snapshot failed', error);
    return {
      configured: true,
      available: false,
      generatedAt: new Date().toISOString(),
      relationships: [],
      stats: { total: 0, active: 0, critical: 0, high: 0, warming: 0, cooling: 0, stalled: 0, openLoops: 0 },
    };
  }
}

export async function upsertRelationship(profileId: string, input: RelationshipUpsertInput) {
  const name = clip(input.name || '', 140);
  if (!name) throw new Error('Relationship name is required.');
  const handles = await getRelationshipSession(profileId);
  if (!handles) throw new Error('Relationship memory is unavailable.');
  const key = relationshipKey({ name, organization: input.organization, email: input.email });
  const page = await handles.session.messages({ size: 100, reverse: true });
  const existingMessage = page.items.find((message) => message.metadata?.jarbisRelationship === true && message.metadata?.relationshipKey === key);
  const existing = existingMessage ? parseRelationship(existingMessage) : null;
  const now = new Date().toISOString();
  const organization = input.organization?.trim() ? clip(input.organization, 140) : existing?.organization;
  const role = input.role?.trim() ? clip(input.role, 140) : existing?.role;
  const email = input.email?.trim() ? clip(input.email.toLowerCase(), 180) : existing?.email;
  const status = input.status && STATUSES.has(input.status) ? input.status : existing?.status || 'active';
  const strategicValue = input.strategicValue && VALUES.has(input.strategicValue) ? input.strategicValue : existing?.strategicValue || 'normal';
  const momentum = input.momentum && MOMENTUM.has(input.momentum) ? input.momentum : existing?.momentum || 'unknown';
  const lastInteractionAt = safeIso(input.lastInteractionAt) || existing?.lastInteractionAt;
  const nextInteractionAt = safeIso(input.nextInteractionAt) || existing?.nextInteractionAt;
  const interactionCount = Math.max(existing?.interactionCount || 0, Math.round(input.interactionCount || 0));
  const confidence = Math.max(existing?.confidence || 0, Math.max(0, Math.min(1, input.confidence ?? 0.5)));
  const topics = combineUnique(existing?.topics || [], input.topics, 10);
  const openLoops = combineUnique(existing?.openLoops || [], input.openLoops, 12);
  const promisesByUs = combineUnique(existing?.promisesByUs || [], input.promisesByUs, 10);
  const promisesByThem = combineUnique(existing?.promisesByThem || [], input.promisesByThem, 10);
  const leverage = combineUnique(existing?.leverage || [], input.leverage, 10);
  const objections = combineUnique(existing?.objections || [], input.objections, 10);
  const evidence = combineUnique(existing?.evidence || [], input.evidence, 10);
  const nextBestAction = input.nextBestAction?.trim() ? clip(input.nextBestAction, 800) : existing?.nextBestAction;
  const note = input.note?.trim() ? clip(input.note, 1200) : existing?.note;
  const metadata = {
    jarbisRelationship: true,
    recordVersion: 1,
    relationshipKey: key,
    name,
    status,
    strategicValue,
    momentum,
    interactionCount,
    confidence,
    topics,
    openLoops,
    promisesByUs,
    promisesByThem,
    leverage,
    objections,
    evidence,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    ...(organization ? { organization } : {}),
    ...(role ? { role } : {}),
    ...(email ? { email } : {}),
    ...(lastInteractionAt ? { lastInteractionAt } : {}),
    ...(nextInteractionAt ? { nextInteractionAt } : {}),
    ...(nextBestAction ? { nextBestAction } : {}),
    ...(note ? { note } : {}),
  };

  if (existingMessage) {
    await handles.session.updateMessage(existingMessage.id, metadata);
    return { id: existingMessage.id, key, created: false };
  }

  const created = await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[RELATIONSHIP] ${now}\n${name}${organization ? ` — ${organization}` : ''}`,
    metadata,
  }]);
  return { id: created[0]?.id || null, key, created: true };
}

export async function updateRelationship(profileId: string, messageId: string, patch: {
  status?: RelationshipStatus;
  strategicValue?: RelationshipValue;
  momentum?: RelationshipMomentum;
  nextBestAction?: string | null;
  note?: string | null;
}) {
  const handles = await getRelationshipSession(profileId);
  if (!handles) throw new Error('Relationship memory is unavailable.');
  const message = await handles.session.getMessage(messageId);
  if (message.metadata?.jarbisRelationship !== true) throw new Error('The target message is not a relationship dossier.');
  const metadata: Record<string, unknown> = { ...message.metadata, updatedAt: new Date().toISOString() };
  if (patch.status !== undefined) {
    if (!STATUSES.has(patch.status)) throw new Error('Invalid relationship status.');
    metadata.status = patch.status;
  }
  if (patch.strategicValue !== undefined) {
    if (!VALUES.has(patch.strategicValue)) throw new Error('Invalid strategic value.');
    metadata.strategicValue = patch.strategicValue;
  }
  if (patch.momentum !== undefined) {
    if (!MOMENTUM.has(patch.momentum)) throw new Error('Invalid relationship momentum.');
    metadata.momentum = patch.momentum;
  }
  if (patch.nextBestAction !== undefined) {
    if (patch.nextBestAction === null || !patch.nextBestAction.trim()) delete metadata.nextBestAction;
    else metadata.nextBestAction = clip(patch.nextBestAction, 800);
  }
  if (patch.note !== undefined) {
    if (patch.note === null || !patch.note.trim()) delete metadata.note;
    else metadata.note = clip(patch.note, 1200);
  }
  const updated = await handles.session.updateMessage(messageId, metadata);
  return updated.id;
}

export async function recordRelationshipScan(profileId: string, input: {
  runKey: string;
  summary: string;
  newCount: number;
  updatedCount: number;
}) {
  const handles = await getRelationshipSession(profileId);
  if (!handles) throw new Error('Relationship memory is unavailable.');
  const generatedAt = new Date().toISOString();
  await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[RELATIONSHIP_SCAN] ${generatedAt}\n${clip(input.summary, 5000)}`,
    metadata: {
      jarbisRelationshipScan: true,
      runKey: clip(input.runKey, 160),
      generatedAt,
      summary: clip(input.summary, 5000),
      newCount: Math.max(0, Math.round(input.newCount)),
      updatedCount: Math.max(0, Math.round(input.updatedCount)),
    },
  }]);
  return generatedAt;
}

export async function hasCompletedRelationshipRun(profileId: string, runKey: string) {
  if (!process.env.HONCHO_API_KEY) return false;
  const handles = await getRelationshipSession(profileId);
  if (!handles) return false;
  const page = await handles.session.messages({ size: 40, reverse: true });
  return page.items.some((message) => message.metadata?.jarbisRelationshipScan === true && message.metadata?.runKey === runKey);
}

export function relationshipSnapshotToPrompt(snapshot: RelationshipSnapshot) {
  const active = snapshot.relationships
    .filter((record) => record.status !== 'inactive' && (record.strategicValue === 'critical' || record.strategicValue === 'high' || record.openLoops.length || record.momentum === 'cooling' || record.momentum === 'stalled'))
    .slice(0, 12);
  if (!active.length) return '';
  const rows = active.map((record) => {
    const flags = [record.strategicValue.toUpperCase(), record.momentum.toUpperCase(), record.openLoops.length ? `${record.openLoops.length} OPEN LOOP${record.openLoops.length === 1 ? '' : 'S'}` : ''].filter(Boolean);
    return `- ${record.name}${record.organization ? ` — ${record.organization}` : ''} | ${flags.join(', ')}${record.nextBestAction ? ` | next: ${record.nextBestAction}` : ''}`;
  });
  return [`Relationship intelligence: ${snapshot.stats.active} active relationships; ${snapshot.stats.cooling} cooling; ${snapshot.stats.stalled} stalled; ${snapshot.stats.openLoops} open loops.`, ...rows].join('\n');
}
