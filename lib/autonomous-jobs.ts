import { Honcho } from '@honcho-ai/sdk';
import { runOperatorMission, type OperatorMissionState, type OperatorPendingAction } from '@/lib/operator';
import { createTask, updateTask } from '@/lib/task-router';
import { nextRunAfter, validateJobSchedule, type JobSchedule } from '@/lib/job-schedule';

export type JobMode = 'scheduled' | 'condition';
export type JobStatus = 'active' | 'paused' | 'approval_required' | 'needs_input' | 'blocked' | 'completed' | 'cancelled';
export type JobRunStatus = 'completed' | 'approval_required' | 'needs_input' | 'blocked' | 'condition_not_met' | 'failed';

export type AutonomousJob = {
  id: string;
  title: string;
  instruction: string;
  mode: JobMode;
  condition?: string;
  schedule: JobSchedule;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastRunAt?: string;
  lastRunStatus?: JobRunStatus;
  lastSummary?: string;
  runCount: number;
  failureCount: number;
  commandCenterTaskId?: string;
  pendingAction?: OperatorPendingAction;
  operatorState?: OperatorMissionState;
};

export type AutonomousJobRun = {
  id: string;
  jobId: string;
  scheduledFor: string;
  startedAt: string;
  completedAt: string;
  status: JobRunStatus;
  summary: string;
  taskId?: string;
};

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt';
}

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

async function getJobSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`jobs-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadataNumber(metadata: Record<string, unknown>, key: string, fallback = 0) {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseJson<T>(value: unknown): T | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try { return JSON.parse(value) as T; } catch { return undefined; }
}

function parseJob(message: { id: string; createdAt: string; metadata: Record<string, unknown> }): AutonomousJob | null {
  const metadata = message.metadata || {};
  if (metadata.elpAutonomousJob !== true) return null;
  const title = metadataString(metadata, 'title');
  const instruction = metadataString(metadata, 'instruction');
  const mode = metadataString(metadata, 'mode') as JobMode | undefined;
  const status = metadataString(metadata, 'jobStatus') as JobStatus | undefined;
  const schedule = parseJson<JobSchedule>(metadata.scheduleJson);
  if (!title || !instruction || !mode || !['scheduled', 'condition'].includes(mode) || !status || !schedule) return null;
  const createdAt = metadataString(metadata, 'createdAt') || message.createdAt;
  const updatedAt = metadataString(metadata, 'updatedAt') || createdAt;
  const condition = metadataString(metadata, 'condition');
  const nextRunRaw = metadata.nextRunAt;
  const nextRunAt = typeof nextRunRaw === 'string' && nextRunRaw.trim() ? nextRunRaw : null;
  const lastRunAt = metadataString(metadata, 'lastRunAt');
  const lastRunStatus = metadataString(metadata, 'lastRunStatus') as JobRunStatus | undefined;
  const lastSummary = metadataString(metadata, 'lastSummary');
  const commandCenterTaskId = metadataString(metadata, 'commandCenterTaskId');
  const pendingAction = parseJson<OperatorPendingAction>(metadata.pendingActionJson);
  const operatorState = parseJson<OperatorMissionState>(metadata.operatorStateJson);
  return {
    id: message.id,
    title: clip(title, 180),
    instruction: clip(instruction, 4000),
    mode,
    ...(condition ? { condition: clip(condition, 1600) } : {}),
    schedule,
    status,
    createdAt,
    updatedAt,
    nextRunAt,
    ...(lastRunAt ? { lastRunAt } : {}),
    ...(lastRunStatus ? { lastRunStatus } : {}),
    ...(lastSummary ? { lastSummary: clip(lastSummary, 3000) } : {}),
    runCount: Math.max(0, Math.round(metadataNumber(metadata, 'runCount'))),
    failureCount: Math.max(0, Math.round(metadataNumber(metadata, 'failureCount'))),
    ...(commandCenterTaskId ? { commandCenterTaskId } : {}),
    ...(pendingAction ? { pendingAction } : {}),
    ...(operatorState ? { operatorState } : {}),
  };
}

function parseRun(message: { id: string; createdAt: string; metadata: Record<string, unknown> }): AutonomousJobRun | null {
  const metadata = message.metadata || {};
  if (metadata.elpAutonomousJobRun !== true) return null;
  const jobId = metadataString(metadata, 'jobId');
  const scheduledFor = metadataString(metadata, 'scheduledFor');
  const startedAt = metadataString(metadata, 'startedAt') || message.createdAt;
  const completedAt = metadataString(metadata, 'completedAt') || startedAt;
  const status = metadataString(metadata, 'runStatus') as JobRunStatus | undefined;
  const summary = metadataString(metadata, 'summary');
  const taskId = metadataString(metadata, 'taskId');
  if (!jobId || !scheduledFor || !status || !summary) return null;
  return { id: message.id, jobId, scheduledFor, startedAt, completedAt, status, summary: clip(summary, 3000), ...(taskId ? { taskId } : {}) };
}

export async function listAutonomousJobs(profileId: string) {
  const handles = await getJobSession(profileId);
  if (!handles) return [] as AutonomousJob[];
  const page = await handles.session.messages({ size: 300, reverse: true });
  return page.items.map((message) => parseJob(message)).filter((job): job is AutonomousJob => Boolean(job));
}

export async function listAutonomousJobRuns(profileId: string, jobId?: string, limit = 100) {
  const handles = await getJobSession(profileId);
  if (!handles) return [] as AutonomousJobRun[];
  const page = await handles.session.messages({ size: Math.min(300, Math.max(20, limit * 3)), reverse: true });
  return page.items
    .map((message) => parseRun(message))
    .filter((run): run is AutonomousJobRun => Boolean(run) && (!jobId || run?.jobId === jobId))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function createAutonomousJob(profileId: string, input: {
  title: string;
  instruction: string;
  mode?: JobMode;
  condition?: string;
  schedule: JobSchedule;
}) {
  const handles = await getJobSession(profileId);
  if (!handles) throw new Error('Autonomous job storage is unavailable.');
  const title = clip(input.title, 180);
  const instruction = clip(input.instruction, 4000);
  const mode: JobMode = input.mode === 'condition' ? 'condition' : 'scheduled';
  const condition = input.condition?.trim() ? clip(input.condition, 1600) : undefined;
  if (!title || !instruction) throw new Error('Job title and instruction are required.');
  if (mode === 'condition' && !condition) throw new Error('Condition watches require a condition.');
  const scheduleError = validateJobSchedule(input.schedule);
  if (scheduleError) throw new Error(scheduleError);
  const now = new Date();
  const nextRunAt = nextRunAfter(input.schedule, new Date(now.getTime() - 1000), now);
  if (!nextRunAt) throw new Error('This schedule has no future run.');
  const timestamp = now.toISOString();
  const created = await handles.session.addMessages([{
    peerId: handles.user.id,
    content: `[AUTONOMOUS JOB] ${title}\n${instruction}`,
    metadata: {
      elpAutonomousJob: true,
      recordVersion: 1,
      title,
      instruction,
      mode,
      ...(condition ? { condition } : {}),
      scheduleJson: JSON.stringify(input.schedule),
      jobStatus: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
      nextRunAt,
      runCount: 0,
      failureCount: 0,
    },
  }]);
  const id = created[0]?.id;
  if (!id) throw new Error('Job record could not be created.');
  return { id, nextRunAt };
}

export async function updateAutonomousJob(profileId: string, jobId: string, patch: {
  status?: 'active' | 'paused' | 'cancelled';
  title?: string;
  instruction?: string;
  condition?: string | null;
  schedule?: JobSchedule;
}) {
  const handles = await getJobSession(profileId);
  if (!handles) throw new Error('Autonomous job storage is unavailable.');
  const message = await handles.session.getMessage(jobId);
  const job = parseJob(message);
  if (!job) throw new Error('Autonomous job not found.');
  const metadata: Record<string, unknown> = { ...message.metadata, updatedAt: new Date().toISOString() };
  if (patch.title !== undefined) metadata.title = clip(patch.title, 180);
  if (patch.instruction !== undefined) metadata.instruction = clip(patch.instruction, 4000);
  if (patch.condition !== undefined) {
    if (patch.condition === null || !patch.condition.trim()) delete metadata.condition;
    else metadata.condition = clip(patch.condition, 1600);
  }
  if (patch.schedule !== undefined) {
    const error = validateJobSchedule(patch.schedule);
    if (error) throw new Error(error);
    metadata.scheduleJson = JSON.stringify(patch.schedule);
    metadata.nextRunAt = nextRunAfter(patch.schedule, new Date(), new Date(job.createdAt));
  }
  if (patch.status !== undefined) {
    metadata.jobStatus = patch.status;
    if (patch.status === 'active') metadata.nextRunAt = nextRunAfter(patch.schedule || job.schedule, new Date(), new Date(job.createdAt));
    if (patch.status === 'paused' || patch.status === 'cancelled') metadata.nextRunAt = '';
  }
  await handles.session.updateMessage(jobId, metadata);
  return { ok: true };
}

function runObjective(job: AutonomousJob) {
  if (job.mode === 'scheduled') return job.instruction;
  return `CONDITION WATCH. Check whether this condition is true now: ${job.condition}. If it is false, do not take any external action; finish with a summary beginning exactly CONDITION_NOT_MET: and briefly state the evidence. If it is true, carry out this instruction: ${job.instruction}`;
}

async function writeRun(profileId: string, job: AutonomousJob, scheduledFor: string, status: JobRunStatus, summary: string, taskId?: string) {
  const handles = await getJobSession(profileId);
  if (!handles) return null;
  const completedAt = new Date().toISOString();
  const created = await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[JOB RUN] ${job.title}\n${summary}`,
    metadata: {
      elpAutonomousJobRun: true,
      recordVersion: 1,
      jobId: job.id,
      scheduledFor,
      startedAt: completedAt,
      completedAt,
      runStatus: status,
      summary: clip(summary, 3000),
      ...(taskId ? { taskId } : {}),
    },
  }]);
  return created[0]?.id || null;
}

async function patchAfterRun(profileId: string, job: AutonomousJob, patch: Record<string, unknown>) {
  const handles = await getJobSession(profileId);
  if (!handles) return;
  const message = await handles.session.getMessage(job.id);
  await handles.session.updateMessage(job.id, { ...message.metadata, ...patch, updatedAt: new Date().toISOString() });
}

export async function runAutonomousJob(profileId: string, job: AutonomousJob, scheduledFor = job.nextRunAt || new Date().toISOString()) {
  const recentRuns = await listAutonomousJobRuns(profileId, job.id, 20);
  if (recentRuns.some((run) => run.scheduledFor === scheduledFor)) return { skipped: true, reason: 'already-run', jobId: job.id };

  const sessionId = `job-${job.id.slice(0, 24)}-${Date.parse(scheduledFor) || Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96);
  let result;
  try {
    result = await runOperatorMission({ objective: runObjective(job), profileId, sessionId, state: job.operatorState });
  } catch (error) {
    const summary = error instanceof Error ? error.message : 'Autonomous job failed.';
    const taskId = await createTask(profileId, { objective: `Autonomous job failed: ${job.title}`, queue: 'decisions', owner: 'user', priority: 'high', source: 'autonomous-job', summary });
    await writeRun(profileId, job, scheduledFor, 'failed', summary, taskId || undefined);
    const nextRunAt = nextRunAfter(job.schedule, new Date(), new Date(job.createdAt));
    await patchAfterRun(profileId, job, { lastRunAt: new Date().toISOString(), lastRunStatus: 'failed', lastSummary: clip(summary, 3000), failureCount: job.failureCount + 1, runCount: job.runCount + 1, nextRunAt: nextRunAt || '', commandCenterTaskId: taskId || '' });
    return { jobId: job.id, status: 'failed' as const, summary, nextRunAt };
  }

  const conditionNotMet = job.mode === 'condition' && result.status === 'completed' && result.summary.trim().toUpperCase().startsWith('CONDITION_NOT_MET:');
  const runStatus: JobRunStatus = conditionNotMet ? 'condition_not_met' : result.status;
  let taskId: string | null = null;
  if (result.status === 'approval_required') {
    taskId = await createTask(profileId, { objective: job.title, queue: 'decisions', owner: 'user', priority: 'high', approval: 'required', source: 'autonomous-job', summary: result.summary, toolSlug: result.pendingAction?.toolSlug, risk: result.pendingAction?.risk });
  } else if (result.status === 'needs_input' || result.status === 'blocked') {
    taskId = await createTask(profileId, { objective: job.title, queue: 'decisions', owner: 'user', priority: result.status === 'blocked' ? 'high' : 'normal', source: 'autonomous-job', summary: result.question || result.summary });
  } else if (!conditionNotMet) {
    taskId = await createTask(profileId, { objective: job.title, queue: 'done', owner: 'ai', priority: 'normal', status: 'completed', source: 'autonomous-job', summary: result.summary });
  }

  await writeRun(profileId, job, scheduledFor, runStatus, result.summary, taskId || undefined);
  const oneTimeCompleted = job.schedule.type === 'once' && result.status === 'completed';
  const nextRunAt = oneTimeCompleted ? null : nextRunAfter(job.schedule, new Date(), new Date(job.createdAt));
  const jobStatus: JobStatus = result.status === 'approval_required' ? 'approval_required' : result.status === 'needs_input' ? 'needs_input' : result.status === 'blocked' ? 'blocked' : oneTimeCompleted ? 'completed' : 'active';
  await patchAfterRun(profileId, job, {
    jobStatus,
    lastRunAt: new Date().toISOString(),
    lastRunStatus: runStatus,
    lastSummary: clip(result.summary, 3000),
    runCount: job.runCount + 1,
    failureCount: result.status === 'blocked' ? job.failureCount + 1 : job.failureCount,
    nextRunAt: nextRunAt || '',
    ...(taskId ? { commandCenterTaskId: taskId } : {}),
    ...(result.pendingAction ? { pendingActionJson: JSON.stringify(result.pendingAction) } : { pendingActionJson: '' }),
    operatorStateJson: JSON.stringify(result.state),
  });
  return { jobId: job.id, status: runStatus, summary: result.summary, pendingAction: result.pendingAction, taskId, nextRunAt };
}

export async function runDueAutonomousJobs(profileId: string, now = new Date(), limit = 6) {
  const jobs = await listAutonomousJobs(profileId);
  const due = jobs
    .filter((job) => job.status === 'active' && job.nextRunAt && Date.parse(job.nextRunAt) <= now.getTime())
    .sort((a, b) => (a.nextRunAt || '').localeCompare(b.nextRunAt || ''))
    .slice(0, Math.max(1, Math.min(limit, 10)));
  const results = [];
  for (const job of due) results.push(await runAutonomousJob(profileId, job, job.nextRunAt || now.toISOString()));
  return { ok: true, due: due.length, results };
}

export async function recordAutonomousJobActionExecuted(profileId: string, jobId: string, evidence?: string) {
  const handles = await getJobSession(profileId);
  if (!handles) throw new Error('Autonomous job storage is unavailable.');
  const message = await handles.session.getMessage(jobId);
  const job = parseJob(message);
  if (!job) throw new Error('Autonomous job not found.');
  if (job.commandCenterTaskId) {
    await updateTask(profileId, job.commandCenterTaskId, { queue: 'done', owner: 'ai', approval: 'none', status: 'completed', evidence: evidence || 'Approved autonomous job action executed.' });
  }
  const nextRunAt = job.schedule.type === 'once' ? null : nextRunAfter(job.schedule, new Date(), new Date(job.createdAt));
  await handles.session.updateMessage(job.id, {
    ...message.metadata,
    jobStatus: job.schedule.type === 'once' ? 'completed' : 'active',
    nextRunAt: nextRunAt || '',
    pendingActionJson: '',
    operatorStateJson: '',
    lastRunStatus: 'completed',
    lastSummary: clip(evidence || 'Approved autonomous job action executed.', 3000),
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, nextRunAt };
}
