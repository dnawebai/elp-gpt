import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { executeComposioTool } from '@/lib/composio';
import { listHonchoMessages } from '@/lib/honcho-pagination';

export type EventProvider = 'google_calendar' | 'gmail' | 'outlook' | 'teams' | 'slack' | 'github' | 'whatsapp' | 'generic';
export type EventSubscription = { id: string; provider: EventProvider; status: 'active' | 'fallback_polling' | 'blocked'; channelId?: string; token?: string; resourceId?: string; expiresAt?: string; callbackUrl?: string; note?: string; createdAt: string; updatedAt: string };
export type InboundEvent = { id: string; provider: EventProvider; type: string; sourceId?: string; receivedAt: string; summary?: string; metadata?: Record<string, unknown> };

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
async function sessionFor(profileId: string) { if (!process.env.HONCHO_API_KEY) return null; const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' }); const user = await honcho.peer(`user-${profileId}`); const elp = await honcho.peer('elp'); const session = await honcho.session(`event-fabric-${profileId}`); await session.addPeers([user, elp]); return { user, elp, session }; }
function safeEqual(a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function parseSubscription(message: { id: string; createdAt: string; metadata: Record<string, unknown> }): EventSubscription | null { const m = message.metadata || {}; if (m.elpEventSubscription !== true) return null; const provider = String(m.provider) as EventProvider; if (!['google_calendar','gmail','outlook','teams','slack','github','whatsapp','generic'].includes(provider)) return null; return { id: typeof m.subscriptionId === 'string' ? m.subscriptionId : message.id, provider, status: ['active','fallback_polling','blocked'].includes(String(m.status)) ? m.status as EventSubscription['status'] : 'blocked', channelId: typeof m.channelId === 'string' ? m.channelId : undefined, token: typeof m.token === 'string' ? m.token : undefined, resourceId: typeof m.resourceId === 'string' ? m.resourceId : undefined, expiresAt: typeof m.expiresAt === 'string' ? m.expiresAt : undefined, callbackUrl: typeof m.callbackUrl === 'string' ? m.callbackUrl : undefined, note: typeof m.note === 'string' ? m.note : undefined, createdAt: typeof m.createdAt === 'string' ? m.createdAt : message.createdAt, updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : message.createdAt }; }

export async function listEventSubscriptions(profileId: string) { const handles = await sessionFor(profileId); if (!handles) return [] as EventSubscription[]; const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true }); const byProvider = new Map<EventProvider, EventSubscription>(); for (const message of messages) { const item = parseSubscription(message); if (item && !byProvider.has(item.provider)) byProvider.set(item.provider, item); } return [...byProvider.values()]; }

export async function ensureBaselineEventStatus(profileId: string) {
  const handles = await sessionFor(profileId); if (!handles) return [] as EventSubscription[]; const existing = await listEventSubscriptions(profileId); const present = new Set(existing.map((x) => x.provider)); const now = new Date().toISOString(); const records: Array<{ provider: EventProvider; status: EventSubscription['status']; note: string }> = [
    { provider: 'gmail', status: 'fallback_polling', note: 'Provider connection exposes message reads/history but not Gmail users.watch subscription creation in the current tool surface.' },
    { provider: 'outlook', status: 'fallback_polling', note: 'Outlook is connected; direct Microsoft Graph subscription creation is not exposed by the active Outlook tool surface.' },
    { provider: 'teams', status: 'fallback_polling', note: 'Teams chat reads are available through Outlook; event subscription requires an additional Graph subscription connection.' },
    { provider: 'slack', status: 'blocked', note: 'No active Slack event-subscription connection is currently available.' },
  ];
  for (const record of records) if (!present.has(record.provider)) await handles.session.addMessages([{ peerId: handles.elp.id, content: `[EVENT_SUBSCRIPTION] ${record.provider}: ${record.status}`, metadata: { elpEventSubscription: true, recordVersion: 1, subscriptionId: randomUUID(), provider: record.provider, status: record.status, note: record.note, createdAt: now, updatedAt: now } }]);
  return listEventSubscriptions(profileId);
}

export async function createGoogleCalendarWatch(profileId: string, callbackUrl: string) {
  if (!/^https:\/\//i.test(callbackUrl)) throw new Error('Calendar webhook callback must be public HTTPS.');
  const handles = await sessionFor(profileId); if (!handles) throw new Error('Event fabric storage is unavailable.');
  const channelId = randomUUID(); const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  const result = await executeComposioTool({ toolSlug: 'GOOGLECALENDAR_EVENTS_WATCH', arguments: { calendarId: 'primary', id: channelId, address: callbackUrl, type: 'web_hook', token, params: { ttl: '604800' }, payload: false }, profileId });
  const objects: Record<string, unknown>[] = []; const walk = (v: unknown) => { if (!v || typeof v !== 'object') return; if (Array.isArray(v)) return v.forEach(walk); const o = v as Record<string, unknown>; objects.push(o); Object.values(o).forEach(walk); }; walk(result);
  const match = objects.find((o) => typeof o.id === 'string' && (o.id === channelId || typeof o.resourceId === 'string' || typeof o.resource_id === 'string')); const resourceId = match && typeof (match.resourceId || match.resource_id) === 'string' ? String(match.resourceId || match.resource_id) : undefined; const expirationRaw = match?.expiration; const expiresAt = typeof expirationRaw === 'string' || typeof expirationRaw === 'number' ? new Date(Number(expirationRaw) > 2e12 ? Number(expirationRaw) : String(expirationRaw)).toISOString() : undefined;
  const now = new Date().toISOString(); const subscriptionId = randomUUID();
  await handles.session.addMessages([{ peerId: handles.elp.id, content: `[EVENT_SUBSCRIPTION] google_calendar: active`, metadata: { elpEventSubscription: true, recordVersion: 1, subscriptionId, provider: 'google_calendar', status: 'active', channelId, token, resourceId: resourceId || '', expiresAt: expiresAt || '', callbackUrl, note: 'Google Calendar push channel for event changes.', createdAt: now, updatedAt: now } }]);
  return { id: subscriptionId, provider: 'google_calendar' as const, status: 'active' as const, channelId, resourceId, expiresAt, callbackUrl, createdAt: now, updatedAt: now };
}

export async function verifyGoogleCalendarWebhook(profileId: string, channelId: string, token: string) { const subscriptions = await listEventSubscriptions(profileId); const active = subscriptions.find((s) => s.provider === 'google_calendar' && s.status === 'active' && s.channelId === channelId); return Boolean(active?.token && safeEqual(active.token, token)); }
export async function recordInboundEvent(profileId: string, event: Omit<InboundEvent, 'id' | 'receivedAt'>) { const handles = await sessionFor(profileId); if (!handles) return null; const id = randomUUID(); const receivedAt = new Date().toISOString(); await handles.session.addMessages([{ peerId: handles.elp.id, content: `[INBOUND_EVENT][${event.provider}] ${event.type}${event.summary ? `\n${event.summary}` : ''}`, metadata: { elpInboundEvent: true, recordVersion: 1, eventId: id, provider: event.provider, eventType: event.type.slice(0,120), sourceId: event.sourceId?.slice(0,300) || '', receivedAt, summary: event.summary?.slice(0,1600) || '', metadataJson: JSON.stringify(event.metadata || {}).slice(0,8000) } }]); return { id, receivedAt, ...event }; }
