import { listDailyOperatingPlans, type PriorityItem } from '@/lib/daily-plan-memory';
import { listExecutionSchedules } from '@/lib/execution-schedule-memory';

export type PlanChange = {
  id: string;
  kind: 'new' | 'removed' | 'promoted' | 'demoted' | 'score_changed' | 'rescheduled' | 'unscheduled';
  title: string;
  summary: string;
  source?: string;
  delta?: number;
};

export type PlanDiff = {
  generatedAt: string;
  previousGeneratedAt?: string;
  currentGeneratedAt?: string;
  changes: PlanChange[];
  scheduleChanges: PlanChange[];
};

const horizonRank = { now: 3, today: 2, week: 1 } as const;
function itemMap(items: PriorityItem[]) { return new Map(items.map((item) => [item.id, item])); }
function allItems(plan: Awaited<ReturnType<typeof listDailyOperatingPlans>>[number]) { const result = new Map<string, PriorityItem>(); for (const item of [...plan.focus, ...plan.now, ...plan.today, ...plan.week, ...plan.defer, ...plan.stopDoing]) if (!result.has(item.id)) result.set(item.id, item); return [...result.values()]; }

export async function getPlanDiff(profileId: string): Promise<PlanDiff> {
  const [plans, schedules] = await Promise.all([listDailyOperatingPlans(profileId, 2), listExecutionSchedules(profileId, 2)]);
  const current = plans[0]; const previous = plans[1]; const changes: PlanChange[] = [];
  if (current && previous) {
    const cur = itemMap(allItems(current)); const prev = itemMap(allItems(previous));
    for (const [id, item] of cur) {
      const old = prev.get(id);
      if (!old) { changes.push({ id, kind: 'new', title: item.title, source: item.source, summary: `New ${item.priority} priority entered ${item.horizon.toUpperCase()} at score ${item.score}.` }); continue; }
      if (item.horizon !== old.horizon) { const promoted = horizonRank[item.horizon] > horizonRank[old.horizon]; changes.push({ id, kind: promoted ? 'promoted' : 'demoted', title: item.title, source: item.source, delta: item.score - old.score, summary: `${promoted ? 'Moved up' : 'Moved down'} from ${old.horizon.toUpperCase()} to ${item.horizon.toUpperCase()}${item.score !== old.score ? ` as score changed ${old.score} → ${item.score}` : ''}.` }); }
      else if (Math.abs(item.score - old.score) >= 5) changes.push({ id, kind: 'score_changed', title: item.title, source: item.source, delta: item.score - old.score, summary: `Priority score changed ${old.score} → ${item.score}. ${item.reasons[0] || ''}`.trim() });
    }
    for (const [id, item] of prev) if (!cur.has(id)) changes.push({ id, kind: 'removed', title: item.title, source: item.source, summary: 'No longer appears in the active operating plan; it may be completed, resolved, deferred, or superseded.' });
  }

  const scheduleChanges: PlanChange[] = [];
  const schedule = schedules[0]; const priorSchedule = schedules[1];
  if (schedule && priorSchedule) {
    const curBySource = new Map(schedule.blocks.filter((b) => b.sourceId).map((b) => [`${b.source}:${b.sourceId}`, b]));
    const oldBySource = new Map(priorSchedule.blocks.filter((b) => b.sourceId).map((b) => [`${b.source}:${b.sourceId}`, b]));
    for (const [key, block] of curBySource) {
      const old = oldBySource.get(key);
      if (old && old.start !== block.start) scheduleChanges.push({ id: block.id, kind: 'rescheduled', title: block.title, source: block.source, summary: `Moved from ${old.start} to ${block.start}. Trigger: calendar, protected-block, priority, or capacity state changed.` });
      if (!old && !['calendar', 'system'].includes(String(block.source))) scheduleChanges.push({ id: block.id, kind: 'new', title: block.title, source: block.source, summary: `Added to execution schedule at ${block.start}.` });
    }
    for (const [key, block] of oldBySource) if (!curBySource.has(key) && !['calendar', 'system'].includes(String(block.source))) scheduleChanges.push({ id: block.id, kind: 'unscheduled', title: block.title, source: block.source, summary: 'Removed from the latest execution schedule because available time or ranking changed.' });
  }
  return { generatedAt: new Date().toISOString(), previousGeneratedAt: previous?.generatedAt, currentGeneratedAt: current?.generatedAt, changes: changes.slice(0, 30), scheduleChanges: scheduleChanges.slice(0, 30) };
}
