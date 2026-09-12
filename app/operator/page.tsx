'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, LoaderCircle, Mic, MicOff, Play, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import './operator.css';

type ActionRisk = 'read' | 'write' | 'high';
type OperatorTraceEntry = {
  step: number;
  kind: 'discover' | 'read' | 'approval' | 'result' | 'ask' | 'error';
  summary: string;
  toolSlug?: string;
  risk?: ActionRisk;
};
type OperatorMissionState = {
  objective: string;
  iteration: number;
  discoveries: Array<{ query: string; toolkit?: string }>;
  observations: Array<{ toolSlug: string; summary: string; preview: string }>;
  trace: OperatorTraceEntry[];
};
type PendingOperatorAction = {
  toolSlug: string;
  arguments: Record<string, unknown>;
  summary: string;
  risk: 'write' | 'high';
};
type OperatorResult = {
  ok: boolean;
  status: 'completed' | 'approval_required' | 'needs_input' | 'blocked';
  objective: string;
  summary: string;
  state: OperatorMissionState;
  pendingAction?: PendingOperatorAction;
  question?: string;
  error?: string;
};

type PlannedAction = {
  action: {
    toolSlug: string;
    arguments: Record<string, unknown>;
    connectedAccountId?: string;
    summary: string;
  };
  risk: 'write' | 'high';
  proposalToken: string;
  policy: string;
};

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      start: () => void;
      stop: () => void;
      onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
      onend: (() => void) | null;
      onerror: (() => void) | null;
    };
  }
}

export default function OperatorPage() {
  const [sessionId, setSessionId] = useState('operator');
  const [objective, setObjective] = useState('');
  const [mission, setMission] = useState<OperatorResult | null>(null);
  const [pending, setPending] = useState<PlannedAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<InstanceType<NonNullable<Window['webkitSpeechRecognition']>> | null>(null);

  useEffect(() => {
    const existing = window.sessionStorage.getItem('luke-session-id');
    const id = existing || crypto.randomUUID();
    if (!existing) window.sessionStorage.setItem('luke-session-id', id);
    setSessionId(id);
    void fetch('/api/identity', { method: 'POST', cache: 'no-store' });
  }, []);

  const speak = useCallback((text: string) => {
    if (!('speechSynthesis' in window) || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 0.92;
    window.speechSynthesis.speak(utterance);
  }, []);

  const runMission = useCallback(async (args?: {
    state?: OperatorMissionState;
    resumeObservation?: { toolSlug: string; summary: string; result: unknown };
  }) => {
    const goal = objective.trim() || mission?.objective || '';
    if (!goal || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/operator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: goal,
          sessionId,
          state: args?.state || mission?.state || null,
          resumeObservation: args?.resumeObservation || null,
        }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as OperatorResult | null;
      if (!response.ok || !data) throw new Error(data?.error || 'JARBIS Operator did not return a valid result.');
      setMission(data);

      if (data.status === 'approval_required' && data.pendingAction) {
        const planResponse = await fetch('/api/actions/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            toolSlug: data.pendingAction.toolSlug,
            arguments: data.pendingAction.arguments,
            summary: data.pendingAction.summary,
          }),
          cache: 'no-store',
        });
        const plan = await planResponse.json().catch(() => null) as PlannedAction | null;
        if (!planResponse.ok || !plan?.proposalToken) throw new Error('Operator action could not be secured for approval.');
        setPending(plan);
        speak(`Approval required. ${data.pendingAction.summary}`);
      } else {
        setPending(null);
        speak(data.summary);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Operator mission failed.');
    } finally {
      setBusy(false);
    }
  }, [busy, mission, objective, sessionId, speak]);

  const approve = useCallback(async () => {
    if (!pending || !mission || busy) return;
    setBusy(true);
    setError(null);
    try {
      const approvalResponse = await fetch('/api/actions/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalToken: pending.proposalToken, sessionId }),
        cache: 'no-store',
      });
      const approval = await approvalResponse.json().catch(() => null) as { executionToken?: string; error?: string } | null;
      if (!approvalResponse.ok || !approval?.executionToken) throw new Error(approval?.error || 'Approval failed.');

      const executeResponse = await fetch('/api/actions/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: approval.executionToken,
          sessionId,
          toolSlug: pending.action.toolSlug,
          arguments: pending.action.arguments,
          connectedAccountId: pending.action.connectedAccountId,
        }),
        cache: 'no-store',
      });
      const executed = await executeResponse.json().catch(() => null) as { ok?: boolean; result?: unknown; error?: string } | null;
      if (!executeResponse.ok || executed?.ok === false) throw new Error(executed?.error || 'Approved action failed.');

      const previousState = mission.state;
      const resumeObservation = {
        toolSlug: pending.action.toolSlug,
        summary: pending.action.summary,
        result: executed?.result,
      };
      setPending(null);
      setBusy(false);
      await runMission({ state: previousState, resumeObservation });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Approved action failed.');
      setBusy(false);
    }
  }, [busy, mission, pending, runMission, sessionId]);

  const reject = useCallback(() => {
    setPending(null);
    setMission((current) => current ? { ...current, status: 'blocked', summary: 'Mission paused because the proposed external action was not approved.' } : current);
    speak('Understood, Sir. The action was not executed and the mission is paused.');
  }, [speak]);

  const toggleVoice = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Recognition = window.webkitSpeechRecognition;
    if (!Recognition) {
      setError('Browser speech recognition is not available here. Use the mission text box instead.');
      return;
    }
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) setObjective(transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setError('Voice capture failed. Check microphone permission or type the mission.');
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setError(null);
  }, [listening]);

  const trace = mission?.state?.trace || [];

  return <main className="operator-shell">
    <header className="operator-header">
      <Link href="/" className="operator-back"><ArrowLeft size={17} /> LUKE</Link>
      <div><span>ELP GPT</span><h1>JARBIS Operator</h1></div>
      <div className="operator-live"><i /> EXECUTION LAYER</div>
    </header>

    <section className="operator-command">
      <div className="operator-command-label"><span>COMMANDER&apos;S INTENT</span><strong>State the outcome. JARBIS plans the work.</strong></div>
      <textarea
        value={objective}
        onChange={(event) => setObjective(event.target.value)}
        placeholder="Example: Review my important unread email, identify anything that needs action today, check my calendar for conflicts, and prepare what I should do next."
        disabled={busy}
      />
      <div className="operator-controls">
        <button className={listening ? 'voice active' : 'voice'} onClick={toggleVoice} disabled={busy}>
          {listening ? <MicOff size={17} /> : <Mic size={17} />}{listening ? 'Listening' : 'Voice'}
        </button>
        <button className="launch" onClick={() => void runMission()} disabled={!objective.trim() || busy || Boolean(pending)}>
          {busy ? <LoaderCircle size={17} className="spin" /> : <Play size={17} />} {mission ? 'Continue Mission' : 'Run Mission'}
        </button>
      </div>
    </section>

    {error && <section className="operator-error">{error}</section>}

    {pending && <section className="approval-card">
      <div className="approval-icon"><ShieldCheck size={23} /></div>
      <div className="approval-copy">
        <span>{pending.risk.toUpperCase()} ACTION — APPROVAL REQUIRED</span>
        <h2>{pending.action.summary}</h2>
        <p>{pending.policy}</p>
        <code>{pending.action.toolSlug}</code>
      </div>
      <div className="approval-actions">
        <button className="reject" onClick={reject} disabled={busy}><X size={16} /> Reject</button>
        <button className="approve" onClick={() => void approve()} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} Approve</button>
      </div>
    </section>}

    <section className="operator-grid">
      <article className="operator-panel result-panel">
        <span className="panel-kicker">MISSION STATUS</span>
        <h2>{mission ? mission.status.replaceAll('_', ' ').toUpperCase() : 'STANDBY'}</h2>
        <p>{mission?.summary || 'JARBIS Operator can autonomously research and read connected systems. External changes remain behind explicit approval.'}</p>
      </article>

      <article className="operator-panel trace-panel">
        <span className="panel-kicker">EXECUTION TRACE</span>
        {!trace.length && <p className="trace-empty">No mission steps yet.</p>}
        <div className="trace-list">{trace.map((item, index) => <div className={`trace-row kind-${item.kind}`} key={`${index}-${item.step}-${item.summary}`}>
          <b>{String(item.step).padStart(2, '0')}</b>
          <span><small>{item.kind.toUpperCase()}{item.toolSlug ? ` · ${item.toolSlug}` : ''}</small>{item.summary}</span>
        </div>)}</div>
      </article>
    </section>

    <footer className="operator-footer">READS MAY RUN AUTONOMOUSLY · WRITES REQUIRE APPROVAL · CONSEQUENT ACTIONS REMAIN CRYPTOGRAPHICALLY BOUND</footer>
  </main>;
}
