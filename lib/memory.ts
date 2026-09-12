import { Honcho } from '@honcho-ai/sdk';
import { captureExecutiveArtifacts } from '@/lib/executive-memory';

export type MemoryRole = 'user' | 'assistant';
export type MemorySnapshot = {
  configured: boolean;
  available: boolean;
  facts: string[];
  representation: string;
  summary: string;
};

function empty(configured = false): MemorySnapshot {
  return { configured, available: false, facts: [], representation: '', summary: '' };
}

async function getHonchoSession(profileId: string, sessionId: string) {
  if (!process.env.HONCHO_API_KEY) return null;

  const honcho = new Honcho({
    apiKey: process.env.HONCHO_API_KEY,
    workspaceId: process.env.HONCHO_WORKSPACE_ID || 'elp-gpt-luke',
    environment: 'production',
  });

  const user = await honcho.peer(`user-${profileId}`);
  const luke = await honcho.peer('luke');
  const session = await honcho.session(`session-${profileId}-${sessionId}`);
  await session.addPeers([user, luke]);

  return { user, luke, session };
}

export async function getMemorySnapshot(profileId: string, sessionId: string): Promise<MemorySnapshot> {
  if (!process.env.HONCHO_API_KEY) return empty(false);

  try {
    const handles = await getHonchoSession(profileId, sessionId);
    if (!handles) return empty(false);

    const context = await handles.session.context({
      summary: true,
      tokens: 2600,
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
    console.error('Honcho memory read failed', error);
    return empty(true);
  }
}

export function memoryToPrompt(snapshot: MemorySnapshot) {
  if (!snapshot.available) return '';
  return [
    snapshot.facts.length ? `Stable profile facts:\n- ${snapshot.facts.join('\n- ')}` : '',
    snapshot.representation ? `User representation:\n${snapshot.representation}` : '',
    snapshot.summary ? `Recent session summary:\n${snapshot.summary}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function persistTranscript(
  profileId: string,
  sessionId: string,
  role: MemoryRole,
  content: string,
) {
  if (!process.env.HONCHO_API_KEY) return false;

  try {
    const handles = await getHonchoSession(profileId, sessionId);
    if (!handles) return false;
    const peer = role === 'user' ? handles.user : handles.luke;
    await handles.session.addMessages([peer.message(content)]);

    if (role === 'user') {
      await captureExecutiveArtifacts(profileId, content);
    }

    return true;
  } catch (error) {
    console.error('Honcho transcript persistence failed', error);
    return false;
  }
}
