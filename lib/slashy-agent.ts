import { getReasoningProviders } from '@/lib/elp';
import { getMemorySnapshot, memoryToPrompt } from '@/lib/memory';
import { getCommunicationsSyncSnapshot, runCommunicationsSync } from '@/lib/communications-sync';
import { getCommitmentFulfilmentSnapshot } from '@/lib/commitment-fulfilment';
import { getExecutiveLedger } from '@/lib/executive-memory';
import { getTaskBoard } from '@/lib/task-router';
import { isComposioConfigured, searchComposioTools } from '@/lib/composio';
import { classifyActionRisk } from '@/lib/actions';

export type SlashyMission = {
  objective: string;
  sessionId?: string;
  context?: string;
  refreshCommunications?: boolean;
};

export type SlashyToolCandidate = {
  slug: string;
  name: string;
  toolkit?: string;
  risk: 'read' | 'write' | 'high';
};

export type SlashyMissionResult = {
  mode: 'slashy-communications-operator';
  objective: string;
  synthesis: string;
  memoryAnchors: {
    always: string[];
    activity: string[];
    entity: string[];
    note: string;
  };
  droppedBallSignals: Array<{ source: string; title: string; status: string; detail?: string }>;
  communications: Awaited<ReturnType<typeof getCommunicationsSyncSnapshot>>;
  fulfilment: Awaited<ReturnType<typeof getCommitmentFulfilmentSnapshot>>;
  tools: SlashyToolCandidate[];
  proposedWriteTools: SlashyToolCandidate[];
  generatedAt: string;
};

const POLICY = `You are ELP's Slashy Communications Operator. Behave like an executive communications agent rather than a generic chatbot. Work across current inbox/calendar/research context, memory and commitments. Detect dropped balls, stale follow-ups and unanswered obligations. Apply memory only when relevant to the activity or entity. Safe reads may be recommended or performed through ELP connectors; sending, replying, creating calendar events, forwarding, deleting, publishing, purchasing, deploying or any other external mutation must remain behind ELP's action approval or standing-authority controls. Never claim a message was sent or an event changed unless verified tool output confirms it.`;

function clean(value: unknown, max = 1600) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function inferActivity(objective: string) {
  const q = objective.toLowerCase();
  if (/calendar|meeting|schedule|availability|book/.test(q)) return 'calendar';
  if (/follow.?up|dropped ball|overdue|commitment|forgot/.test(q)) return 'follow-up';
  return 'email';
}

function deriveMemoryAnchors(snapshot: Awaited<ReturnType<typeof getMemorySnapshot>>, objective: string) {
  const activity = inferActivity(objective);
  const all = snapshot.facts.slice(0, 24);
  const activityFacts = all.filter((fact) => {
    const lower = fact.toLowerCase();
    if (activity === 'calendar') return /calendar|schedule|meeting|zoom|time|availability/.test(lower);
    if (activity === 'follow-up') return /follow|commitment|deadline|todo|remind|reply/.test(lower);
    return /email|writing|reply|tone|sign.?off|message|draft/.test(lower);
  }).slice(0, 8);
  const entityTokens = objective.match(/\b[A-Z][A-Za-z0-9&.-]{2,}\b/g) || [];
  const entityFacts = all.filter((fact) => entityTokens.some((token) => fact.toLowerCase().includes(token.toLowerCase()))).slice(0, 8);
  const used = new Set([...activityFacts, ...entityFacts]);
  return {
    always: all.filter((fact) => !used.has(fact)).slice(0, 8),
    activity: activityFacts,
    entity: entityFacts,
    note: `Anchors are derived by ELP from the current objective (${activity}) and stored memory facts; they are routing labels, not native Honcho metadata.`,
  };
}

function droppedBallSignals(
  fulfilment: Awaited<ReturnType<typeof getCommitmentFulfilmentSnapshot>>,
  ledger: Awaited<ReturnType<typeof getExecutiveLedger>>,
  board: Awaited<ReturnType<typeof getTaskBoard>>,
) {
  const signals: Array<{ source: string; title: string; status: string; detail?: string }> = [];
  for (const record of fulfilment.records.slice(0, 20)) {
    if (!['approval_required', 'needs_input', 'blocked'].includes(record.status)) continue;
    signals.push({ source: 'fulfilment', title: record.title, status: record.status, detail: record.summary });
  }
  for (const item of ledger.items.slice(0, 30)) {
    if (!(item.overdue || item.stale || item.status === 'blocked')) continue;
    signals.push({ source: 'executive-ledger', title: item.title, status: item.overdue ? 'overdue' : item.status, detail: item.note || item.content });
  }
  for (const task of [...board.queues.decisions, ...board.queues.working, ...board.queues.delegated]) {
    if (task.status === 'completed' || task.status === 'cancelled') continue;
    if (!(task.status === 'blocked' || task.approval === 'required' || task.queue === 'decisions')) continue;
    signals.push({ source: 'command-center', title: task.title, status: task.approval === 'required' ? 'approval_required' : task.status, detail: task.summary || task.objective });
  }
  const seen = new Set<string>();
  return signals.filter((item) => {
    const key = `${item.source}:${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

async function discoverTools(objective: string): Promise<SlashyToolCandidate[]> {
  if (!isComposioConfigured()) return [];
  const searches = [
    `email read search draft reply ${clean(objective, 220)}`,
    `calendar availability events schedule ${clean(objective, 220)}`,
    `web research contact company ${clean(objective, 220)}`,
  ];
  const groups = await Promise.all(searches.map((query) => searchComposioTools(query).catch(() => [])));
  const unique = new Map<string, SlashyToolCandidate>();
  for (const tool of groups.flat()) {
    const risk = classifyActionRisk(tool.slug);
    if (!unique.has(tool.slug)) unique.set(tool.slug, { slug: tool.slug, name: tool.name, toolkit: tool.toolkit, risk });
  }
  return [...unique.values()].slice(0, 18);
}

async function callHermes(system: string, user: string) {
  const provider = getReasoningProviders().find((item) => item.name === 'hermes') || getReasoningProviders()[0];
  if (!provider) throw new Error('No reasoning provider configured for Slashy Agent.');
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) },
    body: JSON.stringify({ model: provider.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: 1700 }),
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) throw new Error(`Slashy reasoning failed (${response.status}).`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Slashy reasoning returned an empty response.');
  return text;
}

export async function runSlashyMission(profileId: string, mission: SlashyMission): Promise<SlashyMissionResult> {
  const objective = clean(mission.objective, 2200);
  if (!objective) throw new Error('Slashy objective is required.');
  const sessionId = clean(mission.sessionId, 120) || 'slashy';

  if (mission.refreshCommunications) {
    await runCommunicationsSync({ profileId, persist: true }).catch(() => undefined);
  }

  const [memory, communications, fulfilment, ledger, board, tools] = await Promise.all([
    getMemorySnapshot(profileId, sessionId),
    getCommunicationsSyncSnapshot(profileId),
    getCommitmentFulfilmentSnapshot(profileId),
    getExecutiveLedger(profileId),
    getTaskBoard(profileId),
    discoverTools(objective),
  ]);

  const anchors = deriveMemoryAnchors(memory, objective);
  const dropped = droppedBallSignals(fulfilment, ledger, board);
  const proposedWriteTools = tools.filter((tool) => tool.risk !== 'read');
  const prompt = [
    `Objective: ${objective}`,
    mission.context ? `Context: ${clean(mission.context, 1800)}` : '',
    memory.available ? `ELP MEMORY:\n${memoryToPrompt(memory)}` : 'ELP MEMORY: unavailable or empty.',
    `DERIVED MEMORY ANCHORS:\n${JSON.stringify(anchors)}`,
    `COMMUNICATION SYNC SNAPSHOT:\n${JSON.stringify(communications).slice(0, 12000)}`,
    `DROPPED-BALL SIGNALS:\n${JSON.stringify(dropped).slice(0, 10000)}`,
    `AVAILABLE TOOL CANDIDATES:\n${JSON.stringify(tools)}`,
  ].filter(Boolean).join('\n\n');

  const synthesis = await callHermes(
    POLICY,
    `${prompt}\n\nReturn these sections: 1) Attention Queue, 2) Dropped Balls, 3) Draft Responses or Scheduling Recommendations, 4) Memory Anchors Applied, 5) Safe Read Actions, 6) Proposed Write Actions requiring approval, 7) Next Review. Distinguish verified ELP records from inference. Do not fabricate inbox contents that are not present in the snapshot.`,
  );

  return {
    mode: 'slashy-communications-operator',
    objective,
    synthesis,
    memoryAnchors: anchors,
    droppedBallSignals: dropped,
    communications,
    fulfilment,
    tools,
    proposedWriteTools,
    generatedAt: new Date().toISOString(),
  };
}
