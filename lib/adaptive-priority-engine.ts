import { persistDailyOperatingPlan, type DailyOperatingPlan, type PriorityItem } from '@/lib/daily-plan-memory';
import { runDynamicPriorityEngine } from '@/lib/dynamic-priority-engine';
import { getStoredStrategyCalibration, type StoredStrategyCalibration } from '@/lib/strategy-calibration-memory';
import { getTaskBoard } from '@/lib/task-router';

function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function horizon(score: number, blocked: boolean): PriorityItem['horizon'] { if (blocked || score >= 82) return 'now'; if (score >= 62) return 'today'; return 'week'; }
function calibrationDimension(item: PriorityItem, calibration: StoredStrategyCalibration) {
  if (item.source === 'relationship') return { name: 'relationship impact', value: calibration.dimensions.relationshipImpact };
  if (item.source === 'risk' || item.source === 'notification') return { name: 'evidence strength', value: calibration.dimensions.evidenceStrength };
  if (item.source === 'commitment') return { name: 'expected value', value: calibration.dimensions.expectedValue };
  if (item.source === 'delegation' || item.source === 'capacity') return { name: 'execution complexity', value: calibration.dimensions.executionComplexity };
  return { name: 'strategic fit', value: calibration.dimensions.strategicFit };
}

export async function runAdaptivePriorityEngine(args: { profileId: string; persist?: boolean }) {
  const [base, calibration, board] = await Promise.all([
    runDynamicPriorityEngine({ profileId: args.profileId, persist: false }),
    getStoredStrategyCalibration(args.profileId),
    getTaskBoard(args.profileId),
  ]);
  const tasks = new Map([...board.queues.now, ...board.queues.decisions, ...board.queues.working, ...board.queues.delegated, ...board.queues.done].map((task) => [task.id, task]));
  const transformed = new Map<string, PriorityItem>();
  const all = [...base.focus, ...base.now, ...base.today, ...base.week, ...base.defer, ...base.stopDoing, ...base.blockers];
  for (const original of all) {
    if (transformed.has(original.id)) continue;
    let score = original.score;
    const reasons = [...original.reasons];
    if (calibration && calibration.resolvedDecisions >= 3) {
      const dimension = calibrationDimension(original, calibration);
      const delta = Math.max(-5, Math.min(5, Math.round((dimension.value - 75) / 5)));
      if (delta) { score += delta; reasons.push(`Outcome-learning calibration ${delta > 0 ? '+' : ''}${delta}: ${dimension.name} forecast accuracy ${Math.round(dimension.value)}%.`); }
    }
    if (original.source === 'task') {
      const task = tasks.get(original.sourceId);
      if (task) {
        if (task.dueAt) {
          const hours = (Date.parse(task.dueAt) - Date.now()) / 3_600_000;
          const dueDelta = hours < 0 ? 20 : hours <= 24 ? 15 : hours <= 72 ? 9 : hours <= 168 ? 4 : 0;
          if (dueDelta) { score += dueDelta; reasons.push(hours < 0 ? 'Structured task deadline is overdue.' : `Structured task deadline is within ${Math.ceil(hours)} hours.`); }
        }
        if (task.progressPercent !== undefined) reasons.push(`Verified/recorded progress: ${Math.round(task.progressPercent)}%.`);
        if (task.remainingHours !== undefined) reasons.push(`Estimated remaining effort: ${task.remainingHours.toFixed(1)}h.`);
        if (task.progressPercent !== undefined && task.progressPercent >= 80 && task.remainingHours !== undefined && task.remainingHours <= 1.5 && original.priority !== 'low') { score += 4; reasons.push('Near-complete task receives a small finish-work bonus.'); }
      }
    }
    const finalScore = clamp(score);
    transformed.set(original.id, { ...original, score: finalScore, horizon: horizon(finalScore, original.blocked), reasons });
  }
  const get = (items: PriorityItem[]) => items.map((item) => transformed.get(item.id) || item).sort((a, b) => b.score - a.score);
  const ranked = [...transformed.values()].sort((a, b) => b.score - a.score || Number(b.blocked) - Number(a.blocked));
  const plan: DailyOperatingPlan = {
    ...base,
    generatedAt: new Date().toISOString(),
    focus: ranked.slice(0, base.stats.overload ? 5 : 7),
    now: ranked.filter((item) => item.horizon === 'now').slice(0, 8),
    today: ranked.filter((item) => item.horizon === 'today').slice(0, 10),
    week: ranked.filter((item) => item.horizon === 'week').slice(0, 14),
    defer: get(base.defer),
    stopDoing: get(base.stopDoing),
    blockers: ranked.filter((item) => item.blocked || item.approvalRequired).slice(0, 10),
  };
  plan.headline = `${plan.focus.length} focus item${plan.focus.length === 1 ? '' : 's'}; ${plan.now.length} need attention now${plan.stats.overload ? `; capacity is ${plan.capacityStatus}` : ''}${calibration?.resolvedDecisions ? `; calibrated from ${calibration.resolvedDecisions} resolved decisions` : ''}.`;
  return args.persist === false ? plan : persistDailyOperatingPlan(args.profileId, plan);
}
