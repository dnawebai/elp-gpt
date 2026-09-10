'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bell,
  BrainCircuit,
  ChevronRight,
  CircleUserRound,
  Cpu,
  LockKeyhole,
  Mic,
  Radio,
  RefreshCw,
  ShieldCheck,
  WandSparkles,
  X,
} from 'lucide-react';
import { useLukeVoice, type LukeVoiceCommand } from '@/lib/useLukeVoice';

type Role = 'user' | 'assistant';
type VoiceMessage = { role: Role; content: string };
type SectionKey = 'memory' | 'signals' | 'skills' | 'briefings' | 'permissions' | 'system';
type SystemStatus = {
  voice: boolean;
  reasoning: boolean;
  reasoningProvider: string | null;
  memory: boolean;
  hermes: boolean;
  together: boolean;
  composio?: boolean;
  securityMode: string;
  voiceModel: string;
  listenModel: string;
};
type MemorySnapshot = {
  configured: boolean;
  available: boolean;
  facts: string[];
  representation: string;
  summary: string;
};
type PendingAction = {
  action: {
    toolSlug: string;
    arguments: Record<string, unknown>;
    connectedAccountId?: string;
    summary: string;
  };
  risk: 'write' | 'high';
  policy: string;
  proposalToken: string;
};

type SystemItem = { key: SectionKey; label: string; detail: string; icon: SectionKey };
const systemItems: SystemItem[] = [
  { key: 'memory', label: 'Memory', detail: 'Long-term context and learned profile', icon: 'memory' },
  { key: 'signals', label: 'Signals', detail: 'Changes, risks and emerging priorities', icon: 'signals' },
  { key: 'skills', label: 'Skills', detail: 'Voice commands and connected capabilities', icon: 'skills' },
  { key: 'briefings', label: 'Briefings', detail: 'Proactive and scheduled intelligence', icon: 'briefings' },
  { key: 'permissions', label: 'Permissions', detail: 'Approval policy and action controls', icon: 'permissions' },
  { key: 'system', label: 'System', detail: 'Models, integrations and diagnostics', icon: 'system' },
];

function SystemIcon({ kind }: { kind: SectionKey }) {
  if (kind === 'memory') return <BrainCircuit size={19} />;
  if (kind === 'signals') return <Activity size={19} />;
  if (kind === 'skills') return <WandSparkles size={19} />;
  if (kind === 'briefings') return <Bell size={19} />;
  if (kind === 'permissions') return <ShieldCheck size={19} />;
  return <Cpu size={19} />;
}

function StateDot({ online }: { online: boolean }) {
  return <i className={online ? 'engine-dot online' : 'engine-dot'} />;
}

export default function Home() {
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>('system');
  const [latestVoice, setLatestVoice] = useState<VoiceMessage | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('web');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [memory, setMemory] = useState<MemorySnapshot | null>(null);
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [lastActionResult, setLastActionResult] = useState<string | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);

  useEffect(() => {
    const existing = window.sessionStorage.getItem('luke-session-id');
    const id = existing || crypto.randomUUID();
    if (!existing) window.sessionStorage.setItem('luke-session-id', id);
    setSessionId(id);
    void fetch('/api/identity', { method: 'POST', cache: 'no-store' }).catch(() => undefined);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      if (response.ok) setStatus((await response.json()) as SystemStatus);
    } catch {
      setStatus(null);
    }
  }, []);

  const loadMemory = useCallback(async () => {
    setLoadingMemory(true);
    try {
      await fetch('/api/identity', { method: 'POST', cache: 'no-store' });
      const response = await fetch(`/api/profile/context?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
      if (response.ok) setMemory((await response.json()) as MemorySnapshot);
    } finally {
      setLoadingMemory(false);
    }
  }, [sessionId]);

  const openSection = useCallback((section: SectionKey) => {
    setActiveSection(section);
    setProfileOpen(true);
    if (section === 'system') void loadStatus();
    if (section === 'memory') void loadMemory();
  }, [loadMemory, loadStatus]);

  const rememberPending = useCallback((value: PendingAction | null) => {
    pendingActionRef.current = value;
    setPendingAction(value);
  }, []);

  const executePlannedAction = useCallback(async (plan: PendingAction | { action: PendingAction['action']; proposalToken: string }, token: string) => {
    const response = await fetch('/api/actions/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        toolSlug: plan.action.toolSlug,
        arguments: plan.action.arguments,
        connectedAccountId: plan.action.connectedAccountId,
      }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({ error: 'Action returned an invalid response.' }));
    if (!response.ok) return { ok: false, ...data };
    setLastActionResult(`${plan.action.summary} — completed`);
    return data;
  }, []);

  const handleVoiceCommand = useCallback(async ({ name, input }: LukeVoiceCommand) => {
    if (name === 'open_profile') {
      setProfileOpen(true);
      return { ok: true, visible: 'profile' };
    }
    if (name === 'close_profile') {
      setProfileOpen(false);
      return { ok: true, visible: 'voice_hud' };
    }
    if (name === 'open_profile_section') {
      const section = input.section;
      if (typeof section === 'string' && systemItems.some((item) => item.key === section)) {
        openSection(section as SectionKey);
        return { ok: true, visible: section };
      }
      return { ok: false, error: 'Unknown profile section.' };
    }
    if (name === 'search_tools') {
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      const toolkit = typeof input.toolkit === 'string' ? input.toolkit.trim() : '';
      if (!query) return { ok: false, error: 'A tool search query is required.' };
      const params = new URLSearchParams({ q: query });
      if (toolkit) params.set('toolkit', toolkit);
      const response = await fetch(`/api/actions/search?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({ error: 'Tool discovery failed.' }));
      return response.ok ? { ok: true, ...data } : { ok: false, ...data };
    }
    if (name === 'prepare_action') {
      const response = await fetch('/api/actions/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          toolSlug: input.tool_slug,
          arguments: input.arguments,
          summary: input.summary,
          connectedAccountId: input.connected_account_id,
        }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({ error: 'Action planning failed.' })) as PendingAction & {
        configured?: boolean;
        requiresApproval?: boolean;
        error?: string;
      };
      if (!response.ok) return { ok: false, error: data.error || 'Action planning failed.' };
      if (!data.configured) return { ok: false, error: 'Composio is not configured on this deployment.' };
      if (data.requiresApproval) {
        rememberPending(data);
        setActiveSection('permissions');
        setProfileOpen(true);
        setLastActionResult(null);
        return {
          ok: true,
          status: 'approval_required',
          risk: data.risk,
          summary: data.action.summary,
          policy: data.policy,
        };
      }
      return executePlannedAction(data, data.proposalToken);
    }
    if (name === 'approve_action') {
      const current = pendingActionRef.current;
      if (!current) return { ok: false, error: 'There is no pending action to approve.' };
      const approval = await fetch('/api/actions/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalToken: current.proposalToken }),
        cache: 'no-store',
      });
      const approved = await approval.json().catch(() => ({ error: 'Approval failed.' })) as { executionToken?: string; error?: string };
      if (!approval.ok || !approved.executionToken) return { ok: false, error: approved.error || 'Approval failed.' };
      const result = await executePlannedAction(current, approved.executionToken);
      if ((result as { ok?: boolean }).ok !== false) rememberPending(null);
      return result;
    }
    if (name === 'reject_action') {
      const current = pendingActionRef.current;
      rememberPending(null);
      setLastActionResult(current ? `${current.action.summary} — cancelled` : null);
      return current ? { ok: true, status: 'cancelled', summary: current.action.summary } : { ok: true, status: 'nothing_pending' };
    }
    return { ok: false, error: `Unsupported LUKE command: ${name}` };
  }, [executePlannedAction, openSection, rememberPending, sessionId]);

  const onVoiceMessage = useCallback((message: VoiceMessage) => {
    setLatestVoice(message);
    setVoiceError(null);
    if (message.role === 'assistant' && activeSection === 'memory') void loadMemory();
  }, [activeSection, loadMemory]);

  const voice = useLukeVoice({
    enabled: true,
    sessionId,
    onMessage: onVoiceMessage,
    onCommand: handleVoiceCommand,
    onError: (message) => setVoiceError(message),
  });

  const stateLabel = useMemo(() => {
    if (voice.state === 'connecting') return 'CONNECTING';
    if (voice.isSpeaking) return 'SPEAKING';
    if (voice.isThinking) return 'THINKING';
    if (voice.isListening) return 'LISTENING';
    if (voice.state === 'error') return 'VOICE OFFLINE';
    return 'TAP TO ACTIVATE';
  }, [voice.isListening, voice.isSpeaking, voice.isThinking, voice.state]);

  const activeLabel = voice.isActive ? 'ACTIVE' : voice.state === 'error' ? 'CHECK SYSTEM' : 'STANDBY';

  function toggleVoice() {
    setVoiceError(null);
    if (voice.isActive) voice.stop();
    else void voice.start();
  }

  function renderSection() {
    if (activeSection === 'memory') {
      return <section className="detail-card"><div className="detail-heading"><div><span>MEMORY</span><h3>What LUKE knows</h3></div><button className="mini-button" onClick={() => void loadMemory()} aria-label="Refresh memory"><RefreshCw size={15} /></button></div>{loadingMemory && <p className="section-note">Reading current memory…</p>}{!loadingMemory && memory && !memory.configured && <p className="section-note">Honcho is not configured on this deployment.</p>}{!loadingMemory && memory?.configured && !memory.available && <p className="section-note">Memory is connected. Keep talking with LUKE and stable context will appear here.</p>}{memory?.facts?.length ? <div className="fact-list">{memory.facts.map((fact, index) => <p key={`${index}-${fact}`}>{fact}</p>)}</div> : null}{memory?.summary ? <div className="memory-block"><span>SESSION CONTEXT</span><p>{memory.summary}</p></div> : null}{memory?.representation ? <div className="memory-block"><span>PROFILE MODEL</span><p>{memory.representation}</p></div> : null}</section>;
    }
    if (activeSection === 'signals') return <section className="detail-card"><div className="detail-heading"><div><span>SIGNALS</span><h3>Attention radar</h3></div></div><p className="section-note">The signal surface is ready for connected monitors. LUKE only reports verified connected signals.</p></section>;
    if (activeSection === 'skills') return <section className="detail-card"><div className="detail-heading"><div><span>SKILLS</span><h3>Active capabilities</h3></div></div><div className="capability-grid"><span>Realtime Deepgram voice</span><span>Composio tool discovery</span><span>Permission-gated actions</span><span>Hermes / Together routing</span><span>Honcho memory continuity</span><span>System diagnostics</span></div></section>;
    if (activeSection === 'briefings') return <section className="detail-card"><div className="detail-heading"><div><span>BRIEFINGS</span><h3>Proactive intelligence</h3></div></div><p className="section-note">Briefings will use connected calendar, communications, projects and signals. No scheduled briefing is active yet.</p></section>;
    if (activeSection === 'permissions') {
      return <section className="detail-card"><div className="detail-heading"><div><span>PERMISSIONS</span><h3>Action policy</h3></div></div>{pendingAction ? <div className="memory-block"><span>PENDING {pendingAction.risk.toUpperCase()} ACTION</span><p>{pendingAction.action.summary}</p><p className="section-note">Say “approve action” to execute exactly this action, or “cancel action” to discard it.</p></div> : <p className="section-note">No action is waiting for approval.</p>}<div className="policy-list"><p><LockKeyhole size={16} /><span><strong>Read-only context</strong>May run when directly requested and relevant.</span></p><p><ShieldCheck size={16} /><span><strong>External writes</strong>Require explicit approval before execution.</span></p><p><ShieldCheck size={16} /><span><strong>Consequential actions</strong>Approval is cryptographically bound to the exact tool and arguments.</span></p></div>{lastActionResult && <div className="memory-block"><span>LAST ACTION</span><p>{lastActionResult}</p></div>}</section>;
    }
    return <section className="detail-card"><div className="detail-heading"><div><span>SYSTEM</span><h3>Live diagnostics</h3></div><button className="mini-button" onClick={() => void loadStatus()} aria-label="Refresh system"><RefreshCw size={15} /></button></div>{!status ? <p className="section-note">Open or refresh to read deployment status.</p> : <div className="status-list"><p><StateDot online={status.voice} /><span>Deepgram voice</span><b>{status.voice ? 'READY' : 'NOT CONFIGURED'}</b></p><p><StateDot online={status.reasoning} /><span>Reasoning</span><b>{status.reasoningProvider?.toUpperCase() || 'NOT CONFIGURED'}</b></p><p><StateDot online={Boolean(status.composio)} /><span>Composio actions</span><b>{status.composio ? 'READY' : 'NOT CONFIGURED'}</b></p><p><StateDot online={status.memory} /><span>Honcho memory</span><b>{status.memory ? 'READY' : 'OPTIONAL'}</b></p><p><StateDot online={status.securityMode === 'dedicated'} /><span>Session signing</span><b>{status.securityMode.toUpperCase()}</b></p><div className="model-note">Listen: {status.listenModel}<br />Voice: {status.voiceModel}</div></div>}</section>;
  }

  return <main className="luke-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <button className="profile-trigger" onClick={() => { setProfileOpen(true); void loadStatus(); }} aria-label="Open profile and system tools"><CircleUserRound size={24} /></button>
    <section className="voice-stage" aria-label="LUKE voice interface"><button className={`hud ${voice.isActive ? 'is-active' : ''} ${voice.isSpeaking ? 'is-speaking' : ''}`} onClick={toggleVoice} aria-label={voice.isActive ? 'Stop LUKE voice session' : 'Activate LUKE voice session'}><span className="hud-halo" /><span className="hud-ring ring-outer" /><span className="hud-ring ring-arc-a" /><span className="hud-ring ring-arc-b" /><span className="hud-ring ring-ticks" /><span className="hud-ring ring-inner" /><span className="hud-center"><span className="voice-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span><strong>LUKE</strong><span className="voice-state"><Mic size={14} />{stateLabel}</span></span></button><div className={`active-state ${voice.isActive ? 'online' : ''}`}><i /><span>{activeLabel}</span></div>{voiceError && <p className="voice-error">{voiceError}</p>}</section>
    <p className="system-signature">ELP GPT</p>
    {profileOpen && <div className="profile-backdrop" role="presentation" onClick={() => setProfileOpen(false)}><aside className="profile-panel" role="dialog" aria-modal="true" aria-label="Profile and system" onClick={(event) => event.stopPropagation()}><header className="profile-header"><div><p>ELP GPT</p><h2>Profile & System</h2></div><button className="close-button" onClick={() => setProfileOpen(false)} aria-label="Close profile"><X size={21} /></button></header><section className="profile-identity"><div className="profile-avatar"><CircleUserRound size={30} /></div><div><strong>LUKE environment</strong><span>Secure voice intelligence profile</span></div><div className="profile-online"><i /> {voice.isActive ? 'Live' : 'Ready'}</div></section><nav className="system-menu" aria-label="LUKE system tools">{systemItems.map((item) => <button key={item.key} className={`system-row ${activeSection === item.key ? 'active' : ''}`} onClick={() => openSection(item.key)}><span className="system-row-icon"><SystemIcon kind={item.icon} /></span><span className="system-row-copy"><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronRight size={18} /></button>)}</nav>{renderSection()}<section className="engine-card"><div className="engine-title"><Radio size={17} /><span>Core engines</span></div><div className="engine-grid"><span>Deepgram <StateDot online={Boolean(status?.voice)} /></span><span>Composio <StateDot online={Boolean(status?.composio)} /></span><span>Hermes <StateDot online={Boolean(status?.hermes)} /></span><span>Together AI <StateDot online={Boolean(status?.together)} /></span><span>Honcho <StateDot online={Boolean(status?.memory)} /></span></div></section>{latestVoice && <section className="recent-voice"><span>{latestVoice.role === 'user' ? 'LAST HEARD' : 'LAST RESPONSE'}</span><p>{latestVoice.content}</p></section>}<p className="profile-footnote">Say “LUKE, open memory”, “show system status”, or ask LUKE to use a connected app.</p></aside></div>}
  </main>;
}
