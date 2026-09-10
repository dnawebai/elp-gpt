import { Honcho } from '@honcho-ai/sdk';

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

const LUKE_SYSTEM_PROMPT = `You are LUKE, a highly capable voice-first intelligence system for ELP GPT.

Behavior:
- Be concise, anticipatory, practical, and precise.
- Learn the user's stable preferences, goals, projects, recurring obligations, decision patterns, and communication style from provided memory context.
- Distinguish facts from inference. Say when something is uncertain.
- Proactively surface useful risks, conflicts, forgotten dependencies, opportunities, and next actions when relevant.
- Never claim that an external action was completed unless a tool or service result confirms it.
- For consequential, destructive, financial, legal, security-sensitive, privacy-sensitive, or irreversible actions, propose the action and require explicit confirmation before execution.
- Prefer reversible actions and least privilege.
- Do not imitate fictional dialogue or quote copyrighted character dialogue. LUKE is an original ELP GPT intelligence system with a calm, technically sophisticated personality.

When memory context is supplied, use it naturally and only when relevant.`;

function sanitizeId(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const safe = value.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96);
  return safe || fallback;
}

function getProvider() {
  if (process.env.HERMES_BASE_URL) {
    return {
      name: 'hermes',
      baseUrl: process.env.HERMES_BASE_URL.replace(/\/$/, ''),
      apiKey: process.env.HERMES_API_KEY || '',
      model: process.env.HERMES_MODEL || 'hermes-3-llama-3.1-8b',
    };
  }

  if (process.env.TOGETHER_API_KEY) {
    return {
      name: 'together',
      baseUrl: 'https://api.together.xyz/v1',
      apiKey: process.env.TOGETHER_API_KEY,
      model: process.env.TOGETHER_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    };
  }

  return null;
}

async function buildHonchoContext(profileId: string, sessionId: string, messages: ChatMessage[]) {
  if (!process.env.HONCHO_API_KEY) return { memory: '', persist: async (_assistantText: string) => undefined };

  try {
    const honcho = new Honcho({
      apiKey: process.env.HONCHO_API_KEY,
      workspaceId: process.env.HONCHO_WORKSPACE_ID || 'elp-gpt-luke',
      environment: 'production',
    });

    const user = await honcho.peer(`user-${profileId}`);
    const assistant = await honcho.peer('luke');
    const session = await honcho.session(`session-${profileId}-${sessionId}`);
    await session.addPeers([user, assistant]);

    const latestUser = [...messages].reverse().find((message) => message.role === 'user');
    if (latestUser) await session.addMessages([user.message(latestUser.content)]);

    const context = await session.context({
      summary: true,
      tokens: 2200,
      peerTarget: user.id,
    });

    const memoryParts = [
      context.peerCard?.length ? `Stable profile facts:\n- ${context.peerCard.join('\n- ')}` : '',
      context.peerRepresentation ? `User representation:\n${context.peerRepresentation}` : '',
      context.summary?.content ? `Conversation summary:\n${context.summary.content}` : '',
    ].filter(Boolean);

    return {
      memory: memoryParts.join('\n\n'),
      persist: async (assistantText: string) => {
        try {
          await session.addMessages([assistant.message(assistantText)]);
        } catch {
          // Memory persistence must not make the response fail.
        }
      },
    };
  } catch {
    return { memory: '', persist: async (_assistantText: string) => undefined };
  }
}

export async function runLuke(args: {
  messages: ChatMessage[];
  profileId: unknown;
  sessionId: unknown;
}) {
  const profileId = sanitizeId(args.profileId, 'anonymous');
  const sessionId = sanitizeId(args.sessionId, 'web');
  const history = args.messages.slice(-18);
  const memory = await buildHonchoContext(profileId, sessionId, history);
  const provider = getProvider();

  if (!provider) {
    throw new Error('No reasoning provider configured. Set HERMES_BASE_URL or TOGETHER_API_KEY.');
  }

  const system = memory.memory
    ? `${LUKE_SYSTEM_PROMPT}\n\nLONG-TERM MEMORY CONTEXT:\n${memory.memory}`
    : LUKE_SYSTEM_PROMPT;

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: 'system', content: system }, ...history],
      temperature: 0.35,
      max_tokens: 1200,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${provider.name} request failed (${response.status}): ${detail.slice(0, 240)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${provider.name} returned an empty completion.`);

  await memory.persist(text);
  return { text, provider: provider.name };
}
