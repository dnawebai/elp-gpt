export function hoursUntil(value: string | undefined, now = new Date()) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return (time - now.getTime()) / 3_600_000;
}

export function shouldRenewCalendarWatch(input: {
  status?: string;
  expiresAt?: string;
  now?: Date;
  renewalWindowHours?: number;
}) {
  const now = input.now || new Date();
  if (input.status !== 'active') return true;
  const remaining = hoursUntil(input.expiresAt, now);
  if (remaining === null) return true;
  return remaining <= Math.max(1, input.renewalWindowHours ?? 24);
}

export function isFresh(value: string | undefined, maxAgeMinutes: number, now = new Date()) {
  if (!value) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const age = now.getTime() - time;
  return age >= -5 * 60_000 && age <= Math.max(1, maxAgeMinutes) * 60_000;
}
