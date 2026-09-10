'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  BrainCircuit,
  ChevronRight,
  CircleUserRound,
  Cpu,
  Mic,
  Radio,
  ShieldCheck,
  WandSparkles,
  X,
} from 'lucide-react';
import { useLukeVoice } from '@/lib/useLukeVoice';

type Role = 'user' | 'assistant';
type VoiceMessage = { role: Role; content: string };

type SystemItem = {
  label: string;
  detail: string;
  icon: 'memory' | 'signals' | 'skills' | 'briefings' | 'permissions' | 'system';
};

const systemItems: SystemItem[] = [
  { label: 'Memory', detail: 'Profile understanding and long-term context', icon: 'memory' },
  { label: 'Signals', detail: 'Changes, risks, priorities and opportunities', icon: 'signals' },
  { label: 'Skills', detail: 'Connected capabilities and agent tools', icon: 'skills' },
  { label: 'Briefings', detail: 'Scheduled and proactive intelligence', icon: 'briefings' },
  { label: 'Permissions', detail: 'Approvals, privacy and action controls', icon: 'permissions' },
  { label: 'System', detail: 'Voice, models, integrations and diagnostics', icon: 'system' },
];

function SystemIcon({ kind }: { kind: SystemItem['icon'] }) {
  if (kind === 'memory') return <BrainCircuit size={19} />;
  if (kind === 'signals') return <Activity size={19} />;
  if (kind === 'skills') return <WandSparkles size={19} />;
  if (kind === 'briefings') return <Bell size={19} />;
  if (kind === 'permissions') return <ShieldCheck size={19} />;
  return <Cpu size={19} />;
}

export default function Home() {
  const [profileOpen, setProfileOpen] = useState(false);
  const [latestVoice, setLatestVoice] = useState<VoiceMessage | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const onVoiceMessage = useCallback((message: VoiceMessage) => {
    setLatestVoice(message);
    setVoiceError(null);
  }, []);

  const onVoiceError = useCallback((message: string) => {
    setVoiceError(message);
  }, []);

  const voice = useLukeVoice({
    enabled: true,
    onMessage: onVoiceMessage,
    onError: onVoiceError,
  });

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  const stateLabel = useMemo(() => {
    if (voice.state === 'connecting') return 'CONNECTING';
    if (voice.isSpeaking) return 'SPEAKING';
    if (voice.isListening) return 'LISTENING';
    if (voice.state === 'error') return 'VOICE OFFLINE';
    return 'TAP TO ACTIVATE';
  }, [voice.isListening, voice.isSpeaking, voice.state]);

  const activeLabel = voice.isActive ? 'ACTIVE' : voice.state === 'error' ? 'CHECK VOICE' : 'STANDBY';

  function toggleVoice() {
    setVoiceError(null);
    if (voice.isActive) voice.stop();
    else void voice.start();
  }

  return (
    <main className="luke-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <button
        className="profile-trigger"
        onClick={() => setProfileOpen(true)}
        aria-label="Open profile and system tools"
      >
        <CircleUserRound size={24} />
      </button>

      <section className="voice-stage" aria-label="LUKE voice interface">
        <button
          className={`hud ${voice.isActive ? 'is-active' : ''} ${voice.isSpeaking ? 'is-speaking' : ''}`}
          onClick={toggleVoice}
          aria-label={voice.isActive ? 'Stop LUKE voice session' : 'Activate LUKE voice session'}
        >
          <span className="hud-halo" />
          <span className="hud-ring ring-outer" />
          <span className="hud-ring ring-arc-a" />
          <span className="hud-ring ring-arc-b" />
          <span className="hud-ring ring-ticks" />
          <span className="hud-ring ring-inner" />
          <span className="hud-center">
            <span className="voice-wave" aria-hidden="true">
              <i /><i /><i /><i /><i /><i /><i />
            </span>
            <strong>LUKE</strong>
            <span className="voice-state">
              <Mic size={14} />
              {stateLabel}
            </span>
          </span>
        </button>

        <div className={`active-state ${voice.isActive ? 'online' : ''}`}>
          <i />
          <span>{activeLabel}</span>
        </div>

        {voiceError && <p className="voice-error">{voiceError}</p>}
      </section>

      <p className="system-signature">ELP GPT</p>

      {profileOpen && (
        <div className="profile-backdrop" role="presentation" onClick={() => setProfileOpen(false)}>
          <aside className="profile-panel" role="dialog" aria-modal="true" aria-label="Profile and system" onClick={(event) => event.stopPropagation()}>
            <header className="profile-header">
              <div>
                <p>ELP GPT</p>
                <h2>Profile & System</h2>
              </div>
              <button className="close-button" onClick={() => setProfileOpen(false)} aria-label="Close profile">
                <X size={21} />
              </button>
            </header>

            <section className="profile-identity">
              <div className="profile-avatar"><CircleUserRound size={30} /></div>
              <div>
                <strong>LUKE profile</strong>
                <span>Voice intelligence environment</span>
              </div>
              <div className="profile-online"><i /> {voice.isActive ? 'Live' : 'Ready'}</div>
            </section>

            <nav className="system-menu" aria-label="LUKE system tools">
              {systemItems.map((item) => (
                <button key={item.label} className="system-row">
                  <span className="system-row-icon"><SystemIcon kind={item.icon} /></span>
                  <span className="system-row-copy">
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))}
            </nav>

            <section className="engine-card">
              <div className="engine-title"><Radio size={17} /><span>Core engines</span></div>
              <div className="engine-grid">
                <span>Deepgram <i /></span>
                <span>Hermes Agent <i /></span>
                <span>Together AI <i /></span>
                <span>Honcho Memory <i /></span>
              </div>
            </section>

            {latestVoice && (
              <section className="recent-voice">
                <span>{latestVoice.role === 'user' ? 'LAST HEARD' : 'LAST RESPONSE'}</span>
                <p>{latestVoice.content}</p>
              </section>
            )}

            <p className="profile-footnote">Tools and controls stay hidden here until you open your profile.</p>
          </aside>
        </div>
      )}
    </main>
  );
}
