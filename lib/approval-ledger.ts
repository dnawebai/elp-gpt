import { Honcho } from '@honcho-ai/sdk';
import type { ActionRisk } from '@/lib/actions';

export type ApprovalStatus = 'proposed' | 'approved' | 'executing' | 'executed' | 'rejected' | 'failed' | 'expired';

export type ApprovalRecord = {
  id: string;
  nonce: string;
  digest: string;
  sessionId: string;
  toolSlug: string;
  summary: string;
  risk: ActionRisk;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  updatedAt?: string;
  approvedAt?: string;
  executedAt?: string;
  rejectedAt?: string;
  failedAt?: string;
  error?: string;
  evidence?: string;
};

export type ApprovalLedger = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  records: ApprovalRecord[];
  stats: {
    total: number;
    pending: number;
    approved: number;
    executed: number;
    rejected: number;
    failed: number;
    highRisk: number;
  };
};

const STATUS_VALUES = new Set<ApprovalStatus>(['proposed', 'approved', 'executing', 'executed', 'rejected', 'failed', 'expired']);

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt';
}

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

async function getApprovalSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({
    apiKey: process.env.HONCHO_API_KEY,
    workspaceId: workspaceId(),
    environment: 'production',
  });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`approvals-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function effectiveStatus(status: ApprovalStatus, expiresAt: string) {
  if ((status === 'proposed' || status === 'approved') && Date.parse(expiresAt) <= Date.now()) return 'expired' as const;
  return status;
}

function parseRecord(message: { id: string; content: string; createdAt: string; metadata: Record<string, unknown> }): ApprovalRecord | null {
  const metadata = message.metadata || {};
  if (metadata.jarbisApproval !== true) return null;
  const nonce = metadataString(metadata, 'nonce');
  const digest = metadataString(metadata, 'digest');
  const sessionId = metadataString(metadata, 'sessionId');
  const toolSlug = metadataString(metadata, 'toolSlug');
  const summary = metadataString(metadata, 'summary');
  const risk = metadataString(metadata, 'risk') as ActionRisk | undefined;
  const statusRaw = metadataString(metadata, 'approvalStatus') as ApprovalStatus | undefined;
  const createdAt = metadataString(metadata, 'createdAt') || message.createdAt;
  const expiresAt = metadataString(metadata, 'expiresAt');
  if (!nonce || !digest || !sessionId || !toolSlug || !summary || !expiresAt || !risk || !['read', 'write', 'high'].includes(risk)) return null;
  const status = effectiveStatus(statusRaw && STATUS_VALUES.has(statusRaw) ? statusRaw : 'proposed', expiresAt);
  const updatedAt = metadataString(metadata, 'updatedAt');
  const approvedAt = metadataString(metadata, 'approvedAt');
  const executedAt = metadataString(metadata, 'executedAt');
  const rejectedAt = metadataString(metadata, 'rejectedAt');
  const failedAt = metadataString(metadata, 'failedAt');
  const error = metadataString(metadata, 'error');
  const evidence = metadataString(metadata, 'evidence');
  return {
    id: message.id,
    nonce,
    digest,
    sessionId,
    toolSlug,
    summary,
    risk,
    status,
    createdAt,
    expiresAt,
    ...(updatedAt ? { updatedAt } : {}),
    ...(approvedAt ? { approvedAt } : {}),
    ...(executedAt ? { executedAt } : {}),
    ...(rejectedAt ? { rejectedAt } : {}),
    ...(failedAt ? { failedAt } : {}),
    ...(error ? { error } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

async function findRecord(profileId: string, nonce: string) {
  const handles = await getApprovalSession(profileId);
  if (!handles) return null;
  const page = await handles.session.messages({ size: 100, reverse: true });
  for (const message of page.items) {
    const record = parseRecord(message);
    if (record?.nonce === nonce) return { handles, message, record };
  }
  return null;
}

export async function recordActionProposal(profileId: string, input: {
  nonce: string;
  digest: string;
  sessionId: string;
  toolSlug: string;
  summary: string;
  risk: ActionRisk;
  expiresAt: string;
}) {
  if (!process.env.HONCHO_API_KEY) return null;
  const handles = await getApprovalSession(profileId);
  if (!handles) return null;
  const timestamp = new Date().toISOString();
  const created = await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[APPROVAL_PROPOSAL] ${timestamp}\n${clip(input.summary, 500)}`,
    metadata: {
      jarbisApproval: true,
      recordVersion: 1,
      nonce: clip(input.nonce, 120),
      digest: clip(input.digest, 120),
      sessionId: clip(input.sessionId, 96),
      toolSlug: clip(input.toolSlug, 160),
      summary: clip(input.summary, 500),
      risk: input.risk,
      approvalStatus: 'proposed',
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: input.expiresAt,
    },
  }]);
  return created[0]?.id || null;
}

async function updateRecord(profileId: string, nonce: string, patch: {
  status: ApprovalStatus;
  approvedAt?: string;
  executedAt?: string;
  rejectedAt?: string;
  failedAt?: string;
  error?: string;
  evidence?: string;
}) {
  if (!process.env.HONCHO_API_KEY) return null;
  const found = await findRecord(profileId, nonce);
  if (!found) return null;
  const now = new Date().toISOString();
  const metadata: Record<string, unknown> = {
    ...found.message.metadata,
    jarbisApproval: true,
    recordVersion: 1,
    approvalStatus: patch.status,
    updatedAt: now,
  };
  if (patch.approvedAt) metadata.approvedAt = patch.approvedAt;
  if (patch.executedAt) metadata.executedAt = patch.executedAt;
  if (patch.rejectedAt) metadata.rejectedAt = patch.rejectedAt;
  if (patch.failedAt) metadata.failedAt = patch.failedAt;
  if (patch.error) metadata.error = clip(patch.error, 1000);
  if (patch.evidence) metadata.evidence = clip(patch.evidence, 2000);
  const updated = await found.handles.session.updateMessage(found.message.id, metadata);
  return updated.id;
}

export async function recordActionApproved(profileId: string, nonce: string) {
  const now = new Date().toISOString();
  return updateRecord(profileId, nonce, { status: 'approved', approvedAt: now });
}

export async function recordActionExecuting(profileId: string, nonce: string) {
  return updateRecord(profileId, nonce, { status: 'executing' });
}

export async function recordActionExecuted(profileId: string, nonce: string, evidence?: string) {
  const now = new Date().toISOString();
  return updateRecord(profileId, nonce, { status: 'executed', executedAt: now, ...(evidence ? { evidence } : {}) });
}

export async function recordActionRejected(profileId: string, nonce: string) {
  const now = new Date().toISOString();
  return updateRecord(profileId, nonce, { status: 'rejected', rejectedAt: now });
}

export async function recordActionFailed(profileId: string, nonce: string, error: string) {
  const now = new Date().toISOString();
  return updateRecord(profileId, nonce, { status: 'failed', failedAt: now, error });
}

function emptyLedger(configured = false): ApprovalLedger {
  return {
    configured,
    available: false,
    generatedAt: new Date().toISOString(),
    records: [],
    stats: { total: 0, pending: 0, approved: 0, executed: 0, rejected: 0, failed: 0, highRisk: 0 },
  };
}

export async function getApprovalLedger(profileId: string): Promise<ApprovalLedger> {
  if (!process.env.HONCHO_API_KEY) return emptyLedger(false);
  try {
    const handles = await getApprovalSession(profileId);
    if (!handles) return emptyLedger(false);
    const page = await handles.session.messages({ size: 100, reverse: true });
    const records = page.items
      .map((message) => parseRecord(message))
      .filter((record): record is ApprovalRecord => Boolean(record))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      configured: true,
      available: records.length > 0,
      generatedAt: new Date().toISOString(),
      records,
      stats: {
        total: records.length,
        pending: records.filter((record) => record.status === 'proposed').length,
        approved: records.filter((record) => record.status === 'approved' || record.status === 'executing').length,
        executed: records.filter((record) => record.status === 'executed').length,
        rejected: records.filter((record) => record.status === 'rejected').length,
        failed: records.filter((record) => record.status === 'failed').length,
        highRisk: records.filter((record) => record.risk === 'high').length,
      },
    };
  } catch (error) {
    console.error('JARBIS approval ledger read failed', error);
    return emptyLedger(true);
  }
}

export function approvalLedgerToPrompt(ledger: ApprovalLedger) {
  if (!ledger.available) return '';
  const live = ledger.records
    .filter((record) => ['proposed', 'approved', 'executing', 'failed'].includes(record.status))
    .slice(0, 12)
    .map((record) => `- [${record.status.toUpperCase()}] ${record.summary} | ${record.toolSlug} | risk:${record.risk}`);
  return [
    `Approval audit totals: ${ledger.stats.pending} pending, ${ledger.stats.approved} approved/in-flight, ${ledger.stats.failed} failed, ${ledger.stats.executed} executed.`,
    live.length ? `Live approval state:\n${live.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
