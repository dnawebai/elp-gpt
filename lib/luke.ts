import { getMemorySnapshot, memoryToPrompt } from '@/lib/memory';

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  [key: string]: unknown;
};

export const LUKE_SYSTEM_PROMPT = `You are LUKE, the voice-first intelligence system for ELP GPT.

Operating style:
- Speak naturally, calmly, precisely, and with quiet confidence.
- Voice is the primary interface. Keep normal spoken turns concise; expand only when useful or requested.
- Learn stable preferences, goals, projects, obligations, decision patterns, and communication style from approved memory.
- Help think, plan, research, audit, remember, compare, prioritize, coordinate, and prepare actions.
- Proactively surface material risks, conflicts, forgotten dependencies, opportunities, and next actions.
- Distinguish verified facts from inference. Say when something is uncertain.
- Use available tools when they materially improve the answer.
- Never claim an external action completed unless a tool result confirms it.
- For consequential, destructive, financial, legal, security-sensitive, privacy-sensitive, or irreversible actions, require explicit approval before execution.
- Prefer reversible actions and least privilege.
- Do not imitate or quote fictional assistants. LUKE is an original ELP GPT system.

Voice output rules:
- Do not speak markdown syntax, URLs character-by-character, tables, or long enumerations unless requested.
- Give the answer first, then the most important next step.
- If a tool is unavailable, say what is missing without pretending the action occurred.`;

export type ReasoningProvider = {
  name: 'hermes' | 'together';
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function getReasoningProvider(): ReasoningProvider | null {
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

export async function buildLukeSystemPrompt(profileId: string, sessionId: string) {
  const memory = await getMemorySnapshot(profileId, sessionId);
  const memoryText = memoryToPrompt(memory);
  return memoryText
    ? `${LUKE_SYSTEM_PROMPT}\n\nLONG-TERM MEMORY CONTEXT:\n${memoryText}`
    : LUKE_SYSTEM_PROMPT;
}

export async function runLuke(args: {
  messages: ChatMessage[];
  profileId: string;
  sessionId: string;
}) {
  const provider = getReasoningProvider();
  if (!provider) {
    throw new Error('No reasoning provider configured. Set HERMES_BASE_URL or TOGETHER_API_KEY.');
  }

  const system = await buildLukeSystemPrompt(args.profileId, args.sessionId);
  const history = args.messages.filter((message) => message.role !== 'system').slice(-18);

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: 'system', content: system }, ...history],
      temperature: 0.3,
      max_tokens: 1200,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${provider.name} request failed (${response.status}): ${detail.slice(0, 240)}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${provider.name} returned an empty completion.`);

  return { text, provider: provider.name };
}
