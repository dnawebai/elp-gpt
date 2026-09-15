'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LoaderCircle, ShieldAlert, X } from 'lucide-react';

type Continuation = {
  id: string;
  summary: string;
  toolSlug: string;
  risk: 'read' | 'write' | 'high';
  status: 'pending' | 'executed' | 'rejected' | 'failed' | 'expired';
  source: 'agent';
  sourceRunId?: string;
  createdAt: string;
  expiresAt: string;
};

type ApprovalSnapshot = {
  continuations?: Continuation[];
  resumablePending?: number;
};

const shell: React.CSSProperties = {
  position: 'fixed',
  right: 18,
  bottom: 82,
  zIndex: 120,
  fontFamily: 'Inter, Arial, sans-serif',
};

const button: React.CSSProperties = {
  border: '1px solid #315874',
  background: '#0b2133',
  color: '#ecf8ff',
  borderRadius: 999,
  padding: '10px 14px',
  cursor: 'pointer',
  display: 'inline-flex',
  gap: 8,
  alignItems: 'center',
  boxShadow: '0 12px 36px rgba(0,0,0,.35)',
};

export default function ApprovalPresence() {
  const [snapshot, setSnapshot] = useState<ApprovalSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const pending = useMemo(
    () => (snapshot?.continuations || []).filter((item) => item.status === 'pending'),
    [snapshot],
  );

  const load = useCallback(async () => {
    try {
      await fetch('/api/identity', { method: 'POST', cache: 'no-store' }).catch(() => undefined);
      const response = await fetch('/api/approvals', { cache: 'no-store' });
      if (!response.ok) return;
      setSnapshot(await response.json() as ApprovalSnapshot);
    } catch {
      // Presence is fail-soft; the dedicated Approval Center remains available.
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30_000);
    const onFocus = () => void load();
    const onVisibility = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  async function continueApproval(item: Continuation, action: 'approve' | 'reject') {
    setBusy(`${action}-${item.id}`);
    setError('');
    try {
      const response = await fetch('/api/approvals/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ continuationId: item.id, action }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({ error: 'Approval returned an invalid response.' })) as { error?: string };
      if (!response.ok) throw new Error(data.error || `Could not ${action} approval.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval action failed.');
    } finally {
      setBusy('');
    }
  }

  if (!pending.length) return null;

  return (
    <div style={shell} aria-live="polite">
      {open ? (
        <section style={{ width: 'min(420px, calc(100vw - 28px))', maxHeight: '65vh', overflow: 'auto', border: '1px solid #274b67', background: '#071523', color: '#edf8ff', borderRadius: 18, padding: 14, boxShadow: '0 18px 54px rgba(0,0,0,.5)' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10 }}>
            <div><div style={{ fontSize: 11, letterSpacing: 1.6, color: '#7fb8e5' }}>ELP APPROVAL PRESENCE</div><strong>{pending.length} action{pending.length === 1 ? '' : 's'} waiting</strong></div>
            <button onClick={() => setOpen(false)} aria-label="Close approvals" style={{ ...button, padding: 7 }}><X size={15} /></button>
          </header>
          {error ? <div style={{ border: '1px solid #713746', background: '#2a1119', color: '#ffd7de', padding: 9, borderRadius: 10, marginBottom: 10 }}>{error}</div> : null}
          <div style={{ display: 'grid', gap: 10 }}>
            {pending.slice(0, 8).map((item) => (
              <article key={item.id} style={{ border: '1px solid #1d3c56', background: '#0a1b2a', borderRadius: 13, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <strong style={{ fontSize: 14 }}>{item.summary}</strong>
                  <span style={{ fontSize: 10, textTransform: 'uppercase', color: item.risk === 'high' ? '#ff9eab' : '#ffd076' }}>{item.risk}</span>
                </div>
                <div style={{ marginTop: 7, fontSize: 11, color: '#96b6cd', overflowWrap: 'anywhere' }}>{item.toolSlug}</div>
                <div style={{ marginTop: 5, fontSize: 11, color: '#708fa7' }}>
                  {item.sourceRunId ? `AGI run ${item.sourceRunId.slice(0, 12)} · ` : ''}expires {new Date(item.expiresAt).toLocaleString()}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  <button disabled={Boolean(busy)} onClick={() => void continueApproval(item, 'approve')} style={button}>
                    {busy === `approve-${item.id}` ? <LoaderCircle size={14} /> : <CheckCircle2 size={14} />} Approve & execute
                  </button>
                  <button disabled={Boolean(busy)} onClick={() => void continueApproval(item, 'reject')} style={{ ...button, background: '#20131a', borderColor: '#633243' }}>
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
          <a href="/approvals" style={{ display: 'inline-block', marginTop: 12, color: '#9ed0ff', fontSize: 12 }}>Open full Approval Center →</a>
        </section>
      ) : (
        <button onClick={() => setOpen(true)} style={button} aria-label={`${pending.length} pending approvals`}>
          <ShieldAlert size={17} /> Approvals <strong>{pending.length}</strong>
        </button>
      )}
    </div>
  );
}
