import { sanitizeId } from '@/lib/security';

export function isSingleUserOwnerMode() {
  return process.env.LUKE_SINGLE_USER_MODE?.trim().toLowerCase() === 'true';
}

export function getOwnerProfileId() {
  if (!isSingleUserOwnerMode()) return null;
  return sanitizeId(process.env.LUKE_OWNER_PROFILE_ID || 'owner', 'owner');
}

export function getBriefingTimezone() {
  return process.env.LUKE_BRIEFING_TIMEZONE?.trim() || 'America/Toronto';
}

export function getBriefingHour() {
  const parsed = Number.parseInt(process.env.LUKE_BRIEFING_HOUR || '8', 10);
  return Number.isFinite(parsed) ? Math.min(23, Math.max(0, parsed)) : 8;
}

export function getBriefingEmailConfig() {
  const enabled = process.env.LUKE_BRIEFING_EMAIL_ENABLED?.trim().toLowerCase() === 'true';
  const recipient = process.env.LUKE_BRIEFING_EMAIL_TO?.trim() || '';
  return {
    enabled,
    recipient,
    ready: enabled && Boolean(recipient),
  };
}

export function localDateParts(timezone = getBriefingTimezone(), date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      date: `${map.year}-${map.month}-${map.day}`,
      hour: Number.parseInt(map.hour || '0', 10),
    };
  } catch {
    return {
      date: date.toISOString().slice(0, 10),
      hour: date.getUTCHours(),
    };
  }
}
