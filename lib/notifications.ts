import { createHash } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { getApprovalLedger } from '@/lib/approval-ledger';
import { getRadarSnapshot } from '@/lib/radar';
import { getRelationshipSnapshot } from '@/lib/relationship-memory';
import { getTaskBoard } from '@/lib/task-router';

export type NotificationKind = 'approval' | 'failure' | 'risk' | 'opportunity' | 'deadline' | 'relationship' | 'task' | 'completion' | 'system';
export type NotificationSeverity = 'critical' | 'high' | 'normal' | 'low';
export type NotificationStatus = 'unread' | 'read' | 'dismissed';

export type NotificationRecord = {
  id: string;
  fingerprint: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  status: NotificationStatus;
  title: string;
  summary: string;
  source: string;
  sourceId: string;
  action?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
};

export type NotificationCenter = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  notifications: NotificationRecord[];
  stats: {
    total: number;
    unread: number;
    critical: number;
    high: number;
    approvals: number;
    failures: number;
  };
};

type Candidate = Omit<NotificationRecord, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'lastSeenAt' | 'occurrenceCount'>;

const KINDS = new Set<NotificationKind>(['approval', 'failure', 'risk', 'opportunity', 'deadline', 'relationship', 'task', 'completion', 'system']);
const SEVERITIES = new Set<NotificationSeverity>(['critical', 'high', 'normal', 'low']);
const STATUSES = new Set<NotificationStatus>(['unread', 'read', 'dismissed']);
const severityRank: Record<NotificationSeverity, number> = { critical: 4, high: 3, normal: 2, low: 1 };

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt-luke';
}

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function fingerprint(source: string, sourceId: string, kind: NotificationKind) {
  return createHash('sha256').update(`${source}|${sourceId}|${kind}`).digest('hex').slice(0, 24);
}

async function getNotificationSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({
    apiKey: process.env.HONCHO_API_KEY,
    workspaceId: workspaceId(),
    environment: 'production',
  });
  const user = await honcho.peer(`user-${profileId}`);
  const luke = await honcho.peer('luke');
  const session = await honcho.session(`notifications-${profileId}`);
  await session.addPeers([user, luke]);
  return { user, luke, session };
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadataNumber(metadata: Record<string, unknown>, key: string, fallback = 0) {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseNotification(message: { id: string; createdAt: string; metadata: Record<string, unknown> }): NotificationRecord | null {
  const metadata = message.metadata || {};
  if (metadata.jarbisNotification !== true) return null;
  const kind = metadataString(metadata, 'kind') as NotificationKind | undefined;
  const severity = metadataString(metadata, 'severity') as NotificationSeverity | undefined;
  const status = metadataString(metadata, 'status') as NotificationStatus | undefined;
  const title = metadataString(metadata, 'title');
  const summary = metadataString(metadata, 'summary');
  const source = metadataString(metadata, 'source');
  const sourceId = metadataString(metadata, 'sourceId');
  const fp = metadataString(metadata, 'fingerprint');
  if (!kind || !KINDS.has(kind) || !severity || !SEVERITIES.has(severity) || !title || !summary || !source || !sourceId || !fp) return null;
  const createdAt = metadataString(metadata, 'createdAt') || message.createdAt;
  const updatedAt = metadataString(metadata, 'updatedAt') || createdAt;
  const lastSeenAt = metadataString(metadata, 'lastSeenAt') || updatedAt;
  const action = metadataString(metadata, 'action');
  return {
    id: message.id,
    fingerprint: fp,
    kind,
    severity,
    status: status && STATUSES.has(status) ? status : 'unread',
    title: clip(title, 180),
    summary: clip(summary, 1600),
    source: clip(source, 60),
    sourceId: clip(sourceId, 180),
    ...(action ? { action: clip(action, 800) } : {}),
    createdAt,
    updatedAt,
    lastSeenAt,
    occurrenceCount: Math.max(1, Math.round(metadataNumber(metadata, 'occurrenceCount', 1))),
  };
}

function stats(records: NotificationRecord[]) {
  const active = records.filter((record) => record.status !== 'dismissed');
  return {
    total: active.length,
    unread: active.filter((record) => record.status === 'unread').length,
    critical: active.filter((record) => record.status === 'unread' && record.severity === 'critical').length,
    high: active.filter((record) => record.status === 'unread' && record.severity === 'high').length,
    approvals: active.filter((record) => record.status === 'unread' && record.kind === 'approval').length,
    failures: active.filter((record) => record.status === 'unread' && record.kind === 'failure').length,
  };
}

function emptyCenter(configured = false): NotificationCenter {
  return {
    configured,
    available: false,
    generatedAt: new Date().toISOString(),
    notifications: [],
    stats: { total: 0, unread: 0, critical: 0, high: 0, approvals: 0, failures: 0 },
  };
}

export async function getNotificationCenter(profileId: string): Promise<NotificationCenter> {
  if (!process.env.HONCHO_API_KEY) return emptyCenter(false);
  try {
    const handles = await getNotificationSession(profileId);
    if (!handles) return emptyCenter(false);
    const page = await handles.session.messages({ size: 200, reverse: true });
    const notifications = page.items
      .map((message) => parseNotification(message))
      .filter((record): record is NotificationRecord => Boolean(record))
      .sort((a, b) => {
        const unreadA = a.status === 'unread' ? 1 : 0;
        const unreadB = b.status === 'unread' ? 1 : 0;
        return unreadB - unreadA || severityRank[b.severity] - severityRank[a.severity] || b.lastSeenAt.localeCompare(a.lastSeenAt);
      });
    return {
      configured: true,
      available: notifications.length > 0,
      generatedAt: new Date().toISOString(),
      notifications,
      stats: stats(notifications),
    };
  } catch (error) {
    console.error('JARBIS notification center read failed', error);
    return emptyCenter(true);
  }
}

function addCandidate(target: Candidate[], input: Omit<Candidate, 'fingerprint'>) {
  target.push({ ...input, fingerprint: fingerprint(input.source, input.sourceId, input.kind) });
}

function withinHours(value: string | undefined, hours: number) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && Date.now() - time <= hours * 60 * 60 * 1000;
}

async function candidates(profileId: string): Promise<Candidate[]> {
  const [tasks, approvals, radar, relationships] = await Promise.all([
    getTaskBoard(profileId),
    getApprovalLedger(profileId),
    getRadarSnapshot(profileId),
    getRelationshipSnapshot(profileId),
  ]);
  const result: Candidate[] = [];

  for (const task of tasks.queues.decisions) {
    if (task.status === 'cancelled' || task.status === 'completed') continue;
    addCandidate(result, {
      kind: 'task',
      severity: task.priority === 'critical' ? 'critical' : task.priority === 'high' ? 'high' : 'normal',
      title: task.approval === 'required' ? 'Decision required' : 'Input required',
      summary: task.title,
      source: 'task',
      sourceId: task.id,
      action: task.approval === 'required' ? 'Review the pending decision in Command Center.' : 'Provide the missing input so JARBIS can continue.',
    });
  }

  for (const task of tasks.queues.now) {
    if (!['critical', 'high'].includes(task.priority) || task.status === 'completed' || task.status === 'cancelled') continue;
    addCandidate(result, {
      kind: 'task',
      severity: task.priority === 'critical' ? 'critical' : 'high',
      title: 'Priority task requires attention',
      summary: task.title,
      source: 'task-now',
      sourceId: task.id,
      action: task.summary || 'Review the task in Command Center.',
    });
  }

  for (const record of approvals.records) {
    if (record.status === 'proposed') {
      addCandidate(result, {
        kind: 'approval',
        severity: record.risk === 'high' ? 'critical' : 'high',
        title: record.risk === 'high' ? 'High-risk approval required' : 'Approval required',
        summary: record.summary,
        source: 'approval',
        sourceId: record.nonce,
        action: `Review ${record.toolSlug} before execution.`,
      });
    } else if (record.status === 'failed') {
      addCandidate(result, {
        kind: 'failure',
        severity: record.risk === 'high' ? 'critical' : 'high',
        title: 'External action failed',
        summary: record.error || record.summary,
        source: 'approval-failure',
        sourceId: record.nonce,
        action: 'Inspect the failed action and decide whether to retry or change approach.',
      });
    } else if (record.status === 'executed' && record.risk === 'high' && withinHours(record.executedAt, 24)) {
      addCandidate(result, {
        kind: 'completion',
        severity: 'normal',
        title: 'High-risk action completed',
        summary: record.summary,
        source: 'approval-completion',
        sourceId: record.nonce,
        action: 'Execution evidence is available in the approval ledger.',
      });
    }
  }

  for (const signal of radar.signals) {
    if (signal.status !== 'open' || !['critical', 'high'].includes(signal.severity)) continue;
    const kind: NotificationKind = signal.type === 'opportunity' ? 'opportunity' : signal.type === 'deadline' ? 'deadline' : signal.type === 'relationship' ? 'relationship' : 'risk';
    addCandidate(result, {
      kind,
      severity: signal.severity === 'critical' ? 'critical' : 'high',
      title: signal.title,
      summary: signal.summary,
      source: 'radar',
      sourceId: signal.id,
      action: signal.recommendedAction,
    });
  }

  for (const relationship of relationships.relationships) {
    if (relationship.status === 'inactive') continue;
    const material = relationship.strategicValue === 'critical' || relationship.strategicValue === 'high';
    const drift = relationship.momentum === 'cooling' || relationship.momentum === 'stalled';
    const obligation = relationship.promisesByUs.length > 0 || relationship.openLoops.length > 0;
    if (!material || (!drift && !obligation)) continue;
    addCandidate(result, {
      kind: 'relationship',
      severity: relationship.strategicValue === 'critical' || relationship.momentum === 'stalled' ? 'high' : 'normal',
      title: drift ? `Relationship ${relationship.momentum}` : 'Relationship follow-up due',
      summary: `${relationship.name}${relationship.organization ? ` — ${relationship.organization}` : ''}. ${relationship.openLoops[0] || relationship.promisesByUs[0] || relationship.nextBestAction || 'Material relationship requires review.'}`,
      source: 'relationship',
      sourceId: relationship.id,
      action: relationship.nextBestAction || 'Review open loops and commitments for this relationship.',
    });
  }

  return result.slice(0, 80);
}

export async function refreshNotifications(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return { ok: false, newCount: 0, updatedCount: 0, center: emptyCenter(false) };
  const handles = await getNotificationSession(profileId);
  if (!handles) return { ok: false, newCount: 0, updatedCount: 0, center: emptyCenter(false) };
  const page = await handles.session.messages({ size: 200, reverse: true });
  const existing = page.items
    .map((message) => ({ message, record: parseNotification(message) }))
    .filter((item): item is { message: typeof page.items[number]; record: NotificationRecord } => Boolean(item.record));
  const byFingerprint = new Map(existing.map((item) => [item.record.fingerprint, item]));
  const now = new Date().toISOString();
  let newCount = 0;
  let updatedCount = 0;

  for (const candidate of await candidates(profileId)) {
    const found = byFingerprint.get(candidate.fingerprint);
    if (found) {
      if (found.record.status === 'dismissed') continue;
      const changed = found.record.title !== candidate.title || found.record.summary !== candidate.summary || found.record.severity !== candidate.severity || found.record.action !== candidate.action;
      const metadata: Record<string, unknown> = {
        ...found.message.metadata,
        jarbisNotification: true,
        recordVersion: 1,
        kind: candidate.kind,
        severity: candidate.severity,
        title: clip(candidate.title, 180),
        summary: clip(candidate.summary, 1600),
        source: clip(candidate.source, 60),
        sourceId: clip(candidate.sourceId, 180),
        fingerprint: candidate.fingerprint,
        action: candidate.action ? clip(candidate.action, 800) : undefined,
        lastSeenAt: now,
        updatedAt: now,
        occurrenceCount: found.record.occurrenceCount + 1,
        status: changed && found.record.status === 'read' ? 'unread' : found.record.status,
      };
      await handles.session.updateMessage(found.message.id, metadata);
      updatedCount += 1;
      continue;
    }

    await handles.session.addMessages([{
      peerId: handles.luke.id,
      content: `[NOTIFICATION] ${candidate.title}\n${candidate.summary}`,
      metadata: {
        jarbisNotification: true,
        recordVersion: 1,
        kind: candidate.kind,
        severity: candidate.severity,
        status: 'unread',
        title: clip(candidate.title, 180),
        summary: clip(candidate.summary, 1600),
        source: clip(candidate.source, 60),
        sourceId: clip(candidate.sourceId, 180),
        fingerprint: candidate.fingerprint,
        ...(candidate.action ? { action: clip(candidate.action, 800) } : {}),
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        occurrenceCount: 1,
      },
    }]);
    newCount += 1;
  }

  return { ok: true, newCount, updatedCount, center: await getNotificationCenter(profileId) };
}

export async function updateNotification(profileId: string, id: string, status: NotificationStatus) {
  if (!STATUSES.has(status)) throw new Error('Invalid notification status.');
  const handles = await getNotificationSession(profileId);
  if (!handles) throw new Error('Notification center is unavailable.');
  const message = await handles.session.getMessage(id);
  if (message.metadata?.jarbisNotification !== true) throw new Error('Notification not found.');
  await handles.session.updateMessage(id, {
    ...message.metadata,
    jarbisNotification: true,
    status,
    updatedAt: new Date().toISOString(),
  });
}

export function notificationCenterToPrompt(center: NotificationCenter) {
  const unread = center.notifications
    .filter((record) => record.status === 'unread' && (record.severity === 'critical' || record.severity === 'high'))
    .slice(0, 10);
  if (!unread.length) return '';
  return [
    `Unread priority notifications: ${unread.length}.`,
    ...unread.map((record) => `- [${record.severity.toUpperCase()}][${record.kind}] ${record.title}: ${record.summary}${record.action ? ` Next: ${record.action}` : ''}`),
  ].join('\n');
}
