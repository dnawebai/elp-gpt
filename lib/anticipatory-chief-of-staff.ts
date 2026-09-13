import { createHash } from 'node:crypto';
import { Honcho } from '@honcho-ai/sdk';
import { getExecutiveLedger } from '@/lib/executive-memory';
import { generateProactiveBriefing } from '@/lib/proactive';
import { getRadarSnapshot } from '@/lib/radar';
import { getRelationshipSnapshot } from '@/lib/relationship-memory';
import { createTask, getTaskBoard } from '@/lib/task-router';

export type AnticipatoryRiskType = 'deadline_failure' | 'decision_bottleneck' | 'dependency_block' | 'relationship_followup' | 'schedule_pressure' | 'execution_gap';
export type AnticipatorySeverity = 'critical' | 'high' | 'medium';

export type AnticipatoryRisk = {
  id: string;
  fingerprint: string;
  type: AnticipatoryRiskType;
  severity: AnticipatorySeverity;
  title: string;
  summary: string;
  evidence: string[];
  recommendedAction: string;
  horizonHours: number;
  confidence: number;
  relatedIds: string[];
};

export type AnticipatorySnapshot = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  timezone: string;
  risks: AnticipatoryRisk[];
  forwardScanSummary: string;
  stats: { total: number; critical: number; high: number; medium: number; deadlines: number; decisions: number; dependencies: number; relationships: number; schedule: number };
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
function clip(value: string, max: number) { const clean = value.trim(); return clean.length <= max ? clean : `${clean.slice(0, max)}…`; }
function hoursUntilDate(date?: string) {
  if (!date) return null;
  const time = Date.parse(`${date}T23:59:59.999Z`);
  if (!Number.isFinite(time)) return null;
  return Math.round((time - Date.now()) / 3_600_000);
}
function fingerprint(type: AnticipatoryRiskType, title: string, relatedIds: string[]) {
  return createHash('sha256').update(`${type}|${title.toLowerCase()}|${[...relatedIds].sort().join(',')}`).digest('hex').slice(0, 24);
}
function risk(input: Omit<AnticipatoryRisk, 'id' | 'fingerprint'>): AnticipatoryRisk {
  const fp = fingerprint(input.type, input.title, input.relatedIds);
  return { ...input, id: fp, fingerprint: fp };
}
function rank(value: AnticipatorySeverity) { return value === 'critical' ? 3 : value === 'high' ? 2 : 1; }
function dedupe(items: AnticipatoryRisk[]) {
  const map = new Map<string, AnticipatoryRisk>();
  for (const item of items) {
    const existing = map.get(item.fingerprint);
    if (!existing || rank(item.severity) > rank(existing.severity)) map.set(item.fingerprint, item);
  }
  return [...map.values()].sort((a, b) => rank(b.severity) - rank(a.severity) || a.horizonHours - b.horizonHours).slice(0, 24);
}
function stats(risks: AnticipatoryRisk[]) {
  return {
    total: risks.length,
    critical: risks.filter((item) => item.severity === 'critical').length,
    high: risks.filter((item) => item.severity === 'high').length,
    medium: risks.filter((item) => item.severity === 'medium').length,
    deadlines: risks.filter((item) => item.type === 'deadline_failure').length,
    decisions: risks.filter((item) => item.type === 'decision_bottleneck').length,
    dependencies: risks.filter((item) => item.type === 'dependency_block').length,
    relationships: risks.filter((item) => item.type === 'relationship_followup').length,
    schedule: risks.filter((item) => item.type === 'schedule_pressure').length,
  };
}

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`anticipatory-${profileId}`);
  await session.addPeers([user, elp]);
  return { elp, session };
}

function parseSnapshot(message: { createdAt: string; metadata: Record<string, unknown> }): AnticipatorySnapshot | null {
  const metadata = message.metadata || {};
  if (metadata.jarbisAnticipatoryScan !== true) return null;
  const generatedAt = typeof metadata.generatedAt === 'string' ? metadata.generatedAt : message.createdAt;
  const timezone = typeof metadata.timezone === 'string' ? metadata.timezone : 'America/Toronto';
  const forwardScanSummary = typeof metadata.forwardScanSummary === 'string' ? metadata.forwardScanSummary : '';
  const raw = typeof metadata.risksJson === 'string' ? metadata.risksJson : '[]';
  try {
    const parsed = JSON.parse(raw) as AnticipatoryRisk[];
    const risks = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.title === 'string' && typeof item.fingerprint === 'string').slice(0, 24) : [];
    return { configured: true, available: Boolean(risks.length || forwardScanSummary), generatedAt, timezone, risks, forwardScanSummary, stats: stats(risks) };
  } catch { return null; }
}

export async function getAnticipatorySnapshot(profileId: string): Promise<AnticipatorySnapshot> {
  const empty = (configured: boolean): AnticipatorySnapshot => ({ configured, available: false, generatedAt: new Date().toISOString(), timezone: process.env.ELP_BRIEFING_TIMEZONE || 'America/Toronto', risks: [], forwardScanSummary: '', stats: stats([]) });
  if (!process.env.HONCHO_API_KEY) return empty(false);
  try {
    const handles = await getSession(profileId);
    if (!handles) return empty(false);
    const page = await handles.session.messages({ size: 40, reverse: true });
    return page.items.map((message) => parseSnapshot(message)).find(Boolean) || empty(true);
  } catch (error) {
    console.error('ELP anticipatory snapshot read failed', error);
    return empty(true);
  }
}

function risksFromForwardScan(summary: string): AnticipatoryRisk[] {
  const text = summary.toLowerCase();
  const result: AnticipatoryRisk[] = [];
  if (/conflict|double[- ]book|overlap|overbook|back[- ]to[- ]back/.test(text)) {
    result.push(risk({ type: 'schedule_pressure', severity: /critical|cannot attend|double[- ]book/.test(text) ? 'high' : 'medium', title: 'Upcoming schedule pressure detected', summary: clip(summary, 1000), evidence: ['Read-only 7-day calendar/email forward scan flagged schedule pressure.'], recommendedAction: 'Review the conflicting commitments and protect preparation/travel time before the conflict becomes urgent.', horizonHours: 72, confidence: 0.72, relatedIds: [] }));
  }
  if (/missing prep|not prepared|preparation gap|needs preparation|no agenda|missing document/.test(text)) {
    result.push(risk({ type: 'execution_gap', severity: 'medium', title: 'Preparation gap in the next seven days', summary: clip(summary, 1000), evidence: ['Read-only 7-day forward scan identified a preparation gap.'], recommendedAction: 'Prepare the missing brief, document, agenda, or decision context before the affected event.', horizonHours: 120, confidence: 0.68, relatedIds: [] }));
  }
  if (/unanswered|waiting for reply|follow[- ]up|no response|going quiet/.test(text)) {
    result.push(risk({ type: 'relationship_followup', severity: 'medium', title: 'Potential unanswered follow-up in the near term', summary: clip(summary, 1000), evidence: ['Read-only email/calendar forward scan detected an unanswered or time-sensitive follow-up pattern.'], recommendedAction: 'Review the thread and prepare the smallest appropriate follow-up; sending remains approval-gated.', horizonHours: 96, confidence: 0.64, relatedIds: [] }));
  }
  return result;
}

async function prepareInternalTasks(profileId: string, risks: AnticipatoryRisk[]) {
  const board = await getTaskBoard(profileId);
  const open = [...board.queues.now, ...board.queues.decisions, ...board.queues.working, ...board.queues.delegated];
  let created = 0;
  for (const item of risks.filter((entry) => entry.severity === 'critical' || entry.severity === 'high').slice(0, 4)) {
    const sessionId = `anticipatory-${item.fingerprint}`;
    if (open.some((task) => task.sessionId === sessionId && task.status !== 'completed' && task.status !== 'cancelled')) continue;
    const needsPrincipal = item.type === 'decision_bottleneck';
    await createTask(profileId, {
      objective: `${item.recommendedAction}\nForecast: ${item.summary}`,
      queue: needsPrincipal ? 'decisions' : 'now',
      owner: needsPrincipal ? 'user' : 'ai',
      priority: item.severity === 'critical' ? 'critical' : 'high',
      approval: 'none',
      source: 'anticipatory-chief-of-staff',
      sessionId,
      summary: item.title,
    });
    created += 1;
  }
  return created;
}

export async function runAnticipatoryScan(args: { profileId: string; sessionId: string; timezone?: string; persist?: boolean }) {
  const timezone = args.timezone?.trim() || process.env.ELP_BRIEFING_TIMEZONE?.trim() || 'America/Toronto';
  const [ledger, board, relationships, radar, lookahead] = await Promise.all([
    getExecutiveLedger(args.profileId),
    getTaskBoard(args.profileId),
    getRelationshipSnapshot(args.profileId),
    getRadarSnapshot(args.profileId),
    generateProactiveBriefing({ kind: 'lookahead', profileId: args.profileId, sessionId: `${args.sessionId}-lookahead`, timezone, persist: true }),
  ]);
  const found: AnticipatoryRisk[] = [];

  for (const item of ledger.items.filter((entry) => entry.status === 'active' || entry.status === 'blocked')) {
    if (item.primaryKind === 'commitment') {
      const hours = hoursUntilDate(item.dueDate);
      if (hours !== null && hours <= 168) {
        const severity: AnticipatorySeverity = hours <= 24 || item.overdue ? 'critical' : hours <= 72 || item.priority === 'high' ? 'high' : 'medium';
        found.push(risk({ type: 'deadline_failure', severity, title: `Deadline exposure: ${item.title}`, summary: `${item.title}${item.dueDate ? ` is due ${item.dueDate}` : ''}${item.status === 'blocked' ? ' and is currently blocked' : ''}.`, evidence: [item.content, ...(item.note ? [item.note] : [])].slice(0, 3), recommendedAction: item.status === 'blocked' ? 'Remove the blocking dependency now or decide on a fallback path.' : 'Verify readiness, identify the remaining work, and advance the obligation before it becomes urgent.', horizonHours: Math.max(0, hours), confidence: 0.94, relatedIds: [item.id] }));
      }
      if (item.dependencyText || item.status === 'blocked') {
        found.push(risk({ type: 'dependency_block', severity: item.priority === 'high' || item.overdue ? 'high' : 'medium', title: `Dependency risk: ${item.title}`, summary: item.dependencyText ? `${item.title} depends on ${item.dependencyText}.` : `${item.title} is recorded as blocked.`, evidence: [item.content], recommendedAction: 'Identify the dependency owner, evidence, fallback and latest safe intervention point.', horizonHours: hours === null ? 168 : Math.max(0, hours), confidence: 0.9, relatedIds: [item.id] }));
      }
    }
  }

  for (const task of board.queues.decisions.filter((entry) => entry.status === 'active' || entry.status === 'blocked')) {
    found.push(risk({ type: 'decision_bottleneck', severity: task.priority === 'critical' ? 'critical' : task.priority === 'high' ? 'high' : 'medium', title: `Decision bottleneck: ${task.title}`, summary: task.summary || task.objective, evidence: [task.note || task.objective], recommendedAction: 'Make or delegate the blocking decision before dependent work loses time.', horizonHours: task.priority === 'critical' ? 12 : task.priority === 'high' ? 36 : 96, confidence: 0.96, relatedIds: [task.id] }));
  }

  for (const relation of relationships.relationships) {
    const material = relation.strategicValue === 'critical' || relation.strategicValue === 'high';
    const drift = relation.momentum === 'cooling' || relation.momentum === 'stalled';
    if (!material || (!drift && !relation.promisesByUs.length && !relation.openLoops.length)) continue;
    found.push(risk({ type: 'relationship_followup', severity: relation.strategicValue === 'critical' || relation.momentum === 'stalled' ? 'high' : 'medium', title: `Relationship risk: ${relation.name}`, summary: `${relation.name}${relation.organization ? ` — ${relation.organization}` : ''} is ${relation.momentum}; ${relation.openLoops[0] || relation.promisesByUs[0] || relation.nextBestAction || 'a material open loop remains'}.`, evidence: [...relation.openLoops.slice(0, 2), ...relation.promisesByUs.slice(0, 2)], recommendedAction: relation.nextBestAction || 'Review the open loop and prepare a timely follow-up.', horizonHours: 96, confidence: Math.max(0.55, relation.confidence), relatedIds: [relation.id] }));
  }

  for (const signal of radar.signals.filter((entry) => (entry.status === 'open' || entry.status === 'acknowledged') && (entry.severity === 'critical' || entry.severity === 'high'))) {
    const type: AnticipatoryRiskType = signal.type === 'deadline' ? 'deadline_failure' : signal.type === 'dependency' ? 'dependency_block' : signal.type === 'relationship' ? 'relationship_followup' : 'execution_gap';
    found.push(risk({ type, severity: signal.severity === 'critical' ? 'critical' : 'high', title: signal.title, summary: signal.summary, evidence: signal.evidence, recommendedAction: signal.recommendedAction, horizonHours: type === 'deadline_failure' ? 48 : 120, confidence: signal.confidence, relatedIds: [signal.id, ...signal.relatedLedgerIds] }));
  }

  found.push(...risksFromForwardScan(lookahead.summary));
  const risks = dedupe(found);
  const createdTasks = await prepareInternalTasks(args.profileId, risks);
  const generatedAt = new Date().toISOString();
  const snapshot: AnticipatorySnapshot = { configured: Boolean(process.env.HONCHO_API_KEY), available: Boolean(risks.length || lookahead.summary), generatedAt, timezone, risks, forwardScanSummary: lookahead.summary, stats: stats(risks) };

  if (args.persist !== false && process.env.HONCHO_API_KEY) {
    const handles = await getSession(args.profileId);
    if (handles) {
      await handles.session.addMessages([{ peerId: handles.elp.id, content: `[ANTICIPATORY_SCAN] ${generatedAt}\n${risks.length} forecast risks; ${createdTasks} internal tasks prepared.`, metadata: { jarbisAnticipatoryScan: true, recordVersion: 1, generatedAt, timezone, risksJson: JSON.stringify(risks), forwardScanSummary: clip(lookahead.summary, 6000), createdTasks } }]);
    }
  }
  return { ...snapshot, createdTasks };
}

export function anticipatorySnapshotToPrompt(snapshot: AnticipatorySnapshot) {
  if (!snapshot.available) return '';
  const top = snapshot.risks.slice(0, 10).map((item) => `- [${item.severity.toUpperCase()}][${item.type}] ${item.title}: ${item.summary} Next: ${item.recommendedAction}`);
  return [`Anticipatory forecast: ${snapshot.stats.critical} critical, ${snapshot.stats.high} high, ${snapshot.stats.medium} medium risks in the near-term horizon.`, ...top].join('\n');
}
