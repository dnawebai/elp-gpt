import { Honcho } from '@honcho-ai/sdk';
import type { InterruptDisposition } from '@/lib/interrupt-policy';

export type InterruptSource = 'notification' | 'priority';
export type InterruptCandidate = {
  id: string;
  source: InterruptSource;
  sourceId: string;
  title: string;
  summary: string;
  severity: 'critical' | 'high' | 'normal' | 'low';
  score: number;
  approvalRequired: boolean;
  updatedAt: string;
  recommendedAction?: string;
};
export type ResumeCheckpoint = {
  blockId: string;
  title: string;
  sourceId?: string;
  interruptedAt: string;
  scheduledEnd: string;
  remainingMinutes: number;
  reason: string;
};
export type InterruptDecision = {
  candidate: InterruptCandidate;
  disposition: InterruptDisposition;
  reason: string;
  margin: number;
  threshold: number;
};
export type InterruptSnapshot = {
  id: string;
  generatedAt: string;
  currentBlockId?: string;
  currentBlockTitle?: string;
  decisions: InterruptDecision[];
  checkpoint?: ResumeCheckpoint;
  replanned: boolean;
  newScheduleId?: string;
  stats: { candidates: number; interruptNow: number; queued: number; monitored: number };
};

function workspaceId() { return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt'; }
async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({ apiKey: process.env.HONCHO_API_KEY, workspaceId: workspaceId(), environment: 'production' });
  const user = await honcho.peer(`user-${profileId}`); const elp = await honcho.peer('elp');
  const session = await honcho.session(`interrupt-manager-${profileId}`); await session.addPeers([user, elp]); return { elp, session };
}
function parse(metadata: Record<string, unknown>): InterruptSnapshot | null {
  if (metadata.jarbisInterruptSnapshot !== true || typeof metadata.snapshotJson !== 'string') return null;
  try { const value = JSON.parse(metadata.snapshotJson) as InterruptSnapshot; return value && typeof value.id === 'string' && Array.isArray(value.decisions) ? value : null; } catch { return null; }
}
export async function persistInterruptSnapshot(profileId: string, snapshot: InterruptSnapshot) {
  const handles = await getSession(profileId); if (!handles) return snapshot;
  await handles.session.addMessages([{ peerId: handles.elp.id, content: `[INTERRUPT_MANAGER] ${snapshot.generatedAt}\n${snapshot.stats.interruptNow} immediate; ${snapshot.stats.queued} queued.`, metadata: { jarbisInterruptSnapshot: true, recordVersion: 1, generatedAt: snapshot.generatedAt, snapshotJson: JSON.stringify(snapshot) } }]);
  return snapshot;
}
export async function getLatestInterruptSnapshot(profileId: string) {
  const handles = await getSession(profileId); if (!handles) return null;
  try { const page = await handles.session.messages({ size: 40, reverse: true }); return page.items.map((item) => parse(item.metadata || {})).find((item): item is InterruptSnapshot => Boolean(item)) || null; } catch { return null; }
}
export function interruptSnapshotToPrompt(snapshot: InterruptSnapshot | null) {
  if (!snapshot) return '';
  const immediate = snapshot.decisions.filter((item) => item.disposition === 'interrupt_now').slice(0, 4);
  const queued = snapshot.decisions.filter((item) => item.disposition === 'queue_after_block').slice(0, 4);
  return [
    immediate.length ? `IMMEDIATE INTERRUPTS: ${immediate.map((item) => `${item.candidate.title} (${item.reason})`).join('; ')}` : '',
    queued.length ? `QUEUED AFTER CURRENT BLOCK: ${queued.map((item) => item.candidate.title).join('; ')}` : '',
    snapshot.checkpoint ? `RESUME CHECKPOINT: ${snapshot.checkpoint.title}, about ${snapshot.checkpoint.remainingMinutes} minutes remaining.` : '',
  ].filter(Boolean).join('\n');
}
