import { hasCapability } from '@/lib/authority-policy';
import type { VoiceActivationBriefing } from '@/lib/voice-activation-briefing';
import type { ZeroTrustAuthorityContext } from '@/lib/zero-trust-authority';

export type NextBestActionMode = 'do_now' | 'approve' | 'delegate' | 'monitor';
export type NextBestActionCategory = 'approval' | 'risk' | 'commitment' | 'appointment' | 'decision';
export type NextBestActionUrgency = 'critical' | 'high' | 'normal';

export type NextBestAction = {
  rank: number;
  id: string;
  sourceKey: string;
  mode: NextBestActionMode;
  category: NextBestActionCategory;
  urgency: NextBestActionUrgency;
  score: number;
  title: string;
  rationale: string;
  recommendedAction: string;
  governance: 'explicit_approval' | 'separate_user_command' | 'monitor_only';
  continuationId?: string;
  expiresAt?: string;
};

export type NextBestActionQueue = {
  generatedAt: string;
  count: number;
  topAction: NextBestAction | null;
  byMode: Record<NextBestActionMode, number>;
  actions: NextBestAction[];
};

const MAX_ACTIONS = 8;

function clip(value: string, max: number) {
  const clean = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function deadlineBonus(value?: string, now = Date.now()) {
  if (!value) return 0;
  const parsed = Date.parse(value.length === 10 ? `${value}T23:59:59.999Z` : value);
  if (!Number.isFinite(parsed)) return 0;
  const remaining = parsed - now;
  if (remaining <= 0) return 180;
  if (remaining <= 30 * 60_000) return 160;
  if (remaining <= 2 * 60 * 60_000) return 130;
  if (remaining <= 6 * 60 * 60_000) return 100;
  if (remaining <= 24 * 60 * 60_000) return 75;
  if (remaining <= 3 * 24 * 60 * 60_000) return 45;
  if (remaining <= 7 * 24 * 60 * 60_000) return 20;
  return 0;
}

function horizonBonus(hours: number) {
  if (!Number.isFinite(hours)) return 0;
  if (hours <= 12) return 140;
  if (hours <= 24) return 110;
  if (hours <= 72) return 60;
  return 20;
}

function allowed(sourceKey: string, focusKeys?: readonly string[]) {
  return focusKeys === undefined || focusKeys.includes(sourceKey);
}

function urgencyFromScore(score: number): NextBestActionUrgency {
  return score >= 900 ? 'critical' : score >= 650 ? 'high' : 'normal';
}

function buildApprovalActions(briefing: VoiceActivationBriefing, focusKeys?: readonly string[]) {
  return briefing.approvals.flatMap((item) => {
    const sourceKey = `approval:${item.id}`;
    if (!allowed(sourceKey, focusKeys)) return [];
    const score = (item.risk === 'high' ? 900 : item.risk === 'write' ? 760 : 610) + deadlineBonus(item.expiresAt);
    const title = clip(item.summary, 180);
    return [{
      rank: 0,
      id: sourceKey,
      sourceKey,
      mode: 'approve' as const,
      category: 'approval' as const,
      urgency: urgencyFromScore(score),
      score,
      title,
      rationale: `${item.risk === 'high' ? 'High-risk' : item.risk === 'write' ? 'Write' : 'Read'} action is already prepared and waiting in the durable approval queue.`,
      recommendedAction: `Review the pending approval for ${title}.`,
      governance: 'explicit_approval' as const,
      continuationId: item.id,
      expiresAt: item.expiresAt,
    }];
  });
}

function buildRiskActions(briefing: VoiceActivationBriefing, focusKeys?: readonly string[]) {
  return briefing.risks.flatMap((item) => {
    const sourceKey = `risk:${item.id}`;
    if (!allowed(sourceKey, focusKeys)) return [];
    const score = (item.severity === 'critical' ? 850 : 690) + horizonBonus(item.horizonHours) + Math.round(item.confidence * 40);
    const immediate = item.severity === 'critical' || item.horizonHours <= 24;
    const title = clip(item.title, 180);
    return [{
      rank: 0,
      id: sourceKey,
      sourceKey,
      mode: immediate ? 'do_now' as const : 'monitor' as const,
      category: 'risk' as const,
      urgency: urgencyFromScore(score),
      score,
      title,
      rationale: immediate
        ? `The forecast is ${item.severity} with a ${Math.round(item.confidence * 100)}% confidence signal inside the near-term horizon.`
        : `The forecast is material but not yet inside the immediate-action horizon.`,
      recommendedAction: immediate
        ? `Review the evidence and prepare the smallest safe mitigation for ${title}.`
        : `Monitor ${title} and re-evaluate if severity, confidence, or horizon worsens.`,
      governance: immediate ? 'separate_user_command' as const : 'monitor_only' as const,
    }];
  });
}

function buildCommitmentActions(
  context: ZeroTrustAuthorityContext,
  briefing: VoiceActivationBriefing,
  focusKeys?: readonly string[],
) {
  const canDelegate = hasCapability(context.principal.role, 'manage_tasks', context.principal.capabilities);
  return briefing.commitments.flatMap((item) => {
    const sourceKey = `commitment:${item.id}`;
    if (!allowed(sourceKey, focusKeys)) return [];
    const deadline = deadlineBonus(item.dueDate);
    const score = (item.overdue ? 840 : item.status === 'blocked' ? 790 : item.priority === 'high' ? 650 : 480) + deadline;
    const immediate = item.overdue || item.status === 'blocked' || deadline >= 75;
    const delegate = !immediate && canDelegate && item.priority === 'high';
    const mode: NextBestActionMode = immediate ? 'do_now' : delegate ? 'delegate' : 'monitor';
    const title = clip(item.title, 180);
    return [{
      rank: 0,
      id: sourceKey,
      sourceKey,
      mode,
      category: 'commitment' as const,
      urgency: urgencyFromScore(score),
      score,
      title,
      rationale: item.overdue
        ? 'This commitment is overdue.'
        : item.status === 'blocked'
          ? 'This commitment is blocked and needs a dependency decision.'
          : delegate
            ? 'This is a high-priority commitment with enough runway to assign an owner before it becomes urgent.'
            : 'This commitment remains active and should stay visible until its deadline or status changes.',
      recommendedAction: immediate
        ? `Work through the remaining obligation or blocker for ${title}.`
        : delegate
          ? `Choose an accountable owner and delegate ${title} with a clear due date and evidence of completion.`
          : `Monitor ${title} and advance it if the deadline or status worsens.`,
      governance: mode === 'monitor' ? 'monitor_only' as const : 'separate_user_command' as const,
    }];
  });
}

function buildAppointmentActions(briefing: VoiceActivationBriefing, focusKeys?: readonly string[]) {
  return briefing.appointments.flatMap((item) => {
    const identity = item.reference || item.callId;
    const sourceKey = `appointment:${identity}`;
    if (!allowed(sourceKey, focusKeys)) return [];
    const title = clip([item.with ? `Appointment with ${item.with}` : 'Confirmed appointment', item.datetime].filter(Boolean).join(' — '), 180);
    return [{
      rank: 0,
      id: sourceKey,
      sourceKey,
      mode: 'monitor' as const,
      category: 'appointment' as const,
      urgency: 'normal' as const,
      score: 360,
      title,
      rationale: 'The appointment is confirmed; the next safe step is to keep it visible and prepare only when requested.',
      recommendedAction: `Monitor ${title} and prepare the meeting context when needed.`,
      governance: 'monitor_only' as const,
    }];
  });
}

function buildDecisionActions(briefing: VoiceActivationBriefing, focusKeys?: readonly string[]) {
  return briefing.decisions.flatMap((item) => {
    const sourceKey = `decision:${item.id}`;
    if (!allowed(sourceKey, focusKeys)) return [];
    const score = (item.priority === 'critical' ? 820 : item.priority === 'high' ? 680 : item.priority === 'normal' ? 500 : 380) + deadlineBonus(item.dueAt);
    const immediate = item.priority === 'critical' || item.priority === 'high' || deadlineBonus(item.dueAt) >= 75;
    const title = clip(item.title, 180);
    return [{
      rank: 0,
      id: sourceKey,
      sourceKey,
      mode: immediate ? 'do_now' as const : 'monitor' as const,
      category: 'decision' as const,
      urgency: urgencyFromScore(score),
      score,
      title,
      rationale: immediate ? 'A principal decision is blocking or materially affecting near-term work.' : 'The decision remains open but is not yet in the immediate-action band.',
      recommendedAction: immediate ? `Review the decision context and choose or delegate a decision path for ${title}.` : `Monitor ${title} until its priority or deadline changes.`,
      governance: immediate ? 'separate_user_command' as const : 'monitor_only' as const,
    }];
  });
}

export function buildNextBestActionQueue(
  context: ZeroTrustAuthorityContext,
  briefing: VoiceActivationBriefing,
  options?: { focusKeys?: readonly string[] },
): NextBestActionQueue {
  const focusKeys = options?.focusKeys;
  const ranked = [
    ...buildApprovalActions(briefing, focusKeys),
    ...buildRiskActions(briefing, focusKeys),
    ...buildCommitmentActions(context, briefing, focusKeys),
    ...buildAppointmentActions(briefing, focusKeys),
    ...buildDecisionActions(briefing, focusKeys),
  ]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, MAX_ACTIONS)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const byMode: Record<NextBestActionMode, number> = { do_now: 0, approve: 0, delegate: 0, monitor: 0 };
  for (const item of ranked) byMode[item.mode] += 1;

  return {
    generatedAt: new Date().toISOString(),
    count: ranked.length,
    topAction: ranked[0] || null,
    byMode,
    actions: ranked,
  };
}

export function nextBestActionSpeech(queue: NextBestActionQueue) {
  const top = queue.topAction;
  if (!top) return '';
  if (top.mode === 'approve') {
    return `Recommended next move: review the pending approval for ${top.title}. I will not execute it without your explicit approval.`;
  }
  if (top.mode === 'do_now') {
    return `Recommended next move: do now — ${top.recommendedAction} Ask me to work through it if you want me to proceed.`;
  }
  if (top.mode === 'delegate') {
    return `Recommended next move: delegate — ${top.recommendedAction} Delegation is not automatic; tell me who should own it.`;
  }
  return `Recommended next move: monitor — ${top.recommendedAction}`;
}
