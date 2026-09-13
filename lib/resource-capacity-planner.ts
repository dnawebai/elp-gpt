import { randomUUID } from 'node:crypto';
import { executeComposioTool, searchComposioTools } from '@/lib/composio';
import { getExecutiveLedger } from '@/lib/executive-memory';
import { getPortfolioSnapshot } from '@/lib/portfolio-control';
import { getTaskBoard, createTask } from '@/lib/task-router';
import { getCapacityProfile, persistCapacityPlan, type AllocationRecommendation, type CalendarCapacity, type CapacityDemand, type CapacityPlan, type CapacityStatus } from '@/lib/capacity-memory';

function round(value: number) { return Math.round(value * 10) / 10; }
function daysUntil(date?: string) { if (!date) return null; const ms = Date.parse(`${date}T23:59:59.999Z`) - Date.now(); return Number.isFinite(ms) ? Math.ceil(ms / 86_400_000) : null; }
function priorityWeight(priority: string) { return priority === 'critical' ? 1.6 : priority === 'high' ? 1.3 : priority === 'low' ? 0.7 : 1; }

async function readCalendar(profileId: string, timezone: string, horizonDays: number): Promise<CalendarCapacity> {
  try {
    const tools = await searchComposioTools('list calendar events within a date range', 'GOOGLECALENDAR');
    const tool = tools.find((item) => item.slug.toUpperCase().includes('EVENTS_LIST')) || tools[0];
    if (!tool) return { available: false, horizonDays, eventCount: 0, busyHours: 0, allDayEvents: 0, note: 'No read-only calendar listing tool is available.' };
    const start = new Date();
    const end = new Date(start.getTime() + horizonDays * 86_400_000);
    const schema = tool.inputSchema || {};
    const props = (schema.properties || {}) as Record<string, unknown>;
    const args: Record<string, unknown> = {};
    if ('calendarId' in props) args.calendarId = 'primary';
    if ('calendar_id' in props) args.calendar_id = 'primary';
    if ('timeMin' in props) args.timeMin = start.toISOString();
    if ('time_min' in props) args.time_min = start.toISOString();
    if ('timeMax' in props) args.timeMax = end.toISOString();
    if ('time_max' in props) args.time_max = end.toISOString();
    if ('timezone' in props) args.timezone = timezone;
    if ('singleEvents' in props) args.singleEvents = true;
    if ('single_events' in props) args.single_events = true;
    if ('maxResults' in props) args.maxResults = 250;
    if ('max_results' in props) args.max_results = 250;
    const result = await executeComposioTool({ toolSlug: tool.slug, arguments: args, profileId });
    const json = JSON.stringify(result);
    const raw = result as Record<string, unknown>;
    const candidates: unknown[] = [];
    const walk = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (const item of value) walk(item); return; }
      const obj = value as Record<string, unknown>;
      if ((obj.start || obj.start_time || obj.startTime) && (obj.end || obj.end_time || obj.endTime)) candidates.push(obj);
      for (const child of Object.values(obj)) walk(child);
    };
    walk(raw);
    const seen = new Set<string>();
    let busy = 0;
    let allDay = 0;
    for (const value of candidates) {
      const event = value as Record<string, unknown>;
      const startValue = event.start ?? event.start_time ?? event.startTime;
      const endValue = event.end ?? event.end_time ?? event.endTime;
      const normalize = (v: unknown) => {
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          return typeof o.dateTime === 'string' ? o.dateTime : typeof o.date === 'string' ? o.date : typeof o.datetime === 'string' ? o.datetime : '';
        }
        return '';
      };
      const s = normalize(startValue);
      const e = normalize(endValue);
      const key = `${s}|${e}|${String(event.id || event.event_id || '')}`;
      if (!s || !e || seen.has(key)) continue;
      seen.add(key);
      if (/^20\d{2}-\d{2}-\d{2}$/.test(s)) { allDay += 1; continue; }
      const ms = Date.parse(e) - Date.parse(s);
      if (Number.isFinite(ms) && ms > 0 && ms <= 24 * 3_600_000) busy += ms / 3_600_000;
    }
    return { available: true, source: tool.slug, horizonDays, eventCount: seen.size, busyHours: round(Math.max(0, busy)), allDayEvents: allDay, note: json.length > 0 ? undefined : 'Calendar response was empty.' };
  } catch (error) {
    return { available: false, horizonDays, eventCount: 0, busyHours: 0, allDayEvents: 0, note: error instanceof Error ? error.message.slice(0, 500) : 'Calendar read failed.' };
  }
}

function statusFor(loadRatio: number, gap: number): CapacityStatus {
  if (gap > 20 || loadRatio >= 1.35) return 'critical';
  if (gap > 0 || loadRatio >= 1.05) return 'overloaded';
  if (loadRatio >= 0.85) return 'tight';
  return 'balanced';
}

export async function runResourceCapacityPlanner(args: { profileId: string; persist?: boolean; createRecoveryTasks?: boolean; horizonDays?: number }) {
  const horizonDays = Math.max(3, Math.min(14, Math.round(args.horizonDays || 7)));
  const [profile, portfolio, board, ledger] = await Promise.all([getCapacityProfile(args.profileId), getPortfolioSnapshot(args.profileId), getTaskBoard(args.profileId), getExecutiveLedger(args.profileId)]);
  const calendar = await readCalendar(args.profileId, profile.timezone, horizonDays);
  const allTasks = [...board.queues.now, ...board.queues.decisions, ...board.queues.working, ...board.queues.delegated].filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
  const demand: CapacityDemand[] = [];
  for (const task of allTasks) {
    const base = profile.defaultTaskHours * priorityWeight(task.priority);
    const ownerFactor = task.owner === 'user' ? 1 : task.owner === 'ai' || task.owner === 'connector' || task.owner === 'browser' ? 0.35 : 0.2;
    demand.push({ id: `task:${task.id}`, source: 'task', sourceId: task.id, title: task.title, owner: task.owner, priority: task.priority, estimatedHours: round(base * ownerFactor), reason: task.queue === 'decisions' ? 'Principal decision/input consumes attention and blocks execution.' : `${task.queue} work currently active.` });
  }
  for (const item of ledger.items.filter((x) => x.primaryKind === 'commitment' && (x.status === 'active' || x.status === 'blocked'))) {
    const due = daysUntil(item.dueDate);
    const urgency = due !== null && due <= 2 ? 1.5 : due !== null && due <= 7 ? 1.2 : 1;
    demand.push({ id: `commitment:${item.id}`, source: 'commitment', sourceId: item.id, title: item.title, owner: item.owner, priority: item.priority === 'high' ? 'high' : 'normal', dueDate: item.dueDate, estimatedHours: round(profile.defaultTaskHours * urgency), reason: item.blocked ? 'Blocked executive commitment.' : item.overdue ? 'Overdue executive commitment.' : 'Open executive commitment requires capacity.' });
  }
  for (const delegation of portfolio.delegations.filter((item) => !['completed', 'cancelled'].includes(item.status))) {
    const recoveryFactor = delegation.status === 'blocked' ? 0.7 : portfolio.delegationExceptions.some((e) => e.delegation.id === delegation.id) ? 0.4 : 0.15;
    demand.push({ id: `delegation:${delegation.id}`, source: 'delegation', sourceId: delegation.id, title: delegation.expectedOutcome, owner: delegation.delegatee, priority: delegation.status === 'blocked' ? 'high' : 'normal', dueDate: delegation.dueDate, estimatedHours: round(profile.defaultTaskHours * recoveryFactor), reason: 'Delegated work still consumes management/check-in capacity until completion is verified.', goalId: delegation.goalId });
  }
  const activeGoalHealth = portfolio.goalHealth.filter((item) => item.goal.status === 'active' || item.goal.status === 'at_risk');
  for (const health of activeGoalHealth) {
    if (health.health === 'critical' || health.health === 'at_risk') {
      demand.push({ id: `goal:${health.goal.id}`, source: 'goal', sourceId: health.goal.id, title: health.goal.title, owner: health.goal.owner, priority: health.goal.priority, dueDate: health.goal.dueDate, estimatedHours: round(profile.defaultTaskHours * (health.health === 'critical' ? 1.5 : 0.8)), reason: `Goal health is ${health.health}; recovery/coordination capacity is required.`, goalId: health.goal.id });
    }
  }
  const gross = round(profile.weeklyHours * (horizonDays / 7));
  const reserve = round(gross * (profile.reservePercent / 100));
  const admin = round(gross * (profile.adminPercent / 100));
  const execution = round(Math.max(0, gross - reserve - admin - calendar.busyHours));
  const estimatedDemand = round(demand.reduce((sum, item) => sum + item.estimatedHours, 0));
  const gap = round(Math.max(0, estimatedDemand - execution));
  const ratio = execution > 0 ? round(estimatedDemand / execution) : estimatedDemand > 0 ? 9 : 0;
  const status = statusFor(ratio, gap);
  const recommendations: AllocationRecommendation[] = [];
  const push = (item: Omit<AllocationRecommendation, 'id'>) => recommendations.push({ id: randomUUID(), ...item });
  for (const health of activeGoalHealth.filter((item) => item.health === 'critical').slice(0, 4)) push({ action: 'accelerate', source: 'goal', sourceId: health.goal.id, title: health.goal.title, reason: health.reasons.join(' '), confidence: 0.9, requiresApproval: false });
  for (const exception of portfolio.delegationExceptions.filter((item) => item.severity === 'critical' || item.severity === 'high').slice(0, 4)) push({ action: 'resolve', source: 'delegation', sourceId: exception.delegation.id, title: exception.delegation.expectedOutcome, reason: exception.reason, confidence: 0.9, requiresApproval: true });
  const lowPriority = demand.filter((item) => item.priority === 'low' || (item.priority === 'normal' && !item.dueDate)).sort((a, b) => b.estimatedHours - a.estimatedHours);
  if (status === 'overloaded' || status === 'critical') {
    let recovered = 0;
    for (const item of lowPriority.slice(0, 6)) {
      if (recovered >= gap) break;
      push({ action: item.owner === 'user' ? 'delegate' : 'defer', source: item.source, sourceId: item.sourceId, title: item.title, reason: `Capacity is ${status}; this is a lower-urgency candidate to free execution bandwidth.`, estimatedHoursRecovered: item.estimatedHours, confidence: 0.72, requiresApproval: true });
      recovered += item.estimatedHours;
    }
  }
  if (activeGoalHealth.length > profile.maxConcurrentObjectives) push({ action: 'stop', source: 'portfolio', sourceId: 'concurrency', title: 'Reduce concurrent objectives', reason: `${activeGoalHealth.length} active objectives exceed the configured limit of ${profile.maxConcurrentObjectives}. Pause or stop the lowest-value objectives rather than spreading capacity thinner.`, confidence: 0.92, requiresApproval: true });
  if (calendar.available && calendar.busyHours > gross * 0.45) push({ action: 'protect', source: 'calendar', sourceId: 'calendar-load', title: 'Protect execution blocks', reason: `${calendar.busyHours} calendar hours consume more than 45% of gross capacity in the planning horizon.`, confidence: 0.85, requiresApproval: true });
  const plan: CapacityPlan = { id: randomUUID(), generatedAt: new Date().toISOString(), profile, calendar, status, grossCapacityHours: gross, reserveHours: reserve, adminHours: admin, calendarBusyHours: calendar.busyHours, executionCapacityHours: execution, estimatedDemandHours: estimatedDemand, capacityGapHours: gap, loadRatio: ratio, demand: demand.sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || b.estimatedHours - a.estimatedHours).slice(0, 80), recommendations: recommendations.slice(0, 20), stats: { activeGoals: portfolio.stats.activeGoals, criticalGoals: portfolio.stats.criticalGoals, atRiskGoals: portfolio.stats.atRiskGoals, openCommitments: ledger.stats.openCommitments, activeTasks: allTasks.length, delegatedOpen: portfolio.stats.delegatedOpen, delegationExceptions: portfolio.stats.delegationExceptions, orphanTasks: portfolio.stats.orphanTasks } };
  if (args.createRecoveryTasks && (status === 'critical' || status === 'overloaded')) {
    const existing = allTasks.some((task) => task.source === 'capacity-planner' && task.status !== 'completed' && task.status !== 'cancelled');
    if (!existing) await createTask(args.profileId, { objective: `Rebalance resource capacity. Current estimated demand is ${estimatedDemand}h versus ${execution}h execution capacity over ${horizonDays} days. Review the capacity plan and prepare the smallest reversible set of deferrals, delegations, calendar protections, or stops. Do not execute external changes without approval.`, queue: 'decisions', owner: 'user', priority: status === 'critical' ? 'critical' : 'high', approval: 'none', source: 'capacity-planner', summary: `Capacity ${status}: ${gap}h gap.` });
  }
  return args.persist === false ? plan : persistCapacityPlan(args.profileId, plan);
}
