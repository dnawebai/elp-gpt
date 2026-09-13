import { getLatestDailyOperatingPlan, persistDailyOperatingPlan } from '@/lib/daily-plan-memory';
import { runExecutionScheduler } from '@/lib/execution-scheduler';

export async function refreshExecutionSchedule(profileId: string) {
  const schedule = await runExecutionScheduler({ profileId, persist: true });
  const plan = await getLatestDailyOperatingPlan(profileId);
  if (plan) {
    const current = schedule.currentBlockId ? schedule.blocks.find((item) => item.id === schedule.currentBlockId) : undefined;
    const next = schedule.nextBlockId ? schedule.blocks.find((item) => item.id === schedule.nextBlockId) : undefined;
    const focusContext = [
      current ? `Current focus: ${current.title} until ${current.end}.` : '',
      next ? `Next focus: ${next.title} at ${next.start}.` : '',
      schedule.unscheduled.length ? `${schedule.unscheduled.length} material priorit${schedule.unscheduled.length === 1 ? 'y is' : 'ies are'} not yet scheduled today.` : '',
    ].filter(Boolean).join(' ');
    await persistDailyOperatingPlan(profileId, { ...plan, generatedAt: schedule.generatedAt, headline: `${plan.headline} ${focusContext}`.trim() });
  }
  return schedule;
}
