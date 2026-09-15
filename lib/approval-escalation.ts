import { createHash } from 'node:crypto';
import { listApprovalContinuations } from '@/lib/approval-continuations';
import { upsertNotificationCandidates, type NotificationCandidate } from '@/lib/notification-store';

const WARNING_MS = 2 * 60 * 60 * 1000;
const CRITICAL_MS = 30 * 60 * 1000;

function fingerprint(nonce: string) {
  return createHash('sha256').update(`approval|${nonce}|approval`).digest('hex').slice(0, 24);
}

function remainingLabel(expiresAt: string) {
  const remaining = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remaining)) return 'expiry time unavailable';
  const minutes = Math.max(0, Math.ceil(remaining / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export async function refreshApprovalEscalations(profileId: string) {
  const continuations = await listApprovalContinuations(profileId);
  const candidates: NotificationCandidate[] = [];

  for (const item of continuations) {
    if (item.status !== 'pending') continue;
    const remaining = Date.parse(item.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > WARNING_MS) continue;
    const critical = item.risk === 'high' || remaining <= CRITICAL_MS;
    const timeLeft = remainingLabel(item.expiresAt);
    candidates.push({
      fingerprint: fingerprint(item.nonce),
      kind: 'approval',
      severity: critical ? 'critical' : 'high',
      title: remaining <= CRITICAL_MS ? 'Approval expires soon' : 'Approval nearing expiry',
      summary: `${item.summary} · ${timeLeft} remaining before this sealed action expires.`,
      source: 'approval',
      sourceId: item.nonce,
      action: `Open Approval Center to review ${item.toolSlug} before expiry.`,
    });
  }

  if (!candidates.length) return { ok: true, escalated: 0 };
  const result = await upsertNotificationCandidates(profileId, candidates, { resolveMissing: false });
  return { ok: result.ok, escalated: candidates.length };
}
