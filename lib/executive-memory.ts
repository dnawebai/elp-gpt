import { Honcho } from '@honcho-ai/sdk';

export type ExecutiveArtifactKind = 'decision' | 'commitment' | 'assumption' | 'objective';

export type ExecutiveMemorySnapshot = {
  configured: boolean;
  available: boolean;
  facts: string[];
  representation: string;
  summary: string;
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

function empty(configured = false): ExecutiveMemorySnapshot {
  return { configured, available: false, facts: [], representation: '', summary: '' };
}

function workspaceId() {
  return process.env.HONCHO_WORKSPACE_ID || 'elp-gpt-luke';
}

async function getExecutiveSession(profileId: string) {
  if (!process.env.HONCHO_API_KEY) return null;

  const honcho = new Honcho({
    apiKey: process.env.HONCHO_API_KEY,
    workspaceId: workspaceId(),
    environment: 'production',
  });

  const user = await honcho.peer(`user-${profileId}`);
  const luke = await honcho.peer('luke');
  const session = await honcho.session(`executive-${profileId}`);
  await session.addPeers([user, luke]);
  return { user, luke, session };
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
    await handles.session.addMessages([handles.user.message(message)]);
    return { saved: true, kinds };
  } catch (error) {
    console.error('LUKE executive memory capture failed', error);
    return { saved: false, kinds };
  }
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
    console.error('LUKE executive memory read failed', error);
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
