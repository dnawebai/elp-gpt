export type JobSchedule =
  | { type: 'once'; runAt: string }
  | { type: 'interval'; everyMinutes: number; anchorAt?: string }
  | { type: 'daily'; time: string; timezone: string }
  | { type: 'weekly'; weekday: number; time: string; timezone: string };

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function validTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : null;
}

function validTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function validateJobSchedule(schedule: JobSchedule) {
  if (!schedule || typeof schedule !== 'object') return 'A schedule is required.';
  if (schedule.type === 'once') {
    const timestamp = Date.parse(schedule.runAt);
    return Number.isFinite(timestamp) ? null : 'One-time jobs require a valid runAt timestamp.';
  }
  if (schedule.type === 'interval') {
    return Number.isFinite(schedule.everyMinutes) && schedule.everyMinutes >= 60 && schedule.everyMinutes <= 60 * 24 * 30
      ? null
      : 'Intervals must be between 60 minutes and 30 days.';
  }
  if (schedule.type === 'daily') {
    if (!validTime(schedule.time)) return 'Daily schedules require time in HH:MM format.';
    return validTimezone(schedule.timezone) ? null : 'Daily schedules require a valid IANA timezone.';
  }
  if (schedule.type === 'weekly') {
    if (!Number.isInteger(schedule.weekday) || schedule.weekday < 0 || schedule.weekday > 6) return 'Weekly schedules require weekday 0-6.';
    if (!validTime(schedule.time)) return 'Weekly schedules require time in HH:MM format.';
    return validTimezone(schedule.timezone) ? null : 'Weekly schedules require a valid IANA timezone.';
  }
  return 'Unsupported schedule type.';
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', weekday: 'short',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: Math.max(0, WEEKDAYS.indexOf(parts.weekday)),
  };
}

function addLocalDays(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function localToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = desired;
  for (let index = 0; index < 4; index += 1) {
    const actual = zonedParts(new Date(guess), timezone);
    const actualScalar = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    const delta = desired - actualScalar;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

export function nextRunAfter(schedule: JobSchedule, after: Date, anchor?: Date): string | null {
  const error = validateJobSchedule(schedule);
  if (error) throw new Error(error);
  const afterMs = after.getTime();

  if (schedule.type === 'once') {
    const runAt = new Date(schedule.runAt);
    return runAt.getTime() > afterMs ? runAt.toISOString() : null;
  }

  if (schedule.type === 'interval') {
    const base = schedule.anchorAt ? new Date(schedule.anchorAt) : anchor || after;
    const baseMs = base.getTime();
    const intervalMs = Math.round(schedule.everyMinutes) * 60_000;
    if (baseMs > afterMs) return new Date(baseMs).toISOString();
    const steps = Math.floor((afterMs - baseMs) / intervalMs) + 1;
    return new Date(baseMs + steps * intervalMs).toISOString();
  }

  const time = validTime(schedule.time) as { hour: number; minute: number };
  const local = zonedParts(after, schedule.timezone);
  let localDate = { year: local.year, month: local.month, day: local.day };

  if (schedule.type === 'daily') {
    let candidate = localToUtc(localDate.year, localDate.month, localDate.day, time.hour, time.minute, schedule.timezone);
    if (candidate.getTime() <= afterMs) {
      localDate = addLocalDays(localDate.year, localDate.month, localDate.day, 1);
      candidate = localToUtc(localDate.year, localDate.month, localDate.day, time.hour, time.minute, schedule.timezone);
    }
    return candidate.toISOString();
  }

  let daysAhead = (schedule.weekday - local.weekday + 7) % 7;
  let target = addLocalDays(localDate.year, localDate.month, localDate.day, daysAhead);
  let candidate = localToUtc(target.year, target.month, target.day, time.hour, time.minute, schedule.timezone);
  if (candidate.getTime() <= afterMs) {
    daysAhead = daysAhead === 0 ? 7 : daysAhead + 7;
    target = addLocalDays(localDate.year, localDate.month, localDate.day, daysAhead);
    candidate = localToUtc(target.year, target.month, target.day, time.hour, time.minute, schedule.timezone);
  }
  return candidate.toISOString();
}

export function describeJobSchedule(schedule: JobSchedule) {
  if (schedule.type === 'once') return `Once at ${schedule.runAt}`;
  if (schedule.type === 'interval') return `Every ${schedule.everyMinutes} minutes`;
  if (schedule.type === 'daily') return `Daily at ${schedule.time} (${schedule.timezone})`;
  return `Weekly on ${WEEKDAYS[schedule.weekday]} at ${schedule.time} (${schedule.timezone})`;
}
