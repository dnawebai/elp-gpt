import { createHash } from 'node:crypto';
import {
  getNotificationCenter,
  upsertNotificationCandidates,
  updateNotification,
  type NotificationCandidate,
} from '@/lib/notification-store';
import type { ActionRisk } from '@/lib/actions';

function fingerprint(sourceId: string) {
  return createHash('sha256').update(`approval-continuation|${sourceId}|approval`).digest('hex').slice(0, 24);
}

export async function publishApprovalPresenceNotification(profileId: string, input: {
  continuationId: string;
  summary: string;
  toolSlug: string;
  risk: ActionRisk;
  sourceRunId?: string;
  expiresAt: string;
}) {
  const candidate: NotificationCandidate = {
    fingerprint: fingerprint(input.continuationId),
    kind: 'approval',
    severity: input.risk === 'high' ? 'critical' : 'high',
    title: input.risk === 'high' ? 'High-risk AGI approval required' : 'AGI approval required',
    summary: input.sourceRunId
      ? `${input.summary} · Run ${input.sourceRunId.slice(0, 12)}`
      : input.summary,
    source: 'approval-continuation',
    sourceId: input.continuationId,
    action: 'Open Approval Center to review, approve, or reject the exact sealed action.',
  };
  await upsertNotificationCandidates(profileId, [candidate], { resolveMissing: false });
}

export async function resolveApprovalPresenceNotification(profileId: string, continuationId: string) {
  const center = await getNotificationCenter(profileId);
  const matching = center.notifications.filter((item) =>
    item.source === 'approval-continuation' &&
    item.sourceId === continuationId &&
    (item.status === 'unread' || item.status === 'read')
  );
  await Promise.all(matching.map((item) => updateNotification(profileId, item.id, 'resolved')));
}
