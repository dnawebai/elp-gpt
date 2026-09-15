import { Honcho } from '@honcho-ai/sdk';
import type { ActionRisk } from '@/lib/actions';
import { sealServerEnvelope, unsealServerEnvelope } from '@/lib/secure-envelope';

export type ApprovalContinuationStatus = 'pending' | 'executed' | 'rejected' | 'failed' | 'expired';

export type ApprovalContinuationEnvelope = {
  version: 1;
  nonce: string;
  digest: string;
  sessionId: string;
  toolSlug: string;
  arguments: Record<string, unknown>;
  connectedAccountId?: string;
  summary: string;
  risk: ActionRisk;
  proposedByPrincipalId?: string;
  source: 'agent';
  sourceRunId?: string;
  createdAt: string;
};

export type ApprovalContinuationRecord = {
  id: string;
  nonce: string;
  digest: string;
  sessionId: string;
  toolSlug: string;
  summary: string;
  risk: ActionRisk;
  status: ApprovalContinuationStatus;
  source: 'agent';
  sourceRunId?: string;
  createdAt: string;
  expiresAt: string;
  updatedAt?: string;
  executedAt?: string;
  rejectedAt?: string;
  failedAt?: string;
  error?: string;
};

const PURPOSE = 'approval-continuation';
const CONTINUATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VALID_STATUSES = new Set<ApprovalContinuationStatus>(['pending', 'executed', 'rejected', 'failed', 'expired']);

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt';
}

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

async function sessionHandles(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({
    apiKey: process.env.HONCHO_API_KEY,
    workspaceId: workspaceId(),
    environment: 'production',
  });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`approval-continuations-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseRecord(message: { id: string; content: string; createdAt: string; metadata: Record<string, unknown> }) {
  const metadata = message.metadata || {};
  if (metadata.elpApprovalContinuation !== true) return null;
  const nonce = metadataString(metadata, 'nonce');
  const digest = metadataString(metadata, 'digest');
  const sessionId = metadataString(metadata, 'sessionId');
  const toolSlug = metadataString(metadata, 'toolSlug');
  const summary = metadataString(metadata, 'summary');
  const risk = metadataString(metadata, 'risk') as ActionRisk | undefined;
  const source = metadataString(metadata, 'source');
  const sourceRunId = metadataString(metadata, 'sourceRunId');
  const createdAt = metadataString(metadata, 'createdAt') || message.createdAt;
  const expiresAt = metadataString(metadata, 'expiresAt');
  const rawStatus = metadataString(metadata, 'continuationStatus') as ApprovalContinuationStatus | undefined;
  if (!nonce || !digest || !sessionId || !toolSlug || !summary || !expiresAt || source !== 'agent' || !risk || !['read', 'write', 'high'].includes(risk)) return null;
  let status: ApprovalContinuationStatus = rawStatus && VALID_STATUSES.has(rawStatus) ? rawStatus : 'pending';
  if (status === 'pending' && Date.parse(expiresAt) <= Date.now()) status = 'expired';
  return {
    id: message.id,
    nonce,
    digest,
    sessionId,
    toolSlug,
    summary,
    risk,
    status,
    source: 'agent' as const,
    ...(sourceRunId ? { sourceRunId } : {}),
    createdAt,
    expiresAt,
    ...(metadataString(metadata, 'updatedAt') ? { updatedAt: metadataString(metadata, 'updatedAt') } : {}),
    ...(metadataString(metadata, 'executedAt') ? { executedAt: metadataString(metadata, 'executedAt') } : {}),
    ...(metadataString(metadata, 'rejectedAt') ? { rejectedAt: metadataString(metadata, 'rejectedAt') } : {}),
    ...(metadataString(metadata, 'failedAt') ? { failedAt: metadataString(metadata, 'failedAt') } : {}),
    ...(metadataString(metadata, 'error') ? { error: metadataString(metadata, 'error') } : {}),
  } satisfies ApprovalContinuationRecord;
}

function sealedFromContent(content: string) {
  const prefix = '[ELP_APPROVAL_CONTINUATION]\n';
  return content.startsWith(prefix) ? content.slice(prefix.length).trim() : null;
}

export async function persistApprovalContinuation(profileId: string, envelope: ApprovalContinuationEnvelope) {
  const handles = await sessionHandles(profileId);
  if (!handles) return null;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CONTINUATION_TTL_MS).toISOString();
  const sealed = sealServerEnvelope(envelope, PURPOSE);
  const created = await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[ELP_APPROVAL_CONTINUATION]\n${sealed}`,
    metadata: {
      elpApprovalContinuation: true,
      recordVersion: 1,
      nonce: clip(envelope.nonce, 120),
      digest: clip(envelope.digest, 120),
      sessionId: clip(envelope.sessionId, 96),
      toolSlug: clip(envelope.toolSlug, 160),
      summary: clip(envelope.summary, 500),
      risk: envelope.risk,
      source: envelope.source,
      ...(envelope.sourceRunId ? { sourceRunId: clip(envelope.sourceRunId, 120) } : {}),
      continuationStatus: 'pending',
      createdAt,
      updatedAt: createdAt,
      expiresAt,
    },
  }]);
  const id = created[0]?.id;
  return id ? { id, expiresAt } : null;
}

async function findContinuation(profileId: string, id: string) {
  const handles = await sessionHandles(profileId);
  if (!handles) return null;
  const page = await handles.session.messages({ size: 100, reverse: true });
  for (const message of page.items) {
    const record = parseRecord(message);
    if (record && (record.id === id || record.nonce === id)) return { handles, message, record };
  }
  return null;
}

export async function loadApprovalContinuation(profileId: string, id: string) {
  const found = await findContinuation(profileId, id);
  if (!found || found.record.status !== 'pending') return null;
  const sealed = sealedFromContent(found.message.content);
  const envelope = unsealServerEnvelope<ApprovalContinuationEnvelope>(sealed || undefined, PURPOSE);
  if (!envelope || envelope.version !== 1 || envelope.nonce !== found.record.nonce || envelope.digest !== found.record.digest || envelope.toolSlug !== found.record.toolSlug || envelope.risk !== found.record.risk) return null;
  return { record: found.record, envelope };
}

export async function listApprovalContinuations(profileId: string) {
  const handles = await sessionHandles(profileId);
  if (!handles) return [] as ApprovalContinuationRecord[];
  const page = await handles.session.messages({ size: 100, reverse: true });
  return page.items
    .map((message) => parseRecord(message))
    .filter((record): record is ApprovalContinuationRecord => Boolean(record))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateApprovalContinuation(profileId: string, id: string, input: {
  status: Exclude<ApprovalContinuationStatus, 'pending' | 'expired'>;
  error?: string;
}) {
  const found = await findContinuation(profileId, id);
  if (!found) return null;
  const now = new Date().toISOString();
  const metadata: Record<string, unknown> = {
    ...found.message.metadata,
    elpApprovalContinuation: true,
    recordVersion: 1,
    continuationStatus: input.status,
    updatedAt: now,
  };
  if (input.status === 'executed') metadata.executedAt = now;
  if (input.status === 'rejected') metadata.rejectedAt = now;
  if (input.status === 'failed') metadata.failedAt = now;
  if (input.error) metadata.error = clip(input.error, 1000);
  const updated = await found.handles.session.updateMessage(found.message.id, metadata);
  return updated.id;
}
