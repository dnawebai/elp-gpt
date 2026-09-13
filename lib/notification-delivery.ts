import { createHash } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import webpush from 'web-push';
import { executeComposioTool } from '@/lib/composio';
import {
  DEFAULT_NOTIFICATION_DELIVERY_PREFERENCES,
  deliveryKey,
  enabledChannels,
  shouldDeliverNotification,
  type NotificationChannel,
  type NotificationDeliveryPreferences,
} from '@/lib/notification-delivery-policy';
import { getNotificationCenter, type NotificationRecord } from '@/lib/notification-store';

export type PushSubscriptionRecord = {
  id: string;
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
  createdAt: string;
  updatedAt: string;
};

export type DeliveryAttempt = {
  id: string;
  notificationId: string;
  deliveryKey: string;
  channel: NotificationChannel;
  status: 'sent' | 'failed' | 'skipped';
  createdAt: string;
  detail?: string;
};

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt';
}

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

async function getDeliverySession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`notification-delivery-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

export function getPushPublicKey() {
  return process.env.ELP_WEB_PUSH_PUBLIC_KEY?.trim() || null;
}

export function webPushConfigured() {
  return Boolean(process.env.ELP_WEB_PUSH_PUBLIC_KEY?.trim() && process.env.ELP_WEB_PUSH_PRIVATE_KEY?.trim());
}

function configureWebPush() {
  const publicKey = process.env.ELP_WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.ELP_WEB_PUSH_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) throw new Error('Web Push is not configured.');
  webpush.setVapidDetails(process.env.ELP_WEB_PUSH_SUBJECT?.trim() || 'mailto:alerts@elpgpt.com', publicKey, privateKey);
}

export async function getDeliveryPreferences(profileId: string): Promise<NotificationDeliveryPreferences> {
  const handles = await getDeliverySession(profileId);
  if (!handles) return DEFAULT_NOTIFICATION_DELIVERY_PREFERENCES;
  const page = await handles.session.messages({ size: 80, reverse: true });
  const message = page.items.find((item) => item.metadata?.elpNotificationDeliveryPreferences === true);
  const stored = parseJson<Partial<NotificationDeliveryPreferences>>(message?.metadata?.preferencesJson);
  return { ...DEFAULT_NOTIFICATION_DELIVERY_PREFERENCES, ...(stored || {}) };
}

export async function setDeliveryPreferences(profileId: string, preferences: NotificationDeliveryPreferences) {
  const handles = await getDeliverySession(profileId);
  if (!handles) throw new Error('Notification delivery storage is unavailable.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: preferences.timezone }).format(new Date()); }
  catch { throw new Error('A valid IANA timezone is required.'); }
  const clean: NotificationDeliveryPreferences = {
    pushEnabled: preferences.pushEnabled === true,
    emailEnabled: preferences.emailEnabled === true,
    smsEnabled: preferences.smsEnabled === true,
    whatsappEnabled: preferences.whatsappEnabled === true,
    voiceEnabled: preferences.voiceEnabled === true,
    ...(preferences.email?.trim() ? { email: clip(preferences.email, 320) } : {}),
    ...(preferences.phone?.trim() ? { phone: clip(preferences.phone, 40) } : {}),
    ...(preferences.whatsapp?.trim() ? { whatsapp: clip(preferences.whatsapp, 40) } : {}),
    ...(preferences.quietHoursStart?.trim() ? { quietHoursStart: clip(preferences.quietHoursStart, 5) } : {}),
    ...(preferences.quietHoursEnd?.trim() ? { quietHoursEnd: clip(preferences.quietHoursEnd, 5) } : {}),
    timezone: preferences.timezone,
  };
  const page = await handles.session.messages({ size: 80, reverse: true });
  const existing = page.items.find((item) => item.metadata?.elpNotificationDeliveryPreferences === true);
  const metadata = {
    elpNotificationDeliveryPreferences: true,
    recordVersion: 1,
    preferencesJson: JSON.stringify(clean),
    updatedAt: new Date().toISOString(),
  };
  if (existing) await handles.session.updateMessage(existing.id, { ...existing.metadata, ...metadata });
  else await handles.session.addMessages([{ peerId: handles.user.id, content: '[NOTIFICATION DELIVERY PREFERENCES]', metadata }]);
  return clean;
}

function endpointHash(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
}

export async function savePushSubscription(profileId: string, input: {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}) {
  const handles = await getDeliverySession(profileId);
  if (!handles) throw new Error('Push subscription storage is unavailable.');
  if (!input.endpoint.startsWith('https://') || !input.keys?.p256dh || !input.keys?.auth) throw new Error('Invalid push subscription.');
  const hash = endpointHash(input.endpoint);
  const page = await handles.session.messages({ size: 160, reverse: true });
  const existing = page.items.find((item) => item.metadata?.elpPushSubscription === true && item.metadata?.endpointHash === hash);
  const now = new Date().toISOString();
  const metadata = {
    ...(existing?.metadata || {}),
    elpPushSubscription: true,
    recordVersion: 1,
    endpointHash: hash,
    subscriptionJson: JSON.stringify(input),
    updatedAt: now,
    createdAt: typeof existing?.metadata?.createdAt === 'string' ? existing.metadata.createdAt : now,
    active: true,
  };
  if (existing) await handles.session.updateMessage(existing.id, metadata);
  else await handles.session.addMessages([{ peerId: handles.user.id, content: `[PUSH SUBSCRIPTION] ${hash}`, metadata }]);
  return { ok: true };
}

export async function removePushSubscription(profileId: string, endpoint: string) {
  const handles = await getDeliverySession(profileId);
  if (!handles) return;
  const hash = endpointHash(endpoint);
  const page = await handles.session.messages({ size: 160, reverse: true });
  const existing = page.items.find((item) => item.metadata?.elpPushSubscription === true && item.metadata?.endpointHash === hash);
  if (existing) await handles.session.updateMessage(existing.id, { ...existing.metadata, active: false, updatedAt: new Date().toISOString() });
}

export async function listPushSubscriptions(profileId: string): Promise<PushSubscriptionRecord[]> {
  const handles = await getDeliverySession(profileId);
  if (!handles) return [];
  const page = await handles.session.messages({ size: 160, reverse: true });
  return page.items.flatMap((item) => {
    if (item.metadata?.elpPushSubscription !== true || item.metadata?.active === false) return [];
    const parsed = parseJson<{ endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } }>(item.metadata.subscriptionJson);
    if (!parsed?.endpoint || !parsed.keys?.p256dh || !parsed.keys?.auth) return [];
    return [{
      id: item.id,
      endpoint: parsed.endpoint,
      expirationTime: parsed.expirationTime,
      keys: parsed.keys,
      createdAt: typeof item.metadata.createdAt === 'string' ? item.metadata.createdAt : item.createdAt,
      updatedAt: typeof item.metadata.updatedAt === 'string' ? item.metadata.updatedAt : item.createdAt,
    }];
  });
}

async function listDeliveryAttempts(profileId: string, limit = 300): Promise<DeliveryAttempt[]> {
  const handles = await getDeliverySession(profileId);
  if (!handles) return [];
  const page = await handles.session.messages({ size: Math.min(300, Math.max(40, limit)), reverse: true });
  return page.items.flatMap((item) => {
    if (item.metadata?.elpNotificationDeliveryAttempt !== true) return [];
    const channel = item.metadata.channel as NotificationChannel;
    const status = item.metadata.deliveryStatus as DeliveryAttempt['status'];
    const notificationId = typeof item.metadata.notificationId === 'string' ? item.metadata.notificationId : '';
    const key = typeof item.metadata.deliveryKey === 'string' ? item.metadata.deliveryKey : '';
    if (!notificationId || !key || !['push', 'email', 'sms', 'whatsapp', 'voice'].includes(channel) || !['sent', 'failed', 'skipped'].includes(status)) return [];
    return [{
      id: item.id,
      notificationId,
      deliveryKey: key,
      channel,
      status,
      createdAt: typeof item.metadata.createdAt === 'string' ? item.metadata.createdAt : item.createdAt,
      ...(typeof item.metadata.detail === 'string' ? { detail: item.metadata.detail } : {}),
    }];
  });
}

async function recordAttempt(profileId: string, notification: NotificationRecord, channel: NotificationChannel, status: DeliveryAttempt['status'], detail?: string) {
  const handles = await getDeliverySession(profileId);
  if (!handles) return;
  const key = deliveryKey(notification, channel);
  const now = new Date().toISOString();
  await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[NOTIFICATION DELIVERY] ${channel} ${status} — ${notification.title}`,
    metadata: {
      elpNotificationDeliveryAttempt: true,
      recordVersion: 1,
      notificationId: notification.id,
      deliveryKey: key,
      channel,
      deliveryStatus: status,
      createdAt: now,
      ...(detail ? { detail: clip(detail, 1400) } : {}),
    },
  }]);
}

function pushPayload(notification: NotificationRecord) {
  return JSON.stringify({
    title: notification.title,
    body: notification.summary,
    tag: `elp-${notification.fingerprint}`,
    url: '/notifications',
    severity: notification.severity,
    kind: notification.kind,
  });
}

async function sendPush(profileId: string, notification: NotificationRecord) {
  if (!webPushConfigured()) throw new Error('Web Push VAPID keys are not configured.');
  configureWebPush();
  const subscriptions = await listPushSubscriptions(profileId);
  if (!subscriptions.length) throw new Error('No active Web Push subscription.');
  let sent = 0;
  const failures: string[] = [];
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, expirationTime: subscription.expirationTime, keys: subscription.keys }, pushPayload(notification), { TTL: 60 * 60, urgency: notification.severity === 'critical' ? 'high' : 'normal' });
      sent += 1;
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number((error as { statusCode?: unknown }).statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) await removePushSubscription(profileId, subscription.endpoint);
      failures.push(error instanceof Error ? error.message : 'Push failed');
    }
  }
  if (!sent) throw new Error(failures[0] || 'Push delivery failed.');
  return `Delivered to ${sent} push subscription${sent === 1 ? '' : 's'}.`;
}

async function sendEmail(profileId: string, notification: NotificationRecord, email: string) {
  await executeComposioTool({
    toolSlug: 'GMAIL_SEND_EMAIL',
    profileId,
    arguments: {
      recipient_email: email,
      subject: `[ELP ${notification.severity.toUpperCase()}] ${notification.title}`,
      body: `${notification.summary}\n\n${notification.action ? `Next: ${notification.action}\n\n` : ''}Open ELP: https://elpgpt.com/notifications`,
      is_html: false,
      user_id: 'me',
    },
  });
  return `Email sent to ${email}.`;
}

async function sendWebhook(channel: 'sms' | 'whatsapp', notification: NotificationRecord, destination: string) {
  const url = channel === 'sms' ? process.env.ELP_SMS_WEBHOOK_URL?.trim() : process.env.ELP_WHATSAPP_WEBHOOK_URL?.trim();
  if (!url) throw new Error(`${channel.toUpperCase()} delivery webhook is not configured.`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.ELP_DELIVERY_WEBHOOK_SECRET?.trim() ? { Authorization: `Bearer ${process.env.ELP_DELIVERY_WEBHOOK_SECRET.trim()}` } : {}),
    },
    body: JSON.stringify({ channel, to: destination, title: notification.title, message: notification.summary, severity: notification.severity, kind: notification.kind, action: notification.action, url: 'https://elpgpt.com/notifications' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${channel.toUpperCase()} webhook failed (${response.status}).`);
  return `${channel.toUpperCase()} webhook accepted.`;
}

async function sendVoice(notification: NotificationRecord, phone: string) {
  const apiKey = process.env.RETELL_API_KEY?.trim();
  const agentId = process.env.RETELL_AGENT_ID?.trim();
  const fromNumber = process.env.ELP_RETELL_FROM_NUMBER?.trim();
  if (!apiKey || !agentId || !fromNumber) throw new Error('Retell outbound voice is not fully configured.');
  const response = await fetch('https://api.retellai.com/v2/create-phone-call', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_number: fromNumber,
      to_number: phone,
      override_agent_id: agentId,
      metadata: { source: 'elp-notification', notification_id: notification.id },
      retell_llm_dynamic_variables: {
        alert_title: notification.title,
        alert_summary: notification.summary,
        alert_action: notification.action || 'Open ELP Notifications for details.',
        alert_severity: notification.severity,
      },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const data = await response.json().catch(() => null) as { call_id?: string; message?: string } | null;
  if (!response.ok) throw new Error(data?.message || `Retell outbound call failed (${response.status}).`);
  return `Retell call created${data?.call_id ? ` (${data.call_id})` : ''}.`;
}

async function deliverChannel(profileId: string, notification: NotificationRecord, channel: NotificationChannel, preferences: NotificationDeliveryPreferences) {
  if (channel === 'push') return sendPush(profileId, notification);
  if (channel === 'email' && preferences.email) return sendEmail(profileId, notification, preferences.email);
  if (channel === 'sms' && preferences.phone) return sendWebhook('sms', notification, preferences.phone);
  if (channel === 'whatsapp' && (preferences.whatsapp || preferences.phone)) return sendWebhook('whatsapp', notification, preferences.whatsapp || preferences.phone || '');
  if (channel === 'voice' && preferences.phone) return sendVoice(notification, preferences.phone);
  throw new Error(`${channel} destination is missing.`);
}

export async function deliverPriorityNotifications(profileId: string) {
  const [center, preferences, attempts] = await Promise.all([
    getNotificationCenter(profileId),
    getDeliveryPreferences(profileId),
    listDeliveryAttempts(profileId, 300),
  ]);
  const sentKeys = new Set(attempts.filter((attempt) => attempt.status === 'sent').map((attempt) => attempt.deliveryKey));
  const results: Array<{ notificationId: string; channel: NotificationChannel; status: 'sent' | 'failed'; detail: string }> = [];
  const notifications = center.notifications.filter((item) => item.status === 'unread' && (item.severity === 'critical' || item.severity === 'high')).slice(0, 30);
  const channels = enabledChannels(preferences);

  for (const notification of notifications) {
    for (const channel of channels) {
      const key = deliveryKey(notification, channel);
      if (sentKeys.has(key)) continue;
      if (!shouldDeliverNotification({ channel, severity: notification.severity, kind: notification.kind, firstSeenAt: notification.createdAt, preferences })) continue;
      try {
        const detail = await deliverChannel(profileId, notification, channel, preferences);
        await recordAttempt(profileId, notification, channel, 'sent', detail);
        sentKeys.add(key);
        results.push({ notificationId: notification.id, channel, status: 'sent', detail });
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Delivery failed.';
        await recordAttempt(profileId, notification, channel, 'failed', detail);
        results.push({ notificationId: notification.id, channel, status: 'failed', detail });
      }
    }
  }

  return {
    ok: results.every((item) => item.status === 'sent'),
    attempted: results.length,
    sent: results.filter((item) => item.status === 'sent').length,
    failed: results.filter((item) => item.status === 'failed').length,
    channels,
    results,
  };
}

export async function getNotificationDeliverySnapshot(profileId: string) {
  const [preferences, subscriptions, attempts] = await Promise.all([
    getDeliveryPreferences(profileId),
    listPushSubscriptions(profileId),
    listDeliveryAttempts(profileId, 120),
  ]);
  return {
    preferences,
    push: { configured: webPushConfigured(), publicKey: getPushPublicKey(), subscriptions: subscriptions.length },
    providers: {
      email: Boolean(process.env.COMPOSIO_API_KEY),
      sms: Boolean(process.env.ELP_SMS_WEBHOOK_URL),
      whatsapp: Boolean(process.env.ELP_WHATSAPP_WEBHOOK_URL),
      voice: Boolean(process.env.RETELL_API_KEY && process.env.RETELL_AGENT_ID && process.env.ELP_RETELL_FROM_NUMBER),
    },
    recentAttempts: attempts.slice(0, 30),
  };
}
