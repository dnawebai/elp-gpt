import { Honcho } from '@honcho-ai/sdk';

export type ExecutiveArtifactKind = 'decision' | 'commitment' | 'assumption' | 'objective';
export type ExecutiveArtifactStatus = 'active' | 'completed' | 'blocked' | 'superseded' | 'dismissed';
export type ExecutivePriority = 'high' | 'medium' | 'normal';
export type ExecutiveGraphEdgeType = 'supports' | 'implements' | 'informs' | 'depends_on' | 'supersedes';

export type ExecutiveMemorySnapshot = {
  configured: boolean;
  available: boolean;
  facts: string[];
  representation: string;
  summary: string;
};

export type ExecutiveLedgerItem = {
  id: string;
  messageId: string;
  kinds: ExecutiveArtifactKind[];
  primaryKind: ExecutiveArtifactKind;
  title: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  status: ExecutiveArtifactStatus;
  owner?: string;
  dueDate?: string;
  dueLabel?: string;
  priority: ExecutivePriority;
  stale: boolean;
  overdue: boolean;
  ageDays: number;
  dependencyText?: string;
  note?: string;
};

export type ExecutiveLedgerEdge = {
  id: string;
  from: string;
  to: string;
  type: ExecutiveGraphEdgeType;
  score: number;
};

export type ExecutiveLedgerStats = {
  total: number;
  active: number;
  openCommitments: number;
  overdue: number;
  blocked: number;
  activeObjectives: number;
  staleAssumptions: number;
  recentDecisions: number;
};

export type ExecutiveLedger = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  items: ExecutiveLedgerItem[];
  edges: ExecutiveLedgerEdge[];
  stats: ExecutiveLedgerStats;
};

const DETECTORS: Array<{ kind: ExecutiveArtifactKind; patterns: RegExp[] }> = [
  {
    kind: 'decision',
    patterns: [
      /\b(i|we) (have )?decided\b/i,
      /\bdecision (is|was|will be)\b/i,
      /\b(i|we)(?:'re| are) going with\b/i,
      /\b(i|we) chose\b/i,
      /\b(i|we) choose\b/i,
    ],
  },
  {
    kind: 'commitment',
    patterns: [
      /\b(i|we) (have )?(promised|committed|agreed)\b/i,
      /\b(i|we) will\b/i,
      /\b(i|we) must\b/i,
      /\b(i|we) need to\b/i,
      /\bdeadline\b/i,
      /\bdue (by|on)\b/i,
    ],
  },
  {
    kind: 'assumption',
    patterns: [
      /\bassum(e|ing|ption)\b/i,
      /\b(i|we)(?:'re| are) assuming\b/i,
      /\bour assumption\b/i,
      /\bworking assumption\b/i,
    ],
  },
  {
    kind: 'objective',
    patterns: [
      /\b(goal|objective|target) is\b/i,
      /\b(i|we) want to achieve\b/i,
      /\b(i|we) need to reach\b/i,
      /\btarget of\b/i,
    ],
  },
];

const STATUS_VALUES = new Set<ExecutiveArtifactStatus>(['active', 'completed', 'blocked', 'superseded', 'dismissed']);
const PRIORITY_VALUES = new Set<ExecutivePriority>(['high', 'medium', 'normal']);
const KIND_VALUES = new Set<ExecutiveArtifactKind>(['decision', 'commitment', 'assumption', 'objective']);
const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'because', 'before', 'being', 'between', 'could', 'deadline',
  'from', 'have', 'into', 'need', 'our', 'should', 'that', 'their', 'them', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'under', 'very', 'want', 'will', 'with', 'would', 'your', 'going', 'must', 'today',
  'tomorrow', 'decision', 'objective', 'target', 'commitment', 'assumption', 'agreed', 'decided', 'owner', 'responsible',
]);

function empty(configured = false): ExecutiveMemorySnapshot {
  return { configured, available: false, facts: [], representation: '', summary: '' };
}

function emptyLedger(configured = false): ExecutiveLedger {
  return {
    configured,
    available: false,
    generatedAt: new Date().toISOString(),
    items: [],
    edges: [],
    stats: {
      total: 0,
      active: 0,
      openCommitments: 0,
      overdue: 0,
      blocked: 0,
      activeObjectives: 0,
      staleAssumptions: 0,
      recentDecisions: 0,
    },
  };
}

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt';
}

async function getExecutiveSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;

  const honcho = new Honcho({
    apiKey: process.env.HONCHO_API_KEY,
    workspaceId: workspaceId(),
    environment: 'production',
  });

  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`executive-${profileId}`);
  await session.addPeers([user, elp]);
  return { user, elp, session };
}

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadataKinds(metadata: Record<string, unknown>) {
  const value = metadata.artifactKinds;
  if (!Array.isArray(value)) return [] as ExecutiveArtifactKind[];
  return value.filter((item): item is ExecutiveArtifactKind => typeof item === 'string' && KIND_VALUES.has(item as ExecutiveArtifactKind));
}

function taggedKinds(content: string) {
  const header = content.split('\n', 1)[0] || '';
  const found = [...header.matchAll(/\[(DECISION|COMMITMENT|ASSUMPTION|OBJECTIVE)\]/g)].map(
    (match) => match[1].toLowerCase() as ExecutiveArtifactKind,
  );
  return [...new Set(found)];
}

function taggedTimestamp(content: string) {
  const header = content.split('\n', 1)[0] || '';
  const match = header.match(/(20\d{2}-\d{2}-\d{2}T[^\s]+Z)/);
  return match?.[1];
}

function artifactBody(content: string) {
  const lines = content.split('\n');
  return lines.length > 1 ? lines.slice(1).join('\n').trim() : content.trim();
}

function primaryKind(kinds: ExecutiveArtifactKind[]): ExecutiveArtifactKind {
  if (kinds.includes('commitment')) return 'commitment';
  if (kinds.includes('decision')) return 'decision';
  if (kinds.includes('objective')) return 'objective';
  return 'assumption';
}

function parseOwner(content: string, metadata: Record<string, unknown>) {
  const override = metadataString(metadata, 'owner');
  if (override) return clip(override, 80);
  const match = content.match(/\b(?:owner|assigned to|owned by|responsible(?: person)?(?: is)?)\s*[:=-]?\s*([^,;\n]{2,70}?)(?=\s+(?:due|deadline|by)\b|[,;\n]|$)/i);
  if (match?.[1]) return clip(match[1], 80);
  if (/\bi will\b/i.test(content)) return 'Principal';
  if (/\bwe will\b/i.test(content)) return 'Team';
  return undefined;
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDueDate(content: string, createdAt: string, metadata: Record<string, unknown>) {
  const override = metadataString(metadata, 'dueDate');
  if (override && /^20\d{2}-\d{2}-\d{2}$/.test(override)) return { dueDate: override, dueLabel: override };

  const iso = content.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso?.[1]) return { dueDate: iso[1], dueLabel: iso[1] };

  const month = content.match(/\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+20\d{2})\b/i);
  if (month?.[1]) {
    const cleaned = month[1].replace(/(\d)(st|nd|rd|th)/i, '$1');
    const parsed = new Date(cleaned);
    if (!Number.isNaN(parsed.valueOf())) return { dueDate: formatDateOnly(parsed), dueLabel: month[1] };
  }

  const base = new Date(createdAt);
  if (!Number.isNaN(base.valueOf()) && /\b(?:due|deadline|by)\b[^.\n]{0,25}\btomorrow\b/i.test(content)) {
    base.setUTCDate(base.getUTCDate() + 1);
    return { dueDate: formatDateOnly(base), dueLabel: 'tomorrow' };
  }
  if (!Number.isNaN(base.valueOf()) && /\b(?:due|deadline|by)\b[^.\n]{0,25}\btoday\b/i.test(content)) {
    return { dueDate: formatDateOnly(base), dueLabel: 'today' };
  }
  return {} as { dueDate?: string; dueLabel?: string };
}

function parseDependencyText(content: string) {
  const match = content.match(/\b(?:depends on|dependent on|blocked by|waiting on)\s+([^.;\n]{2,140})/i);
  return match?.[1] ? clip(match[1], 140) : undefined;
}

function daysBetween(earlier: string, later = new Date()) {
  const date = new Date(earlier);
  if (Number.isNaN(date.valueOf())) return 0;
  return Math.max(0, Math.floor((later.valueOf() - date.valueOf()) / 86_400_000));
}

function dueDeltaDays(dueDate?: string) {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T23:59:59.999Z`);
  if (Number.isNaN(due.valueOf())) return null;
  return Math.ceil((due.valueOf() - Date.now()) / 86_400_000);
}

function inferPriority(content: string, dueDate: string | undefined, metadata: Record<string, unknown>): ExecutivePriority {
  const stored = metadataString(metadata, 'priority');
  if (stored && PRIORITY_VALUES.has(stored as ExecutivePriority)) return stored as ExecutivePriority;
  const delta = dueDeltaDays(dueDate);
  if (delta !== null && delta < 0) return 'high';
  if (/\b(urgent|critical|asap|immediately|must today|priority)\b/i.test(content)) return 'high';
  if (delta !== null && delta <= 2) return 'high';
  if (delta !== null && delta <= 7) return 'medium';
  return 'normal';
}

function isStale(kind: ExecutiveArtifactKind, status: ExecutiveArtifactStatus, ageDays: number, dueDate?: string) {
  if (status !== 'active') return false;
  if (kind === 'assumption') return ageDays >= 30;
  if (kind === 'commitment') return !dueDate && ageDays >= 14;
  if (kind === 'objective') return ageDays >= 30;
  return false;
}

function titleFrom(content: string, metadata: Record<string, unknown>) {
  const stored = metadataString(metadata, 'title');
  if (stored) return clip(stored, 150);
  const first = content.split(/\n|(?<=[.!?])\s+/)[0] || content;
  return clip(first.replace(/^[-*\s]+/, ''), 150);
}

function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map((token) => token.replace(/^-|-$/g, ''))
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function relationScore(a: ExecutiveLedgerItem, b: ExecutiveLedgerItem) {
  const left = tokens(`${a.title} ${a.content}`);
  const right = tokens(`${b.title} ${b.content}`);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  if (shared < 2) return 0;
  return shared / Math.max(3, Math.min(left.size, right.size));
}

function buildEdges(items: ExecutiveLedgerItem[]) {
  const active = items.filter((item) => item.status === 'active' || item.status === 'blocked');
  const edges: ExecutiveLedgerEdge[] = [];
  const add = (from: ExecutiveLedgerItem, to: ExecutiveLedgerItem, type: ExecutiveGraphEdgeType, score: number) => {
    if (from.id === to.id) return;
    const id = `${from.id}:${to.id}:${type}`;
    if (!edges.some((edge) => edge.id === id)) edges.push({ id, from: from.id, to: to.id, type, score: Math.round(score * 100) / 100 });
  };

  for (const item of active) {
    const ranked = active
      .filter((candidate) => candidate.id !== item.id)
      .map((candidate) => ({ candidate, score: relationScore(item, candidate) }))
      .filter((entry) => entry.score >= 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    for (const { candidate, score } of ranked) {
      if (item.primaryKind === 'commitment' && candidate.primaryKind === 'objective') add(item, candidate, 'supports', score);
      else if (item.primaryKind === 'commitment' && candidate.primaryKind === 'decision') add(item, candidate, 'implements', score);
      else if (item.primaryKind === 'decision' && candidate.primaryKind === 'objective') add(item, candidate, 'supports', score);
      else if (item.primaryKind === 'assumption' && (candidate.primaryKind === 'decision' || candidate.primaryKind === 'objective')) add(item, candidate, 'informs', score);
    }

    if (item.dependencyText) {
      const dependency = ranked[0];
      if (dependency) add(item, dependency.candidate, 'depends_on', Math.max(0.5, dependency.score));
    }

    if (/\b(no longer|instead|replace(?:d|s)?|supersed(?:e|ed|es))\b/i.test(item.content)) {
      const prior = ranked.find((entry) => entry.candidate.primaryKind === item.primaryKind && entry.candidate.createdAt < item.createdAt);
      if (prior) add(item, prior.candidate, 'supersedes', prior.score);
    }
  }

  return edges.slice(0, 60);
}

function ledgerStats(items: ExecutiveLedgerItem[]): ExecutiveLedgerStats {
  const active = items.filter((item) => item.status === 'active' || item.status === 'blocked');
  return {
    total: items.length,
    active: active.length,
    openCommitments: active.filter((item) => item.primaryKind === 'commitment').length,
    overdue: active.filter((item) => item.overdue).length,
    blocked: items.filter((item) => item.status === 'blocked').length,
    activeObjectives: active.filter((item) => item.primaryKind === 'objective').length,
    staleAssumptions: active.filter((item) => item.primaryKind === 'assumption' && item.stale).length,
    recentDecisions: items.filter((item) => item.primaryKind === 'decision' && item.ageDays <= 30 && item.status !== 'dismissed').length,
  };
}

function parseLedgerItem(message: { id: string; content: string; createdAt: string; metadata: Record<string, unknown> }): ExecutiveLedgerItem | null {
  const metadata = message.metadata || {};
  const kinds = metadataKinds(metadata).length ? metadataKinds(metadata) : taggedKinds(message.content);
  if (!kinds.length) return null;
  if (metadata.jarbisLedgerEvent === true) return null;

  const content = artifactBody(message.content);
  if (!content) return null;
  const createdAt = taggedTimestamp(message.content) || message.createdAt;
  const storedStatus = metadataString(metadata, 'status');
  const status = storedStatus && STATUS_VALUES.has(storedStatus as ExecutiveArtifactStatus)
    ? storedStatus as ExecutiveArtifactStatus
    : 'active';
  const kind = primaryKind(kinds);
  const due = parseDueDate(content, createdAt, metadata);
  const ageDays = daysBetween(createdAt);
  const delta = dueDeltaDays(due.dueDate);
  const overdue = status === 'active' && delta !== null && delta < 0;
  const owner = parseOwner(content, metadata);
  const dependencyText = parseDependencyText(content);
  const updatedAt = metadataString(metadata, 'updatedAt');
  const note = metadataString(metadata, 'statusNote');

  return {
    id: message.id,
    messageId: message.id,
    kinds,
    primaryKind: kind,
    title: titleFrom(content, metadata),
    content: clip(content, 12_000),
    createdAt,
    ...(updatedAt ? { updatedAt } : {}),
    status,
    ...(owner ? { owner } : {}),
    ...(due.dueDate ? { dueDate: due.dueDate } : {}),
    ...(due.dueLabel ? { dueLabel: due.dueLabel } : {}),
    priority: inferPriority(content, due.dueDate, metadata),
    stale: isStale(kind, status, ageDays, due.dueDate),
    overdue,
    ageDays,
    ...(dependencyText ? { dependencyText } : {}),
    ...(note ? { note } : {}),
  };
}

function validateDateOnly(value: string | null | undefined) {
  if (value == null || value === '') return undefined;
  const clean = value.trim();
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(clean)) throw new Error('Due date must use YYYY-MM-DD.');
  const parsed = new Date(`${clean}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || formatDateOnly(parsed) !== clean) throw new Error('Invalid due date.');
  return clean;
}

export function detectExecutiveArtifacts(content: string): ExecutiveArtifactKind[] {
  const text = content.trim();
  if (!text) return [];
  return DETECTORS
    .filter((detector) => detector.patterns.some((pattern) => pattern.test(text)))
    .map((detector) => detector.kind);
}

export async function captureExecutiveArtifacts(profileId: string, content: string) {
  const kinds = detectExecutiveArtifacts(content);
  if (!kinds.length || !process.env.HONCHO_API_KEY) return { saved: false, kinds };

  try {
    const handles = await getExecutiveSession(profileId);
    if (!handles) return { saved: false, kinds };

    const timestamp = new Date().toISOString();
    const labels = kinds.map((kind) => kind.toUpperCase()).join('][');
    const message = `[${labels}] ${timestamp}\n${content.trim().slice(0, 12_000)}`;
    await handles.session.addMessages([{
      peerId: handles.user.id,
      content: message,
      metadata: {
        jarbisExecutive: true,
        recordVersion: 2,
        artifactKinds: kinds,
        status: 'active',
        capturedAt: timestamp,
      },
    }]);
    return { saved: true, kinds };
  } catch (error) {
    console.error('ELP executive memory capture failed', error);
    return { saved: false, kinds };
  }
}

export async function createExecutiveLedgerItem(profileId: string, input: {
  kind: ExecutiveArtifactKind;
  content: string;
  owner?: string;
  dueDate?: string;
  priority?: ExecutivePriority;
}) {
  if (!process.env.HONCHO_API_KEY) throw new Error('Honcho is not configured.');
  if (!KIND_VALUES.has(input.kind)) throw new Error('Invalid executive artifact kind.');
  const content = clip(input.content, 12_000);
  if (!content) throw new Error('Content is required.');
  const owner = input.owner?.trim() ? clip(input.owner, 80) : undefined;
  const dueDate = validateDateOnly(input.dueDate);
  const priority = input.priority && PRIORITY_VALUES.has(input.priority) ? input.priority : 'normal';
  const handles = await getExecutiveSession(profileId);
  if (!handles) throw new Error('Executive memory is unavailable.');

  const timestamp = new Date().toISOString();
  const created = await handles.session.addMessages([{
    peerId: handles.user.id,
    content: `[${input.kind.toUpperCase()}] ${timestamp}\n${content}`,
    metadata: {
      jarbisExecutive: true,
      recordVersion: 2,
      artifactKinds: [input.kind],
      status: 'active',
      priority,
      capturedAt: timestamp,
      ...(owner ? { owner } : {}),
      ...(dueDate ? { dueDate } : {}),
    },
  }]);
  return created[0]?.id || null;
}

export async function updateExecutiveLedgerItem(profileId: string, messageId: string, patch: {
  status?: ExecutiveArtifactStatus;
  owner?: string | null;
  dueDate?: string | null;
  priority?: ExecutivePriority;
  note?: string | null;
}) {
  if (!process.env.HONCHO_API_KEY) throw new Error('Honcho is not configured.');
  const handles = await getExecutiveSession(profileId);
  if (!handles) throw new Error('Executive memory is unavailable.');
  const message = await handles.session.getMessage(messageId);
  const kinds = metadataKinds(message.metadata).length ? metadataKinds(message.metadata) : taggedKinds(message.content);
  if (!kinds.length) throw new Error('The target message is not an executive ledger item.');

  const metadata: Record<string, unknown> = {
    ...message.metadata,
    jarbisExecutive: true,
    recordVersion: 2,
    artifactKinds: kinds,
    updatedAt: new Date().toISOString(),
  };

  if (patch.status !== undefined) {
    if (!STATUS_VALUES.has(patch.status)) throw new Error('Invalid status.');
    metadata.status = patch.status;
  }
  if (patch.priority !== undefined) {
    if (!PRIORITY_VALUES.has(patch.priority)) throw new Error('Invalid priority.');
    metadata.priority = patch.priority;
  }
  if (patch.owner !== undefined) {
    if (patch.owner === null || !patch.owner.trim()) delete metadata.owner;
    else metadata.owner = clip(patch.owner, 80);
  }
  if (patch.dueDate !== undefined) {
    const dueDate = validateDateOnly(patch.dueDate);
    if (dueDate) metadata.dueDate = dueDate;
    else delete metadata.dueDate;
  }
  if (patch.note !== undefined) {
    if (patch.note === null || !patch.note.trim()) delete metadata.statusNote;
    else metadata.statusNote = clip(patch.note, 500);
  }

  const updated = await handles.session.updateMessage(messageId, metadata);
  const eventParts = [
    patch.status ? `status=${patch.status}` : '',
    patch.owner !== undefined ? `owner=${patch.owner || 'cleared'}` : '',
    patch.dueDate !== undefined ? `due=${patch.dueDate || 'cleared'}` : '',
    patch.priority ? `priority=${patch.priority}` : '',
    patch.note?.trim() ? `note=${clip(patch.note, 180)}` : '',
  ].filter(Boolean);
  if (eventParts.length) {
    const timestamp = new Date().toISOString();
    await handles.session.addMessages([{
      peerId: handles.elp.id,
      content: `[LEDGER_UPDATE] ${timestamp}\n${messageId}: ${eventParts.join('; ')}`,
      metadata: { jarbisLedgerEvent: true, targetMessageId: messageId, updatedAt: timestamp },
    }]);
  }
  return updated.id;
}

export async function getExecutiveLedger(profileId: string): Promise<ExecutiveLedger> {
  if (!process.env.HONCHO_API_KEY) return emptyLedger(false);
  try {
    const handles = await getExecutiveSession(profileId);
    if (!handles) return emptyLedger(false);
    const page = await handles.session.messages({ size: 100, reverse: true });
    const items = page.items
      .map((message) => parseLedgerItem(message))
      .filter((item): item is ExecutiveLedgerItem => Boolean(item))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      configured: true,
      available: items.length > 0,
      generatedAt: new Date().toISOString(),
      items,
      edges: buildEdges(items),
      stats: ledgerStats(items),
    };
  } catch (error) {
    console.error('ELP executive ledger read failed', error);
    return emptyLedger(true);
  }
}

export function executiveLedgerToPrompt(ledger: ExecutiveLedger) {
  if (!ledger.available) return '';
  const live = ledger.items
    .filter((item) => item.status === 'active' || item.status === 'blocked')
    .slice(0, 24)
    .map((item) => {
      const flags = [
        item.overdue ? 'OVERDUE' : '',
        item.stale ? 'STALE' : '',
        item.status === 'blocked' ? 'BLOCKED' : '',
        item.priority === 'high' ? 'HIGH PRIORITY' : '',
      ].filter(Boolean);
      return `- [${item.primaryKind.toUpperCase()}] ${item.title}${item.owner ? ` | owner: ${item.owner}` : ''}${item.dueDate ? ` | due: ${item.dueDate}` : ''}${flags.length ? ` | ${flags.join(', ')}` : ''}`;
    });
  return [
    `Executive control totals: ${ledger.stats.openCommitments} open commitments; ${ledger.stats.overdue} overdue; ${ledger.stats.blocked} blocked; ${ledger.stats.activeObjectives} active objectives; ${ledger.stats.staleAssumptions} stale assumptions.`,
    live.length ? `Live executive ledger:\n${live.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export async function getExecutiveMemorySnapshot(profileId: string): Promise<ExecutiveMemorySnapshot> {
  if (!process.env.HONCHO_API_KEY) return empty(false);

  try {
    const handles = await getExecutiveSession(profileId);
    if (!handles) return empty(false);

    const context = await handles.session.context({
      summary: true,
      tokens: 2200,
      peerTarget: handles.user.id,
    });

    const facts = Array.isArray(context.peerCard) ? context.peerCard.filter(Boolean).slice(0, 24) : [];
    const representation = context.peerRepresentation || '';
    const summary = context.summary?.content || '';

    return {
      configured: true,
      available: Boolean(facts.length || representation || summary),
      facts,
      representation,
      summary,
    };
  } catch (error) {
    console.error('ELP executive memory read failed', error);
    return empty(true);
  }
}

export function executiveMemoryToPrompt(snapshot: ExecutiveMemorySnapshot) {
  if (!snapshot.available) return '';
  return [
    snapshot.facts.length ? `Executive facts and commitments:\n- ${snapshot.facts.join('\n- ')}` : '',
    snapshot.summary ? `Decision/commitment ledger summary:\n${snapshot.summary}` : '',
    snapshot.representation ? `Executive operating model:\n${snapshot.representation}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
