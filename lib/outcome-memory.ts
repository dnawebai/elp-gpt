import { Honcho } from '@honcho-ai/sdk';

export type MeetingOutcomeStatus = 'pending' | 'achieved' | 'partial' | 'missed' | 'abandoned';

export type MeetingOutcomeRecord = {
  id: string;
  messageId: string;
  meetingId: string;
  title: string;
  objective: string;
  status: MeetingOutcomeStatus;
  score: number;
  confidence: number;
  summary?: string;
  evidence: string[];
  lessons: string[];
  nextActions: string[];
  createdAt: string;
  updatedAt: string;
  lastEvaluatedAt?: string;
  nextReviewAt?: string;
  evaluationCount: number;
};

export type MeetingOutcomeSnapshot = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  outcomes: MeetingOutcomeRecord[];
  stats: {
    total: number;
    pending: number;
    achieved: number;
    partial: number;
    missed: number;
    averageScore: number;
  };
};

const STATUSES = new Set<MeetingOutcomeStatus>(['pending', 'achieved', 'partial', 'missed', 'abandoned']);

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt-luke';
}

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadataStrings(metadata: Record<string, unknown>, key: string, max = 12) {
  const value = metadata[key];
  if (!Array.isArray(value)) return [] as string[];
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => clip(item, 900))
    .slice(0, max);
}

function metadataNumber(metadata: Record<string, unknown>, key: string, fallback = 0) {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asIso(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

async function getOutcomeSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({
    apiKey: process.env.HONCHO_API_KEY,
    workspaceId: workspaceId(),
    environment: 'production',
  });
  const user = await honcho.peer(`user-${profileId}`);
  const luke = await honcho.peer('luke');
  const session = await honcho.session(`meeting-outcomes-${profileId}`);
  await session.addPeers([user, luke]);
  return { user, luke, session };
}

function parseOutcome(message: { id: string; content: string; createdAt: string; metadata: Record<string, unknown> }): MeetingOutcomeRecord | null {
  const metadata = message.metadata || {};
  if (metadata.jarbisMeetingOutcome !== true) return null;
  const meetingId = metadataString(metadata, 'meetingId');
  const title = metadataString(metadata, 'title');
  const objective = metadataString(metadata, 'objective');
  if (!meetingId || !title || !objective) return null;
  const statusRaw = metadataString(metadata, 'outcomeStatus') as MeetingOutcomeStatus | undefined;
  const summary = metadataString(metadata, 'summary');
  const lastEvaluatedAt = asIso(metadataString(metadata, 'lastEvaluatedAt'));
  const nextReviewAt = asIso(metadataString(metadata, 'nextReviewAt'));
  return {
    id: message.id,
    messageId: message.id,
    meetingId,
    title: clip(title, 180),
    objective: clip(objective, 2400),
    status: statusRaw && STATUSES.has(statusRaw) ? statusRaw : 'pending',
    score: Math.max(0, Math.min(100, metadataNumber(metadata, 'score', 0))),
    confidence: Math.max(0, Math.min(1, metadataNumber(metadata, 'confidence', 0.25))),
    ...(summary ? { summary: clip(summary, 3000) } : {}),
    evidence: metadataStrings(metadata, 'evidence', 16),
    lessons: metadataStrings(metadata, 'lessons', 12),
    nextActions: metadataStrings(metadata, 'nextActions', 12),
    createdAt: asIso(metadataString(metadata, 'createdAt')) || message.createdAt,
    updatedAt: asIso(metadataString(metadata, 'updatedAt')) || message.createdAt,
    ...(lastEvaluatedAt ? { lastEvaluatedAt } : {}),
    ...(nextReviewAt ? { nextReviewAt } : {}),
    evaluationCount: Math.max(0, Math.round(metadataNumber(metadata, 'evaluationCount', 0))),
  };
}

async function findOutcome(profileId: string, meetingId: string) {
  const handles = await getOutcomeSession(profileId);
  if (!handles) return null;
  const page = await handles.session.messages({ size: 100, reverse: true });
  const message = page.items.find((item) => item.metadata?.jarbisMeetingOutcome === true && item.metadata?.meetingId === meetingId);
  if (!message) return null;
  const record = parseOutcome(message);
  return record ? { handles, message, record } : null;
}

export async function createMeetingOutcome(profileId: string, input: {
  meetingId: string;
  title: string;
  objective: string;
  initialEvidence?: string[];
}) {
  if (!process.env.HONCHO_API_KEY) return null;
  const existing = await findOutcome(profileId, input.meetingId);
  if (existing) return existing.record;
  const handles = await getOutcomeSession(profileId);
  if (!handles) return null;
  const now = new Date().toISOString();
  const objective = clip(input.objective || `Verify the intended result of ${input.title}.`, 2400);
  const evidence = (input.initialEvidence || []).filter(Boolean).map((item) => clip(item, 900)).slice(0, 12);
  const created = await handles.session.addMessages([{
    peerId: handles.luke.id,
    content: `[MEETING_OUTCOME] ${now}\n${clip(input.title, 180)}\n${objective}`,
    metadata: {
      jarbisMeetingOutcome: true,
      recordVersion: 1,
      meetingId: clip(input.meetingId, 100),
      title: clip(input.title, 180),
      objective,
      outcomeStatus: 'pending',
      score: 0,
      confidence: 0.25,
      evidence,
      lessons: [],
      nextActions: [],
      evaluationCount: 0,
      createdAt: now,
      updatedAt: now,
      nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  }]);
  const message = created[0];
  if (!message) return null;
  return parseOutcome(message);
}

export async function getMeetingOutcome(profileId: string, meetingId: string) {
  return (await findOutcome(profileId, meetingId))?.record || null;
}

export async function updateMeetingOutcome(profileId: string, meetingId: string, patch: {
  status?: MeetingOutcomeStatus;
  score?: number;
  confidence?: number;
  summary?: string | null;
  evidence?: string[];
  lessons?: string[];
  nextActions?: string[];
  lastEvaluatedAt?: string;
  nextReviewAt?: string | null;
  incrementEvaluation?: boolean;
}) {
  const found = await findOutcome(profileId, meetingId);
  if (!found) throw new Error('Meeting outcome record not found.');
  const metadata: Record<string, unknown> = {
    ...found.message.metadata,
    updatedAt: new Date().toISOString(),
  };
  if (patch.status !== undefined) {
    if (!STATUSES.has(patch.status)) throw new Error('Invalid meeting outcome status.');
    metadata.outcomeStatus = patch.status;
  }
  if (patch.score !== undefined) metadata.score = Math.max(0, Math.min(100, patch.score));
  if (patch.confidence !== undefined) metadata.confidence = Math.max(0, Math.min(1, patch.confidence));
  if (patch.summary !== undefined) {
    if (patch.summary === null || !patch.summary.trim()) delete metadata.summary;
    else metadata.summary = clip(patch.summary, 3000);
  }
  if (patch.evidence !== undefined) metadata.evidence = patch.evidence.filter(Boolean).map((item) => clip(item, 900)).slice(0, 16);
  if (patch.lessons !== undefined) metadata.lessons = patch.lessons.filter(Boolean).map((item) => clip(item, 900)).slice(0, 12);
  if (patch.nextActions !== undefined) metadata.nextActions = patch.nextActions.filter(Boolean).map((item) => clip(item, 900)).slice(0, 12);
  if (patch.lastEvaluatedAt) metadata.lastEvaluatedAt = asIso(patch.lastEvaluatedAt) || new Date().toISOString();
  if (patch.nextReviewAt !== undefined) {
    if (patch.nextReviewAt === null) delete metadata.nextReviewAt;
    else metadata.nextReviewAt = asIso(patch.nextReviewAt) || patch.nextReviewAt;
  }
  if (patch.incrementEvaluation) metadata.evaluationCount = found.record.evaluationCount + 1;
  await found.handles.session.updateMessage(found.message.id, metadata);
  return (await findOutcome(profileId, meetingId))?.record || null;
}

export async function addMeetingOutcomeEvidence(profileId: string, meetingId: string, evidence: string) {
  const found = await findOutcome(profileId, meetingId);
  if (!found) return null;
  const clean = clip(evidence, 900);
  const merged = [clean, ...found.record.evidence].filter(Boolean).filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index).slice(0, 16);
  return updateMeetingOutcome(profileId, meetingId, { evidence: merged });
}

function emptySnapshot(configured = false): MeetingOutcomeSnapshot {
  return {
    configured,
    available: false,
    generatedAt: new Date().toISOString(),
    outcomes: [],
    stats: { total: 0, pending: 0, achieved: 0, partial: 0, missed: 0, averageScore: 0 },
  };
}

export async function getMeetingOutcomeSnapshot(profileId: string): Promise<MeetingOutcomeSnapshot> {
  if (!process.env.HONCHO_API_KEY) return emptySnapshot(false);
  try {
    const handles = await getOutcomeSession(profileId);
    if (!handles) return emptySnapshot(false);
    const page = await handles.session.messages({ size: 100, reverse: true });
    const outcomes = page.items
      .map((message) => parseOutcome(message))
      .filter((record): record is MeetingOutcomeRecord => Boolean(record))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const scored = outcomes.filter((item) => item.status !== 'pending' && item.status !== 'abandoned');
    const averageScore = scored.length ? Math.round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length) : 0;
    return {
      configured: true,
      available: outcomes.length > 0,
      generatedAt: new Date().toISOString(),
      outcomes,
      stats: {
        total: outcomes.length,
        pending: outcomes.filter((item) => item.status === 'pending').length,
        achieved: outcomes.filter((item) => item.status === 'achieved').length,
        partial: outcomes.filter((item) => item.status === 'partial').length,
        missed: outcomes.filter((item) => item.status === 'missed').length,
        averageScore,
      },
    };
  } catch (error) {
    console.error('JARBIS meeting outcome snapshot failed', error);
    return emptySnapshot(true);
  }
}

export function meetingOutcomeSnapshotToPrompt(snapshot: MeetingOutcomeSnapshot) {
  if (!snapshot.available) return '';
  const lessons = snapshot.outcomes
    .filter((item) => item.lessons.length || item.status === 'missed' || item.status === 'partial')
    .slice(0, 8)
    .flatMap((item) => item.lessons.slice(0, 3).map((lesson) => `- ${item.title} [${item.status.toUpperCase()} ${Math.round(item.score)}%]: ${lesson}`));
  const active = snapshot.outcomes
    .filter((item) => item.status === 'pending' || item.status === 'partial')
    .slice(0, 6)
    .map((item) => `- ${item.title}: ${item.objective} | status ${item.status}${item.nextReviewAt ? ` | next review ${item.nextReviewAt}` : ''}`);
  return [
    `Meeting outcome learning: ${snapshot.stats.achieved} achieved, ${snapshot.stats.partial} partial, ${snapshot.stats.missed} missed, ${snapshot.stats.pending} pending; average resolved score ${snapshot.stats.averageScore}%.`,
    lessons.length ? `Recent learned patterns:\n${lessons.join('\n')}` : '',
    active.length ? `Open meeting outcomes:\n${active.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}
