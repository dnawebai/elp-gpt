'use client';

import { useRef, useState } from 'react';
import { LoaderCircle, Phone, PhoneOff } from 'lucide-react';
import { RetellWebClient } from 'retell-client-js-sdk';

type RetellState = 'idle' | 'connecting' | 'ready' | 'speaking' | 'error';

export default function RetellCallDock() {
  const clientRef = useRef<RetellWebClient | null>(null);
  const [state, setState] = useState<RetellState>('idle');
  const [error, setError] = useState<string | null>(null);

  async function stopCall() {
    clientRef.current?.stopCall();
    clientRef.current = null;
    setState('idle');
    setError(null);
  }

  async function startCall() {
    if (state !== 'idle' && state !== 'error') return;
    setError(null);
    setState('connecting');

    try {
      const sessionId = window.sessionStorage.getItem('luke-session-id') || 'web';
      const response = await fetch('/api/retell/web-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as { accessToken?: string; error?: string } | null;
      if (!response.ok || !payload?.accessToken) {
        throw new Error(payload?.error || 'Unable to start Retell voice call.');
      }

      const client = new RetellWebClient();
      clientRef.current = client;

      client.on('call_started', () => setState('ready'));
      client.on('call_ready', () => setState('ready'));
      client.on('agent_start_talking', () => setState('speaking'));
      client.on('agent_stop_talking', () => setState('ready'));
      client.on('call_ended', () => {
        clientRef.current = null;
        setState('idle');
      });
      client.on('error', (message) => {
        console.error('Retell web call error', message);
        setError(typeof message === 'string' ? message : 'Retell voice call encountered an error.');
        setState('error');
      });

      await client.startCall({ accessToken: payload.accessToken, sampleRate: 24_000 });
      await client.startAudioPlayback().catch(() => undefined);
    } catch (cause) {
      clientRef.current?.stopCall();
      clientRef.current = null;
      setState('error');
      setError(cause instanceof Error ? cause.message : 'Unable to start Retell voice call.');
    }
  }

  const active = state === 'connecting' || state === 'ready' || state === 'speaking';
  const label = state === 'connecting'
    ? 'Connecting'
    : state === 'speaking'
      ? 'LUKE speaking'
      : state === 'ready'
        ? 'Retell live'
        : state === 'error'
          ? 'Retry Retell'
          : 'Call LUKE';

  return (
    <div className={`retell-call-dock ${active ? 'is-active' : ''} ${state === 'speaking' ? 'is-speaking' : ''}`}>
      <button
        type="button"
        className="retell-call-button"
        onClick={() => active ? void stopCall() : void startCall()}
        aria-label={active ? 'End LUKE Retell call' : 'Start LUKE Retell call'}
      >
        {state === 'connecting'
          ? <LoaderCircle size={18} className="retell-spin" />
          : active
            ? <PhoneOff size={18} />
            : <Phone size={18} />}
        <span>{label}</span>
      </button>
      {error && <p className="retell-call-error">{error}</p>}
    </div>
  );
}
