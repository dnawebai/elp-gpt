import { createHash } from 'node:crypto';
import { getAnticipatorySnapshot } from '@/lib/anticipatory-chief-of-staff';
import { getApprovalLedger } from '@/lib/approval-ledger';
import {
  getNotificationCenter,
  upsertNotificationCandidates,
  updateNotification,
  type NotificationCandidate,
  type NotificationKind,
  type NotificationStatus,
} from '@/lib/notification-store';
import { getRadarSnapshot } from '@/lib/radar';
import { getRelationshipSnapshot } from '@/lib/relationship-memory';
import { getTaskBoard } from '@/lib/task-router';

export {
  getNotificationCenter,
  updateNotification,
  type NotificationCenter,
  type NotificationKind,
  type NotificationRecord,
  type NotificationSeverity,
  type NotificationStatus,
} from '@/lib/notification-store';

function fingerprint(source: string, sourceId: string, kind: NotificationKind) {
  return createHash('sha256').update(`${source}|${sourceId}|${kind}`).digest('hex').slice(0, 24);
}

function addCandidate(target: NotificationCandidate[], input: Omit<NotificationCandidate, 'fingerprint'>) {
  target.push({ ...input, fingerprint: fingerprint(input.source, input.sourceId, input.kind) });
}

function withinHours(value: string | undefined, hours: number) {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && Date.now() - time <= hours * 60 * 60 * 1000;
}

async function collectCandidates(profileId: string): Promise<NotificationCandidate[]> {
  const [tasks, approvals, radar, relationships, anticipatory] = await Promise.all([
    getTaskBoard(profileId),
    getApprovalLedger(profileId),
    getRadarSnapshot(profileId),
    getRelationshipSnapshot(profileId),
    getAnticipatorySnapshot(profileId),
  ]);
  const result: NotificationCandidate[] = [];

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
    const kind: NotificationKind = signal.type === 'opportunity'
      ? 'opportunity'
      : signal.type === 'deadline'
        ? 'deadline'
        : signal.type === 'relationship'
          ? 'relationship'
          : 'risk';
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

  for (const forecast of anticipatory.risks) {
    if (forecast.severity === 'medium') continue;
    const kind: NotificationKind = forecast.type === 'deadline_failure'
      ? 'deadline'
      : forecast.type === 'relationship_followup'
        ? 'relationship'
        : 'risk';
    addCandidate(result, {
      kind,
      severity: forecast.severity === 'critical' ? 'critical' : 'high',
      title: forecast.title,
      summary: forecast.summary,
      source: 'anticipatory',
      sourceId: forecast.fingerprint,
      action: forecast.recommendedAction,
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

  return result.slice(0, 100);
}

export async function refreshNotifications(profileId: string) {
  const candidates = await collectCandidates(profileId);
  return upsertNotificationCandidates(profileId, candidates);
}

export async function setNotificationStatus(profileId: string, id: string, status: NotificationStatus) {
  return updateNotification(profileId, id, status);
}
