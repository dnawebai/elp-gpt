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
function parseInboundEvent(message: { id: string; createdAt: string; metadata: Record<string, unknown> }): InboundEvent | null {
  const m = message.metadata || {};
  if (m.elpInboundEvent !== true) return null;
  const provider = String(m.provider) as EventProvider;
  if (!['google_calendar','gmail','outlook','teams','slack','github','whatsapp','generic'].includes(provider)) return null;
  let metadata: Record<string, unknown> = {};
  if (typeof m.metadataJson === 'string' && m.metadataJson) { try { const parsed = JSON.parse(m.metadataJson) as unknown; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>; } catch {} }
  return {
    id: typeof m.eventId === 'string' ? m.eventId : message.id,
    provider,
    type: typeof m.eventType === 'string' ? m.eventType : 'event',
    ...(typeof m.sourceId === 'string' && m.sourceId ? { sourceId: m.sourceId } : {}),
    receivedAt: typeof m.receivedAt === 'string' ? m.receivedAt : message.createdAt,
    ...(typeof m.summary === 'string' && m.summary ? { summary: m.summary } : {}),
    metadata,
  };
}

function providerExecutionError(value: unknown) {
  const queue: unknown[] = [value];
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object') continue;
    if (Array.isArray(item)) { queue.push(...item); continue; }
    const record = item as Record<string, unknown>;
    if (record.successful === false) {
      if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
      const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : null;
      if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
      return 'Provider tool execution reported failure.';
    }
    queue.push(...Object.values(record));
  }
  return null;
}

export async function listEventSubscriptions(profileId: string) { const handles = await sessionFor(profileId); if (!handles) return [] as EventSubscription[]; const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 20, reverse: true }); const byProvider = new Map<EventProvider, EventSubscription>(); for (const message of messages) { const item = parseSubscription(message); if (item && !byProvider.has(item.provider)) byProvider.set(item.provider, item); } return [...byProvider.values()]; }

export async function listRecentInboundEvents(profileId: string, hours = 6, maxItems = 100) {
  const handles = await sessionFor(profileId); if (!handles) return [] as InboundEvent[];
  const boundedHours = Math.max(1, Math.min(72, hours)); const cutoff = Date.now() - boundedHours * 3_600_000;
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 10, reverse: true });
  return messages
    .map(parseInboundEvent)
    .filter((item): item is InboundEvent => {
      if (!item) return false;
      return Date.parse(item.receivedAt) >= cutoff;
    })
    .sort((a,b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, Math.max(1, Math.min(500, maxItems)));
}

export async function ensureBaselineEventStatus(profileId: string) {
  const handles = await sessionFor(profileId); if (!handles) return [] as EventSubscription[]; const existing = await listEventSubscriptions(profileId); const present = new Set(existing.map((x) => x.provider)); const now = new Date().toISOString(); const records: Array<{ provider: EventProvider; status: EventSubscription['status']; note: string }> = [
    { provider: 'gmail', status: 'fallback_polling', note: 'Gmail history checkpoints provide incremental mailbox deltas when provider-native push subscriptions are unavailable.' },
    { provider: 'outlook', status: 'fallback_polling', note: 'Outlook delta checkpoints provide incremental mailbox changes when direct Graph change subscriptions are unavailable.' },
    { provider: 'teams', status: 'fallback_polling', note: 'Teams event subscriptions require an additional Graph subscription surface; the secure communications ingress remains available.' },
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
  const executionError = providerExecutionError(result);
  if (executionError) throw new Error(`Calendar watch creation failed: ${executionError.slice(0, 500)}`);
  const objects: Record<string, unknown>[] = []; const walk = (v: unknown) => { if (!v || typeof v !== 'object') return; if (Array.isArray(v)) return v.forEach(walk); const o = v as Record<string, unknown>; objects.push(o); Object.values(o).forEach(walk); }; walk(result);
  const match = objects.find((o) => typeof o.id === 'string' && (o.id === channelId || typeof o.resourceId === 'string' || typeof o.resource_id === 'string')); const resourceId = match && typeof (match.resourceId || match.resource_id) === 'string' ? String(match.resourceId || match.resource_id) : undefined; const expirationRaw = match?.expiration; const expiresAt = typeof expirationRaw === 'string' || typeof expirationRaw === 'number' ? new Date(Number(expirationRaw) > 2e12 ? Number(expirationRaw) : String(expirationRaw)).toISOString() : undefined;
  if (!resourceId) throw new Error('Calendar watch creation returned no resource identifier; refusing to record a false active subscription.');
  const now = new Date().toISOString(); const subscriptionId = randomUUID();
  await handles.session.addMessages([{ peerId: handles.elp.id, content: `[EVENT_SUBSCRIPTION] google_calendar: active`, metadata: { elpEventSubscription: true, recordVersion: 1, subscriptionId, provider: 'google_calendar', status: 'active', channelId, token, resourceId, expiresAt: expiresAt || '', callbackUrl, note: 'Google Calendar push channel for event changes.', createdAt: now, updatedAt: now } }]);
  return { id: subscriptionId, provider: 'google_calendar' as const, status: 'active' as const, channelId, resourceId, expiresAt, callbackUrl, createdAt: now, updatedAt: now };
}

export async function verifyGoogleCalendarWebhook(profileId: string, channelId: string, token: string) { const subscriptions = await listEventSubscriptions(profileId); const active = subscriptions.find((s) => s.provider === 'google_calendar' && s.status === 'active' && s.channelId === channelId); return Boolean(active?.token && safeEqual(active.token, token)); }
export async function recordInboundEvent(profileId: string, event: Omit<InboundEvent, 'id' | 'receivedAt'>) { const handles = await sessionFor(profileId); if (!handles) return null; const id = randomUUID(); const receivedAt = new Date().toISOString(); await handles.session.addMessages([{ peerId: handles.elp.id, content: `[INBOUND_EVENT][${event.provider}] ${event.type}${event.summary ? `\n${event.summary}` : ''}`, metadata: { elpInboundEvent: true, recordVersion: 1, eventId: id, provider: event.provider, eventType: event.type.slice(0,120), sourceId: event.sourceId?.slice(0,300) || '', receivedAt, summary: event.summary?.slice(0,1600) || '', metadataJson: JSON.stringify(event.metadata || {}).slice(0,8000) } }]); return { id, receivedAt, ...event }; }
