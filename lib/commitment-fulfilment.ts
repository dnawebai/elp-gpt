import { Honcho } from '@honcho-ai/sdk';
import { getExecutiveLedger, updateExecutiveLedgerItem, type ExecutiveLedgerItem } from '@/lib/executive-memory';
import { runOperatorMission, type OperatorPendingAction } from '@/lib/operator';
import { createTask, getTaskBoard, updateTask, type TaskRecord } from '@/lib/task-router';

export type FulfilmentTargetType = 'commitment' | 'task';
export type FulfilmentStatus = 'completed' | 'approval_required' | 'needs_input' | 'blocked';

export type CommitmentFulfilmentRecord = {
  id: string;
  targetType: FulfilmentTargetType;
  targetId: string;
  title: string;
  status: FulfilmentStatus;
  summary: string;
  createdAt: string;
  updatedAt?: string;
  nextReviewAt?: string;
  pendingAction?: OperatorPendingAction;
  evidence?: string;
  question?: string;
};

export type CommitmentFulfilmentSnapshot = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  records: CommitmentFulfilmentRecord[];
  stats: {
    total: number;
    completed: number;
    approvalRequired: number;
    needsInput: number;
    blocked: number;
  };
};

type Candidate = {
  targetType: FulfilmentTargetType;
  targetId: string;
  title: string;
  objective: string;
  priority: number;
  dueDate?: string;
  task?: TaskRecord;
  commitment?: ExecutiveLedgerItem;
};

const RECENT_REVIEW_MS = 4 * 60 * 60 * 1000;

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt';
}

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

async function getFulfilmentSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`fulfilment-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parsePendingAction(value?: string): OperatorPendingAction | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as OperatorPendingAction;
    if (!parsed || typeof parsed.toolSlug !== 'string' || typeof parsed.summary !== 'string' || !parsed.arguments || typeof parsed.arguments !== 'object') return undefined;
    if (parsed.risk !== 'write' && parsed.risk !== 'high') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function parseRecord(message: { id: string; content: string; createdAt: string; metadata: Record<string, unknown> }): CommitmentFulfilmentRecord | null {
  const metadata = message.metadata || {};
  if (metadata.jarbisFulfilment !== true) return null;
  const targetType = metadataString(metadata, 'targetType') as FulfilmentTargetType | undefined;
  const targetId = metadataString(metadata, 'targetId');
  const title = metadataString(metadata, 'title');
  const status = metadataString(metadata, 'fulfilmentStatus') as FulfilmentStatus | undefined;
  const summary = metadataString(metadata, 'summary');
  const createdAt = metadataString(metadata, 'createdAt') || message.createdAt;
  if (!targetType || !['commitment', 'task'].includes(targetType) || !targetId || !title || !status || !['completed', 'approval_required', 'needs_input', 'blocked'].includes(status) || !summary) return null;
  const updatedAt = metadataString(metadata, 'updatedAt');
  const nextReviewAt = metadataString(metadata, 'nextReviewAt');
  const pendingAction = parsePendingAction(metadataString(metadata, 'pendingActionJson'));
  const evidence = metadataString(metadata, 'evidence');
  const question = metadataString(metadata, 'question');
  return {
    id: message.id,
    targetType,
    targetId,
    title,
    status,
    summary,
    createdAt,
    ...(updatedAt ? { updatedAt } : {}),
    ...(nextReviewAt ? { nextReviewAt } : {}),
    ...(pendingAction ? { pendingAction } : {}),
    ...(evidence ? { evidence } : {}),
    ...(question ? { question } : {}),
  };
}

function emptySnapshot(configured = false): CommitmentFulfilmentSnapshot {
  return {
    configured,
    available: false,
    generatedAt: new Date().toISOString(),
    records: [],
    stats: { total: 0, completed: 0, approvalRequired: 0, needsInput: 0, blocked: 0 },
  };
}

export async function getCommitmentFulfilmentSnapshot(profileId: string): Promise<CommitmentFulfilmentSnapshot> {
  if (!process.env.HONCHO_API_KEY) return emptySnapshot(false);
  try {
    const handles = await getFulfilmentSession(profileId);
    if (!handles) return emptySnapshot(false);
    const page = await handles.session.messages({ size: 100, reverse: true });
    const records = page.items.map((message) => parseRecord(message)).filter((record): record is CommitmentFulfilmentRecord => Boolean(record)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      configured: true,
      available: records.length > 0,
      generatedAt: new Date().toISOString(),
      records,
      stats: {
        total: records.length,
        completed: records.filter((record) => record.status === 'completed').length,
        approvalRequired: records.filter((record) => record.status === 'approval_required').length,
        needsInput: records.filter((record) => record.status === 'needs_input').length,
        blocked: records.filter((record) => record.status === 'blocked').length,
      },
    };
  } catch (error) {
    console.error('ELP fulfilment snapshot read failed', error);
    return emptySnapshot(true);
  }
}

async function persistRecord(profileId: string, input: Omit<CommitmentFulfilmentRecord, 'id' | 'createdAt'>) {
  const handles = await getFulfilmentSession(profileId);
  if (!handles) throw new Error('Fulfilment memory is unavailable.');
  const timestamp = new Date().toISOString();
  const pendingActionJson = input.pendingAction ? JSON.stringify(input.pendingAction) : undefined;
  const created = await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[FULFILMENT] ${timestamp}\n${clip(input.title, 180)}\n${clip(input.summary, 4000)}`,
    metadata: {
      jarbisFulfilment: true,
      recordVersion: 1,
      targetType: input.targetType,
      targetId: clip(input.targetId, 160),
      title: clip(input.title, 180),
      fulfilmentStatus: input.status,
      summary: clip(input.summary, 4000),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.nextReviewAt ? { nextReviewAt: input.nextReviewAt } : {}),
      ...(pendingActionJson ? { pendingActionJson: clip(pendingActionJson, 64_000) } : {}),
      ...(input.evidence ? { evidence: clip(input.evidence, 3000) } : {}),
      ...(input.question ? { question: clip(input.question, 1200) } : {}),
    },
  }]);
  return created[0]?.id || null;
}

function dueInDays(dueDate?: string) {
  if (!dueDate) return null;
  const parsed = Date.parse(`${dueDate}T23:59:59.999Z`);
  if (!Number.isFinite(parsed)) return null;
  return Math.ceil((parsed - Date.now()) / 86_400_000);
}

function candidatePriority(item: ExecutiveLedgerItem) {
  const due = dueInDays(item.dueDate);
  return (item.overdue ? 100 : 0) + (item.status === 'blocked' ? 60 : 0) + (item.priority === 'high' ? 40 : item.priority === 'medium' ? 20 : 0) + (due !== null && due <= 2 ? 30 : due !== null && due <= 7 ? 15 : 0) + Math.min(item.ageDays, 20);
}

function buildCandidates(ledger: Awaited<ReturnType<typeof getExecutiveLedger>>, board: Awaited<ReturnType<typeof getTaskBoard>>) {
  const candidates: Candidate[] = [];
  for (const item of ledger.items) {
    if (item.primaryKind !== 'commitment' || !['active', 'blocked'].includes(item.status)) continue;
    const due = dueInDays(item.dueDate);
    const material = item.overdue || item.status === 'blocked' || item.priority === 'high' || (due !== null && due <= 7) || item.stale;
    if (!material) continue;
    candidates.push({
      targetType: 'commitment',
      targetId: item.id,
      title: item.title,
      objective: item.content,
      priority: candidatePriority(item),
      dueDate: item.dueDate,
      commitment: item,
    });
  }

  for (const task of [...board.queues.now, ...board.queues.working, ...board.queues.delegated]) {
    if (task.status !== 'active' || task.approval !== 'none') continue;
    if (!['ai', 'connector', 'browser'].includes(task.owner)) continue;
    const priority = task.priority === 'critical' ? 120 : task.priority === 'high' ? 80 : task.priority === 'normal' ? 45 : 20;
    candidates.push({ targetType: 'task', targetId: task.id, title: task.title, objective: task.objective, priority, task });
  }

  return candidates.sort((a, b) => b.priority - a.priority).slice(0, 24);
}

function latestByTarget(records: CommitmentFulfilmentRecord[]) {
  const map = new Map<string, CommitmentFulfilmentRecord>();
  for (const record of records) {
    const key = `${record.targetType}:${record.targetId}`;
    if (!map.has(key)) map.set(key, record);
  }
  return map;
}

function shouldSkip(candidate: Candidate, latest: CommitmentFulfilmentRecord | undefined, force: boolean) {
  if (force || !latest) return false;
  if (latest.status === 'approval_required') return true;
  const stamp = Date.parse(latest.updatedAt || latest.createdAt);
  return Number.isFinite(stamp) && Date.now() - stamp < RECENT_REVIEW_MS;
}

function missionObjective(candidate: Candidate) {
  const context = candidate.targetType === 'commitment'
    ? `Executive commitment: ${candidate.objective}${candidate.dueDate ? `\nDue date: ${candidate.dueDate}` : ''}`
    : `Command Center task: ${candidate.objective}`;
  return `Autonomously advance the following obligation as far as safely possible. You may use read-only connected-app operations and internal reasoning. Do NOT perform any external write, send, reply, create, update, delete, book, publish, deploy, purchase, transfer, cancel, or permission change. If an external write is required, identify the exact smallest next action and return it through the normal approval_required boundary. Verify whether the obligation is already satisfied, gather evidence, identify blockers, and produce a concise next-step result. Do not mark a human-owned commitment complete merely because preparatory research finished.\n\n${context}`;
}

async function ensureDecisionTask(profileId: string, candidate: Candidate, result: { summary: string; pendingAction?: OperatorPendingAction; question?: string }, board: Awaited<ReturnType<typeof getTaskBoard>>) {
  const sessionId = `fulfilment-${candidate.targetId}`.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
  const existing = [...board.queues.now, ...board.queues.decisions, ...board.queues.working, ...board.queues.delegated]
    .find((task) => task.sessionId === sessionId && task.status !== 'completed' && task.status !== 'cancelled');
  const objective = result.pendingAction
    ? `Approval needed to advance commitment: ${candidate.title}. ${result.summary}`
    : `Input needed to advance commitment: ${candidate.title}. ${result.question || result.summary}`;
  if (existing) {
    await updateTask(profileId, existing.id, {
      queue: 'decisions',
      owner: 'user',
      approval: result.pendingAction ? 'required' : 'none',
      status: 'blocked',
      summary: result.summary,
      toolSlug: result.pendingAction?.toolSlug || null,
      risk: result.pendingAction?.risk || null,
      note: result.question || null,
    });
    return existing.id;
  }
  return createTask(profileId, {
    objective,
    queue: 'decisions',
    owner: 'user',
    priority: candidate.priority >= 100 ? 'critical' : candidate.priority >= 70 ? 'high' : 'normal',
    approval: result.pendingAction ? 'required' : 'none',
    source: 'commitment-fulfilment',
    sessionId,
    summary: result.summary,
    toolSlug: result.pendingAction?.toolSlug,
    risk: result.pendingAction?.risk,
  });
}

async function applyResult(profileId: string, candidate: Candidate, result: Awaited<ReturnType<typeof runOperatorMission>>, board: Awaited<ReturnType<typeof getTaskBoard>>) {
  if (candidate.targetType === 'task' && candidate.task) {
    if (result.status === 'completed') {
      await updateTask(profileId, candidate.task.id, { queue: 'done', owner: 'ai', approval: 'none', status: 'completed', summary: result.summary, evidence: result.summary, note: 'Completed by autonomous read-only/reversible fulfilment cycle.' });
    } else if (result.status === 'approval_required') {
      await updateTask(profileId, candidate.task.id, { queue: 'decisions', owner: 'user', approval: 'required', status: 'blocked', summary: result.summary, toolSlug: result.pendingAction?.toolSlug, risk: result.pendingAction?.risk, note: 'External write requires explicit approval.' });
    } else if (result.status === 'needs_input') {
      await updateTask(profileId, candidate.task.id, { queue: 'decisions', owner: 'user', approval: 'none', status: 'blocked', summary: result.summary, note: result.question || 'User input is required.' });
    } else {
      await updateTask(profileId, candidate.task.id, { summary: result.summary, note: 'Autonomous fulfilment is currently blocked; no external write was executed.' });
    }
    return;
  }

  if (candidate.targetType === 'commitment' && candidate.commitment) {
    const notePrefix = result.status === 'completed' ? 'ELP autonomous review completed' : result.status === 'approval_required' ? 'ELP prepared an approval-gated next action' : result.status === 'needs_input' ? 'ELP requires input' : 'ELP review blocked';
    await updateExecutiveLedgerItem(profileId, candidate.commitment.messageId, { note: `${notePrefix}: ${clip(result.summary, 420)}` });
    if (result.status === 'approval_required' || result.status === 'needs_input') await ensureDecisionTask(profileId, candidate, result, board);
  }
}

export async function runCommitmentFulfilmentCycle(args: {
  profileId: string;
  sessionPrefix?: string;
  limit?: number;
  force?: boolean;
}) {
  const limit = Math.max(1, Math.min(8, Math.round(args.limit || 4)));
  const [ledger, board, snapshot] = await Promise.all([
    getExecutiveLedger(args.profileId),
    getTaskBoard(args.profileId),
    getCommitmentFulfilmentSnapshot(args.profileId),
  ]);
  const latest = latestByTarget(snapshot.records);
  const candidates = buildCandidates(ledger, board);
  const results: CommitmentFulfilmentRecord[] = [];
  let reviewed = 0;

  for (const candidate of candidates) {
    if (reviewed >= limit) break;
    const prior = latest.get(`${candidate.targetType}:${candidate.targetId}`);
    if (shouldSkip(candidate, prior, Boolean(args.force))) continue;
    reviewed += 1;
    try {
      const mission = await runOperatorMission({
        objective: missionObjective(candidate),
        profileId: args.profileId,
        sessionId: `${args.sessionPrefix || 'commitment-fulfilment'}-${reviewed}`.slice(0, 120),
        state: null,
      });
      await applyResult(args.profileId, candidate, mission, board);
      const nextReviewAt = mission.status === 'approval_required' || mission.status === 'needs_input'
        ? undefined
        : new Date(Date.now() + RECENT_REVIEW_MS).toISOString();
      const id = await persistRecord(args.profileId, {
        targetType: candidate.targetType,
        targetId: candidate.targetId,
        title: candidate.title,
        status: mission.status,
        summary: mission.summary,
        ...(mission.pendingAction ? { pendingAction: mission.pendingAction } : {}),
        ...(mission.question ? { question: mission.question } : {}),
        ...(nextReviewAt ? { nextReviewAt } : {}),
      });
      results.push({
        id: id || `${candidate.targetType}-${candidate.targetId}`,
        targetType: candidate.targetType,
        targetId: candidate.targetId,
        title: candidate.title,
        status: mission.status,
        summary: mission.summary,
        createdAt: new Date().toISOString(),
        ...(mission.pendingAction ? { pendingAction: mission.pendingAction } : {}),
        ...(mission.question ? { question: mission.question } : {}),
        ...(nextReviewAt ? { nextReviewAt } : {}),
      });
    } catch (error) {
      const summary = error instanceof Error ? error.message : 'Autonomous fulfilment failed.';
      const id = await persistRecord(args.profileId, { targetType: candidate.targetType, targetId: candidate.targetId, title: candidate.title, status: 'blocked', summary, nextReviewAt: new Date(Date.now() + RECENT_REVIEW_MS).toISOString() });
      results.push({ id: id || `${candidate.targetType}-${candidate.targetId}`, targetType: candidate.targetType, targetId: candidate.targetId, title: candidate.title, status: 'blocked', summary, createdAt: new Date().toISOString() });
    }
  }

  return {
    ok: true,
    reviewed,
    candidateCount: candidates.length,
    results,
    approvalRequired: results.filter((item) => item.status === 'approval_required').length,
    completed: results.filter((item) => item.status === 'completed').length,
    needsInput: results.filter((item) => item.status === 'needs_input').length,
    blocked: results.filter((item) => item.status === 'blocked').length,
  };
}

async function findRecord(profileId: string, recordId: string) {
  const handles = await getFulfilmentSession(profileId);
  if (!handles) return null;
  const message = await handles.session.getMessage(recordId);
  const record = parseRecord(message);
  return record ? { handles, message, record } : null;
}

export async function getFulfilmentPendingAction(profileId: string, recordId: string) {
  const found = await findRecord(profileId, recordId);
  if (!found?.record.pendingAction || found.record.status !== 'approval_required') return null;
  return found.record.pendingAction;
}

export async function recordFulfilmentExecuted(profileId: string, recordId: string, evidence?: string) {
  const found = await findRecord(profileId, recordId);
  if (!found) throw new Error('Fulfilment record not found.');
  const now = new Date().toISOString();
  const metadata: Record<string, unknown> = {
    ...found.message.metadata,
    fulfilmentStatus: 'completed',
    updatedAt: now,
    nextReviewAt: new Date(Date.now() + RECENT_REVIEW_MS).toISOString(),
    ...(evidence ? { evidence: clip(evidence, 3000) } : {}),
  };
  delete metadata.pendingActionJson;
  await found.handles.session.updateMessage(found.message.id, metadata);

  if (found.record.targetType === 'task') {
    await updateTask(profileId, found.record.targetId, { queue: 'done', owner: 'ai', approval: 'none', status: 'completed', evidence: evidence || 'Approved external action executed.', note: 'Approval-gated fulfilment action executed successfully.' }).catch(() => undefined);
  } else {
    await updateExecutiveLedgerItem(profileId, found.record.targetId, { note: `Approved fulfilment action executed. ${clip(evidence || found.record.summary, 400)} Verify the real-world outcome before closing this commitment.` }).catch(() => undefined);
    const board = await getTaskBoard(profileId);
    const sessionId = `fulfilment-${found.record.targetId}`.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
    const linked = [...board.queues.decisions, ...board.queues.now, ...board.queues.working, ...board.queues.delegated].find((task) => task.sessionId === sessionId);
    if (linked) await updateTask(profileId, linked.id, { queue: 'done', owner: 'ai', approval: 'none', status: 'completed', evidence: evidence || 'Approved external action executed.', note: 'Execution confirmed; commitment remains open until outcome is verified.' }).catch(() => undefined);
  }
  return { ok: true, id: recordId, status: 'completed' as const };
}

export function commitmentFulfilmentToPrompt(snapshot: CommitmentFulfilmentSnapshot) {
  if (!snapshot.available) return '';
  const live = snapshot.records.filter((record) => record.status !== 'completed').slice(0, 10).map((record) => `- [${record.status.toUpperCase()}] ${record.title}: ${clip(record.summary, 280)}`);
  return [
    `Autonomous fulfilment totals: ${snapshot.stats.approvalRequired} awaiting approval; ${snapshot.stats.needsInput} need input; ${snapshot.stats.blocked} blocked.`,
    live.length ? `Live fulfilment queue:\n${live.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
