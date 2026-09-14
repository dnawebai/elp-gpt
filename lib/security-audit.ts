import { createHash, randomUUID } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { listHonchoMessages } from '@/lib/honcho-pagination';

export type SecurityEventCategory = 'identity' | 'session' | 'passkey' | 'authority' | 'action' | 'incident' | 'system';
export type SecurityEventOutcome = 'success' | 'denied' | 'failure' | 'info';
export type SecurityEventSeverity = 'low' | 'normal' | 'high' | 'critical';

export type SecurityAuditEvent = {
  id: string;
  createdAt: string;
  category: SecurityEventCategory;
  action: string;
  outcome: SecurityEventOutcome;
  severity: SecurityEventSeverity;
  actorPrincipalId?: string;
  subjectId?: string;
  sessionId?: string;
  detail?: string;
  clientFingerprint?: string;
  prevHash: string;
  hash: string;
};

export type SecurityAuditIntegrity = {
  ok: boolean;
  checked: number;
  anchored: boolean;
  brokenAtEventId?: string;
  reason?: string;
  headHash?: string;
};

const GENESIS_HASH = 'GENESIS';
const CATEGORIES = new Set<SecurityEventCategory>(['identity','session','passkey','authority','action','incident','system']);
const OUTCOMES = new Set<SecurityEventOutcome>(['success','denied','failure','info']);
const SEVERITIES = new Set<SecurityEventSeverity>(['low','normal','high','critical']);

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }

async function sessionFor(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`security-audit-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function clip(value: unknown, max: number) {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  if (!clean) return undefined;
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function hashPayload(event: Omit<SecurityAuditEvent, 'hash'>) {
  const canonical = JSON.stringify({
    id: event.id,
    createdAt: event.createdAt,
    category: event.category,
    action: event.action,
    outcome: event.outcome,
    severity: event.severity,
    actorPrincipalId: event.actorPrincipalId || null,
    subjectId: event.subjectId || null,
    sessionId: event.sessionId || null,
    detail: event.detail || null,
    clientFingerprint: event.clientFingerprint || null,
    prevHash: event.prevHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function securityClientFingerprint(request: Request) {
  const descriptor = [
    request.headers.get('user-agent') || '',
    request.headers.get('sec-ch-ua-platform') || '',
    request.headers.get('accept-language') || '',
  ].join('|').slice(0, 1600);
  if (!descriptor.replace(/\|/g, '').trim()) return undefined;
  return createHash('sha256').update(descriptor).digest('hex').slice(0, 24);
}

function parse(message: { metadata: Record<string, unknown> }): SecurityAuditEvent | null {
  const metadata = message.metadata || {};
  if (metadata.elpSecurityAudit !== true || typeof metadata.eventJson !== 'string') return null;
  try {
    const event = JSON.parse(metadata.eventJson) as SecurityAuditEvent;
    if (!event?.id || !event.createdAt || !event.action || !event.prevHash || !event.hash) return null;
    if (!CATEGORIES.has(event.category) || !OUTCOMES.has(event.outcome) || !SEVERITIES.has(event.severity)) return null;
    return event;
  } catch {
    return null;
  }
}

export async function listSecurityAuditEvents(profileId: string, limit = 400) {
  const handles = await sessionFor(profileId);
  if (!handles) return [] as SecurityAuditEvent[];
  const messages = await listHonchoMessages(handles.session, { pageSize: 100, maxPages: 30, reverse: true });
  const events = messages.map(parse).filter((item): item is SecurityAuditEvent => Boolean(item));
  return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, Math.max(1, Math.min(3000, limit)));
}

export async function appendSecurityEvent(profileId: string, input: {
  category: SecurityEventCategory;
  action: string;
  outcome?: SecurityEventOutcome;
  severity?: SecurityEventSeverity;
  actorPrincipalId?: string;
  subjectId?: string;
  sessionId?: string;
  detail?: string;
  clientFingerprint?: string;
}) {
  const handles = await sessionFor(profileId);
  if (!handles) throw new Error('Security audit storage is unavailable.');
  const latest = (await listSecurityAuditEvents(profileId, 1))[0];
  const base: Omit<SecurityAuditEvent, 'hash'> = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    category: input.category,
    action: clip(input.action, 160) || 'security.event',
    outcome: input.outcome || 'info',
    severity: input.severity || 'normal',
    ...(clip(input.actorPrincipalId, 160) ? { actorPrincipalId: clip(input.actorPrincipalId, 160) } : {}),
    ...(clip(input.subjectId, 240) ? { subjectId: clip(input.subjectId, 240) } : {}),
    ...(clip(input.sessionId, 160) ? { sessionId: clip(input.sessionId, 160) } : {}),
    ...(clip(input.detail, 1200) ? { detail: clip(input.detail, 1200) } : {}),
    ...(clip(input.clientFingerprint, 80) ? { clientFingerprint: clip(input.clientFingerprint, 80) } : {}),
    prevHash: latest?.hash || GENESIS_HASH,
  };
  const event: SecurityAuditEvent = { ...base, hash: hashPayload(base) };
  await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[SECURITY_AUDIT] ${event.category}.${event.action} ${event.outcome}`,
    metadata: {
      elpSecurityAudit: true,
      recordVersion: 1,
      eventId: event.id,
      category: event.category,
      action: event.action,
      outcome: event.outcome,
      severity: event.severity,
      prevHash: event.prevHash,
      hash: event.hash,
      eventJson: JSON.stringify(event),
    },
  }]);
  return event;
}

export async function recordSecurityEventSafe(profileId: string, input: Parameters<typeof appendSecurityEvent>[1]) {
  try {
    return await appendSecurityEvent(profileId, input);
  } catch (error) {
    console.error('ELP security audit write failed', error);
    return null;
  }
}

export function verifySecurityAuditChain(events: SecurityAuditEvent[]): SecurityAuditIntegrity {
  if (!events.length) return { ok: true, checked: 0, anchored: false };
  const ordered = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const first = ordered[0];
  const anchored = first.prevHash === GENESIS_HASH;
  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index];
    const { hash, ...base } = event;
    const expectedHash = hashPayload(base);
    if (hash !== expectedHash) {
      return { ok: false, checked: index + 1, anchored, brokenAtEventId: event.id, reason: 'Event content hash does not match the signed chain payload.', headHash: ordered.at(-1)?.hash };
    }
    if (index > 0 && event.prevHash !== ordered[index - 1].hash) {
      return { ok: false, checked: index + 1, anchored, brokenAtEventId: event.id, reason: 'Audit chain continuity is broken or forked.', headHash: ordered.at(-1)?.hash };
    }
  }
  return { ok: true, checked: ordered.length, anchored, headHash: ordered.at(-1)?.hash };
}

export function recentSecurityEvents(events: SecurityAuditEvent[], minutes: number) {
  const cutoff = Date.now() - Math.max(1, minutes) * 60_000;
  return events.filter((event) => {
    const time = Date.parse(event.createdAt);
    return Number.isFinite(time) && time >= cutoff;
  });
}
