import { getMemorySnapshot, memoryToPrompt } from '@/lib/memory';
import { skillsToPrompt } from '@/lib/skills';

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
- Prefer a direct authenticated API/tool over browser automation. Use browser/computer control only as a fallback.
- For local requests, use authorized device coordinates when available instead of guessing the user's location.
- Never claim an external action completed unless a tool result confirms it.
- For consequential, destructive, financial, legal, security-sensitive, privacy-sensitive, or irreversible actions, require explicit approval before execution.
- Prefer reversible actions and least privilege.
- Do not imitate or quote fictional assistants. LUKE is an original ELP GPT system.

Action planning:
- Identify the smallest skill or combination of skills that can complete the request.
- For connected apps, discover the exact tool before planning execution; never invent tool slugs or argument names.
- For Google Calendar schedule reads and daily briefings, prefer GOOGLECALENDAR_EVENTS_LIST with calendarId=primary and explicit RFC3339 local-time bounds. Use GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS only as a fallback when the user explicitly needs multiple calendars.
- Read-only actions may run when directly requested and relevant.
- External writes, communications, bookings, purchases, cancellations, deployments, security changes, and other commitments require the configured approval policy.
- When an action fails, report the actual failure and the missing dependency rather than pretending it completed.

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

export function getReasoningProviders(): ReasoningProvider[] {
  const providers: ReasoningProvider[] = [];

  if (process.env.HERMES_BASE_URL) {
    providers.push({
      name: 'hermes',
      baseUrl: process.env.HERMES_BASE_URL.replace(/\/$/, ''),
      apiKey: process.env.HERMES_API_KEY || '',
      model: process.env.HERMES_MODEL || 'hermes-agent',
    });
  }

  if (process.env.TOGETHER_API_KEY) {
    providers.push({
      name: 'together',
      baseUrl: 'https://api.together.xyz/v1',
      apiKey: process.env.TOGETHER_API_KEY,
      model: process.env.TOGETHER_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    });
  }

  return providers;
}

export function getReasoningProvider(): ReasoningProvider | null {
  return getReasoningProviders()[0] || null;
}

export async function buildLukeSystemPrompt(profileId: string, sessionId: string) {
  const memory = await getMemorySnapshot(profileId, sessionId);
  const memoryText = memoryToPrompt(memory);
  const sections = [
    LUKE_SYSTEM_PROMPT,
    `AVAILABLE LUKE SKILLS:\n${skillsToPrompt()}`,
    memoryText ? `LONG-TERM MEMORY CONTEXT:\n${memoryText}` : '',
  ].filter(Boolean);
  return sections.join('\n\n');
}

export async function runLuke(args: {
  messages: ChatMessage[];
  profileId: string;
  sessionId: string;
}) {
  const providers = getReasoningProviders();
  if (!providers.length) {
    throw new Error('No reasoning provider configured. Set HERMES_BASE_URL or TOGETHER_API_KEY.');
  }

  const system = await buildLukeSystemPrompt(args.profileId, args.sessionId);
  const history = args.messages.filter((message) => message.role !== 'system').slice(-18);
  const failures: string[] = [];

  for (const provider of providers) {
    try {
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
        signal: AbortSignal.timeout(provider.name === 'hermes' ? 20_000 : 45_000),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        failures.push(`${provider.name}:${response.status}:${detail.slice(0, 120)}`);
        continue;
      }

      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) {
        failures.push(`${provider.name}:empty`);
        continue;
      }

      return { text, provider: provider.name };
    } catch (error) {
      failures.push(`${provider.name}:${error instanceof Error ? error.name : 'error'}`);
    }
  }

  throw new Error(`All reasoning providers failed (${failures.join(', ') || 'unknown error'}).`);
}
