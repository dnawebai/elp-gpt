import { randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { listHonchoMessages } from '@/lib/honcho-pagination';

export type ProtectedBlock = {
  id: string;
  label: string;
  start: string;
  end: string;
  immovable: boolean;
  active: boolean;
  reason?: string;
  source: 'user' | 'elp';
  createdAt: string;
  updatedAt: string;
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
function clip(value: string, max: number) { const v = value.trim(); return v.length <= max ? v : `${v.slice(0, max)}…`; }
function validIso(value: unknown) { if (typeof value !== 'string') return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null; }

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`); const elp = await honcho.peer('elp'); const session = await honcho.session(`protected-blocks-${profileId}`); await session.addPeers([user, elp]); return { user, elp, session };
}

function parse(message: { id: string; createdAt: string; metadata: Record<string, unknown> }): ProtectedBlock | null {
  const m = message.metadata || {}; if (m.elpProtectedBlock !== true) return null;
  const start = validIso(m.start); const end = validIso(m.end); const label = typeof m.label === 'string' ? m.label.trim() : '';
  if (!start || !end || end <= start || !label) return null;
  return { id: typeof m.blockId === 'string' ? m.blockId : message.id, label: clip(label, 180), start, end, immovable: m.immovable !== false, active: m.active !== false, reason: typeof m.reason === 'string' && m.reason.trim() ? clip(m.reason, 800) : undefined, source: m.source === 'elp' ? 'elp' : 'user', createdAt: typeof m.createdAt === 'string' ? m.createdAt : message.createdAt, updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : message.createdAt };
}

export async function listProtectedBlocks(profileId: string, options: { includeInactive?: boolean; from?: string; to?: string } = {}) {
  const handles = await getSession(profileId); if (!handles) return [] as ProtectedBlock[];
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true });
  const byId = new Map<string, ProtectedBlock>();
  for (const message of messages) { const block = parse(message); if (block && !byId.has(block.id)) byId.set(block.id, block); }
  const from = options.from ? Date.parse(options.from) : -Infinity; const to = options.to ? Date.parse(options.to) : Infinity;
  return [...byId.values()].filter((b) => (options.includeInactive || b.active) && Date.parse(b.end) > from && Date.parse(b.start) < to).sort((a, b) => a.start.localeCompare(b.start));
}

export async function createProtectedBlock(profileId: string, input: { label: string; start: string; end: string; immovable?: boolean; reason?: string }) {
  const handles = await getSession(profileId); if (!handles) throw new Error('Protected-block memory is unavailable.');
  const start = validIso(input.start); const end = validIso(input.end); const label = clip(input.label || '', 180); if (!start || !end || end <= start || !label) throw new Error('A valid label, start and end are required.');
  const id = randomUUID(); const now = new Date().toISOString(); const block: ProtectedBlock = { id, label, start, end, immovable: input.immovable !== false, active: true, ...(input.reason?.trim() ? { reason: clip(input.reason, 800) } : {}), source: 'user', createdAt: now, updatedAt: now };
  await handles.session.addMessages([{ peerId: handles.user.id, content: `[PROTECTED_BLOCK] ${block.label}`, metadata: { elpProtectedBlock: true, recordVersion: 1, blockId: id, label: block.label, start, end, immovable: block.immovable, active: true, reason: block.reason || '', source: 'user', createdAt: now, updatedAt: now } }]);
  return block;
}

export async function updateProtectedBlock(profileId: string, blockId: string, patch: Partial<Pick<ProtectedBlock, 'label' | 'start' | 'end' | 'immovable' | 'active' | 'reason'>>) {
  const handles = await getSession(profileId); if (!handles) throw new Error('Protected-block memory is unavailable.');
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true }); const message = messages.find((m) => m.metadata?.elpProtectedBlock === true && m.metadata?.blockId === blockId); if (!message) throw new Error('Protected block not found.');
  const current = parse(message); if (!current) throw new Error('Protected block is invalid.');
  const next = { ...current, ...patch, label: patch.label !== undefined ? clip(patch.label, 180) : current.label, start: patch.start !== undefined ? validIso(patch.start) || '' : current.start, end: patch.end !== undefined ? validIso(patch.end) || '' : current.end, updatedAt: new Date().toISOString() };
  if (!next.label || !next.start || !next.end || next.end <= next.start) throw new Error('Invalid protected block update.');
  await handles.session.updateMessage(message.id, { ...message.metadata, label: next.label, start: next.start, end: next.end, immovable: next.immovable, active: next.active, reason: next.reason || '', updatedAt: next.updatedAt });
  return next;
}
