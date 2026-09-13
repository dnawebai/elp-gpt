import { Honcho } from '@honcho-ai/sdk';
import { listHonchoMessages } from '@/lib/honcho-pagination';

export type TaskQueue = 'now' | 'decisions' | 'working' | 'delegated' | 'done';
export type TaskOwner = 'user' | 'ai' | 'connector' | 'browser' | 'human' | 'professional';
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
export type TaskApproval = 'none' | 'required' | 'professional';
export type TaskStatus = 'active' | 'blocked' | 'completed' | 'cancelled';

export type TaskRecord = {
  id: string;
  objective: string;
  title: string;
  queue: TaskQueue;
  owner: TaskOwner;
  priority: TaskPriority;
  approval: TaskApproval;
  status: TaskStatus;
  source: string;
  createdAt: string;
  updatedAt?: string;
  sessionId?: string;
  summary?: string;
  toolSlug?: string;
  risk?: string;
  evidence?: string;
  note?: string;
  estimatedHours?: number;
  remainingHours?: number;
  progressPercent?: number;
  dueAt?: string;
  startedAt?: string;
  completedAt?: string;
  progressEvidence?: string;
};

export type TaskBoard = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  total: number;
  queues: Record<TaskQueue, TaskRecord[]>;
};

const QUEUES = new Set<TaskQueue>(['now', 'decisions', 'working', 'delegated', 'done']);
const OWNERS = new Set<TaskOwner>(['user', 'ai', 'connector', 'browser', 'human', 'professional']);
const PRIORITIES = new Set<TaskPriority>(['critical', 'high', 'normal', 'low']);
const APPROVALS = new Set<TaskApproval>(['none', 'required', 'professional']);
const STATUSES = new Set<TaskStatus>(['active', 'blocked', 'completed', 'cancelled']);

function clip(value: string, max: number) { const clean = value.trim(); return clean.length <= max ? clean : `${clean.slice(0, max)}…`; }
function optionalNumber(value: unknown, min: number, max: number) { const n = typeof value === 'number' ? value : Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : undefined; }
function optionalIso(value: unknown) { if (typeof value !== 'string' || !value.trim()) return undefined; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : undefined; }
function emptyBoard(configured = false): TaskBoard { return { configured, available: false, generatedAt: new Date().toISOString(), total: 0, queues: { now: [], decisions: [], working: [], delegated: [], done: [] } }; }
function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }

async function getTaskSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`tasks-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function metadataString(metadata: Record<string, unknown>, key: string) { const value = metadata[key]; return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function titleFromObjective(objective: string) { const first = objective.split(/\n|(?<=[.!?])\s+/)[0] || objective; return clip(first.replace(/^[-*\s]+/, ''), 150); }
function inferPriority(objective: string): TaskPriority { if (/\b(emergency|critical|immediately|right now)\b/i.test(objective)) return 'critical'; if (/\b(urgent|asap|today|deadline|high priority)\b/i.test(objective)) return 'high'; if (/\b(low priority|whenever|no rush)\b/i.test(objective)) return 'low'; return 'normal'; }

function parseTask(message: { id: string; content: string; createdAt: string; metadata: Record<string, unknown> }): TaskRecord | null {
  const metadata = message.metadata || {};
  if (metadata.jarbisTask !== true) return null;
  const objective = metadataString(metadata, 'objective') || message.content.split('\n').slice(1).join('\n').trim();
  if (!objective) return null;
  const queueRaw = metadataString(metadata, 'taskQueue') as TaskQueue | undefined;
  const ownerRaw = metadataString(metadata, 'taskOwner') as TaskOwner | undefined;
  const priorityRaw = metadataString(metadata, 'priority') as TaskPriority | undefined;
  const approvalRaw = metadataString(metadata, 'approval') as TaskApproval | undefined;
  const statusRaw = metadataString(metadata, 'taskStatus') as TaskStatus | undefined;
  const queue = queueRaw && QUEUES.has(queueRaw) ? queueRaw : 'working';
  const owner = ownerRaw && OWNERS.has(ownerRaw) ? ownerRaw : 'ai';
  const priority = priorityRaw && PRIORITIES.has(priorityRaw) ? priorityRaw : inferPriority(objective);
  const approval = approvalRaw && APPROVALS.has(approvalRaw) ? approvalRaw : 'none';
  const status = statusRaw && STATUSES.has(statusRaw) ? statusRaw : queue === 'done' ? 'completed' : 'active';
  const estimatedHours = optionalNumber(metadata.estimatedHours, 0.1, 10_000);
  const progressPercent = optionalNumber(metadata.progressPercent, 0, 100);
  const remainingHours = optionalNumber(metadata.remainingHours, 0, 10_000) ?? (estimatedHours !== undefined && progressPercent !== undefined ? Math.max(0, estimatedHours * (1 - progressPercent / 100)) : undefined);
  const updatedAt = metadataString(metadata, 'updatedAt'); const sessionId = metadataString(metadata, 'sessionId'); const summary = metadataString(metadata, 'summary'); const toolSlug = metadataString(metadata, 'toolSlug'); const risk = metadataString(metadata, 'risk'); const evidence = metadataString(metadata, 'evidence'); const note = metadataString(metadata, 'note');
  const dueAt = optionalIso(metadata.dueAt); const startedAt = optionalIso(metadata.startedAt); const completedAt = optionalIso(metadata.completedAt); const progressEvidence = metadataString(metadata, 'progressEvidence');
  return { id: message.id, objective: clip(objective, 4000), title: metadataString(metadata, 'title') || titleFromObjective(objective), queue, owner, priority, approval, status, source: metadataString(metadata, 'source') || 'manual', createdAt: metadataString(metadata, 'createdAt') || message.createdAt,
    ...(updatedAt ? { updatedAt } : {}), ...(sessionId ? { sessionId } : {}), ...(summary ? { summary } : {}), ...(toolSlug ? { toolSlug } : {}), ...(risk ? { risk } : {}), ...(evidence ? { evidence } : {}), ...(note ? { note } : {}),
    ...(estimatedHours !== undefined ? { estimatedHours } : {}), ...(remainingHours !== undefined ? { remainingHours } : {}), ...(progressPercent !== undefined ? { progressPercent } : {}), ...(dueAt ? { dueAt } : {}), ...(startedAt ? { startedAt } : {}), ...(completedAt ? { completedAt } : {}), ...(progressEvidence ? { progressEvidence } : {}),
  };
}

export async function createTask(profileId: string, input: { objective: string; queue?: TaskQueue; owner?: TaskOwner; priority?: TaskPriority; approval?: TaskApproval; source?: string; sessionId?: string; summary?: string; toolSlug?: string; risk?: string; estimatedHours?: number; remainingHours?: number; progressPercent?: number; dueAt?: string; progressEvidence?: string }) {
  if (!process.env.HONCHO_API_KEY) throw new Error('Honcho is not configured.');
  const objective = clip(input.objective, 4000); if (!objective) throw new Error('Task objective is required.');
  const handles = await getTaskSession(profileId); if (!handles) throw new Error('Task ledger is unavailable.');
  const queue = input.queue && QUEUES.has(input.queue) ? input.queue : 'working'; const owner = input.owner && OWNERS.has(input.owner) ? input.owner : queue === 'decisions' ? 'user' : 'ai'; const priority = input.priority && PRIORITIES.has(input.priority) ? input.priority : inferPriority(objective); const approval = input.approval && APPROVALS.has(input.approval) ? input.approval : 'none'; const timestamp = new Date().toISOString(); const title = titleFromObjective(objective);
  const estimatedHours = optionalNumber(input.estimatedHours, 0.1, 10_000); const progressPercent = optionalNumber(input.progressPercent, 0, 100); const remainingHours = optionalNumber(input.remainingHours, 0, 10_000) ?? (estimatedHours !== undefined && progressPercent !== undefined ? estimatedHours * (1 - progressPercent / 100) : estimatedHours); const dueAt = optionalIso(input.dueAt);
  const created = await handles.session.addMessages([{ peerId: handles.elp.id, content: `[TASK] ${timestamp}\n${objective}`, metadata: { jarbisTask: true, recordVersion: 2, objective, title, taskQueue: queue, taskOwner: owner, priority, approval, taskStatus: queue === 'done' ? 'completed' : 'active', source: clip(input.source || 'manual', 60), createdAt: timestamp, updatedAt: timestamp,
    ...(input.sessionId?.trim() ? { sessionId: clip(input.sessionId, 120) } : {}), ...(input.summary?.trim() ? { summary: clip(input.summary, 1200) } : {}), ...(input.toolSlug?.trim() ? { toolSlug: clip(input.toolSlug.toUpperCase(), 120) } : {}), ...(input.risk?.trim() ? { risk: clip(input.risk, 30) } : {}),
    ...(estimatedHours !== undefined ? { estimatedHours } : {}), ...(remainingHours !== undefined ? { remainingHours } : {}), ...(progressPercent !== undefined ? { progressPercent } : {}), ...(dueAt ? { dueAt } : {}), ...(input.progressEvidence?.trim() ? { progressEvidence: clip(input.progressEvidence, 2000) } : {}),
  } }]);
  return created[0]?.id || null;
}

export async function updateTask(profileId: string, taskId: string, patch: { queue?: TaskQueue; owner?: TaskOwner; priority?: TaskPriority; approval?: TaskApproval; status?: TaskStatus; summary?: string | null; toolSlug?: string | null; risk?: string | null; evidence?: string | null; note?: string | null; estimatedHours?: number | null; remainingHours?: number | null; progressPercent?: number | null; dueAt?: string | null; startedAt?: string | null; completedAt?: string | null; progressEvidence?: string | null }) {
  if (!process.env.HONCHO_API_KEY) throw new Error('Honcho is not configured.'); const handles = await getTaskSession(profileId); if (!handles) throw new Error('Task ledger is unavailable.'); const message = await handles.session.getMessage(taskId); if (message.metadata?.jarbisTask !== true) throw new Error('The target record is not an ELP task.');
  const metadata: Record<string, unknown> = { ...message.metadata, jarbisTask: true, recordVersion: 2, updatedAt: new Date().toISOString() };
  if (patch.queue !== undefined) { if (!QUEUES.has(patch.queue)) throw new Error('Invalid task queue.'); metadata.taskQueue = patch.queue; if (patch.queue === 'done' && patch.status === undefined) metadata.taskStatus = 'completed'; }
  if (patch.owner !== undefined) { if (!OWNERS.has(patch.owner)) throw new Error('Invalid task owner.'); metadata.taskOwner = patch.owner; }
  if (patch.priority !== undefined) { if (!PRIORITIES.has(patch.priority)) throw new Error('Invalid task priority.'); metadata.priority = patch.priority; }
  if (patch.approval !== undefined) { if (!APPROVALS.has(patch.approval)) throw new Error('Invalid approval state.'); metadata.approval = patch.approval; }
  if (patch.status !== undefined) { if (!STATUSES.has(patch.status)) throw new Error('Invalid task status.'); metadata.taskStatus = patch.status; if (patch.status === 'completed') { metadata.progressPercent = 100; metadata.remainingHours = 0; metadata.completedAt = patch.completedAt || new Date().toISOString(); } }
  const setText = (key: string, value: string | null | undefined, max: number) => { if (value === undefined) return; if (value === null || !value.trim()) delete metadata[key]; else metadata[key] = clip(value, max); };
  setText('summary', patch.summary, 1200); setText('toolSlug', patch.toolSlug?.toUpperCase() ?? patch.toolSlug, 120); setText('risk', patch.risk, 30); setText('evidence', patch.evidence, 2000); setText('note', patch.note, 500); setText('progressEvidence', patch.progressEvidence, 2000);
  const setNumber = (key: string, value: number | null | undefined, min: number, max: number) => { if (value === undefined) return; if (value === null) delete metadata[key]; else { const n = optionalNumber(value, min, max); if (n === undefined) throw new Error(`Invalid ${key}.`); metadata[key] = n; } };
  setNumber('estimatedHours', patch.estimatedHours, 0.1, 10_000); setNumber('remainingHours', patch.remainingHours, 0, 10_000); setNumber('progressPercent', patch.progressPercent, 0, 100);
  const setIso = (key: string, value: string | null | undefined) => { if (value === undefined) return; if (value === null || !value.trim()) delete metadata[key]; else { const parsed = optionalIso(value); if (!parsed) throw new Error(`Invalid ${key}.`); metadata[key] = parsed; } };
  setIso('dueAt', patch.dueAt); setIso('startedAt', patch.startedAt); setIso('completedAt', patch.completedAt);
  if (patch.progressPercent !== undefined && patch.remainingHours === undefined && metadata.estimatedHours !== undefined && patch.progressPercent !== null) metadata.remainingHours = Math.max(0, Number(metadata.estimatedHours) * (1 - Number(metadata.progressPercent) / 100));
  if ((patch.progressPercent ?? 0) > 0 && !metadata.startedAt) metadata.startedAt = new Date().toISOString();
  const updated = await handles.session.updateMessage(taskId, metadata); return updated.id;
}

export async function getTask(profileId: string, taskId: string) { if (!process.env.HONCHO_API_KEY) return null; try { const handles = await getTaskSession(profileId); if (!handles) return null; const message = await handles.session.getMessage(taskId); return parseTask(message); } catch { return null; } }

export async function getTaskBoard(profileId: string): Promise<TaskBoard> {
  if (!process.env.HONCHO_API_KEY) return emptyBoard(false);
  try { const handles = await getTaskSession(profileId); if (!handles) return emptyBoard(false); const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true }); const items = messages.map((message) => parseTask(message)).filter((item): item is TaskRecord => Boolean(item)); const rank: Record<TaskPriority, number> = { critical: 4, high: 3, normal: 2, low: 1 }; items.sort((a, b) => rank[b.priority] - rank[a.priority] || b.createdAt.localeCompare(a.createdAt)); const board = emptyBoard(true); for (const item of items) board.queues[item.queue].push(item); board.total = items.length; board.available = items.length > 0; board.generatedAt = new Date().toISOString(); return board; } catch (error) { console.error('ELP task board read failed', error); return emptyBoard(true); }
}

export function taskBoardToPrompt(board: TaskBoard) { if (!board.available) return ''; const liveQueues: TaskQueue[] = ['now', 'decisions', 'working', 'delegated']; const lines = liveQueues.flatMap((queue) => board.queues[queue].slice(0, 8).map((task) => { const effort = task.remainingHours !== undefined ? `remaining:${task.remainingHours.toFixed(1)}h` : ''; const progress = task.progressPercent !== undefined ? `progress:${Math.round(task.progressPercent)}%` : ''; const due = task.dueAt ? `due:${task.dueAt}` : ''; const details = [task.owner, task.priority, task.approval !== 'none' ? `approval:${task.approval}` : '', progress, effort, due].filter(Boolean).join(', '); return `- [${queue.toUpperCase()}] ${task.title} (${details})`; })); const counts = liveQueues.map((queue) => `${queue}:${board.queues[queue].length}`).join(', '); return `Command Center counts: ${counts}.\n${lines.join('\n')}`; }

export function operatorTaskTransition(result: { status: 'completed' | 'approval_required' | 'needs_input' | 'blocked'; summary: string; pendingAction?: { toolSlug: string; risk: 'write' | 'high' } }) {
  if (result.status === 'completed') return { queue: 'done' as TaskQueue, owner: 'ai' as TaskOwner, approval: 'none' as TaskApproval, status: 'completed' as TaskStatus };
  if (result.status === 'approval_required') return { queue: 'decisions' as TaskQueue, owner: 'user' as TaskOwner, approval: 'required' as TaskApproval, status: 'blocked' as TaskStatus, toolSlug: result.pendingAction?.toolSlug, risk: result.pendingAction?.risk };
  if (result.status === 'needs_input') return { queue: 'decisions' as TaskQueue, owner: 'user' as TaskOwner, approval: 'none' as TaskApproval, status: 'blocked' as TaskStatus };
  return { queue: 'decisions' as TaskQueue, owner: 'user' as TaskOwner, approval: 'none' as TaskApproval, status: 'blocked' as TaskStatus };
}
