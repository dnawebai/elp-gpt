import { Honcho } from '@honcho-ai/sdk';
import { listHonchoMessages } from '@/lib/honcho-pagination';

export type PasskeyCredentialRecord = {
  id: string;
  principalId: string;
  label: string;
  publicKey: string;
  counter: number;
  transports: string[];
  credentialDeviceType?: string;
  credentialBackedUp?: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }

async function sessionFor(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`passkeys-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function parseRecord(message: { metadata?: Record<string, unknown> }): PasskeyCredentialRecord | null {
  if (message.metadata?.elpPasskeyCredential !== true || typeof message.metadata.passkeyJson !== 'string') return null;
  try {
    const record = JSON.parse(message.metadata.passkeyJson) as PasskeyCredentialRecord;
    if (!record?.id || !record.principalId || !record.publicKey || !record.createdAt) return null;
    return { ...record, transports: Array.isArray(record.transports) ? record.transports.filter((item): item is string => typeof item === 'string') : [], counter: Number.isFinite(record.counter) ? Math.max(0, Math.floor(record.counter)) : 0 };
  } catch { return null; }
}

async function append(profileId: string, record: PasskeyCredentialRecord, actor: 'user' | 'elp' = 'elp') {
  const handles = await sessionFor(profileId);
  if (!handles) throw new Error('Passkey storage is unavailable.');
  const peer = actor === 'user' ? handles.user : handles.elp;
  await handles.session.addMessages([{
    peerId: peer.id,
    content: `[PASSKEY] ${record.label}: ${record.revokedAt ? 'revoked' : 'active'}`,
    metadata: { elpPasskeyCredential: true, recordVersion: 1, credentialId: record.id, principalId: record.principalId, passkeyJson: JSON.stringify(record) },
  }]);
  return record;
}

export async function listPasskeys(profileId: string, principalId?: string) {
  const handles = await sessionFor(profileId);
  if (!handles) return [] as PasskeyCredentialRecord[];
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true });
  const map = new Map<string, PasskeyCredentialRecord>();
  for (const message of messages) {
    const record = parseRecord(message);
    if (!record || map.has(record.id)) continue;
    map.set(record.id, record);
  }
  return [...map.values()]
    .filter((record) => !principalId || record.principalId === principalId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listActivePasskeys(profileId: string, principalId: string) {
  return (await listPasskeys(profileId, principalId)).filter((record) => !record.revokedAt);
}

export async function savePasskey(profileId: string, input: Omit<PasskeyCredentialRecord, 'createdAt' | 'updatedAt'>) {
  const now = new Date().toISOString();
  const existing = (await listPasskeys(profileId, input.principalId)).find((item) => item.id === input.id && !item.revokedAt);
  if (existing) throw new Error('This passkey is already registered.');
  return append(profileId, { ...input, createdAt: now, updatedAt: now }, 'user');
}

export async function updatePasskeyUsage(profileId: string, principalId: string, credentialId: string, counter: number) {
  const current = (await listPasskeys(profileId, principalId)).find((item) => item.id === credentialId);
  if (!current || current.revokedAt) throw new Error('Passkey is not active.');
  const now = new Date().toISOString();
  return append(profileId, { ...current, counter: Math.max(current.counter, Math.floor(counter)), lastUsedAt: now, updatedAt: now });
}

export async function revokePasskey(profileId: string, principalId: string, credentialId: string) {
  const current = (await listPasskeys(profileId, principalId)).find((item) => item.id === credentialId);
  if (!current) throw new Error('Passkey not found.');
  if (current.revokedAt) return current;
  const now = new Date().toISOString();
  return append(profileId, { ...current, revokedAt: now, updatedAt: now }, 'user');
}
