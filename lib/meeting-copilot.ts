import { randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { createExecutiveLedgerItem, type ExecutivePriority } from '@/lib/executive-memory';
import { getReasoningProviders } from '@/lib/luke';
import { generateProactiveBriefing } from '@/lib/proactive';
import { getRelationshipSnapshot, upsertRelationship } from '@/lib/relationship-memory';
import { createTask, type TaskPriority } from '@/lib/task-router';

export type MeetingStatus = 'draft' | 'live' | 'processing' | 'completed' | 'cancelled';
export type MeetingParticipant = {
  name: string;
  organization?: string;
  role?: string;
  email?: string;
};
export type MeetingCommitment = {
  text: string;
  owner?: string;
  side: 'us' | 'them' | 'joint' | 'unknown';
  dueDate?: string;
  priority: 'high' | 'medium' | 'normal';
};
export type MeetingActionItem = {
  text: string;
  owner?: string;
  dueDate?: string;
  priority: 'high' | 'medium' | 'normal';
};
export type MeetingFollowUp = {
  target: string;
  channel: 'email' | 'message' | 'call' | 'internal';
  subject?: string;
  draft: string;
  reason: string;
};
export type MeetingInsights = {
  summary: string;
  decisions: string[];
  commitments: MeetingCommitment[];
  actionItems: MeetingActionItem[];
  objections: string[];
  questions: string[];
  topics: string[];
  followUps: MeetingFollowUp[];
  confidence: number;
};
export type MeetingRecord = {
  id: string;
  messageId: string;
  title: string;
  objective?: string;
  participants: MeetingParticipant[];
  status: MeetingStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
  prep?: string;
  liveInsights?: MeetingInsights;
  finalInsights?: MeetingInsights;
  transcriptCharacters: number;
  ledgerIds: string[];
  taskIds: string[];
};
export type MeetingTranscriptSegment = {
  id: string;
  text: string;
  speaker?: string;
  capturedAt: string;
  sequence: number;
};

const STATUS = new Set<MeetingStatus>(['draft', 'live', 'processing', 'completed', 'cancelled']);
const PRIORITY = new Set(['high', 'medium', 'normal']);

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt-luke';
}

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function cleanText(value: unknown, max = 1200) {
  return typeof value === 'string' && value.trim() ? clip(value, max) : '';
}

function stringArray(value: unknown, max = 20, itemMax = 800) {
  if (!Array.isArray(value)) return [] as string[];
  return value.flatMap((item) => {
    const text = cleanText(item, itemMax);
    return text ? [text] : [];
  }).slice(0, max);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function asIso(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function asDateOnly(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(clean)) return undefined;
  const parsed = new Date(`${clean}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== clean ? undefined : clean;
}

function sanitizeParticipants(value: unknown): MeetingParticipant[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: MeetingParticipant[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const name = cleanText(item.name, 140);
    if (!name) continue;
    const email = cleanText(item.email, 180).toLowerCase();
    const organization = cleanText(item.organization, 140);
    const key = email || `${name.toLowerCase()}|${organization.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const role = cleanText(item.role, 140);
    result.push({ name, ...(organization ? { organization } : {}), ...(role ? { role } : {}), ...(email ? { email } : {}) });
    if (result.length >= 20) break;
  }
  return result;
}

async function getIndexSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const luke = await honcho.peer('luke');
  const session = await honcho.session(`meetings-${profileId}`);
  await session.addPeers([user, luke]);
  return { user, luke, session, honcho };
}

async function getTranscriptSession(profileId: string, meetingId: string) {
  const handles = await getIndexSession(profileId);
  if (!handles) return null;
  const session = await handles.honcho.session(`meeting-${profileId}-${meetingId}`);
  await session.addPeers([handles.user, handles.luke]);
  return { ...handles, session };
}

function parseMeeting(message: { id: string; content: string; createdAt: string; metadata: Record<string, unknown> }): MeetingRecord | null {
  const metadata = message.metadata || {};
  if (metadata.jarbisMeeting !== true) return null;
  const id = cleanText(metadata.meetingId, 100);
  const title = cleanText(metadata.title, 180);
  if (!id || !title) return null;
  const statusRaw = cleanText(metadata.status, 40) as MeetingStatus;
  const objective = cleanText(metadata.objective, 2000);
  const startedAt = asIso(metadata.startedAt);
  const endedAt = asIso(metadata.endedAt);
  const prep = cleanText(metadata.prep, 12000);
  const liveInsights = parseJson<MeetingInsights | undefined>(metadata.liveInsights, undefined);
  const finalInsights = parseJson<MeetingInsights | undefined>(metadata.finalInsights, undefined);
  return {
    id,
    messageId: message.id,
    title,
    ...(objective ? { objective } : {}),
    participants: sanitizeParticipants(parseJson<unknown>(metadata.participants, [])),
    status: STATUS.has(statusRaw) ? statusRaw : 'draft',
    createdAt: asIso(metadata.createdAt) || message.createdAt,
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    updatedAt: asIso(metadata.updatedAt) || message.createdAt,
    ...(prep ? { prep } : {}),
    ...(liveInsights ? { liveInsights } : {}),
    ...(finalInsights ? { finalInsights } : {}),
    transcriptCharacters: Math.max(0, Number(metadata.transcriptCharacters) || 0),
    ledgerIds: stringArray(metadata.ledgerIds, 60, 120),
    taskIds: stringArray(metadata.taskIds, 60, 120),
  };
}

async function loadMeetingMessage(profileId: string, meetingId: string) {
  const handles = await getIndexSession(profileId);
  if (!handles) throw new Error('Meeting memory is unavailable.');
  const page = await handles.session.messages({ size: 100, reverse: true });
  const message = page.items.find((item) => item.metadata?.jarbisMeeting === true && item.metadata?.meetingId === meetingId);
  if (!message) throw new Error('Meeting not found.');
  const record = parseMeeting(message);
  if (!record) throw new Error('Meeting record is invalid.');
  return { handles, message, record };
}

async function patchMeeting(profileId: string, meetingId: string, patch: Record<string, unknown>) {
  const { handles, message } = await loadMeetingMessage(profileId, meetingId);
  await handles.session.updateMessage(message.id, { ...message.metadata, ...patch, updatedAt: new Date().toISOString() });
  return getMeeting(profileId, meetingId);
}

export async function createMeeting(profileId: string, input: { title: string; objective?: string; participants?: MeetingParticipant[] }) {
  const handles = await getIndexSession(profileId);
  if (!handles) throw new Error('Honcho is not configured.');
  const title = clip(input.title || 'Untitled meeting', 180);
  const objective = cleanText(input.objective, 2000);
  const participants = sanitizeParticipants(input.participants || []);
  const meetingId = randomUUID();
  const now = new Date().toISOString();
  const created = await handles.session.addMessages([{
    peerId: handles.user.id,
    content: `[MEETING] ${now}\n${title}`,
    metadata: {
      jarbisMeeting: true,
      recordVersion: 1,
      meetingId,
      title,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      participants: JSON.stringify(participants),
      transcriptCharacters: 0,
      ledgerIds: [],
      taskIds: [],
      ...(objective ? { objective } : {}),
    },
  }]);
  const messageId = created[0]?.id;
  if (!messageId) throw new Error('Meeting record could not be created.');
  return { meetingId, messageId };
}

export async function listMeetings(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return [] as MeetingRecord[];
  const handles = await getIndexSession(profileId);
  if (!handles) return [] as MeetingRecord[];
  const page = await handles.session.messages({ size: 100, reverse: true });
  return page.items.map((item) => parseMeeting(item)).filter((item): item is MeetingRecord => Boolean(item));
}

export async function getMeeting(profileId: string, meetingId: string) {
  return (await loadMeetingMessage(profileId, meetingId)).record;
}

export async function startMeeting(profileId: string, meetingId: string) {
  const record = await getMeeting(profileId, meetingId);
  if (record.status === 'completed' || record.status === 'cancelled') throw new Error('This meeting cannot be started again.');
  return patchMeeting(profileId, meetingId, { status: 'live', startedAt: record.startedAt || new Date().toISOString() });
}

export async function cancelMeeting(profileId: string, meetingId: string) {
  const record = await getMeeting(profileId, meetingId);
  if (record.status === 'completed') throw new Error('A completed meeting cannot be cancelled.');
  return patchMeeting(profileId, meetingId, { status: 'cancelled', endedAt: new Date().toISOString() });
}

export async function appendMeetingTranscript(profileId: string, meetingId: string, input: { text: string; speaker?: string; sequence?: number; capturedAt?: string }) {
  const record = await getMeeting(profileId, meetingId);
  if (record.status !== 'live' && record.status !== 'processing') throw new Error('Meeting is not live.');
  const text = clip(input.text, 12000);
  if (!text) return { saved: false };
  const handles = await getTranscriptSession(profileId, meetingId);
  if (!handles) throw new Error('Meeting transcript storage is unavailable.');
  const capturedAt = asIso(input.capturedAt) || new Date().toISOString();
  const speaker = cleanText(input.speaker, 80);
  const sequence = Math.max(0, Math.round(Number(input.sequence) || 0));
  await handles.session.addMessages([{
    peerId: handles.user.id,
    content: text,
    metadata: {
      jarbisMeetingTranscript: true,
      meetingId,
      capturedAt,
      sequence,
      ...(speaker ? { speaker } : {}),
    },
  }]);
  await patchMeeting(profileId, meetingId, { transcriptCharacters: record.transcriptCharacters + text.length });
  return { saved: true };
}

export async function getMeetingTranscript(profileId: string, meetingId: string): Promise<MeetingTranscriptSegment[]> {
  if (!process.env.HONCHO_API_KEY) return [];
  const handles = await getTranscriptSession(profileId, meetingId);
  if (!handles) return [];
  const page = await handles.session.messages({ size: 100, reverse: false });
  return page.items.flatMap((message) => {
    if (message.metadata?.jarbisMeetingTranscript !== true) return [];
    const text = cleanText(message.content, 12000);
    if (!text) return [];
    return [{
      id: message.id,
      text,
      ...(cleanText(message.metadata.speaker, 80) ? { speaker: cleanText(message.metadata.speaker, 80) } : {}),
      capturedAt: asIso(message.metadata.capturedAt) || message.createdAt,
      sequence: Math.max(0, Math.round(Number(message.metadata.sequence) || 0)),
    } satisfies MeetingTranscriptSegment];
  }).sort((a, b) => a.sequence - b.sequence || a.capturedAt.localeCompare(b.capturedAt));
}

async function reasonJson(system: string, user: string, maxTokens = 2200) {
  const providers = getReasoningProviders();
  if (!providers.length) throw new Error('No reasoning provider configured.');
  const failures: string[] = [];
  for (const provider of providers) {
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0.1,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(provider.name === 'hermes' ? 30_000 : 55_000),
      });
      if (!response.ok) {
        failures.push(`${provider.name}:${response.status}`);
        continue;
      }
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const raw = data.choices?.[0]?.message?.content?.trim() || '';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start < 0 || end <= start) {
        failures.push(`${provider.name}:invalid-json`);
        continue;
      }
      return { value: JSON.parse(clean.slice(start, end + 1)) as unknown, provider: provider.name };
    } catch (error) {
      failures.push(`${provider.name}:${error instanceof Error ? error.name : 'error'}`);
    }
  }
  throw new Error(`Meeting analysis failed (${failures.join(', ')}).`);
}

function parseInsights(value: unknown): MeetingInsights {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const commitments = Array.isArray(raw.commitments) ? raw.commitments.flatMap((item): MeetingCommitment[] => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const text = cleanText(obj.text, 1200);
    if (!text) return [];
    const sideRaw = cleanText(obj.side, 20);
    const side: MeetingCommitment['side'] = sideRaw === 'us' || sideRaw === 'them' || sideRaw === 'joint' ? sideRaw : 'unknown';
    const priorityRaw = cleanText(obj.priority, 20);
    const priority: MeetingCommitment['priority'] = PRIORITY.has(priorityRaw) ? priorityRaw as MeetingCommitment['priority'] : 'normal';
    const owner = cleanText(obj.owner, 120);
    const dueDate = asDateOnly(obj.dueDate);
    return [{ text, side, priority, ...(owner ? { owner } : {}), ...(dueDate ? { dueDate } : {}) }];
  }).slice(0, 20) : [];
  const actionItems = Array.isArray(raw.actionItems) ? raw.actionItems.flatMap((item): MeetingActionItem[] => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const text = cleanText(obj.text, 1200);
    if (!text) return [];
    const owner = cleanText(obj.owner, 120);
    const dueDate = asDateOnly(obj.dueDate);
    const priorityRaw = cleanText(obj.priority, 20);
    const priority: MeetingActionItem['priority'] = PRIORITY.has(priorityRaw) ? priorityRaw as MeetingActionItem['priority'] : 'normal';
    return [{ text, priority, ...(owner ? { owner } : {}), ...(dueDate ? { dueDate } : {}) }];
  }).slice(0, 20) : [];
  const followUps = Array.isArray(raw.followUps) ? raw.followUps.flatMap((item): MeetingFollowUp[] => {
    if (!item || typeof item !== 'object') return [];
    const obj = item as Record<string, unknown>;
    const target = cleanText(obj.target, 180);
    const draft = cleanText(obj.draft, 3000);
    if (!target || !draft) return [];
    const channelRaw = cleanText(obj.channel, 20);
    const channel: MeetingFollowUp['channel'] = channelRaw === 'email' || channelRaw === 'message' || channelRaw === 'call' ? channelRaw : 'internal';
    const subject = cleanText(obj.subject, 180);
    const reason = cleanText(obj.reason, 800) || 'Post-meeting follow-up.';
    return [{ target, channel, draft, reason, ...(subject ? { subject } : {}) }];
  }).slice(0, 12) : [];
  const confidenceRaw = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? raw.confidence : 0.5;
  return {
    summary: cleanText(raw.summary, 5000),
    decisions: stringArray(raw.decisions, 20, 1200),
    commitments,
    actionItems,
    objections: stringArray(raw.objections, 20, 1200),
    questions: stringArray(raw.questions, 20, 1200),
    topics: stringArray(raw.topics, 16, 300),
    followUps,
    confidence: Math.max(0, Math.min(1, confidenceRaw)),
  };
}

function meetingContext(record: MeetingRecord) {
  return [
    `Title: ${record.title}`,
    record.objective ? `Objective: ${record.objective}` : '',
    record.participants.length ? `External participants: ${record.participants.map((p) => `${p.name}${p.organization ? ` (${p.organization})` : ''}`).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

export async function prepareMeeting(profileId: string, meetingId: string, sessionId: string, timezone?: string) {
  const record = await getMeeting(profileId, meetingId);
  const meeting = `${record.title}. ${record.objective || ''} ${record.participants.map((p) => `${p.name}${p.organization ? ` at ${p.organization}` : ''}`).join(', ')}`.trim();
  const briefing = await generateProactiveBriefing({ kind: 'meeting-prep', profileId, sessionId, timezone, meeting, persist: true });
  await patchMeeting(profileId, meetingId, { prep: clip(briefing.summary, 12000) });
  return briefing;
}

export async function analyseLiveMeeting(profileId: string, meetingId: string, transcript: string) {
  const record = await getMeeting(profileId, meetingId);
  const recent = clip(transcript, 24000);
  if (!recent) return { insights: parseInsights({}), provider: 'none' };
  const system = `You are JARBIS Live Meeting Copilot. Analyse a partial live transcript and surface only provisional, decision-useful signals. Do not invent facts. Speaker labels may be imperfect. Do not create final commitments merely from suggestions or hypotheticals. External follow-ups are advisory drafts only and must never be described as sent.\n\nReturn exactly one JSON object with this schema and no prose:\n{"summary":"1-3 sentence live state","decisions":["explicit decisions only"],"commitments":[{"text":"explicit promise","owner":"name or side if known","side":"us|them|joint|unknown","dueDate":"YYYY-MM-DD or null","priority":"high|medium|normal"}],"actionItems":[{"text":"task","owner":"name if known","dueDate":"YYYY-MM-DD or null","priority":"high|medium|normal"}],"objections":["material concern or objection"],"questions":["important unresolved question"],"topics":["topic"],"followUps":[],"confidence":0.0}`;
  const user = `${meetingContext(record)}\n\nPARTIAL LIVE TRANSCRIPT\n${recent}`;
  const response = await reasonJson(system, user, 1600);
  const insights = parseInsights(response.value);
  await patchMeeting(profileId, meetingId, { liveInsights: JSON.stringify(insights) });
  return { insights, provider: response.provider };
}

function ownerLooksExternal(owner: string | undefined, participants: MeetingParticipant[]) {
  if (!owner) return false;
  const clean = owner.toLowerCase();
  return participants.some((participant) => clean.includes(participant.name.toLowerCase()) || participant.name.toLowerCase().includes(clean));
}

function taskPriority(priority: 'high' | 'medium' | 'normal'): TaskPriority {
  return priority === 'high' ? 'high' : 'normal';
}

function ledgerPriority(priority: 'high' | 'medium' | 'normal'): ExecutivePriority {
  return priority;
}

async function updateMeetingRelationships(profileId: string, record: MeetingRecord, insights: MeetingInsights, endedAt: string) {
  if (!record.participants.length) return;
  const snapshot = await getRelationshipSnapshot(profileId);
  for (const participant of record.participants) {
    const nameLower = participant.name.toLowerCase();
    const existing = snapshot.relationships.find((relationship) => {
      if (participant.email && relationship.email?.toLowerCase() === participant.email.toLowerCase()) return true;
      if (relationship.name.toLowerCase() !== nameLower) return false;
      return !participant.organization || !relationship.organization || relationship.organization.toLowerCase() === participant.organization.toLowerCase();
    });
    const promisesByUs = insights.commitments.filter((item) => item.side === 'us' || item.side === 'joint').map((item) => item.text);
    const promisesByThem = insights.commitments.filter((item) => item.side === 'them' || item.side === 'joint').map((item) => item.text);
    const targetedFollowUps = insights.followUps.filter((item) => item.target.toLowerCase().includes(nameLower) || nameLower.includes(item.target.toLowerCase()));
    await upsertRelationship(profileId, {
      name: participant.name,
      organization: participant.organization,
      role: participant.role,
      email: participant.email,
      status: 'active',
      strategicValue: existing?.strategicValue || 'normal',
      momentum: existing?.momentum || 'steady',
      lastInteractionAt: endedAt,
      interactionCount: (existing?.interactionCount || 0) + 1,
      topics: insights.topics,
      openLoops: targetedFollowUps.length ? targetedFollowUps.map((item) => item.reason) : insights.questions.slice(0, 5),
      promisesByUs,
      promisesByThem,
      objections: insights.objections,
      evidence: insights.summary ? [`Meeting ${record.title}: ${clip(insights.summary, 700)}`] : [],
      nextBestAction: targetedFollowUps[0]?.reason || insights.followUps[0]?.reason,
      confidence: insights.confidence,
    });
  }
}

export async function finalizeMeeting(profileId: string, meetingId: string, input: { transcript?: string; sessionId?: string }) {
  const record = await getMeeting(profileId, meetingId);
  if (record.status === 'completed' && record.finalInsights) {
    return { record, insights: record.finalInsights, alreadyFinalized: true };
  }
  if (record.status === 'cancelled') throw new Error('Cancelled meetings cannot be finalised.');
  await patchMeeting(profileId, meetingId, { status: 'processing' });

  let transcript = clip(input.transcript || '', 70000);
  if (!transcript) {
    const segments = await getMeetingTranscript(profileId, meetingId);
    transcript = clip(segments.map((segment) => `${segment.speaker ? `${segment.speaker}: ` : ''}${segment.text}`).join('\n'), 70000);
  }
  if (!transcript) throw new Error('No meeting transcript is available to finalise.');

  const system = `You are JARBIS Post-Meeting Autopilot. Convert a meeting transcript into a precise internal record and proposed follow-up package. Do not invent facts. Distinguish explicit decisions/promises from discussion. Speaker labels may be imperfect, so use "unknown" when ownership is not supported. Never claim an external email/message/call was sent. Follow-ups are proposed drafts that require later user approval before any external action.\n\nReturn exactly one JSON object and no prose:\n{"summary":"executive summary","decisions":["explicit final decision"],"commitments":[{"text":"promise/commitment","owner":"who owns it if known","side":"us|them|joint|unknown","dueDate":"YYYY-MM-DD or null","priority":"high|medium|normal"}],"actionItems":[{"text":"next action","owner":"owner if known","dueDate":"YYYY-MM-DD or null","priority":"high|medium|normal"}],"objections":["material objection/friction"],"questions":["unresolved question"],"topics":["topic"],"followUps":[{"target":"person/company","channel":"email|message|call|internal","subject":"optional subject","draft":"short proposed follow-up","reason":"why/when this follow-up matters"}],"confidence":0.0}`;
  const user = `${meetingContext(record)}\n${record.prep ? `\nPRE-MEETING CONTEXT\n${clip(record.prep, 9000)}` : ''}\n\nFINAL TRANSCRIPT\n${transcript}`;
  const response = await reasonJson(system, user, 2800);
  const insights = parseInsights(response.value);
  const endedAt = new Date().toISOString();
  const ledgerIds: string[] = [];
  const taskIds: string[] = [];

  for (const decision of insights.decisions) {
    const id = await createExecutiveLedgerItem(profileId, {
      kind: 'decision',
      content: `[Meeting: ${record.title}] ${decision}`,
      priority: 'normal',
    });
    if (id) ledgerIds.push(id);
  }

  for (const commitment of insights.commitments) {
    if (commitment.side !== 'us' && commitment.side !== 'joint') continue;
    const id = await createExecutiveLedgerItem(profileId, {
      kind: 'commitment',
      content: `[Meeting: ${record.title}] ${commitment.text}`,
      owner: commitment.owner,
      dueDate: commitment.dueDate,
      priority: ledgerPriority(commitment.priority),
    });
    if (id) ledgerIds.push(id);
  }

  for (const action of insights.actionItems) {
    const external = ownerLooksExternal(action.owner, record.participants);
    const id = await createTask(profileId, {
      objective: `[Meeting: ${record.title}] ${action.text}${action.dueDate ? ` Due ${action.dueDate}.` : ''}`,
      queue: external ? 'delegated' : action.priority === 'high' ? 'now' : 'working',
      owner: external ? 'human' : 'user',
      priority: taskPriority(action.priority),
      approval: 'none',
      source: 'meeting-copilot',
      sessionId: input.sessionId || meetingId,
      summary: action.owner ? `Owner: ${action.owner}` : 'Captured from post-meeting analysis.',
    });
    if (id) taskIds.push(id);
  }

  for (const followUp of insights.followUps) {
    if (followUp.channel === 'internal') continue;
    const id = await createTask(profileId, {
      objective: `Review and approve ${followUp.channel} follow-up to ${followUp.target} after ${record.title}.`,
      queue: 'decisions',
      owner: 'user',
      priority: 'normal',
      approval: 'required',
      source: 'meeting-follow-up',
      sessionId: input.sessionId || meetingId,
      summary: `${followUp.subject ? `Subject: ${followUp.subject}\n` : ''}${followUp.draft}`,
      risk: 'write',
    });
    if (id) taskIds.push(id);
  }

  await updateMeetingRelationships(profileId, record, insights, endedAt);
  const finalRecord = await patchMeeting(profileId, meetingId, {
    status: 'completed',
    endedAt,
    finalInsights: JSON.stringify(insights),
    liveInsights: JSON.stringify(insights),
    transcriptCharacters: Math.max(record.transcriptCharacters, transcript.length),
    ledgerIds,
    taskIds,
  });
  return { record: finalRecord, insights, provider: response.provider, alreadyFinalized: false };
}
