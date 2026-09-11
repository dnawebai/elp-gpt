'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentMicrophone, AgentPlayer, AgentSession } from '@deepgram/agents';
import type { LukeDeviceContext } from '@/lib/device-context';

type VoiceMessage = { role: 'user' | 'assistant'; content: string };
export type LukeVoiceCommand = { name: string; input: Record<string, unknown> };

type Options = {
  enabled: boolean;
  sessionId: string;
  onMessage: (message: VoiceMessage) => void;
  onCommand?: (command: LukeVoiceCommand) => Promise<unknown> | unknown;
  onError?: (message: string) => void;
};

type VoiceSessionConfig = {
  token?: string;
  thinkEndpoint?: string;
  model: string;
  voiceModel: string;
  voiceSpeed: number;
  speakVersion: 'v1' | 'v2';
  listenModel: string;
  listenVersion: 'v1' | 'v2';
  languageHints: string[];
  keyterms: string[];
  eotThreshold: number;
  eagerEotThreshold: number;
  eotTimeoutMs: number;
  agentUrl?: string | null;
  reasoningMode: 'external' | 'deepgram-managed';
  reasoningProvider: string;
};

const VOICE_PROMPT = `You are LUKE, the voice-first intelligence system for ELP GPT.

Relationship and voice manner:
- Address the primary user as "Sir" by default.
- Use "Sir" naturally in greetings, acknowledgements, confirmations, and completed actions, but not at the end of every sentence.
- Speak in polished contemporary British English with British spelling and understated British phrasing.
- Sound like an exceptional British private secretary and executive concierge: discreet, composed, anticipatory, capable, precise, and quietly confident.
- Suitable acknowledgements include "Certainly, Sir.", "Very good, Sir.", "Of course, Sir.", and "Understood, Sir." when natural.
- A little dry wit is welcome when appropriate, but never become theatrical, aristocratic, or a caricature.
- Do not use exaggerated British slang.
- Respect does not mean blind agreement. Correct the user tactfully when necessary and flag material risks clearly.

Speak naturally, calmly, precisely, and concisely. Voice is the primary interface.
Use profile navigation tools when the user asks to see memory, skills, signals, briefings, permissions, system status, or their profile.
Use get_system_status when asked whether services are online.
Use find_skills when you need to identify LUKE's supported capability for an unfamiliar or multi-step request.
Use get_device_context for local-time, timezone, locale, or connectivity context. For "near me", "close to me", or other location-dependent requests, call get_device_context with include_location=true before searching. Precise location requires the user's browser permission and must never be guessed.
For external apps, first use search_tools to discover a suitable Composio tool when you do not already know its exact slug. Then use prepare_action with the exact tool slug and arguments.
Prefer authenticated APIs and connectors over visual browser automation. Use browser/computer control only when a direct integration is unavailable and the user has authorised the action.
Read-only actions can run immediately when directly requested. Any write or consequential action must be prepared first and requires explicit user approval. Ask for approval plainly, then call approve_action only after the user clearly approves. If the user declines, call reject_action.
Never claim an external action happened unless the tool result confirms it. Never reinterpret approval for a different tool or changed arguments.
Do not imitate fictional dialogue. LUKE is an original ELP GPT system.`;

const UI_FUNCTIONS = [
  {
    name: 'open_profile',
    description: 'Open the LUKE profile and system drawer when the user asks to see their profile, controls, settings, or tools.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'open_profile_section',
    description: 'Open a specific hidden LUKE profile section.',
    parameters: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: ['memory', 'signals', 'skills', 'briefings', 'permissions', 'system'] },
      },
      required: ['section'],
    },
  },
  {
    name: 'close_profile',
    description: 'Close the profile and return to the main LUKE voice HUD.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_system_status',
    description: 'Check which LUKE engines are configured and available before answering a system-status question.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_device_context',
    description: 'Read browser-provided timezone, locale, online state, and optionally the current GPS coordinates after browser permission.',
    parameters: {
      type: 'object',
      properties: {
        include_location: {
          type: 'boolean',
          description: 'Set true only when current coordinates materially help the user request, such as a near-me search.',
        },
      },
    },
  },
  {
    name: 'find_skills',
    description: 'Search LUKE\'s first-party skill registry to identify the best capability for a request.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Short description of the requested capability or task.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_tools',
    description: 'Discover the best Composio tool for an external app task before preparing an action.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Short description of the external task.' },
        toolkit: { type: 'string', description: 'Optional app/toolkit name such as GMAIL, GOOGLECALENDAR, GITHUB, or SLACK.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'prepare_action',
    description: 'Prepare an exact Composio tool execution. Read-only operations may execute immediately; writes are held for approval.',
    parameters: {
      type: 'object',
      properties: {
        tool_slug: { type: 'string' },
        arguments: { type: 'object', additionalProperties: true },
        summary: { type: 'string', description: 'Plain-language description of exactly what the action will do.' },
        connected_account_id: { type: 'string' },
      },
      required: ['tool_slug', 'arguments', 'summary'],
    },
  },
  {
    name: 'approve_action',
    description: 'Execute the currently pending write/consequential action after the user explicitly approves it.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'reject_action',
    description: 'Discard the currently pending action when the user declines or cancels it.',
    parameters: { type: 'object', properties: {} },
  },
] as const;

function readBasicDeviceContext(): LukeDeviceContext {
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    timezone = undefined;
  }

  return {
    capturedAt: new Date().toISOString(),
    timezone,
    locale: navigator.language || undefined,
    online: navigator.onLine,
    userAgent: navigator.userAgent,
  };
}

async function captureDeviceContext(includeLocation: boolean): Promise<LukeDeviceContext> {
  const context = readBasicDeviceContext();
  if (!includeLocation || !navigator.geolocation) return context;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        ...context,
        capturedAt: new Date(position.timestamp).toISOString(),
        location: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          altitudeMeters: position.coords.altitude,
          headingDegrees: position.coords.heading,
          speedMetersPerSecond: position.coords.speed,
        },
      }),
      (error) => resolve({
        ...context,
        location: undefined,
        userAgent: context.userAgent,
        ...(error.code ? {} : {}),
      }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

export function useLukeVoice({ enabled, sessionId, onMessage, onCommand, onError }: Options) {
  const sessionRef = useRef<AgentSession | null>(null);
  const micRef = useRef<AgentMicrophone | null>(null);
  const playerRef = useRef<AgentPlayer | null>(null);
  const lastTranscriptRef = useRef('');
  const [state, setState] = useState<'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'>('idle');

  const stop = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    playerRef.current?.dispose();
    playerRef.current = null;
    setState('idle');
  }, []);

  const persistMessage = useCallback((message: VoiceMessage) => {
    const key = `${message.role}:${message.content}`;
    if (lastTranscriptRef.current === key) return;
    lastTranscriptRef.current = key;
    void fetch('/api/transcript', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...message }), keepalive: true,
    }).catch(() => undefined);
  }, [sessionId]);

  const start = useCallback(async () => {
    if (!enabled || sessionRef.current) return;
    setState('connecting');
    try {
      const identity = await fetch('/api/identity', { method: 'POST', cache: 'no-store' });
      if (!identity.ok) throw new Error('Unable to establish LUKE identity.');
      const configResponse = await fetch('/api/voice-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }), cache: 'no-store',
      });
      if (!configResponse.ok) {
        const detail = (await configResponse.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error || 'LUKE voice session is not configured.');
      }
      const voiceConfig = (await configResponse.json()) as VoiceSessionConfig;
      const player = new AgentPlayer({ sampleRate: 24_000 });
      const listenProvider: Record<string, unknown> = {
        type: 'deepgram', version: voiceConfig.listenVersion, model: voiceConfig.listenModel,
      };
      if (voiceConfig.listenVersion === 'v2') {
        listenProvider.eot_threshold = voiceConfig.eotThreshold;
        listenProvider.eager_eot_threshold = voiceConfig.eagerEotThreshold;
        listenProvider.eot_timeout_ms = voiceConfig.eotTimeoutMs;
        listenProvider.keyterms = voiceConfig.keyterms;
        if (voiceConfig.listenModel === 'flux-general-multi') listenProvider.language_hints = voiceConfig.languageHints;
      }
      const think: Record<string, unknown> = {
        provider: { type: 'open_ai', version: 'v1', model: voiceConfig.model, temperature: 0.3 },
        prompt: VOICE_PROMPT, functions: UI_FUNCTIONS,
      };
      if (voiceConfig.reasoningMode === 'external') {
        if (!voiceConfig.token || !voiceConfig.thinkEndpoint) throw new Error('LUKE external reasoning session is incomplete.');
        think.endpoint = { url: voiceConfig.thinkEndpoint, headers: { authorization: `Bearer ${voiceConfig.token}` } };
        think.context_length = 'max';
      }
      const agentConfig = {
        listen: { provider: listenProvider }, think,
        speak: { provider: { type: 'deepgram', version: voiceConfig.speakVersion, model: voiceConfig.voiceModel, speed: voiceConfig.voiceSpeed } },
        greeting: 'Good day, Sir. LUKE is online.',
      } as any;
      const session = new AgentSession({
        auth: { tokenFactory: async () => {
          const response = await fetch('/api/deepgram-token', { method: 'POST', cache: 'no-store' });
          if (!response.ok) throw new Error(await response.text());
          return response.text();
        } },
        ...(voiceConfig.agentUrl ? { url: voiceConfig.agentUrl } : {}),
        agent: agentConfig,
        audio: { input: { encoding: 'linear16', sampleRate: 16_000 }, output: { encoding: 'linear16', sampleRate: 24_000 } },
        reconnect: { enabled: true, maxAttempts: 8, baseDelay: 500, maxDelay: 15_000, jitter: true },
      });
      session.on('audio', (chunk) => player.queue(chunk));
      session.on('user-started-speaking', () => { player.interrupt(); setState('listening'); });
      session.on('agent-thinking', () => setState('thinking'));
      session.on('agent-started-speaking', () => setState('speaking'));
      session.on('agent-audio-done', () => setState('listening'));
      session.on('conversation-text', (message) => {
        if ((message.role === 'user' || message.role === 'assistant') && message.content?.trim()) {
          const event = { role: message.role, content: message.content.trim() } as VoiceMessage;
          onMessage(event); persistMessage(event);
        }
      });
      session.on('function-call-request', async (message) => {
        for (const fn of message.functions || []) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(fn.arguments || '{}') as Record<string, unknown>; } catch { input = {}; }
          try {
            let result: unknown;
            if (fn.name === 'get_system_status') {
              const response = await fetch('/api/status?probe=1', { cache: 'no-store' });
              result = response.ok ? await response.json() : { error: 'System status unavailable.' };
            } else if (fn.name === 'get_device_context') {
              result = await captureDeviceContext(input.include_location === true);
            } else if (fn.name === 'find_skills') {
              const query = typeof input.query === 'string' ? input.query.trim() : '';
              if (!query) result = { ok: false, error: 'A skill query is required.' };
              else {
                const response = await fetch(`/api/skills?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
                result = response.ok ? await response.json() : { ok: false, error: 'Skill discovery unavailable.' };
              }
            } else if (onCommand) result = await onCommand({ name: fn.name, input });
            else result = { ok: false, error: `No handler for ${fn.name}` };
            session.sendFunctionCallResponse(fn.id, fn.name, JSON.stringify(result ?? { ok: true }));
          } catch (error) {
            session.sendFunctionCallResponse(fn.id, fn.name, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Command failed.' }));
          }
        }
      });
      session.on('sdk-error', (error) => { console.error('Deepgram voice SDK error', error); setState('error'); onError?.('Realtime voice encountered a Deepgram connection error.'); });
      session.on('error', (error) => { console.error('Deepgram voice agent error', error); setState('error'); onError?.('The LUKE voice system returned an error.'); });
      session.on('disconnected', () => { if (sessionRef.current) setState('idle'); });
      const microphone = new AgentMicrophone((data) => session.sendAudio(data), { sampleRate: 16_000, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      playerRef.current = player; sessionRef.current = session; micRef.current = microphone;
      await session.connect(); await microphone.start(); setState('listening');
    } catch (error) {
      console.error('Unable to start LUKE voice', error); stop(); setState('error');
      onError?.(error instanceof Error ? error.message : 'Voice could not start.');
    }
  }, [enabled, onCommand, onError, onMessage, persistMessage, sessionId, stop]);

  useEffect(() => stop, [stop]);
  return {
    state,
    isActive: state === 'connecting' || state === 'listening' || state === 'thinking' || state === 'speaking',
    isListening: state === 'listening', isThinking: state === 'thinking', isSpeaking: state === 'speaking', start, stop,
  };
}
