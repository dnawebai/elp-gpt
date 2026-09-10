'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentMicrophone, AgentPlayer, AgentSession } from '@deepgram/agents';

type VoiceMessage = { role: 'user' | 'assistant'; content: string };

type Options = {
  enabled: boolean;
  onMessage: (message: VoiceMessage) => void;
  onError?: (message: string) => void;
};

const VOICE_PROMPT = `You are LUCY, an original personal intelligence assistant. Speak naturally, efficiently, and calmly. Keep voice responses concise unless the user asks for depth. Help the user think, plan, remember, research, audit, and make decisions. Proactively identify dependencies and risks when useful. Never say an external action was completed unless a connected tool confirms it. Ask for explicit confirmation before destructive, financial, privacy-sensitive, security-sensitive, or irreversible actions.`;

export function useLucyVoice({ enabled, onMessage, onError }: Options) {
  const sessionRef = useRef<AgentSession | null>(null);
  const micRef = useRef<AgentMicrophone | null>(null);
  const playerRef = useRef<AgentPlayer | null>(null);
  const [state, setState] = useState<'idle' | 'connecting' | 'listening' | 'speaking' | 'error'>('idle');

  const stop = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    playerRef.current?.dispose();
    playerRef.current = null;
    setState('idle');
  }, []);

  const start = useCallback(async () => {
    if (!enabled || sessionRef.current) return;
    setState('connecting');

    try {
      const player = new AgentPlayer({ sampleRate: 24_000 });
      const session = new AgentSession({
        auth: {
          tokenFactory: async () => {
            const response = await fetch('/api/deepgram-token', { method: 'POST', cache: 'no-store' });
            if (!response.ok) throw new Error(await response.text());
            return response.text();
          },
        },
        agent: {
          listen: {
            provider: { type: 'deepgram', version: 'v1', model: 'nova-3' },
          },
          think: {
            provider: { type: 'open_ai', model: 'gpt-5.4-mini', temperature: 0.35 },
            prompt: VOICE_PROMPT,
          },
          speak: {
            provider: { type: 'deepgram', model: 'aura-2-thalia-en' },
          },
          greeting: 'LUCY online. How can I help?',
        },
        audio: {
          input: { encoding: 'linear16', sampleRate: 16_000 },
          output: { encoding: 'linear16', sampleRate: 24_000 },
        },
        reconnect: {
          enabled: true,
          maxAttempts: 6,
          baseDelay: 500,
          maxDelay: 10_000,
          jitter: true,
        },
      });

      session.on('audio', (chunk) => player.queue(chunk));
      session.on('user-started-speaking', () => {
        player.interrupt();
        setState('listening');
      });
      session.on('agent-started-speaking', () => setState('speaking'));
      session.on('agent-audio-done', () => setState('listening'));
      session.on('conversation-text', (message) => {
        if ((message.role === 'user' || message.role === 'assistant') && message.content?.trim()) {
          onMessage({ role: message.role, content: message.content.trim() });
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
        onError?.('The voice agent returned an error.');
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
      console.error('Unable to start LUCY voice', error);
      stop();
      setState('error');
      onError?.('Voice could not start. Check microphone permission and DEEPGRAM_API_KEY.');
    }
  }, [enabled, onError, onMessage, stop]);

  useEffect(() => stop, [stop]);

  return {
    state,
    isActive: state === 'connecting' || state === 'listening' || state === 'speaking',
    isListening: state === 'listening',
    isSpeaking: state === 'speaking',
    start,
    stop,
  };
}
