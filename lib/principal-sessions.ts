import { createHash, randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { listHonchoMessages } from '@/lib/honcho-pagination';

export type SessionAssurance = 'standard' | 'step_up';
export type PrincipalSessionStatus = 'active' | 'revoked';
export type PrincipalSessionRecord = {
  id: string;
  principalId: string;
  tokenVersion: string;
  assurance: SessionAssurance;
  status: PrincipalSessionStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastSeenAt?: string;
  clientFingerprint?: string;
  revokedAt?: string;
  revokedByPrincipalId?: string;
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
async function sessionFor(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`principal-sessions-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function parse(message: { metadata: Record<string, unknown> }): PrincipalSessionRecord | null {
  const metadata = message.metadata || {};
  if (metadata.elpPrincipalSession !== true || typeof metadata.sessionJson !== 'string') return null;
  try {
    const item = JSON.parse(metadata.sessionJson) as PrincipalSessionRecord;
    if (!item?.id || !item.principalId || !item.tokenVersion || !['active','revoked'].includes(item.status) || !['standard','step_up'].includes(item.assurance)) return null;
    return item;
  } catch { return null; }
}

function fingerprint(value?: string) {
  const text = (value || '').trim();
  if (!text) return undefined;
  return createHash('sha256').update(text).digest('hex').slice(0, 24);
}

async function write(profileId: string, item: PrincipalSessionRecord, peer: 'user' | 'elp' = 'elp') {
  const handles = await sessionFor(profileId);
  if (!handles) throw new Error('Principal session registry is unavailable.');
  await handles.session.addMessages([{
    peerId: peer === 'user' ? handles.user.id : handles.elp.id,
    content: `[PRINCIPAL_SESSION] ${item.principalId} ${item.status} ${item.assurance}`,
    metadata: { elpPrincipalSession: true, recordVersion: 1, sessionId: item.id, principalId: item.principalId, sessionJson: JSON.stringify(item) },
  }]);
  return item;
}

export async function listPrincipalSessions(profileId: string, limit = 250) {
  const handles = await sessionFor(profileId);
  if (!handles) return [] as PrincipalSessionRecord[];
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true });
  const latest = new Map<string, PrincipalSessionRecord>();
  for (const message of messages) {
    const item = parse(message);
    if (item && !latest.has(item.id)) latest.set(item.id, item);
  }
  return [...latest.values()].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.max(1, Math.min(1000, limit)));
}

export async function createPrincipalSession(args: {
  profileId: string;
  principalId: string;
  assurance?: SessionAssurance;
  ttlSeconds?: number;
  clientDescriptor?: string;
}) {
  const now = new Date();
  const ttl = Math.max(900, Math.min(args.ttlSeconds || 60 * 60 * 12, 60 * 60 * 24 * 30));
  const item: PrincipalSessionRecord = {
    id: randomUUID(),
    principalId: args.principalId,
    tokenVersion: randomUUID(),
    assurance: args.assurance || 'standard',
    status: 'active',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
    lastSeenAt: now.toISOString(),
    clientFingerprint: fingerprint(args.clientDescriptor),
  };
  await write(args.profileId, item, 'user');
  return item;
}

export async function getPrincipalSession(profileId: string, sessionId: string) {
  const sessions = await listPrincipalSessions(profileId, 1000);
  return sessions.find((item) => item.id === sessionId) || null;
}

export async function validatePrincipalSession(args: {
  profileId: string;
  principalId: string;
  sessionId: string;
  tokenVersion: string;
  requiredAssurance?: SessionAssurance;
}) {
  const item = await getPrincipalSession(args.profileId, args.sessionId);
  if (!item || item.status !== 'active' || item.principalId !== args.principalId || item.tokenVersion !== args.tokenVersion) return null;
  if (Date.parse(item.expiresAt) <= Date.now()) return null;
  if (args.requiredAssurance === 'step_up' && item.assurance !== 'step_up') return null;
  return item;
}

export async function touchPrincipalSession(profileId: string, sessionId: string) {
  const item = await getPrincipalSession(profileId, sessionId);
  if (!item || item.status !== 'active') return item;
  const last = item.lastSeenAt ? Date.parse(item.lastSeenAt) : 0;
  if (Date.now() - last < 5 * 60_000) return item;
  return write(profileId, { ...item, lastSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

export async function revokePrincipalSession(profileId: string, sessionId: string, revokedByPrincipalId: string) {
  const item = await getPrincipalSession(profileId, sessionId);
  if (!item) throw new Error('Principal session not found.');
  if (item.status === 'revoked') return item;
  const now = new Date().toISOString();
  return write(profileId, { ...item, status: 'revoked', tokenVersion: randomUUID(), revokedAt: now, revokedByPrincipalId, updatedAt: now });
}

export async function revokeAllPrincipalSessions(profileId: string, principalId: string, revokedByPrincipalId: string) {
  const sessions = (await listPrincipalSessions(profileId, 1000)).filter((item) => item.principalId === principalId && item.status === 'active');
  const results: PrincipalSessionRecord[] = [];
  for (const item of sessions) results.push(await revokePrincipalSession(profileId, item.id, revokedByPrincipalId));
  return results;
}

export async function consumePrincipalAccessNonce(profileId: string, principalId: string, nonce: string) {
  const handles = await sessionFor(profileId);
  if (!handles) throw new Error('Principal session registry is unavailable.');
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true });
  const alreadyUsed = messages.some((message) => message.metadata?.elpPrincipalAccessConsumed === true && message.metadata?.accessNonce === nonce);
  if (alreadyUsed) return false;
  await handles.session.addMessages([{
    peerId: handles.user.id,
    content: `[PRINCIPAL_ACCESS_CONSUMED] ${principalId}`,
    metadata: { elpPrincipalAccessConsumed: true, recordVersion: 1, principalId, accessNonce: nonce, consumedAt: new Date().toISOString() },
  }]);
  return true;
}

export function sessionIsFreshStepUp(item: PrincipalSessionRecord | null, maxAgeMinutes = 10) {
  if (!item || item.status !== 'active' || item.assurance !== 'step_up') return false;
  const created = Date.parse(item.createdAt);
  return Number.isFinite(created) && Date.now() - created <= Math.max(1, maxAgeMinutes) * 60_000;
}
