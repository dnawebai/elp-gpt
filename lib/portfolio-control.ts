import { randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { getAnticipatorySnapshot } from '@/lib/anticipatory-chief-of-staff';
import { getExecutiveLedger } from '@/lib/executive-memory';
import { getTaskBoard } from '@/lib/task-router';

export type GoalLevel = 'vision' | 'objective' | 'key_result';
export type GoalStatus = 'active' | 'at_risk' | 'achieved' | 'paused' | 'cancelled';
export type GoalOwner = 'user' | 'ai' | 'team' | 'external';
export type DelegationStatus = 'delegated' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type PortfolioHealth = 'healthy' | 'watch' | 'at_risk' | 'critical';

export type GoalRecord = {
  id: string;
  messageId?: string;
  title: string;
  description?: string;
  level: GoalLevel;
  parentId?: string;
  owner: GoalOwner;
  status: GoalStatus;
  priority: 'critical' | 'high' | 'normal' | 'low';
  dueDate?: string;
  metric?: string;
  target?: number;
  current?: number;
  unit?: string;
  taskIds: string[];
  ledgerIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type DelegationRecord = {
  id: string;
  messageId?: string;
  taskId: string;
  goalId?: string;
  delegatee: string;
  channel?: string;
  status: DelegationStatus;
  expectedOutcome: string;
  dueDate?: string;
  checkInEveryHours: number;
  lastCheckInAt?: string;
  progress: number;
  blockers: string[];
  evidence: string[];
  escalationNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type GoalHealthRecord = {
  goal: GoalRecord;
  health: PortfolioHealth;
  progress: number;
  openTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  delegatedOpen: number;
  delegatedStale: number;
  dueInDays: number | null;
  reasons: string[];
};

export type DelegationException = {
  delegation: DelegationRecord;
  severity: 'critical' | 'high' | 'normal';
  reason: string;
  recommendedAction: string;
};

export type PortfolioSnapshot = {
  configured: boolean;
  generatedAt: string;
  goals: GoalRecord[];
  delegations: DelegationRecord[];
  goalHealth: GoalHealthRecord[];
  delegationExceptions: DelegationException[];
  stats: {
    totalGoals: number;
    activeGoals: number;
    healthyGoals: number;
    watchGoals: number;
    atRiskGoals: number;
    criticalGoals: number;
    delegatedOpen: number;
    delegationExceptions: number;
    orphanTasks: number;
  };
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
function clip(value: string, max: number) { const clean = value.trim(); return clean.length <= max ? clean : `${clean.slice(0, max)}…`; }
function text(value: unknown, max = 1200) { return typeof value === 'string' && value.trim() ? clip(value, max) : ''; }
function strings(value: unknown, max = 30, itemMax = 500) {
  if (!Array.isArray(value)) return [] as string[];
  return value.flatMap((item) => { const clean = text(item, itemMax); return clean ? [clean] : []; }).slice(0, max);
}
function number(value: unknown, fallback = 0) { const n = typeof value === 'number' ? value : Number(value); return Number.isFinite(n) ? n : fallback; }
function isoDate(value: unknown) { const clean = text(value, 40); return /^20\d{2}-\d{2}-\d{2}$/.test(clean) ? clean : undefined; }
function daysUntil(date?: string) { if (!date) return null; const due = Date.parse(`${date}T23:59:59.999Z`); return Number.isFinite(due) ? Math.ceil((due - Date.now()) / 86_400_000) : null; }
function hoursSince(value?: string) { if (!value) return Infinity; const ms = Date.now() - Date.parse(value); return Number.isFinite(ms) ? Math.max(0, ms / 3_600_000) : Infinity; }

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`portfolio-control-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function parseGoal(message: { id: string; createdAt: string; metadata: Record<string, unknown> }): GoalRecord | null {
  const m = message.metadata || {};
  if (m.jarbisGoal !== true) return null;
  const title = text(m.title, 300);
  if (!title) return null;
  const level = ['vision', 'objective', 'key_result'].includes(String(m.goalLevel)) ? m.goalLevel as GoalLevel : 'objective';
  const owner = ['user', 'ai', 'team', 'external'].includes(String(m.goalOwner)) ? m.goalOwner as GoalOwner : 'user';
  const status = ['active', 'at_risk', 'achieved', 'paused', 'cancelled'].includes(String(m.goalStatus)) ? m.goalStatus as GoalStatus : 'active';
  const priority = ['critical', 'high', 'normal', 'low'].includes(String(m.priority)) ? m.priority as GoalRecord['priority'] : 'normal';
  let taskIds: string[] = [];
  let ledgerIds: string[] = [];
  try { taskIds = typeof m.taskIdsJson === 'string' ? strings(JSON.parse(m.taskIdsJson), 60, 200) : []; } catch {}
  try { ledgerIds = typeof m.ledgerIdsJson === 'string' ? strings(JSON.parse(m.ledgerIdsJson), 60, 200) : []; } catch {}
  const description = text(m.description, 3000);
  const parentId = text(m.parentId, 120);
  const metric = text(m.metric, 300);
  const unit = text(m.unit, 80);
  const dueDate = isoDate(m.dueDate);
  return {
    id: text(m.goalId, 120) || message.id,
    messageId: message.id,
    title,
    ...(description ? { description } : {}),
    level,
    ...(parentId ? { parentId } : {}),
    owner,
    status,
    priority,
    ...(dueDate ? { dueDate } : {}),
    ...(metric ? { metric } : {}),
    ...(typeof m.target === 'number' ? { target: m.target } : {}),
    ...(typeof m.current === 'number' ? { current: m.current } : {}),
    ...(unit ? { unit } : {}),
    taskIds,
    ledgerIds,
    createdAt: text(m.createdAt, 80) || message.createdAt,
    updatedAt: text(m.updatedAt, 80) || message.createdAt,
  };
}

function parseDelegation(message: { id: string; createdAt: string; metadata: Record<string, unknown> }): DelegationRecord | null {
  const m = message.metadata || {};
  if (m.jarbisDelegation !== true) return null;
  const taskId = text(m.taskId, 160);
  const delegatee = text(m.delegatee, 300);
  const expectedOutcome = text(m.expectedOutcome, 2500);
  if (!taskId || !delegatee || !expectedOutcome) return null;
  const status = ['delegated', 'in_progress', 'blocked', 'completed', 'cancelled'].includes(String(m.delegationStatus)) ? m.delegationStatus as DelegationStatus : 'delegated';
  let blockers: string[] = [];
  let evidence: string[] = [];
  try { blockers = typeof m.blockersJson === 'string' ? strings(JSON.parse(m.blockersJson), 20, 700) : []; } catch {}
  try { evidence = typeof m.evidenceJson === 'string' ? strings(JSON.parse(m.evidenceJson), 20, 900) : []; } catch {}
  const goalId = text(m.goalId, 120);
  const channel = text(m.channel, 120);
  const dueDate = isoDate(m.dueDate);
  const lastCheckInAt = text(m.lastCheckInAt, 80);
  const escalationNote = text(m.escalationNote, 1500);
  return {
    id: text(m.delegationId, 120) || message.id,
    messageId: message.id,
    taskId,
    ...(goalId ? { goalId } : {}),
    delegatee,
    ...(channel ? { channel } : {}),
    status,
    expectedOutcome,
    ...(dueDate ? { dueDate } : {}),
    checkInEveryHours: Math.max(1, Math.min(720, Math.round(number(m.checkInEveryHours, 48)))),
    ...(lastCheckInAt ? { lastCheckInAt } : {}),
    progress: Math.max(0, Math.min(100, Math.round(number(m.progress, 0)))),
    blockers,
    evidence,
    ...(escalationNote ? { escalationNote } : {}),
    createdAt: text(m.createdAt, 80) || message.createdAt,
    updatedAt: text(m.updatedAt, 80) || message.createdAt,
  };
}

async function loadRecords(profileId: string) {
  const handles = await getSession(profileId);
  if (!handles) return { configured: false, goals: [] as GoalRecord[], delegations: [] as DelegationRecord[] };
  try {
    const page = await handles.session.messages({ size: 100, reverse: true });
    const goals = page.items.map(parseGoal).filter((item): item is GoalRecord => Boolean(item));
    const delegations = page.items.map(parseDelegation).filter((item): item is DelegationRecord => Boolean(item));
    return { configured: true, goals, delegations };
  } catch (error) {
    console.error('ELP portfolio records read failed', error);
    return { configured: true, goals: [] as GoalRecord[], delegations: [] as DelegationRecord[] };
  }
}

export async function createGoal(profileId: string, input: {
  title: string;
  description?: string;
  level?: GoalLevel;
  parentId?: string;
  owner?: GoalOwner;
  priority?: GoalRecord['priority'];
  dueDate?: string;
  metric?: string;
  target?: number;
  current?: number;
  unit?: string;
  taskIds?: string[];
  ledgerIds?: string[];
}) {
  const handles = await getSession(profileId);
  if (!handles) throw new Error('Portfolio memory is unavailable.');
  const id = randomUUID();
  const now = new Date().toISOString();
  const title = text(input.title, 300);
  if (!title) throw new Error('Goal title is required.');
  const goal: GoalRecord = {
    id,
    title,
    ...(text(input.description, 3000) ? { description: text(input.description, 3000) } : {}),
    level: input.level || 'objective',
    ...(text(input.parentId, 120) ? { parentId: text(input.parentId, 120) } : {}),
    owner: input.owner || 'user',
    status: 'active',
    priority: input.priority || 'normal',
    ...(isoDate(input.dueDate) ? { dueDate: isoDate(input.dueDate) } : {}),
    ...(text(input.metric, 300) ? { metric: text(input.metric, 300) } : {}),
    ...(typeof input.target === 'number' ? { target: input.target } : {}),
    ...(typeof input.current === 'number' ? { current: input.current } : {}),
    ...(text(input.unit, 80) ? { unit: text(input.unit, 80) } : {}),
    taskIds: strings(input.taskIds, 60, 200),
    ledgerIds: strings(input.ledgerIds, 60, 200),
    createdAt: now,
    updatedAt: now,
  };
  const created = await handles.session.addMessages([{ peerId: handles.elp.id, content: `[GOAL][${goal.level.toUpperCase()}] ${goal.title}`, metadata: { jarbisGoal: true, recordVersion: 1, goalId: id, title: goal.title, description: goal.description || '', goalLevel: goal.level, parentId: goal.parentId || '', goalOwner: goal.owner, goalStatus: goal.status, priority: goal.priority, dueDate: goal.dueDate || '', metric: goal.metric || '', target: goal.target ?? null, current: goal.current ?? null, unit: goal.unit || '', taskIdsJson: JSON.stringify(goal.taskIds), ledgerIdsJson: JSON.stringify(goal.ledgerIds), createdAt: now, updatedAt: now } }]);
  return { ...goal, ...(created[0]?.id ? { messageId: created[0].id } : {}) };
}

export async function updateGoal(profileId: string, goalId: string, patch: Partial<Omit<GoalRecord, 'id' | 'messageId' | 'createdAt' | 'updatedAt'>>) {
  const handles = await getSession(profileId);
  if (!handles) throw new Error('Portfolio memory is unavailable.');
  const page = await handles.session.messages({ size: 100, reverse: true });
  const message = page.items.find((item) => item.metadata?.jarbisGoal === true && item.metadata?.goalId === goalId);
  if (!message) throw new Error('Goal not found.');
  const current = parseGoal(message);
  if (!current) throw new Error('Goal record is invalid.');
  const next: GoalRecord = {
    ...current,
    ...(patch.title !== undefined ? { title: text(patch.title, 300) || current.title } : {}),
    ...(patch.description !== undefined ? { description: text(patch.description, 3000) || undefined } : {}),
    ...(patch.level !== undefined ? { level: patch.level } : {}),
    ...(patch.parentId !== undefined ? { parentId: text(patch.parentId, 120) || undefined } : {}),
    ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: isoDate(patch.dueDate) } : {}),
    ...(patch.metric !== undefined ? { metric: text(patch.metric, 300) || undefined } : {}),
    ...(patch.target !== undefined ? { target: patch.target } : {}),
    ...(patch.current !== undefined ? { current: patch.current } : {}),
    ...(patch.unit !== undefined ? { unit: text(patch.unit, 80) || undefined } : {}),
    ...(patch.taskIds !== undefined ? { taskIds: strings(patch.taskIds, 60, 200) } : {}),
    ...(patch.ledgerIds !== undefined ? { ledgerIds: strings(patch.ledgerIds, 60, 200) } : {}),
    updatedAt: new Date().toISOString(),
  };
  await handles.session.updateMessage(message.id, { ...message.metadata, title: next.title, description: next.description || '', goalLevel: next.level, parentId: next.parentId || '', goalOwner: next.owner, goalStatus: next.status, priority: next.priority, dueDate: next.dueDate || '', metric: next.metric || '', target: next.target ?? null, current: next.current ?? null, unit: next.unit || '', taskIdsJson: JSON.stringify(next.taskIds), ledgerIdsJson: JSON.stringify(next.ledgerIds), updatedAt: next.updatedAt });
  return next;
}

export async function createDelegation(profileId: string, input: {
  taskId: string;
  goalId?: string;
  delegatee: string;
  channel?: string;
  expectedOutcome: string;
  dueDate?: string;
  checkInEveryHours?: number;
}) {
  const handles = await getSession(profileId);
  if (!handles) throw new Error('Portfolio memory is unavailable.');
  const id = randomUUID();
  const now = new Date().toISOString();
  const taskId = text(input.taskId, 160);
  const delegatee = text(input.delegatee, 300);
  const expectedOutcome = text(input.expectedOutcome, 2500);
  if (!taskId || !delegatee || !expectedOutcome) throw new Error('Delegation requires taskId, delegatee and expectedOutcome.');
  const record: DelegationRecord = {
    id,
    taskId,
    ...(text(input.goalId, 120) ? { goalId: text(input.goalId, 120) } : {}),
    delegatee,
    ...(text(input.channel, 120) ? { channel: text(input.channel, 120) } : {}),
    status: 'delegated',
    expectedOutcome,
    ...(isoDate(input.dueDate) ? { dueDate: isoDate(input.dueDate) } : {}),
    checkInEveryHours: Math.max(1, Math.min(720, Math.round(input.checkInEveryHours || 48))),
    progress: 0,
    blockers: [],
    evidence: [],
    createdAt: now,
    updatedAt: now,
  };
  const created = await handles.session.addMessages([{ peerId: handles.elp.id, content: `[DELEGATION] ${record.delegatee}\n${record.expectedOutcome}`, metadata: { jarbisDelegation: true, recordVersion: 1, delegationId: id, taskId, goalId: record.goalId || '', delegatee: record.delegatee, channel: record.channel || '', delegationStatus: record.status, expectedOutcome: record.expectedOutcome, dueDate: record.dueDate || '', checkInEveryHours: record.checkInEveryHours, progress: 0, blockersJson: '[]', evidenceJson: '[]', createdAt: now, updatedAt: now } }]);
  return { ...record, ...(created[0]?.id ? { messageId: created[0].id } : {}) };
}

export async function updateDelegation(profileId: string, delegationId: string, patch: Partial<Omit<DelegationRecord, 'id' | 'messageId' | 'createdAt' | 'updatedAt' | 'taskId'>>) {
  const handles = await getSession(profileId);
  if (!handles) throw new Error('Portfolio memory is unavailable.');
  const page = await handles.session.messages({ size: 100, reverse: true });
  const message = page.items.find((item) => item.metadata?.jarbisDelegation === true && item.metadata?.delegationId === delegationId);
  if (!message) throw new Error('Delegation not found.');
  const current = parseDelegation(message);
  if (!current) throw new Error('Delegation record is invalid.');
  const next: DelegationRecord = {
    ...current,
    ...(patch.goalId !== undefined ? { goalId: text(patch.goalId, 120) || undefined } : {}),
    ...(patch.delegatee !== undefined ? { delegatee: text(patch.delegatee, 300) || current.delegatee } : {}),
    ...(patch.channel !== undefined ? { channel: text(patch.channel, 120) || undefined } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.expectedOutcome !== undefined ? { expectedOutcome: text(patch.expectedOutcome, 2500) || current.expectedOutcome } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: isoDate(patch.dueDate) } : {}),
    ...(patch.checkInEveryHours !== undefined ? { checkInEveryHours: Math.max(1, Math.min(720, Math.round(patch.checkInEveryHours))) } : {}),
    ...(patch.lastCheckInAt !== undefined ? { lastCheckInAt: text(patch.lastCheckInAt, 80) || undefined } : {}),
    ...(patch.progress !== undefined ? { progress: Math.max(0, Math.min(100, Math.round(patch.progress))) } : {}),
    ...(patch.blockers !== undefined ? { blockers: strings(patch.blockers, 20, 700) } : {}),
    ...(patch.evidence !== undefined ? { evidence: strings(patch.evidence, 20, 900) } : {}),
    ...(patch.escalationNote !== undefined ? { escalationNote: text(patch.escalationNote, 1500) || undefined } : {}),
    updatedAt: new Date().toISOString(),
  };
  await handles.session.updateMessage(message.id, { ...message.metadata, goalId: next.goalId || '', delegatee: next.delegatee, channel: next.channel || '', delegationStatus: next.status, expectedOutcome: next.expectedOutcome, dueDate: next.dueDate || '', checkInEveryHours: next.checkInEveryHours, lastCheckInAt: next.lastCheckInAt || '', progress: next.progress, blockersJson: JSON.stringify(next.blockers), evidenceJson: JSON.stringify(next.evidence), escalationNote: next.escalationNote || '', updatedAt: next.updatedAt });
  return next;
}

function goalProgress(goal: GoalRecord) {
  if (goal.status === 'achieved') return 100;
  if (typeof goal.target === 'number' && goal.target !== 0 && typeof goal.current === 'number') return Math.max(0, Math.min(100, Math.round((goal.current / goal.target) * 100)));
  return 0;
}

function deriveGoalHealth(goal: GoalRecord, taskById: Map<string, { status: string; priority: string }>, delegations: DelegationRecord[], riskIds: Set<string>): GoalHealthRecord {
  const linked = goal.taskIds.map((id) => taskById.get(id)).filter(Boolean) as Array<{ status: string; priority: string }>;
  const openTasks = linked.filter((item) => item.status === 'active' || item.status === 'blocked').length;
  const blockedTasks = linked.filter((item) => item.status === 'blocked').length;
  const overdueTasks = 0;
  const goalDelegations = delegations.filter((item) => item.goalId === goal.id && !['completed', 'cancelled'].includes(item.status));
  const delegatedStale = goalDelegations.filter((item) => hoursSince(item.lastCheckInAt || item.createdAt) > item.checkInEveryHours).length;
  const dueInDays = daysUntil(goal.dueDate);
  const progress = goalProgress(goal);
  const reasons: string[] = [];
  let health: PortfolioHealth = 'healthy';
  if (goal.status === 'at_risk') { health = 'at_risk'; reasons.push('Goal is explicitly marked at risk.'); }
  if (blockedTasks > 0) { health = 'at_risk'; reasons.push(`${blockedTasks} linked task${blockedTasks === 1 ? '' : 's'} blocked.`); }
  if (delegatedStale > 0) { health = 'at_risk'; reasons.push(`${delegatedStale} delegated item${delegatedStale === 1 ? '' : 's'} missed the check-in cadence.`); }
  if (riskIds.has(goal.id)) { health = 'at_risk'; reasons.push('Anticipatory forecast references this goal as exposed.'); }
  if (dueInDays !== null && dueInDays < 0 && goal.status !== 'achieved') { health = 'critical'; reasons.push(`Goal is ${Math.abs(dueInDays)} day${Math.abs(dueInDays) === 1 ? '' : 's'} overdue.`); }
  else if (dueInDays !== null && dueInDays <= 3 && progress < 80 && goal.status !== 'achieved') { health = 'critical'; reasons.push(`Due in ${Math.max(0, dueInDays)} days with ${progress}% recorded progress.`); }
  else if (dueInDays !== null && dueInDays <= 7 && progress < 60 && health === 'healthy') { health = 'watch'; reasons.push(`Due within a week with ${progress}% recorded progress.`); }
  if (!goal.taskIds.length && goal.level !== 'vision' && goal.status === 'active' && health === 'healthy') { health = 'watch'; reasons.push('Active goal has no linked execution tasks.'); }
  if (!reasons.length) reasons.push('No material portfolio exception is currently detected.');
  return { goal, health, progress, openTasks, blockedTasks, overdueTasks, delegatedOpen: goalDelegations.length, delegatedStale, dueInDays, reasons };
}

function deriveDelegationExceptions(delegations: DelegationRecord[]) {
  const exceptions: DelegationException[] = [];
  for (const delegation of delegations.filter((item) => !['completed', 'cancelled'].includes(item.status))) {
    const due = daysUntil(delegation.dueDate);
    const staleHours = hoursSince(delegation.lastCheckInAt || delegation.createdAt);
    if (delegation.status === 'blocked') {
      exceptions.push({ delegation, severity: 'high', reason: delegation.blockers[0] || 'Delegated work is marked blocked.', recommendedAction: 'Resolve the blocker or reassign the work; do not treat delegation as progress.' });
      continue;
    }
    if (due !== null && due < 0) {
      exceptions.push({ delegation, severity: 'critical', reason: `Delegated work is ${Math.abs(due)} day${Math.abs(due) === 1 ? '' : 's'} overdue.`, recommendedAction: 'Escalate, renegotiate the deadline, or reassign with an explicit recovery plan.' });
      continue;
    }
    if (staleHours > delegation.checkInEveryHours * 2) {
      exceptions.push({ delegation, severity: due !== null && due <= 3 ? 'critical' : 'high', reason: `No recorded check-in for ${Math.round(staleHours)} hours; expected every ${delegation.checkInEveryHours} hours.`, recommendedAction: 'Request a concrete status update with evidence, blockers and next milestone.' });
      continue;
    }
    if (staleHours > delegation.checkInEveryHours) {
      exceptions.push({ delegation, severity: 'normal', reason: 'Delegated work has passed its expected check-in cadence.', recommendedAction: 'Prepare a lightweight status check; sending remains approval-gated if an external message is required.' });
    }
  }
  return exceptions.sort((a, b) => ({ critical: 3, high: 2, normal: 1 }[b.severity] - { critical: 3, high: 2, normal: 1 }[a.severity]));
}

export async function getPortfolioSnapshot(profileId: string): Promise<PortfolioSnapshot> {
  const [records, board, ledger, anticipatory] = await Promise.all([loadRecords(profileId), getTaskBoard(profileId), getExecutiveLedger(profileId), getAnticipatorySnapshot(profileId)]);
  const allTasks = [...board.queues.now, ...board.queues.decisions, ...board.queues.working, ...board.queues.delegated, ...board.queues.done];
  const taskById = new Map(allTasks.map((item) => [item.id, { status: item.status, priority: item.priority }]));
  const riskIds = new Set(anticipatory.risks.flatMap((item) => item.relatedIds));
  const goals = records.goals.filter((goal, index, list) => list.findIndex((item) => item.id === goal.id) === index);
  const delegations = records.delegations.filter((delegation, index, list) => list.findIndex((item) => item.id === delegation.id) === index);
  const goalHealth = goals.filter((goal) => !['cancelled'].includes(goal.status)).map((goal) => deriveGoalHealth(goal, taskById, delegations, riskIds));
  const delegationExceptions = deriveDelegationExceptions(delegations);
  const linkedTasks = new Set(goals.flatMap((goal) => goal.taskIds));
  const orphanTasks = allTasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled' && !linkedTasks.has(task.id)).length;
  void ledger;
  return {
    configured: records.configured,
    generatedAt: new Date().toISOString(),
    goals,
    delegations,
    goalHealth,
    delegationExceptions,
    stats: {
      totalGoals: goals.length,
      activeGoals: goals.filter((item) => item.status === 'active' || item.status === 'at_risk').length,
      healthyGoals: goalHealth.filter((item) => item.health === 'healthy').length,
      watchGoals: goalHealth.filter((item) => item.health === 'watch').length,
      atRiskGoals: goalHealth.filter((item) => item.health === 'at_risk').length,
      criticalGoals: goalHealth.filter((item) => item.health === 'critical').length,
      delegatedOpen: delegations.filter((item) => !['completed', 'cancelled'].includes(item.status)).length,
      delegationExceptions: delegationExceptions.length,
      orphanTasks,
    },
  };
}

export function portfolioSnapshotToPrompt(snapshot: PortfolioSnapshot) {
  if (!snapshot.configured && !snapshot.goals.length && !snapshot.delegations.length) return '';
  const goals = snapshot.goalHealth.filter((item) => item.goal.status === 'active' || item.goal.status === 'at_risk').slice(0, 12).map((item) => `- [${item.health.toUpperCase()}] ${item.goal.title} (${item.progress}% progress${item.dueInDays === null ? '' : `, due ${item.dueInDays}d`}): ${item.reasons.join(' ')}`);
  const delegations = snapshot.delegationExceptions.slice(0, 8).map((item) => `- [${item.severity.toUpperCase()}] ${item.delegation.delegatee}: ${item.delegation.expectedOutcome}. ${item.reason}`);
  return [`PORTFOLIO CONTROL: ${snapshot.stats.activeGoals} active goals; ${snapshot.stats.criticalGoals} critical; ${snapshot.stats.atRiskGoals} at risk; ${snapshot.stats.delegationExceptions} delegation exceptions; ${snapshot.stats.orphanTasks} open tasks not linked to a goal.`, goals.length ? `GOAL HEALTH:\n${goals.join('\n')}` : '', delegations.length ? `DELEGATION EXCEPTIONS:\n${delegations.join('\n')}` : ''].filter(Boolean).join('\n\n');
}
