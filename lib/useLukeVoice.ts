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

type VoicePostExecution =
  | { kind: 'meeting-follow-up'; meetingId: string; index: number }
  | { kind: 'meeting-calendar'; meetingId: string; summary: string };

type OperatorPendingVoiceAction = {
  toolSlug: string;
  arguments: Record<string, unknown>;
  summary: string;
  risk: 'write' | 'high';
  postExecution?: VoicePostExecution;
};

const VOICE_PROMPT = `You are ELP, the voice-first intelligence system for ELP GPT.
Address the primary user as "Sir" naturally. Speak in polished contemporary British English: discreet, composed, anticipatory, precise, and concise. Correct material errors tactfully.

Use jarbis_command for native executive intelligence. It can run missions, briefings, Opportunity Radar, relationship intelligence, negotiation preparation, Executive Ledger/commitments, Command Center, and post-meeting actions.
For a post-meeting email request such as "send the first follow-up from yesterday's meeting", call jarbis_command with command="meeting_follow_up", meeting set to the user's meeting reference, and followUpNumber set to the requested one-based number. The returned action is approval-required. Describe the exact action and ask for approval; never approve it yourself.
For a calendar follow-up such as "schedule the follow-up call Tuesday at 2 PM", call jarbis_command with command="meeting_schedule", meeting set to the relevant meeting reference, scheduleRequest containing the user's date/time wording, durationMinutes if stated, and inviteParticipants=true unless the user explicitly says not to invite them. The server resolves relative dates using the browser timezone and returns an exact approval-required calendar action.
For a negotiation request, pass the counterpart in target and desired outcome in objective when known.
For external apps not covered by a native JARBIS command, use search_tools before prepare_action.
Read-only actions may run immediately. Every external write or consequential action must be prepared and requires explicit user approval. Call approve_action only after a clear yes/approve/proceed; call reject_action if declined.
Never claim an external action occurred unless the execution result confirms it. Do not imitate fictional assistants.`;

const UI_FUNCTIONS = [
  { name: 'open_profile', description: 'Open the ELP profile and system drawer.', parameters: { type: 'object', properties: {} } },
  { name: 'open_profile_section', description: 'Open a specific ELP profile section.', parameters: { type: 'object', properties: { section: { type: 'string', enum: ['memory', 'signals', 'skills', 'briefings', 'permissions', 'system'] } }, required: ['section'] } },
  { name: 'close_profile', description: 'Close the profile and return to the main voice HUD.', parameters: { type: 'object', properties: {} } },
  { name: 'get_system_status', description: 'Check which ELP engines are configured and available.', parameters: { type: 'object', properties: {} } },
  { name: 'get_device_context', description: 'Read browser timezone, locale, connectivity and optionally GPS after browser permission.', parameters: { type: 'object', properties: { include_location: { type: 'boolean' } } } },
  { name: 'find_skills', description: 'Search the first-party ELP skill registry.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  {
    name: 'jarbis_command',
    description: 'Invoke a native JARBIS executive capability, including approval-gated post-meeting email and calendar follow-ups.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: ['mission', 'attention', 'daily_briefing', 'meeting_prep', 'radar', 'relationships', 'relationship', 'negotiation', 'ledger', 'commitments', 'command_center', 'meeting_follow_up', 'meeting_schedule'] },
        objective: { type: 'string' },
        target: { type: 'string' },
        context: { type: 'string' },
        meeting: { type: 'string', description: 'Meeting reference such as latest, yesterday, title, participant or company.' },
        query: { type: 'string' },
        followUpNumber: { type: 'number', description: 'One-based follow-up number. First follow-up is 1.' },
        scheduleRequest: { type: 'string', description: 'User wording for date/time, e.g. Tuesday at 2 PM.' },
        durationMinutes: { type: 'number' },
        inviteParticipants: { type: 'boolean' },
      },
      required: ['command'],
    },
  },
  { name: 'search_tools', description: 'Discover a Composio tool for an external app task.', parameters: { type: 'object', properties: { query: { type: 'string' }, toolkit: { type: 'string' } }, required: ['query'] } },
  { name: 'prepare_action', description: 'Prepare an exact external tool execution. Writes are held for approval.', parameters: { type: 'object', properties: { tool_slug: { type: 'string' }, arguments: { type: 'object', additionalProperties: true }, summary: { type: 'string' }, connected_account_id: { type: 'string' } }, required: ['tool_slug', 'arguments', 'summary'] } },
  { name: 'approve_action', description: 'Execute the pending write/consequential action after explicit approval.', parameters: { type: 'object', properties: {} } },
  { name: 'reject_action', description: 'Discard the pending action.', parameters: { type: 'object', properties: {} } },
] as const;

function readBasicDeviceContext(): LukeDeviceContext {
  let timezone: string | undefined;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { timezone = undefined; }
  return { capturedAt: new Date().toISOString(), timezone, locale: navigator.language || undefined, online: navigator.onLine, userAgent: navigator.userAgent };
}

async function captureDeviceContext(includeLocation: boolean): Promise<LukeDeviceContext> {
  const context = readBasicDeviceContext();
  if (!includeLocation || !navigator.geolocation) return context;
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (position) => resolve({ ...context, capturedAt: new Date(position.timestamp).toISOString(), location: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy, altitudeMeters: position.coords.altitude, headingDegrees: position.coords.heading, speedMetersPerSecond: position.coords.speed } }),
    () => resolve(context),
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
  ));
}

export function useLukeVoice({ enabled, sessionId, onMessage, onCommand, onError }: Options) {
  const sessionRef = useRef<AgentSession | null>(null);
  const micRef = useRef<AgentMicrophone | null>(null);
  const playerRef = useRef<AgentPlayer | null>(null);
  const lastTranscriptRef = useRef('');
  const pendingRef = useRef<OperatorPendingVoiceAction | null>(null);
  const [state, setState] = useState<'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'>('idle');

  const stop = useCallback(() => {
    micRef.current?.stop(); micRef.current = null;
    sessionRef.current?.disconnect(); sessionRef.current = null;
    playerRef.current?.dispose(); playerRef.current = null;
    setState('idle');
  }, []);

  const persistMessage = useCallback((message: VoiceMessage) => {
    const key = `${message.role}:${message.content}`;
    if (lastTranscriptRef.current === key) return;
    lastTranscriptRef.current = key;
    void fetch('/api/transcript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, ...message }), keepalive: true }).catch(() => undefined);
  }, [sessionId]);

  const runJarbisVoiceCommand = useCallback(async (input: Record<string, unknown>) => {
    let timezone: string | undefined;
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { timezone = undefined; }
    const response = await fetch('/api/voice/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, sessionId, timezone }), cache: 'no-store' });
    const data = await response.json().catch(() => ({ error: 'JARBIS voice command returned an invalid response.' })) as { error?: string; status?: string; pendingAction?: OperatorPendingVoiceAction; [key: string]: unknown };
    if (!response.ok) return { ok: false, error: data.error || 'JARBIS voice command failed.' };
    if (data.status === 'approval_required' && data.pendingAction) pendingRef.current = data.pendingAction;
    return data;
  }, [sessionId]);

  const recordPostExecution = useCallback(async (postExecution: VoicePostExecution | undefined, result: unknown) => {
    if (!postExecution) return;
    const evidence = (() => { try { return JSON.stringify(result).slice(0, 1400); } catch { return 'Execution completed.'; } })();
    await fetch('/api/voice/post-execution', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...postExecution, evidence }), cache: 'no-store' }).catch(() => undefined);
  }, []);

  const start = useCallback(async () => {
    if (!enabled || sessionRef.current) return;
    setState('connecting');
    try {
      const identity = await fetch('/api/identity', { method: 'POST', cache: 'no-store' });
      if (!identity.ok) throw new Error('Unable to establish ELP identity.');
      const configResponse = await fetch('/api/voice-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }), cache: 'no-store' });
      if (!configResponse.ok) throw new Error(((await configResponse.json().catch(() => null)) as { error?: string } | null)?.error || 'ELP voice session is not configured.');
      const voiceConfig = await configResponse.json() as VoiceSessionConfig;
      const player = new AgentPlayer({ sampleRate: 24_000 });
      const listenProvider: Record<string, unknown> = { type: 'deepgram', version: voiceConfig.listenVersion, model: voiceConfig.listenModel };
      if (voiceConfig.listenVersion === 'v2') {
        listenProvider.eot_threshold = voiceConfig.eotThreshold;
        listenProvider.eager_eot_threshold = voiceConfig.eagerEotThreshold;
        listenProvider.eot_timeout_ms = voiceConfig.eotTimeoutMs;
        listenProvider.keyterms = voiceConfig.keyterms;
        if (voiceConfig.listenModel === 'flux-general-multi') listenProvider.language_hints = voiceConfig.languageHints;
      }
      const think: Record<string, unknown> = { provider: { type: 'open_ai', version: 'v1', model: voiceConfig.model, temperature: 0.3 }, prompt: VOICE_PROMPT, functions: UI_FUNCTIONS };
      if (voiceConfig.reasoningMode === 'external') {
        if (!voiceConfig.token || !voiceConfig.thinkEndpoint) throw new Error('ELP external reasoning session is incomplete.');
        think.endpoint = { url: voiceConfig.thinkEndpoint, headers: { authorization: `Bearer ${voiceConfig.token}` } };
        think.context_length = 'max';
      }
      const session = new AgentSession({
        auth: { tokenFactory: async () => { const response = await fetch('/api/deepgram-token', { method: 'POST', cache: 'no-store' }); if (!response.ok) throw new Error(await response.text()); return response.text(); } },
        ...(voiceConfig.agentUrl ? { url: voiceConfig.agentUrl } : {}),
        agent: { listen: { provider: listenProvider }, think, speak: { provider: { type: 'deepgram', version: voiceConfig.speakVersion, model: voiceConfig.voiceModel, speed: voiceConfig.voiceSpeed } }, greeting: 'Good day, Sir. ELP is online.' } as any,
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
              const response = await fetch('/api/status?probe=1', { cache: 'no-store' }); result = response.ok ? await response.json() : { error: 'System status unavailable.' };
            } else if (fn.name === 'get_device_context') result = await captureDeviceContext(input.include_location === true);
            else if (fn.name === 'find_skills') {
              const query = typeof input.query === 'string' ? input.query.trim() : '';
              if (!query) result = { ok: false, error: 'A skill query is required.' };
              else { const response = await fetch(`/api/skills?q=${encodeURIComponent(query)}`, { cache: 'no-store' }); result = response.ok ? await response.json() : { ok: false, error: 'Skill discovery unavailable.' }; }
            } else if (fn.name === 'jarbis_command') result = await runJarbisVoiceCommand(input);
            else if (fn.name === 'approve_action' && pendingRef.current && onCommand) {
              const pending = pendingRef.current;
              const prepared = await onCommand({ name: 'prepare_action', input: { tool_slug: pending.toolSlug, arguments: pending.arguments, summary: pending.summary } }) as { status?: string; error?: string };
              if (prepared?.status !== 'approval_required') result = prepared;
              else {
                result = await onCommand({ name: 'approve_action', input: {} });
                if ((result as { ok?: boolean })?.ok !== false) {
                  await recordPostExecution(pending.postExecution, result);
                  pendingRef.current = null;
                }
              }
            } else if (fn.name === 'reject_action' && pendingRef.current) {
              pendingRef.current = null; result = onCommand ? await onCommand({ name: 'reject_action', input: {} }) : { ok: true, status: 'cancelled' };
            } else if (onCommand) result = await onCommand({ name: fn.name, input });
            else result = { ok: false, error: `No handler for ${fn.name}` };
            session.sendFunctionCallResponse(fn.id, fn.name, JSON.stringify(result ?? { ok: true }));
          } catch (error) {
            session.sendFunctionCallResponse(fn.id, fn.name, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Command failed.' }));
          }
        }
      });
      session.on('sdk-error', (error) => { console.error('Deepgram voice SDK error', error); setState('error'); onError?.('Realtime voice encountered a Deepgram connection error.'); });
      session.on('error', (error) => { console.error('Deepgram voice agent error', error); setState('error'); onError?.('The ELP voice system returned an error.'); });
      session.on('disconnected', () => { if (sessionRef.current) setState('idle'); });
      const microphone = new AgentMicrophone((data) => session.sendAudio(data), { sampleRate: 16_000, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      playerRef.current = player; sessionRef.current = session; micRef.current = microphone;
      await session.connect(); await microphone.start(); setState('listening');
    } catch (error) {
      console.error('Unable to start ELP voice', error); stop(); setState('error'); onError?.(error instanceof Error ? error.message : 'Voice could not start.');
    }
  }, [enabled, onCommand, onError, onMessage, persistMessage, recordPostExecution, runJarbisVoiceCommand, sessionId, stop]);

  useEffect(() => stop, [stop]);
  return { state, isActive: state === 'connecting' || state === 'listening' || state === 'thinking' || state === 'speaking', isListening: state === 'listening', isThinking: state === 'thinking', isSpeaking: state === 'speaking', start, stop };
}
