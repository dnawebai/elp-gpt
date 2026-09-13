import { randomUUID } from 'node:crypto';
import { getLatestDailyOperatingPlan } from '@/lib/daily-plan-memory';
import { runDynamicPriorityEngine } from '@/lib/dynamic-priority-engine';
import { getLatestExecutionSchedule, type FocusBlock } from '@/lib/execution-schedule-memory';
import { runExecutionScheduler } from '@/lib/execution-scheduler';
import { persistInterruptSnapshot, type InterruptCandidate, type InterruptDecision, type InterruptSnapshot, type ResumeCheckpoint } from '@/lib/interrupt-memory';
import { decideInterruption } from '@/lib/interrupt-policy';
import { getNotificationCenter } from '@/lib/notification-store';

function activeBlock(blocks: FocusBlock[], nowMs: number) {
  return blocks.find((item) => Date.parse(item.start) <= nowMs && Date.parse(item.end) > nowMs);
}
function candidateKey(source: string, sourceId: string) { return `${source}:${sourceId}`; }

export async function runInterruptManager(args: { profileId: string; persist?: boolean; now?: Date }) {
  const now = args.now || new Date();
  const [schedule, plan, notifications] = await Promise.all([
    getLatestExecutionSchedule(args.profileId),
    getLatestDailyOperatingPlan(args.profileId),
    getNotificationCenter(args.profileId),
  ]);
  const current = schedule ? activeBlock(schedule.blocks, now.getTime()) : undefined;
  const scheduledKeys = new Set((schedule?.blocks || []).map((item) => item.source && item.sourceId ? candidateKey(item.source, item.sourceId) : '').filter(Boolean));
  const candidates = new Map<string, InterruptCandidate>();

  for (const item of notifications.notifications.filter((record) => record.status === 'unread' && (record.severity === 'critical' || record.severity === 'high'))) {
    const key = candidateKey('notification', item.id);
    if (scheduledKeys.has(key)) continue;
    const score = item.severity === 'critical' ? 100 : item.kind === 'failure' || item.kind === 'deadline' ? 90 : 82;
    candidates.set(key, {
      id: key, source: 'notification', sourceId: item.id, title: item.title, summary: item.summary,
      severity: item.severity, score, approvalRequired: item.kind === 'approval', updatedAt: item.updatedAt,
      recommendedAction: item.action,
    });
  }

  if (plan) {
    for (const item of plan.now.filter((entry) => entry.score >= 82)) {
      const key = candidateKey('priority', item.id);
      const represented = scheduledKeys.has(candidateKey(item.source, item.sourceId));
      if (represented || (current?.source === item.source && current.sourceId === item.sourceId)) continue;
      if (!candidates.has(key)) candidates.set(key, {
        id: key, source: 'priority', sourceId: item.id, title: item.title,
        summary: item.reasons.join(' ').slice(0, 1200), severity: item.priority, score: item.score,
        approvalRequired: item.approvalRequired, updatedAt: plan.generatedAt, recommendedAction: item.recommendedAction,
      });
    }
  }

  const currentScore = current?.priorityScore ?? 0;
  const decisions: InterruptDecision[] = [...candidates.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((candidate) => {
      if (!current) {
        return { candidate, disposition: candidate.severity === 'critical' || candidate.severity === 'high' ? 'interrupt_now' : 'queue_after_block', reason: 'No active focus block is being protected.', margin: candidate.score, threshold: 0 };
      }
      const policy = decideInterruption({ eventScore: candidate.score, eventSeverity: candidate.severity, currentBlockScore: currentScore, currentBlockKind: current.kind, protectDeepWork: schedule?.policy.protectDeepWork ?? true, approvalRequired: candidate.approvalRequired });
      return { candidate, ...policy };
    });

  const immediate = decisions.filter((item) => item.disposition === 'interrupt_now');
  let checkpoint: ResumeCheckpoint | undefined;
  if (current && immediate.length) {
    checkpoint = {
      blockId: current.id, title: current.title, sourceId: current.sourceId, interruptedAt: now.toISOString(), scheduledEnd: current.end,
      remainingMinutes: Math.max(1, Math.ceil((Date.parse(current.end) - now.getTime()) / 60_000)),
      reason: `Interrupted for: ${immediate[0].candidate.title}`,
    };
  }

  let replanned = false;
  let newScheduleId: string | undefined;
  if (immediate.length || (!current && decisions.some((item) => item.disposition === 'queue_after_block'))) {
    await runDynamicPriorityEngine({ profileId: args.profileId, persist: true });
    const nextSchedule = await runExecutionScheduler({ profileId: args.profileId, persist: true, now });
    replanned = true;
    newScheduleId = nextSchedule.id;
  } else if (decisions.some((item) => item.disposition === 'queue_after_block')) {
    await runDynamicPriorityEngine({ profileId: args.profileId, persist: true });
  }

  const snapshot: InterruptSnapshot = {
    id: randomUUID(), generatedAt: now.toISOString(), currentBlockId: current?.id, currentBlockTitle: current?.title,
    decisions, checkpoint, replanned, newScheduleId,
    stats: {
      candidates: decisions.length,
      interruptNow: immediate.length,
      queued: decisions.filter((item) => item.disposition === 'queue_after_block').length,
      monitored: decisions.filter((item) => item.disposition === 'monitor').length,
    },
  };
  return args.persist === false ? snapshot : persistInterruptSnapshot(args.profileId, snapshot);
}
