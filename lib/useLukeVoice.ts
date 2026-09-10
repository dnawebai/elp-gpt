'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentMicrophone, AgentPlayer, AgentSession } from '@deepgram/agents';

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
  token: string;
  thinkEndpoint: string;
  model: string;
  voiceModel: string;
  listenModel: string;
  reasoningProvider: string;
};

const VOICE_PROMPT = `You are LUKE, the voice-first intelligence system for ELP GPT. Speak naturally and concisely. Use profile navigation tools when the user asks to see memory, skills, signals, briefings, permissions, system status, or their profile. Use get_system_status when asked whether services are online. Never say an external action happened unless a tool confirms it. Require explicit approval for consequential or irreversible external actions.`;

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
        section: {
          type: 'string',
          enum: ['memory', 'signals', 'skills', 'briefings', 'permissions', 'system'],
        },
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
] as const;

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

  const persistMessage = useCallback(
    (message: VoiceMessage) => {
      const key = `${message.role}:${message.content}`;
      if (lastTranscriptRef.current === key) return;
      lastTranscriptRef.current = key;
      void fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...message }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [sessionId],
  );

  const start = useCallback(async () => {
    if (!enabled || sessionRef.current) return;
    setState('connecting');

    try {
      const identity = await fetch('/api/identity', { method: 'POST', cache: 'no-store' });
      if (!identity.ok) throw new Error('Unable to establish LUKE identity.');

      const configResponse = await fetch('/api/voice-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
        cache: 'no-store',
      });
      if (!configResponse.ok) {
        const detail = (await configResponse.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error || 'LUKE voice session is not configured.');
      }
      const voiceConfig = (await configResponse.json()) as VoiceSessionConfig;

      const player = new AgentPlayer({ sampleRate: 24_000 });
      const agentConfig = {
        listen: {
          provider: { type: 'deepgram', version: 'v2', model: voiceConfig.listenModel },
        },
        think: {
          provider: { type: 'open_ai', model: voiceConfig.model, temperature: 0.3 },
          endpoint: {
            url: voiceConfig.thinkEndpoint,
            headers: { authorization: `Bearer ${voiceConfig.token}` },
          },
          prompt: VOICE_PROMPT,
          contextLength: 'max',
          functions: UI_FUNCTIONS,
        },
        speak: {
          provider: { type: 'deepgram', model: voiceConfig.voiceModel },
        },
        greeting: 'LUKE online.',
      } as any;

      const session = new AgentSession({
        auth: {
          tokenFactory: async () => {
            const response = await fetch('/api/deepgram-token', { method: 'POST', cache: 'no-store' });
            if (!response.ok) throw new Error(await response.text());
            return response.text();
          },
        },
        agent: agentConfig,
        audio: {
          input: { encoding: 'linear16', sampleRate: 16_000 },
          output: { encoding: 'linear16', sampleRate: 24_000 },
        },
        reconnect: {
          enabled: true,
          maxAttempts: 8,
          baseDelay: 500,
          maxDelay: 15_000,
          jitter: true,
        },
      });

      session.on('audio', (chunk) => player.queue(chunk));
      session.on('user-started-speaking', () => {
        player.interrupt();
        setState('listening');
      });
      session.on('agent-thinking', () => setState('thinking'));
      session.on('agent-started-speaking', () => setState('speaking'));
      session.on('agent-audio-done', () => setState('listening'));
      session.on('conversation-text', (message) => {
        if ((message.role === 'user' || message.role === 'assistant') && message.content?.trim()) {
          const event = { role: message.role, content: message.content.trim() } as VoiceMessage;
          onMessage(event);
          persistMessage(event);
        }
      });
      session.on('function-call-request', async (message) => {
        for (const fn of message.functions || []) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(fn.input || '{}') as Record<string, unknown>;
          } catch {
            input = {};
          }

          try {
            let result: unknown;
            if (fn.name === 'get_system_status') {
              const response = await fetch('/api/status', { cache: 'no-store' });
              result = response.ok ? await response.json() : { error: 'System status unavailable.' };
            } else if (onCommand) {
              result = await onCommand({ name: fn.name, input });
            } else {
              result = { ok: false, error: `No handler for ${fn.name}` };
            }
            session.sendFunctionCallResponse(fn.id, fn.name, JSON.stringify(result ?? { ok: true }));
          } catch (error) {
            session.sendFunctionCallResponse(
              fn.id,
              fn.name,
              JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Command failed.' }),
            );
          }
        }
      });
      session.on('sdk-error', (error) => {
        console.error('Deepgram voice SDK error', error);
        setState('error');
        onError?.('Realtime voice encountered a connection error.');
      });
      session.on('error', (error) => {
        console.error('Deepgram voice agent error', error);
        setState('error');
        onError?.('The LUKE voice system returned an error.');
      });
      session.on('disconnected', () => {
        if (sessionRef.current) setState('idle');
      });

      const microphone = new AgentMicrophone((data) => session.sendAudio(data), {
        sampleRate: 16_000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });

      playerRef.current = player;
      sessionRef.current = session;
      micRef.current = microphone;

      await session.connect();
      await microphone.start();
      setState('listening');
    } catch (error) {
      console.error('Unable to start LUKE voice', error);
      stop();
      setState('error');
      onError?.(error instanceof Error ? error.message : 'Voice could not start.');
    }
  }, [enabled, onCommand, onError, onMessage, persistMessage, sessionId, stop]);

  useEffect(() => stop, [stop]);

  return {
    state,
    isActive: state === 'connecting' || state === 'listening' || state === 'thinking' || state === 'speaking',
    isListening: state === 'listening',
    isThinking: state === 'thinking',
    isSpeaking: state === 'speaking',
    start,
    stop,
  };
}
