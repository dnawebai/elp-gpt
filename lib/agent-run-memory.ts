import { Honcho } from '@honcho-ai/sdk';

export type AgentRunMode = 'slashy' | 'vellum';

export type AgentRunRecord = {
  id: string;
  mode: AgentRunMode;
  objective: string;
  status: string;
  summary: string;
  trace?: unknown;
  metadata?: Record<string, unknown>;
  generatedAt: string;
};

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt';
}

function clip(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`;
}

async function getSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;
  const honcho = new Honcho({
    apiKey: process.env.HONCHO_API_KEY,
    workspaceId: workspaceId(),
    environment: 'production',
  });
  const user = await honcho.peer(`user-${profileId}`);
  const elp = await honcho.peer('elp');
  const session = await honcho.session(`agent-runs-${profileId}`);
  await session.addPeers([user, elp]);
  return { elp, session };
}

export async function persistAgentRun(profileId: string, record: AgentRunRecord) {
  const handles = await getSession(profileId);
  if (!handles) return false;
  try {
    const traceJson = record.trace === undefined ? '' : JSON.stringify(record.trace);
    const metadataJson = record.metadata === undefined ? '' : JSON.stringify(record.metadata);
    await handles.session.addMessages([{
      peerId: handles.elp.id,
      content: `[AGENT_RUN][${record.mode}] ${clip(record.objective, 240)}\n${clip(record.summary, 4000)}`,
      metadata: {
        elpAgentRun: true,
        recordVersion: 1,
        runId: clip(record.id, 160),
        mode: record.mode,
        objective: clip(record.objective, 1600),
        runStatus: clip(record.status, 80),
        summary: clip(record.summary, 4000),
        generatedAt: record.generatedAt,
        ...(traceJson ? { traceJson: clip(traceJson, 64_000) } : {}),
        ...(metadataJson ? { metadataJson: clip(metadataJson, 64_000) } : {}),
      },
    }]);
    return true;
  } catch (error) {
    console.error('ELP agent run persistence failed', error);
    return false;
  }
}
