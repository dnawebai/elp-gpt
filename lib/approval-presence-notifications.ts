import { createHash } from 'node:crypto';
import type { ActionRisk } from '@/lib/actions';
import { deliverPriorityNotifications } from '@/lib/notification-delivery';
import {
  getNotificationCenter,
  upsertNotificationCandidates,
  updateNotification,
  type NotificationCandidate,
} from '@/lib/notification-store';

function fingerprint(nonce: string) {
  return createHash('sha256').update(`approval|${nonce}|approval`).digest('hex').slice(0, 24);
}

export async function publishApprovalPresenceNotification(profileId: string, input: {
  nonce: string;
  continuationId: string;
  summary: string;
  toolSlug: string;
  risk: ActionRisk;
  sourceRunId?: string;
  expiresAt: string;
}) {
  const candidate: NotificationCandidate = {
    fingerprint: fingerprint(input.nonce),
    kind: 'approval',
    severity: input.risk === 'high' ? 'critical' : 'high',
    title: input.risk === 'high' ? 'High-risk AGI approval required' : 'AGI approval required',
    summary: input.sourceRunId
      ? `${input.summary} · Run ${input.sourceRunId.slice(0, 12)}`
      : input.summary,
    source: 'approval',
    sourceId: input.nonce,
    action: `Open Approval Center to review ${input.toolSlug} and resume the exact sealed action.`,
  };
  await upsertNotificationCandidates(profileId, [candidate], { resolveMissing: false });
  void deliverPriorityNotifications(profileId).catch((error) => {
    console.error('Immediate approval delivery failed', error);
  });
}

export async function resolveApprovalPresenceNotification(profileId: string, nonce: string) {
  const center = await getNotificationCenter(profileId);
  const matching = center.notifications.filter((item) =>
    item.source === 'approval' &&
    item.sourceId === nonce &&
    (item.status === 'unread' || item.status === 'read')
  );
  await Promise.all(matching.map((item) => updateNotification(profileId, item.id, 'resolved')));
}
