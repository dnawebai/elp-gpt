import type { NotificationKind, NotificationSeverity } from '@/lib/notification-store';

export type NotificationChannel = 'push' | 'email' | 'sms' | 'whatsapp' | 'voice';

export type NotificationDeliveryPreferences = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  voiceEnabled: boolean;
  email?: string;
  phone?: string;
  whatsapp?: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone: string;
};

export const DEFAULT_NOTIFICATION_DELIVERY_PREFERENCES: NotificationDeliveryPreferences = {
  pushEnabled: true,
  emailEnabled: false,
  smsEnabled: false,
  whatsappEnabled: false,
  voiceEnabled: false,
  timezone: 'America/Toronto',
};

const rank: Record<NotificationSeverity, number> = { low: 1, normal: 2, high: 3, critical: 4 };

function validClock(value: string | undefined) {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

function localMinutes(now: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    return hour * 60 + minute;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

export function isQuietHours(preferences: NotificationDeliveryPreferences, now = new Date()) {
  const start = validClock(preferences.quietHoursStart);
  const end = validClock(preferences.quietHoursEnd);
  if (start === null || end === null || start === end) return false;
  const current = localMinutes(now, preferences.timezone || 'UTC');
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function notificationChannelDelayMinutes(args: {
  channel: NotificationChannel;
  severity: NotificationSeverity;
  kind: NotificationKind;
}) {
  const { channel, severity, kind } = args;
  if (channel === 'push') return rank[severity] >= rank.high ? 0 : Number.POSITIVE_INFINITY;
  if (channel === 'email') return rank[severity] >= rank.high ? 0 : Number.POSITIVE_INFINITY;
  if (channel === 'sms' || channel === 'whatsapp') {
    if (severity === 'critical') return 0;
    if (severity === 'high' && ['approval', 'failure', 'deadline', 'risk'].includes(kind)) return 15;
    return Number.POSITIVE_INFINITY;
  }
  if (channel === 'voice') {
    if (severity === 'critical') return 10;
    if (severity === 'high' && ['approval', 'failure', 'deadline'].includes(kind)) return 60;
    return Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

export function enabledChannels(preferences: NotificationDeliveryPreferences) {
  const channels: NotificationChannel[] = [];
  if (preferences.pushEnabled) channels.push('push');
  if (preferences.emailEnabled && preferences.email) channels.push('email');
  if (preferences.smsEnabled && preferences.phone) channels.push('sms');
  if (preferences.whatsappEnabled && (preferences.whatsapp || preferences.phone)) channels.push('whatsapp');
  if (preferences.voiceEnabled && preferences.phone) channels.push('voice');
  return channels;
}

export function shouldDeliverNotification(args: {
  channel: NotificationChannel;
  severity: NotificationSeverity;
  kind: NotificationKind;
  lastSeenAt: string;
  preferences: NotificationDeliveryPreferences;
  now?: Date;
}) {
  const now = args.now || new Date();
  if (!enabledChannels(args.preferences).includes(args.channel)) return false;
  const delay = notificationChannelDelayMinutes(args);
  if (!Number.isFinite(delay)) return false;
  const seen = Date.parse(args.lastSeenAt);
  if (!Number.isFinite(seen) || now.getTime() - seen < delay * 60_000) return false;
  if (args.severity !== 'critical' && isQuietHours(args.preferences, now)) return false;
  return true;
}

export function deliveryKey(notification: { id: string; occurrenceCount: number; updatedAt: string }, channel: NotificationChannel) {
  return `${notification.id}:${notification.occurrenceCount}:${Date.parse(notification.updatedAt) || 0}:${channel}`;
}
