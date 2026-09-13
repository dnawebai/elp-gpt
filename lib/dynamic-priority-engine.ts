import { randomUUID } from 'node:crypto';
import { getAnticipatorySnapshot } from '@/lib/anticipatory-chief-of-staff';
import { getLatestCapacityPlan } from '@/lib/capacity-memory';
import { persistDailyOperatingPlan, type DailyOperatingPlan, type PriorityHorizon, type PriorityItem } from '@/lib/daily-plan-memory';
import { getExecutiveLedger } from '@/lib/executive-memory';
import { getPortfolioSnapshot } from '@/lib/portfolio-control';
import { getRelationshipSnapshot } from '@/lib/relationship-memory';
import { getTaskBoard } from '@/lib/task-router';

function clampScore(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function daysUntil(date?: string) { if (!date) return null; const ms = Date.parse(`${date}T23:59:59.999Z`) - Date.now(); return Number.isFinite(ms) ? Math.ceil(ms / 86_400_000) : null; }
function priorityPoints(priority: string) { return priority === 'critical' ? 35 : priority === 'high' ? 24 : priority === 'low' ? 5 : 12; }
function severityPoints(severity: string) { return severity === 'critical' ? 38 : severity === 'high' ? 26 : 14; }
function horizonFrom(score: number, due: number | null, blocked: boolean): PriorityHorizon {
  if (blocked || score >= 82 || (due !== null && due <= 1)) return 'now';
  if (score >= 62 || (due !== null && due <= 3)) return 'today';
  return 'week';
}

function rankItem(input: Omit<PriorityItem, 'score' | 'horizon'> & { base: number; dueInDays?: number | null; strategic?: number; capacityPenalty?: number }) {
  const due = input.dueInDays ?? null;
  let score = input.base + priorityPoints(input.priority) + (input.strategic || 0);
  if (input.blocked) score += 18;
  if (input.approvalRequired) score += 8;
  if (due !== null) score += due < 0 ? 25 : due === 0 ? 22 : due <= 1 ? 18 : due <= 3 ? 12 : due <= 7 ? 6 : 0;
  score -= input.capacityPenalty || 0;
  const finalScore = clampScore(score);
  return { ...input, score: finalScore, horizon: horizonFrom(finalScore, due, input.blocked) } satisfies PriorityItem & { base: number; dueInDays?: number | null; strategic?: number; capacityPenalty?: number };
}

function stripInternal<T extends PriorityItem & Record<string, unknown>>(item: T): PriorityItem {
  const { base: _base, dueInDays: _due, strategic: _strategic, capacityPenalty: _capacityPenalty, ...clean } = item;
  return clean as PriorityItem;
}

export async function runDynamicPriorityEngine(args: { profileId: string; persist?: boolean }) {
  const [board, ledger, portfolio, relationships, anticipatory, capacity] = await Promise.all([
    getTaskBoard(args.profileId),
    getExecutiveLedger(args.profileId),
    getPortfolioSnapshot(args.profileId),
    getRelationshipSnapshot(args.profileId),
    getAnticipatorySnapshot(args.profileId),
    getLatestCapacityPlan(args.profileId),
  ]);

  const candidates: PriorityItem[] = [];
  const capacityTight = capacity?.status === 'overloaded' || capacity?.status === 'critical';
  const taskGoalLinks = new Map<string, string>();
  for (const goal of portfolio.goals) for (const taskId of goal.taskIds) taskGoalLinks.set(taskId, goal.id);

  const openTasks = [...board.queues.now, ...board.queues.decisions, ...board.queues.working, ...board.queues.delegated].filter((task) => task.status === 'active' || task.status === 'blocked');
  for (const task of openTasks) {
    const goalId = taskGoalLinks.get(task.id);
    const linkedHealth = goalId ? portfolio.goalHealth.find((item) => item.goal.id === goalId) : undefined;
    const reasons = [`Command Center queue: ${task.queue}.`];
    if (task.status === 'blocked') reasons.push('Execution is blocked.');
    if (linkedHealth?.health === 'critical' || linkedHealth?.health === 'at_risk') reasons.push(`Supports a ${linkedHealth.health} goal.`);
    const approvalRequired = task.approval !== 'none' || task.queue === 'decisions';
    if (approvalRequired) reasons.push('Principal decision or approval is required.');
    const ranked = rankItem({
      id: `task:${task.id}`, source: 'task', sourceId: task.id, title: task.title, priority: task.priority,
      owner: task.owner, blocked: task.status === 'blocked', approvalRequired,
      reasons, recommendedAction: task.queue === 'decisions' ? 'Make the blocking decision or explicitly delegate it.' : task.objective,
      base: task.queue === 'now' ? 30 : task.queue === 'decisions' ? 28 : task.queue === 'working' ? 18 : 12,
      strategic: linkedHealth?.health === 'critical' ? 16 : linkedHealth?.health === 'at_risk' ? 10 : goalId ? 5 : -4,
      capacityPenalty: capacityTight && task.priority === 'low' ? 12 : 0,
    });
    candidates.push(stripInternal(ranked));
  }

  for (const item of ledger.items.filter((entry) => entry.primaryKind === 'commitment' && (entry.status === 'active' || entry.status === 'blocked'))) {
    const due = daysUntil(item.dueDate);
    const ranked = rankItem({
      id: `commitment:${item.id}`, source: 'commitment', sourceId: item.id, title: item.title,
      priority: item.priority === 'high' ? 'high' : 'normal', owner: item.owner, dueDate: item.dueDate,
      blocked: item.status === 'blocked', approvalRequired: false,
      reasons: [item.overdue ? 'Executive commitment is overdue.' : 'Open executive commitment.', ...(item.dependencyText ? [`Dependency: ${item.dependencyText}.`] : [])],
      recommendedAction: item.status === 'blocked' ? 'Remove the dependency or choose a fallback path.' : 'Advance the commitment before it becomes urgent.',
      base: 25, dueInDays: due, strategic: item.priority === 'high' ? 10 : 4,
    });
    candidates.push(stripInternal(ranked));
  }

  for (const health of portfolio.goalHealth.filter((item) => item.goal.status === 'active' || item.goal.status === 'at_risk')) {
    if (health.health === 'healthy' && health.dueInDays !== null && health.dueInDays > 14) continue;
    const urgency = health.health === 'critical' ? 28 : health.health === 'at_risk' ? 18 : health.health === 'watch' ? 10 : 4;
    const ranked = rankItem({
      id: `goal:${health.goal.id}`, source: 'goal', sourceId: health.goal.id, title: health.goal.title,
      priority: health.goal.priority, owner: health.goal.owner, dueDate: health.goal.dueDate,
      blocked: health.blockedTasks > 0, approvalRequired: false, reasons: health.reasons,
      recommendedAction: health.health === 'critical' ? 'Protect capacity and execute the next concrete milestone now.' : 'Advance the next measurable milestone.',
      base: 18 + urgency, dueInDays: health.dueInDays, strategic: health.goal.level === 'vision' ? 8 : health.goal.level === 'objective' ? 10 : 6,
    });
    candidates.push(stripInternal(ranked));
  }

  for (const exception of portfolio.delegationExceptions) {
    const delegation = exception.delegation;
    const due = daysUntil(delegation.dueDate);
    const ranked = rankItem({
      id: `delegation:${delegation.id}`, source: 'delegation', sourceId: delegation.id, title: delegation.expectedOutcome,
      priority: exception.severity === 'critical' ? 'critical' : exception.severity === 'high' ? 'high' : 'normal', owner: delegation.delegatee, dueDate: delegation.dueDate,
      blocked: delegation.status === 'blocked', approvalRequired: true,
      reasons: [exception.reason], recommendedAction: exception.recommendedAction,
      base: 22, dueInDays: due, strategic: exception.severity === 'critical' ? 14 : exception.severity === 'high' ? 8 : 2,
    });
    candidates.push(stripInternal(ranked));
  }

  for (const relation of relationships.relationships.filter((item) => item.status !== 'inactive')) {
    const material = relation.strategicValue === 'critical' || relation.strategicValue === 'high';
    const drift = relation.momentum === 'cooling' || relation.momentum === 'stalled';
    if (!material || (!drift && !relation.promisesByUs.length && !relation.openLoops.length)) continue;
    const ranked = rankItem({
      id: `relationship:${relation.id}`, source: 'relationship', sourceId: relation.id,
      title: `${relation.name}${relation.organization ? ` — ${relation.organization}` : ''}`,
      priority: relation.strategicValue === 'critical' ? 'critical' : 'high', owner: 'user', blocked: false, approvalRequired: true,
      reasons: [drift ? `Relationship momentum is ${relation.momentum}.` : 'Material relationship has an open loop.', ...(relation.promisesByUs[0] ? [`Promise by us: ${relation.promisesByUs[0]}`] : [])],
      recommendedAction: relation.nextBestAction || 'Review the open loop and prepare the appropriate follow-up.',
      base: 18, strategic: relation.strategicValue === 'critical' ? 16 : 10,
    });
    candidates.push(stripInternal(ranked));
  }

  for (const risk of anticipatory.risks) {
    const ranked = rankItem({
      id: `risk:${risk.id}`, source: 'risk', sourceId: risk.id, title: risk.title,
      priority: risk.severity === 'critical' ? 'critical' : risk.severity === 'high' ? 'high' : 'normal', blocked: risk.type === 'dependency_block', approvalRequired: risk.type === 'decision_bottleneck' || risk.type === 'relationship_followup',
      reasons: [risk.summary, ...risk.evidence.slice(0, 2)], recommendedAction: risk.recommendedAction,
      base: 20 + severityPoints(risk.severity), strategic: Math.round(risk.confidence * 10),
    });
    candidates.push(stripInternal(ranked));
  }

  if (capacity && (capacity.status === 'overloaded' || capacity.status === 'critical')) {
    candidates.push({
      id: 'capacity:rebalance', source: 'capacity', sourceId: capacity.id, title: 'Rebalance overloaded execution capacity', horizon: 'now', score: capacity.status === 'critical' ? 96 : 86,
      priority: capacity.status === 'critical' ? 'critical' : 'high', blocked: false, approvalRequired: true,
      reasons: [`Estimated demand ${capacity.estimatedDemandHours}h vs execution capacity ${capacity.executionCapacityHours}h; gap ${capacity.capacityGapHours}h.`],
      recommendedAction: 'Approve the smallest reversible combination of deferrals, delegation, calendar protection, or stops.',
    });
  }

  const deduped = new Map<string, PriorityItem>();
  for (const item of candidates) {
    const existing = deduped.get(`${item.source}:${item.sourceId}`);
    if (!existing || item.score > existing.score) deduped.set(`${item.source}:${item.sourceId}`, item);
  }
  const ranked = [...deduped.values()].sort((a, b) => b.score - a.score || Number(b.blocked) - Number(a.blocked));
  const now = ranked.filter((item) => item.horizon === 'now').slice(0, 8);
  const today = ranked.filter((item) => item.horizon === 'today').slice(0, 10);
  const week = ranked.filter((item) => item.horizon === 'week').slice(0, 14);
  const focus = ranked.slice(0, capacityTight ? 5 : 7);
  const defer = capacityTight ? ranked.filter((item) => item.priority === 'low' || (item.priority === 'normal' && item.score < 50)).slice(-8).reverse() : [];
  const stopDoing = capacity?.recommendations.filter((item) => item.action === 'stop').slice(0, 5).map((item): PriorityItem => ({ id: `capacity-stop:${item.id}`, source: 'capacity', sourceId: item.sourceId, title: item.title, horizon: 'week', score: 55, priority: 'normal', blocked: false, approvalRequired: true, reasons: [item.reason], recommendedAction: 'Review and explicitly approve pausing or stopping this work.' })) || [];
  const blockers = ranked.filter((item) => item.blocked || item.approvalRequired).slice(0, 10);
  const generatedAt = new Date().toISOString();
  const capacityStatus = capacity?.status || 'unknown';
  const headline = focus.length ? `${focus.length} focus item${focus.length === 1 ? '' : 's'}; ${now.length} need attention now${capacityTight ? `; capacity is ${capacityStatus}` : ''}.` : 'No material priority items are currently ranked.';
  const plan: DailyOperatingPlan = {
    id: randomUUID(), generatedAt, timezone: capacity?.profile.timezone || process.env.ELP_BRIEFING_TIMEZONE || 'America/Toronto', capacityStatus, headline, focus, now, today, week, defer, stopDoing, blockers,
    stats: { totalCandidates: ranked.length, critical: ranked.filter((item) => item.priority === 'critical').length, blocked: ranked.filter((item) => item.blocked).length, decisions: ranked.filter((item) => item.approvalRequired).length, relationshipItems: ranked.filter((item) => item.source === 'relationship').length, overload: capacityTight },
  };
  return args.persist === false ? plan : persistDailyOperatingPlan(args.profileId, plan);
}
