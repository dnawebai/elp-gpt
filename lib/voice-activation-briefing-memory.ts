import { Honcho } from '@honcho-ai/sdk';
import { sealServerEnvelope, unsealServerEnvelope } from '@/lib/secure-envelope';
import type { VoiceActivationBriefing } from '@/lib/voice-activation-briefing';
import type { ZeroTrustAuthorityContext } from '@/lib/zero-trust-authority';

type BriefingCategory = 'approval' | 'risk' | 'commitment' | 'appointment' | 'decision';
type ChangeKind = 'new' | 'deadline' | 'escalated' | 'changed' | 'resolved';

type BriefingMemoryEntry = {
  key: string;
  category: BriefingCategory;
  signature: string;
  urgency: number;
  deadlineBand: number;
  label: string;
  speech: string;
};

type BriefingMemorySnapshot = {
  version: 1;
  profileId: string;
  principalId: string;
  generatedAt: string;
  status: VoiceActivationBriefing['status'];
  entries: BriefingMemoryEntry[];
};

type BriefingAcknowledgement = {
  version: 1;
  profileId: string;
  principalId: string;
  issuedAt: string;
  snapshot: BriefingMemorySnapshot;
};

export type AdaptiveVoiceActivationBriefing = VoiceActivationBriefing & {
  shouldSpeak: boolean;
  changeState: 'initial' | 'changed' | 'unchanged';
  changes: Record<ChangeKind, number>;
  acknowledgement?: string;
  previousGeneratedAt?: string;
};

const ACK_PURPOSE = 'voice-activation-briefing-ack';
const ACK_TTL_MS = 10 * 60 * 1000;
const MAX_DELTA_SPEECH = 1000;
const MAX_MEMORY_ENTRIES = 40;

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt';
}

async function memorySession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({
    apiKey: process.env.HONCHO_API_KEY,
    workspaceId: workspaceId(),
    environment: 'production',
  });
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`voice-activation-memory-${profileId}`);
  await session.addPeers([elp]);
  return { elp, session };
}

function clip(value: string, max: number) {
  const clean = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function stable(parts: Array<string | number | boolean | undefined>) {
  return parts.map((part) => String(part ?? '')).join('|');
}

function timeBand(remainingMs: number) {
  if (!Number.isFinite(remainingMs)) return 0;
  if (remainingMs <= 30 * 60 * 1000) return 4;
  if (remainingMs <= 2 * 60 * 60 * 1000) return 3;
  if (remainingMs <= 6 * 60 * 60 * 1000) return 2;
  return 1;
}

function remainingPhrase(expiresAt: string) {
  const remaining = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remaining)) return '';
  const minutes = Math.max(0, Math.ceil(remaining / 60_000));
  if (minutes < 60) return `expires in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `expires in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.ceil(hours / 24);
  return `expires in ${days} day${days === 1 ? '' : 's'}`;
}

function dayBand(date?: string) {
  if (!date) return 0;
  const parsed = Date.parse(date.length === 10 ? `${date}T23:59:59.999Z` : date);
  if (!Number.isFinite(parsed)) return 0;
  const remaining = parsed - Date.now();
  if (remaining <= 0) return 4;
  if (remaining <= 24 * 60 * 60 * 1000) return 3;
  if (remaining <= 3 * 24 * 60 * 60 * 1000) return 2;
  if (remaining <= 7 * 24 * 60 * 60 * 1000) return 1;
  return 0;
}

function riskHorizonBand(hours: number) {
  if (!Number.isFinite(hours)) return 0;
  if (hours <= 12) return 4;
  if (hours <= 24) return 3;
  if (hours <= 72) return 2;
  return 1;
}

function entriesFromBriefing(briefing: VoiceActivationBriefing): BriefingMemoryEntry[] {
  const now = Date.now();
  const entries: BriefingMemoryEntry[] = [];

  for (const item of briefing.approvals) {
    const deadlineBand = timeBand(Date.parse(item.expiresAt) - now);
    const riskScore = item.risk === 'high' ? 300 : item.risk === 'write' ? 200 : 100;
    const remaining = remainingPhrase(item.expiresAt);
    entries.push({
      key: `approval:${item.id}`,
      category: 'approval',
      signature: stable([item.summary, item.toolSlug, item.risk]),
      urgency: riskScore + deadlineBand * 20,
      deadlineBand,
      label: clip(item.summary, 140),
      speech: `Approval update: ${clip(item.summary, 180)}. ${item.risk === 'high' ? 'High risk. ' : ''}${remaining ? `${remaining}.` : ''}`.trim(),
    });
  }

  for (const item of briefing.risks) {
    const deadlineBand = riskHorizonBand(item.horizonHours);
    entries.push({
      key: `risk:${item.id}`,
      category: 'risk',
      signature: stable([item.severity, item.title, item.summary, Math.round(item.confidence * 10)]),
      urgency: (item.severity === 'critical' ? 400 : item.severity === 'high' ? 300 : 200) + deadlineBand * 20,
      deadlineBand,
      label: clip(item.title, 140),
      speech: `Forecast update: ${item.severity} risk — ${clip(item.title, 170)}.`,
    });
  }

  for (const item of briefing.commitments) {
    const deadlineBand = item.overdue ? 4 : dayBand(item.dueDate);
    entries.push({
      key: `commitment:${item.id}`,
      category: 'commitment',
      signature: stable([item.title, item.status, item.dueDate, item.overdue, item.priority]),
      urgency: (item.overdue ? 400 : item.status === 'blocked' ? 330 : item.priority === 'high' ? 250 : 180) + deadlineBand * 20,
      deadlineBand,
      label: clip(item.title, 140),
      speech: `Commitment update: ${clip(item.title, 170)}${item.overdue ? ' is overdue.' : item.status === 'blocked' ? ' is blocked.' : item.dueDate ? ` is due ${item.dueDate}.` : '.'}`,
    });
  }

  for (const item of briefing.appointments) {
    const identity = item.reference || item.callId;
    entries.push({
      key: `appointment:${identity}`,
      category: 'appointment',
      signature: stable([item.with, item.datetime, item.locationOrMethod, item.reference]),
      urgency: 160,
      deadlineBand: 0,
      label: clip([item.with, item.datetime].filter(Boolean).join(' ') || 'Confirmed appointment', 140),
      speech: `Appointment update: ${clip([item.with ? `with ${item.with}` : 'confirmed', item.datetime ? `on ${item.datetime}` : '', item.locationOrMethod ? `via ${item.locationOrMethod}` : ''].filter(Boolean).join(' '), 200)}.`,
    });
  }

  for (const item of briefing.decisions) {
    const deadlineBand = dayBand(item.dueAt);
    const priorityScore = item.priority === 'critical' ? 400 : item.priority === 'high' ? 300 : item.priority === 'normal' ? 200 : 120;
    entries.push({
      key: `decision:${item.id}`,
      category: 'decision',
      signature: stable([item.title, item.priority, item.status, item.dueAt]),
      urgency: priorityScore + deadlineBand * 20,
      deadlineBand,
      label: clip(item.title, 140),
      speech: `Decision update: ${clip(item.title, 180)}.`,
    });
  }

  return entries.sort((a, b) => b.urgency - a.urgency || a.key.localeCompare(b.key)).slice(0, MAX_MEMORY_ENTRIES);
}

function parseSnapshot(value: unknown): BriefingMemorySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<BriefingMemorySnapshot>;
  if (record.version !== 1 || typeof record.profileId !== 'string' || typeof record.principalId !== 'string' || typeof record.generatedAt !== 'string' || !Array.isArray(record.entries)) return null;
  return record as BriefingMemorySnapshot;
}

async function loadLastAcknowledged(context: ZeroTrustAuthorityContext) {
  const handles = await memorySession(context.profileId);
  if (!handles) return null;
  const page = await handles.session.messages({ size: 80, reverse: true });
  for (const message of page.items) {
    if (message.metadata?.elpVoiceActivationMemory !== true) continue;
    if (message.metadata?.principalId !== context.principal.id) continue;
    if (typeof message.metadata?.snapshotJson !== 'string') continue;
    try {
      const parsed = parseSnapshot(JSON.parse(message.metadata.snapshotJson));
      if (parsed && parsed.profileId === context.profileId && parsed.principalId === context.principal.id) return parsed;
    } catch {}
  }
  return null;
}

async function persistAcknowledged(context: ZeroTrustAuthorityContext, snapshot: BriefingMemorySnapshot) {
  const handles = await memorySession(context.profileId);
  if (!handles) return false;
  await handles.session.addMessages([{
    peerId: handles.elp.id,
    content: `[VOICE_ACTIVATION_BRIEF_ACK] ${snapshot.generatedAt}`,
    metadata: {
      elpVoiceActivationMemory: true,
      recordVersion: 1,
      principalId: context.principal.id,
      generatedAt: snapshot.generatedAt,
      status: snapshot.status,
      snapshotJson: JSON.stringify(snapshot),
    },
  }]);
  return true;
}

function buildSnapshot(context: ZeroTrustAuthorityContext, briefing: VoiceActivationBriefing): BriefingMemorySnapshot {
  return {
    version: 1,
    profileId: context.profileId,
    principalId: context.principal.id,
    generatedAt: briefing.generatedAt,
    status: briefing.status,
    entries: entriesFromBriefing(briefing),
  };
}

function changeSummary(previous: BriefingMemorySnapshot | null, current: BriefingMemorySnapshot) {
  const counts: Record<ChangeKind, number> = { new: 0, deadline: 0, escalated: 0, changed: 0, resolved: 0 };
  if (!previous) return { counts, changedEntries: current.entries, resolvedEntries: [] as BriefingMemoryEntry[] };

  const oldByKey = new Map(previous.entries.map((entry) => [entry.key, entry]));
  const currentByKey = new Map(current.entries.map((entry) => [entry.key, entry]));
  const changedEntries: BriefingMemoryEntry[] = [];

  for (const item of current.entries) {
    const old = oldByKey.get(item.key);
    if (!old) {
      counts.new += 1;
      changedEntries.push(item);
      continue;
    }
    if (item.deadlineBand > old.deadlineBand) {
      counts.deadline += 1;
      changedEntries.push(item);
      continue;
    }
    if (item.urgency > old.urgency) {
      counts.escalated += 1;
      changedEntries.push(item);
      continue;
    }
    if (item.signature !== old.signature) {
      counts.changed += 1;
      changedEntries.push(item);
    }
  }

  const resolvedEntries = previous.entries.filter((item) => !currentByKey.has(item.key));
  counts.resolved = resolvedEntries.length;
  return { counts, changedEntries, resolvedEntries };
}

function deltaSpeech(
  briefing: VoiceActivationBriefing,
  previous: BriefingMemorySnapshot | null,
  current: BriefingMemorySnapshot,
  changedEntries: BriefingMemoryEntry[],
  resolvedEntries: BriefingMemoryEntry[],
) {
  if (!previous) return briefing.speech;
  const parts: string[] = [];
  const topChanges = changedEntries.sort((a, b) => b.urgency - a.urgency).slice(0, 4);
  if (topChanges.length) {
    parts.push('Priority update.');
    parts.push(...topChanges.map((item) => item.speech));
  }
  if (resolvedEntries.length) {
    const topResolved = resolvedEntries.slice(0, 2).map((item) => item.label).filter(Boolean);
    parts.push(`${resolvedEntries.length} previous priority item${resolvedEntries.length === 1 ? ' is' : 's are'} no longer active${topResolved.length ? `: ${topResolved.join('; ')}` : ''}.`);
  }
  if (!current.entries.length && previous.entries.length) parts.push('No current priority items need your attention.');
  if (parts.length) parts.push('I can open any changed item or act where your authority permits.');
  return clip(parts.join(' '), MAX_DELTA_SPEECH);
}

export async function prepareAdaptiveVoiceActivationBriefing(
  context: ZeroTrustAuthorityContext,
  briefing: VoiceActivationBriefing,
): Promise<AdaptiveVoiceActivationBriefing> {
  const current = buildSnapshot(context, briefing);
  const previous = await loadLastAcknowledged(context).catch(() => null);
  const { counts, changedEntries, resolvedEntries } = changeSummary(previous, current);
  const changeCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const shouldSpeak = !previous || changeCount > 0;
  const speech = shouldSpeak ? deltaSpeech(briefing, previous, current, changedEntries, resolvedEntries) : '';
  const acknowledgement = shouldSpeak
    ? sealServerEnvelope<BriefingAcknowledgement>({
        version: 1,
        profileId: context.profileId,
        principalId: context.principal.id,
        issuedAt: new Date().toISOString(),
        snapshot: current,
      }, ACK_PURPOSE)
    : undefined;

  return {
    ...briefing,
    speech,
    shouldSpeak,
    changeState: !previous ? 'initial' : shouldSpeak ? 'changed' : 'unchanged',
    changes: counts,
    ...(acknowledgement ? { acknowledgement } : {}),
    ...(previous?.generatedAt ? { previousGeneratedAt: previous.generatedAt } : {}),
  };
}

export async function acknowledgeAdaptiveVoiceActivationBriefing(
  context: ZeroTrustAuthorityContext,
  sealed: string,
) {
  const acknowledgement = unsealServerEnvelope<BriefingAcknowledgement>(sealed, ACK_PURPOSE);
  if (!acknowledgement || acknowledgement.version !== 1) return false;
  if (acknowledgement.profileId !== context.profileId || acknowledgement.principalId !== context.principal.id) return false;
  const issued = Date.parse(acknowledgement.issuedAt);
  if (!Number.isFinite(issued) || Date.now() - issued > ACK_TTL_MS || issued > Date.now() + 60_000) return false;
  const snapshot = parseSnapshot(acknowledgement.snapshot);
  if (!snapshot || snapshot.profileId !== context.profileId || snapshot.principalId !== context.principal.id) return false;
  return persistAcknowledged(context, snapshot);
}
