import { randomUUID } from 'node:crypto';
import { executeComposioTool, searchComposioTools } from '@/lib/composio';
import { getLatestDailyOperatingPlan } from '@/lib/daily-plan-memory';
import { getExecutionSchedulePolicy, persistExecutionSchedule, type BusyInterval, type ExecutionSchedule, type FocusBlock, type FocusBlockKind } from '@/lib/execution-schedule-memory';

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function minutes(ms: number) { return Math.max(0, Math.round(ms / 60_000)); }
function parts(date: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const values = Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second) };
}
function timezoneOffsetMs(date: Date, timezone: string) { const p = parts(date, timezone); const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second); return asUtc - date.getTime(); }
function localDateToUtc(timezone: string, year: number, month: number, day: number, hour: number, minute = 0) { const guess = new Date(Date.UTC(year, month - 1, day, hour, minute)); const offset = timezoneOffsetMs(guess, timezone); return new Date(guess.getTime() - offset); }
function localDateKey(date: Date, timezone: string) { const p = parts(date, timezone); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; }
function iso(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') { const item = value as Record<string, unknown>; if (typeof item.dateTime === 'string') return item.dateTime; if (typeof item.datetime === 'string') return item.datetime; if (typeof item.date === 'string') return item.date; }
  return '';
}

async function readCalendar(profileId: string, timezone: string, start: Date, end: Date) {
  try {
    const tools = await searchComposioTools('list calendar events within a date range', 'GOOGLECALENDAR');
    const tool = tools.find((item) => item.slug.toUpperCase().includes('EVENTS_LIST') && !item.slug.toUpperCase().includes('ALL_CALENDARS')) || tools[0];
    if (!tool) return { available: false, source: undefined as string | undefined, busy: [] as BusyInterval[] };
    const props = ((tool.inputSchema?.properties || {}) as Record<string, unknown>);
    const args: Record<string, unknown> = {};
    if ('calendarId' in props) args.calendarId = 'primary'; if ('calendar_id' in props) args.calendar_id = 'primary';
    if ('timeMin' in props) args.timeMin = start.toISOString(); if ('time_min' in props) args.time_min = start.toISOString();
    if ('timeMax' in props) args.timeMax = end.toISOString(); if ('time_max' in props) args.time_max = end.toISOString();
    if ('timezone' in props) args.timezone = timezone; if ('singleEvents' in props) args.singleEvents = true; if ('single_events' in props) args.single_events = true;
    if ('maxResults' in props) args.maxResults = 100; if ('max_results' in props) args.max_results = 100;
    const result = await executeComposioTool({ toolSlug: tool.slug, arguments: args, profileId });
    const candidates: Array<Record<string, unknown>> = [];
    const walk = (value: unknown) => { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) { value.forEach(walk); return; } const obj = value as Record<string, unknown>; if ((obj.start || obj.startTime || obj.start_time) && (obj.end || obj.endTime || obj.end_time)) candidates.push(obj); Object.values(obj).forEach(walk); };
    walk(result);
    const seen = new Set<string>(); const busy: BusyInterval[] = [];
    for (const event of candidates) {
      const s = iso(event.start ?? event.startTime ?? event.start_time); const e = iso(event.end ?? event.endTime ?? event.end_time); if (!s || !e) continue;
      const key = `${String(event.id || event.event_id || '')}|${s}|${e}`; if (seen.has(key)) continue; seen.add(key);
      const allDay = /^20\d{2}-\d{2}-\d{2}$/.test(s); if (allDay) continue;
      const sd = new Date(s); const ed = new Date(e); if (!Number.isFinite(sd.getTime()) || !Number.isFinite(ed.getTime()) || ed <= sd) continue;
      busy.push({ start: sd.toISOString(), end: ed.toISOString(), title: typeof event.summary === 'string' ? event.summary : typeof event.title === 'string' ? event.title : undefined, source: tool.slug });
    }
    busy.sort((a, b) => a.start.localeCompare(b.start));
    return { available: true, source: tool.slug, busy };
  } catch { return { available: false, source: undefined as string | undefined, busy: [] as BusyInterval[] }; }
}

function mergeBusy(intervals: BusyInterval[], dayStart: Date, dayEnd: Date) {
  const normalized = intervals.map((item) => ({ ...item, startMs: Math.max(dayStart.getTime(), Date.parse(item.start)), endMs: Math.min(dayEnd.getTime(), Date.parse(item.end)) })).filter((item) => Number.isFinite(item.startMs) && Number.isFinite(item.endMs) && item.endMs > item.startMs).sort((a, b) => a.startMs - b.startMs);
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const item of normalized) { const last = merged[merged.length - 1]; if (last && item.startMs <= last.endMs) last.endMs = Math.max(last.endMs, item.endMs); else merged.push({ startMs: item.startMs, endMs: item.endMs }); }
  return merged;
}

function kindFor(source: string, approvalRequired: boolean): FocusBlockKind { if (approvalRequired) return 'decision'; if (source === 'relationship' || source === 'delegation') return 'follow_up'; if (source === 'risk') return 'prep'; return 'deep_work'; }
function makeBlock(input: { title: string; kind: FocusBlockKind; startMs: number; endMs: number; score: number; source?: FocusBlock['source']; sourceId?: string; approvalRequired: boolean; reason: string; action?: string }): FocusBlock { return { id: randomUUID(), kind: input.kind, state: 'proposed', title: input.title, start: new Date(input.startMs).toISOString(), end: new Date(input.endMs).toISOString(), durationMinutes: minutes(input.endMs - input.startMs), priorityScore: input.score, source: input.source, sourceId: input.sourceId, approvalRequired: input.approvalRequired, reason: input.reason, recommendedAction: input.action }; }

export async function runExecutionScheduler(args: { profileId: string; persist?: boolean; now?: Date }) {
  const now = args.now || new Date(); const policy = await getExecutionSchedulePolicy(args.profileId); const plan = await getLatestDailyOperatingPlan(args.profileId);
  const p = parts(now, policy.timezone); const dayStart = localDateToUtc(policy.timezone, p.year, p.month, p.day, policy.dayStartHour); const dayEnd = localDateToUtc(policy.timezone, p.year, p.month, p.day, policy.dayEndHour);
  const calendar = await readCalendar(args.profileId, policy.timezone, dayStart, dayEnd);
  const prepMs = policy.meetingPrepMinutes * 60_000; const bufferMs = policy.transitionBufferMinutes * 60_000;
  const expandedBusy: BusyInterval[] = [...calendar.busy];
  for (const meeting of calendar.busy) { const startMs = Date.parse(meeting.start); const prepStart = Math.max(dayStart.getTime(), startMs - prepMs); if (prepMs > 0 && prepStart < startMs) expandedBusy.push({ start: new Date(prepStart).toISOString(), end: meeting.start, title: `Prep: ${meeting.title || 'meeting'}`, source: 'elp-prep' }); const endMs = Date.parse(meeting.end); if (bufferMs > 0 && endMs < dayEnd.getTime()) expandedBusy.push({ start: meeting.end, end: new Date(Math.min(dayEnd.getTime(), endMs + bufferMs)).toISOString(), title: 'Transition buffer', source: 'elp-buffer' }); }
  const merged = mergeBusy(expandedBusy, dayStart, dayEnd); const free: Array<{ startMs: number; endMs: number }> = []; let cursor = Math.max(dayStart.getTime(), now.getTime());
  for (const item of merged) { if (item.endMs <= cursor) continue; if (item.startMs > cursor) free.push({ startMs: cursor, endMs: item.startMs }); cursor = Math.max(cursor, item.endMs); }
  if (cursor < dayEnd.getTime()) free.push({ startMs: cursor, endMs: dayEnd.getTime() });
  const priorities = plan ? [...plan.now, ...plan.today, ...plan.focus].filter((item, index, arr) => arr.findIndex((x) => x.id === item.id) === index).sort((a, b) => b.score - a.score) : [];
  const blocks: FocusBlock[] = []; const scheduled = new Set<string>(); let deepBlocks = 0;
  for (const slot of free) {
    let slotCursor = slot.startMs;
    while (slot.endMs - slotCursor >= policy.minimumFocusMinutes * 60_000) {
      const item = priorities.find((candidate) => !scheduled.has(candidate.id) && (deepBlocks < policy.maxDeepWorkBlocks || kindFor(candidate.source, candidate.approvalRequired) !== 'deep_work'));
      if (!item) break;
      const kind = kindFor(item.source, item.approvalRequired); const desired = kind === 'decision' ? Math.min(45, policy.defaultFocusMinutes) : kind === 'follow_up' ? Math.min(45, policy.defaultFocusMinutes) : policy.defaultFocusMinutes;
      const availableMinutes = minutes(slot.endMs - slotCursor); const duration = clamp(Math.min(desired, availableMinutes), policy.minimumFocusMinutes, desired); const endMs = slotCursor + duration * 60_000;
      blocks.push(makeBlock({ title: item.title, kind, startMs: slotCursor, endMs, score: item.score, source: item.source, sourceId: item.sourceId, approvalRequired: item.approvalRequired, reason: item.reasons[0] || 'Ranked by the Daily Operating Plan.', action: item.recommendedAction }));
      scheduled.add(item.id); if (kind === 'deep_work') deepBlocks += 1; slotCursor = endMs + (policy.transitionBufferMinutes * 60_000);
    }
  }
  for (const meeting of calendar.busy) { if (policy.meetingPrepMinutes > 0) { const s = Date.parse(meeting.start) - prepMs; if (s >= Math.max(dayStart.getTime(), now.getTime())) blocks.push(makeBlock({ title: `Prepare for ${meeting.title || 'meeting'}`, kind: 'prep', startMs: s, endMs: Date.parse(meeting.start), score: 70, source: 'calendar', sourceId: meeting.start, approvalRequired: false, reason: 'Protected preparation window before a scheduled meeting.' })); } if (policy.transitionBufferMinutes > 0) { const s = Date.parse(meeting.end); const e = Math.min(dayEnd.getTime(), s + bufferMs); if (s >= now.getTime() && e > s) blocks.push(makeBlock({ title: 'Transition buffer', kind: 'buffer', startMs: s, endMs: e, score: 40, source: 'system', sourceId: meeting.end, approvalRequired: false, reason: 'Protect context switching and recovery time after the meeting.' })); } }
  blocks.sort((a, b) => a.start.localeCompare(b.start));
  const nowMs = now.getTime(); const current = blocks.find((item) => Date.parse(item.start) <= nowMs && Date.parse(item.end) > nowMs); const next = blocks.find((item) => Date.parse(item.start) > nowMs);
  const unscheduled = priorities.filter((item) => !scheduled.has(item.id)); const focusBlocks = blocks.filter((item) => !['prep', 'buffer'].includes(item.kind));
  const schedule: ExecutionSchedule = { id: randomUUID(), generatedAt: now.toISOString(), date: localDateKey(now, policy.timezone), timezone: policy.timezone, calendarAvailable: calendar.available, calendarSource: calendar.source, policy, busy: calendar.busy, blocks, currentBlockId: current?.id, nextBlockId: next?.id, unscheduled, stats: { focusMinutes: focusBlocks.reduce((sum, item) => sum + item.durationMinutes, 0), deepWorkMinutes: blocks.filter((item) => item.kind === 'deep_work').reduce((sum, item) => sum + item.durationMinutes, 0), prepMinutes: blocks.filter((item) => item.kind === 'prep').reduce((sum, item) => sum + item.durationMinutes, 0), bufferMinutes: blocks.filter((item) => item.kind === 'buffer').reduce((sum, item) => sum + item.durationMinutes, 0), scheduledPriorities: scheduled.size, unscheduledPriorities: unscheduled.length, calendarConflicts: 0 } };
  return args.persist === false ? schedule : persistExecutionSchedule(args.profileId, schedule);
}
