import { getReasoningProviders } from '@/lib/luke';
import { listMeetings, type MeetingRecord } from '@/lib/meeting-copilot';
import { prepareMeetingFollowUp } from '@/lib/meeting-follow-up';

export type VoicePostExecution =
  | { kind: 'meeting-follow-up'; meetingId: string; index: number }
  | { kind: 'meeting-calendar'; meetingId: string; summary: string };

export type VoicePendingMeetingAction = {
  toolSlug: 'GMAIL_SEND_EMAIL' | 'GOOGLECALENDAR_CREATE_EVENT';
  arguments: Record<string, unknown>;
  summary: string;
  risk: 'write';
  postExecution: VoicePostExecution;
};

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function localDateKey(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function relativeDateKey(days: number, timezone: string) {
  return localDateKey(new Date(Date.now() + days * 86_400_000), timezone);
}

function searchableMeetingText(meeting: MeetingRecord) {
  return [
    meeting.title,
    meeting.objective || '',
    ...meeting.participants.flatMap((participant) => [participant.name, participant.organization || '', participant.email || '']),
  ].join(' ').toLowerCase();
}

export async function resolveMeetingReference(profileId: string, reference: string, timezone = 'America/Toronto') {
  const meetings = (await listMeetings(profileId)).filter((meeting) => meeting.status === 'completed' && meeting.finalInsights);
  if (!meetings.length) throw new Error('No completed meetings with follow-ups are available.');

  const needle = reference.trim().toLowerCase();
  if (!needle || needle === 'latest' || needle === 'last meeting' || needle === 'most recent meeting') return meetings[0];

  const dateNeedle = needle.includes('yesterday')
    ? relativeDateKey(-1, timezone)
    : needle.includes('today')
      ? relativeDateKey(0, timezone)
      : null;

  if (dateNeedle) {
    const sameDay = meetings.filter((meeting) => localDateKey(new Date(meeting.endedAt || meeting.createdAt), timezone) === dateNeedle);
    if (sameDay.length === 1) return sameDay[0];
    if (sameDay.length > 1) {
      const semantic = sameDay.filter((meeting) => searchableMeetingText(meeting).includes(needle.replace(/yesterday|today|meeting|the|my/g, '').trim()));
      if (semantic.length === 1) return semantic[0];
      throw new Error(`I found ${sameDay.length} completed meetings for ${dateNeedle}. Name the meeting or participant so I can select the correct one.`);
    }
  }

  const exact = meetings.filter((meeting) => meeting.title.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  const partial = meetings.filter((meeting) => searchableMeetingText(meeting).includes(needle));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`I found ${partial.length} matching meetings. Please name the meeting or participant more specifically.`);
  throw new Error(`I could not match "${clip(reference, 160)}" to a completed meeting.`);
}

export async function prepareVoiceMeetingEmail(profileId: string, meetingReference: string, followUpNumber = 1, timezone?: string): Promise<VoicePendingMeetingAction> {
  const meeting = await resolveMeetingReference(profileId, meetingReference, timezone);
  const index = Math.max(0, Math.round(followUpNumber) - 1);
  const prepared = await prepareMeetingFollowUp(profileId, meeting.id, index);
  return {
    toolSlug: prepared.toolSlug,
    arguments: prepared.arguments,
    summary: prepared.summary,
    risk: 'write',
    postExecution: { kind: 'meeting-follow-up', meetingId: meeting.id, index },
  };
}

async function reasonSchedule(input: {
  request: string;
  timezone: string;
  meeting: MeetingRecord;
  durationMinutes: number;
}) {
  const providers = getReasoningProviders();
  if (!providers.length) throw new Error('No reasoning provider is configured for calendar date resolution.');
  const now = new Date();
  const system = `You resolve calendar scheduling language into an exact local datetime. Return exactly one JSON object, no markdown: {"start_datetime":"YYYY-MM-DDTHH:MM:SS","duration_minutes":30,"summary":"short event title","description":"short context"}. Interpret all relative dates against the supplied current instant and IANA timezone. Never invent a date when the request lacks enough information; instead return {"error":"one concise clarification question"}. Keep duration between 15 and 180 minutes.`;
  const user = `Current UTC instant: ${now.toISOString()}\nTimezone: ${input.timezone}\nMeeting: ${input.meeting.title}\nMeeting objective: ${input.meeting.objective || 'not recorded'}\nParticipants: ${input.meeting.participants.map((p) => `${p.name}${p.organization ? ` (${p.organization})` : ''}`).join(', ') || 'none recorded'}\nRequested default duration: ${input.durationMinutes} minutes\nScheduling request: ${clip(input.request, 1200)}`;
  const failures: string[] = [];

  for (const provider of providers) {
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
        body: JSON.stringify({ model: provider.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, max_tokens: 500 }),
        signal: AbortSignal.timeout(provider.name === 'hermes' ? 20_000 : 45_000),
      });
      if (!response.ok) { failures.push(`${provider.name}:${response.status}`); continue; }
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const raw = data.choices?.[0]?.message?.content?.trim() || '';
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start < 0 || end <= start) { failures.push(`${provider.name}:invalid-json`); continue; }
      return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
    } catch (error) {
      failures.push(`${provider.name}:${error instanceof Error ? error.name : 'error'}`);
    }
  }
  throw new Error(`Calendar date resolution failed (${failures.join(', ') || 'unknown error'}).`);
}

export async function prepareVoiceMeetingCalendar(profileId: string, input: {
  meetingReference: string;
  scheduleRequest: string;
  timezone?: string;
  durationMinutes?: number;
  inviteParticipants?: boolean;
}): Promise<VoicePendingMeetingAction> {
  const timezone = input.timezone?.trim() || 'America/Toronto';
  const meeting = await resolveMeetingReference(profileId, input.meetingReference, timezone);
  const requestedDuration = Math.max(15, Math.min(180, Math.round(input.durationMinutes || 30)));
  const resolved = await reasonSchedule({ request: input.scheduleRequest, timezone, meeting, durationMinutes: requestedDuration });
  if (typeof resolved.error === 'string' && resolved.error.trim()) throw new Error(resolved.error.trim());

  const start = typeof resolved.start_datetime === 'string' ? resolved.start_datetime.trim() : '';
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(start)) throw new Error('I could not resolve the requested follow-up time to an exact local datetime.');
  const duration = Math.max(15, Math.min(180, Number(resolved.duration_minutes) || requestedDuration));
  const summary = typeof resolved.summary === 'string' && resolved.summary.trim() ? clip(resolved.summary, 180) : `Follow-up: ${meeting.title}`;
  const description = typeof resolved.description === 'string' && resolved.description.trim()
    ? clip(resolved.description, 1500)
    : `JARBIS follow-up for ${meeting.title}${meeting.objective ? ` — objective: ${meeting.objective}` : ''}`;
  const attendees = input.inviteParticipants === false
    ? []
    : meeting.participants.map((participant) => participant.email).filter((email): email is string => Boolean(email));
  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;
  const args: Record<string, unknown> = {
    calendar_id: 'primary',
    start_datetime: start,
    timezone,
    summary,
    description,
    event_duration_hour: hours,
    event_duration_minutes: minutes,
    create_meeting_room: true,
    send_updates: attendees.length ? 'all' : 'none',
  };
  if (attendees.length) args.attendees = attendees;

  const humanSummary = `Schedule ${summary} for ${start.replace('T', ' ')} ${timezone}${attendees.length ? ` and invite ${attendees.length} participant${attendees.length === 1 ? '' : 's'}` : ''}.`;
  return {
    toolSlug: 'GOOGLECALENDAR_CREATE_EVENT',
    arguments: args,
    summary: humanSummary,
    risk: 'write',
    postExecution: { kind: 'meeting-calendar', meetingId: meeting.id, summary: humanSummary },
  };
}
