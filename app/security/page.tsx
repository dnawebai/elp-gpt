'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Fingerprint, LockKeyhole, RefreshCw, ShieldAlert, ShieldCheck, Siren, UserRoundX } from 'lucide-react';

type Severity = 'high' | 'critical';
type Finding = { key: string; severity: Severity; title: string; summary: string; recommendedAction: string; subjectId?: string };
type Incident = { id: string; detectionKey: string; severity: Severity; status: 'open' | 'monitoring' | 'resolved'; title: string; summary: string; recommendedAction: string; subjectId?: string; createdAt: string; updatedAt: string };
type EventRecord = { id: string; createdAt: string; category: string; action: string; outcome: string; severity: string; actorPrincipalId?: string; subjectId?: string; sessionId?: string; detail?: string; hash: string; prevHash: string };
type Session = { id: string; principalId: string; assurance: string; createdAt: string; expiresAt: string; lastSeenAt?: string; clientFingerprint?: string };
type Snapshot = {
  generatedAt: string;
  configured: boolean;
  posture: 'normal' | 'elevated' | 'critical';
  integrity: { ok: boolean; checked: number; anchored: boolean; reason?: string; headHash?: string };
  findings: Finding[];
  incidents: Incident[];
  recentEvents: EventRecord[];
  activeSessions: Session[];
  stats: { principals: number; activeSessions: number; activePasskeys: number; activeDevices: number; recentDeniedEvents: number; openIncidents: number };
};

const panel: React.CSSProperties = { background: '#091725', border: '1px solid #1d3c56', borderRadius: 14, padding: 16 };
const button: React.CSSProperties = { background: '#10273a', border: '1px solid #315676', borderRadius: 9, color: '#e9f5ff', padding: '9px 12px', cursor: 'pointer', display: 'inline-flex', gap: 7, alignItems: 'center' };
const dangerButton: React.CSSProperties = { ...button, border: '1px solid #81404d', background: '#2b1319', color: '#ffd5dc' };

function tone(value: string) {
  if (value === 'critical') return '#ff8798';
  if (value === 'elevated' || value === 'high' || value === 'denied' || value === 'failure') return '#ffc36d';
  if (value === 'success' || value === 'normal') return '#79e1b7';
  return '#91aabd';
}

export default function SecurityOperationsPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setBusy('load'); setError('');
    try {
      await fetch('/api/identity', { method: 'POST', cache: 'no-store' });
      const response = await fetch('/api/security-operations', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load security operations.');
      setData(payload);
    } catch (value) { setError(value instanceof Error ? value.message : 'Could not load security operations.'); }
    finally { setBusy(''); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (action: string, input: Record<string, unknown> = {}) => {
    setBusy(action); setError(''); setMessage('');
    try {
      const response = await fetch('/api/security-operations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...input }), cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Security operation failed.');
      if (payload.snapshot) setData(payload.snapshot);
      else await load();
      setMessage(action === 'scan' ? 'Security assessment refreshed.' : 'Security response completed.');
    } catch (value) { setError(value instanceof Error ? value.message : 'Security operation failed.'); }
    finally { setBusy(''); }
  }, [load]);

  async function lockdown(includeDevices: boolean) {
    const label = includeDevices ? 'all delegated sessions and companion devices' : 'all delegated sessions';
    if (!window.confirm(`Emergency lockdown will revoke ${label}. Continue?`)) return;
    await act('lockdown', { includeDevices });
  }

  async function revokeSession(sessionId: string) {
    if (!window.confirm('Revoke this delegated session now?')) return;
    await act('revoke-session', { sessionId });
  }

  const openIncidents = data?.incidents.filter((item) => item.status !== 'resolved') || [];

  return <main style={{ minHeight: '100vh', background: '#06111f', color: '#edf7ff', padding: 22, fontFamily: 'Inter,Arial,sans-serif' }}>
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <Link href="/passkeys" style={{ color: '#9ecbff', textDecoration: 'none', display: 'flex', gap: 7, alignItems: 'center' }}><ArrowLeft size={17}/> Passkey Security</Link>
          <div style={{ fontSize: 11, letterSpacing: 2, color: '#75a9d6', marginTop: 14 }}>ELP SECURITY OPERATIONS</div>
          <h1 style={{ margin: '5px 0', fontSize: 34 }}>Audit ledger & incident response</h1>
          <p style={{ margin: 0, color: '#91aabd', maxWidth: 820 }}>Verify the tamper-evident security chain, detect suspicious authentication and session patterns, and revoke delegated access behind a fresh passkey step-up.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={button} disabled={Boolean(busy)} onClick={() => void act('scan')}><RefreshCw size={15}/> Scan now</button>
          <button style={dangerButton} disabled={Boolean(busy)} onClick={() => void lockdown(false)}><Siren size={15}/> Revoke all sessions</button>
          <button style={dangerButton} disabled={Boolean(busy)} onClick={() => void lockdown(true)}><LockKeyhole size={15}/> Full lockdown</button>
        </div>
      </header>

      {error && <div style={{ padding: 12, border: '1px solid #78384a', background: '#2a1119', borderRadius: 10, color: '#ffd7df', marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ padding: 12, border: '1px solid #2e6b53', background: '#0a281e', borderRadius: 10, color: '#baf5da', marginBottom: 12 }}>{message}</div>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginBottom: 14 }}>
        <div style={panel}><ShieldCheck size={20} color={tone(data?.posture || 'normal')}/><div style={{ fontSize: 11, color: '#8ba7bd', marginTop: 8 }}>POSTURE</div><div style={{ fontSize: 23, fontWeight: 800, color: tone(data?.posture || 'normal'), textTransform: 'uppercase' }}>{data?.posture || '—'}</div></div>
        <div style={panel}><Fingerprint size={20}/><div style={{ fontSize: 11, color: '#8ba7bd', marginTop: 8 }}>AUDIT INTEGRITY</div><div style={{ fontSize: 23, fontWeight: 800, color: data?.integrity.ok ? '#79e1b7' : '#ff8798' }}>{data ? (data.integrity.ok ? 'VERIFIED' : 'FAILED') : '—'}</div><div style={{ fontSize: 11, color: '#6f8ca4' }}>{data?.integrity.checked ?? 0} events checked</div></div>
        <div style={panel}><ShieldAlert size={20}/><div style={{ fontSize: 11, color: '#8ba7bd', marginTop: 8 }}>OPEN INCIDENTS</div><div style={{ fontSize: 28, fontWeight: 800 }}>{data?.stats.openIncidents ?? 0}</div></div>
        <div style={panel}><UserRoundX size={20}/><div style={{ fontSize: 11, color: '#8ba7bd', marginTop: 8 }}>ACTIVE SESSIONS</div><div style={{ fontSize: 28, fontWeight: 800 }}>{data?.stats.activeSessions ?? 0}</div></div>
        <div style={panel}><LockKeyhole size={20}/><div style={{ fontSize: 11, color: '#8ba7bd', marginTop: 8 }}>PASSKEYS / DEVICES</div><div style={{ fontSize: 23, fontWeight: 800 }}>{data?.stats.activePasskeys ?? 0} / {data?.stats.activeDevices ?? 0}</div></div>
      </section>

      {!data?.integrity.ok && data && <section style={{ ...panel, borderColor: '#78384a', background: '#241218', marginBottom: 14 }}><b style={{ color: '#ff9aab' }}>Audit integrity warning</b><div style={{ color: '#d9a8b2', marginTop: 6 }}>{data.integrity.reason || 'The audit chain could not be verified.'}</div></section>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 14, alignItems: 'start', marginBottom: 14 }}>
        <div style={panel}>
          <h2 style={{ marginTop: 0 }}>Active findings</h2>
          {!data?.findings.length && <p style={{ color: '#829eb5' }}>No current high-severity findings.</p>}
          {data?.findings.map((item) => <div key={item.key} style={{ padding: '12px 0', borderBottom: '1px solid #183149' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><AlertTriangle size={16} color={tone(item.severity)}/><b>{item.title}</b><span style={{ color: tone(item.severity), fontSize: 11, textTransform: 'uppercase' }}>{item.severity}</span></div>
            <div style={{ fontSize: 13, color: '#a8bdcd', marginTop: 5 }}>{item.summary}</div>
            <div style={{ fontSize: 12, color: '#77a7ca', marginTop: 5 }}>{item.recommendedAction}</div>
          </div>)}
        </div>

        <div style={panel}>
          <h2 style={{ marginTop: 0 }}>Incidents</h2>
          {!openIncidents.length && <p style={{ color: '#829eb5' }}>No unresolved incidents.</p>}
          {openIncidents.map((item) => <div key={item.id} style={{ padding: '12px 0', borderBottom: '1px solid #183149' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><div><b>{item.title}</b><div style={{ fontSize: 11, color: tone(item.severity), textTransform: 'uppercase' }}>{item.severity} · {item.status}</div></div><button style={button} disabled={Boolean(busy)} onClick={() => void act('resolve-incident', { incidentId: item.id })}>Resolve</button></div>
            <div style={{ fontSize: 12, color: '#9db4c5', marginTop: 5 }}>{item.summary}</div>
          </div>)}
        </div>
      </section>

      <section style={{ ...panel, marginBottom: 14 }}>
        <h2 style={{ marginTop: 0 }}>Delegated sessions</h2>
        {!data?.activeSessions.length && <p style={{ color: '#829eb5' }}>No active delegated sessions.</p>}
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}><thead><tr style={{ color: '#829eb5', textAlign: 'left', fontSize: 11 }}><th style={{ padding: '8px 6px' }}>Principal</th><th>Assurance</th><th>Created</th><th>Last seen</th><th>Client fingerprint</th><th></th></tr></thead><tbody>{data?.activeSessions.map((item) => <tr key={item.id} style={{ borderTop: '1px solid #183149', fontSize: 12 }}><td style={{ padding: '10px 6px' }}>{item.principalId}</td><td>{item.assurance}</td><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString() : '—'}</td><td style={{ fontFamily: 'monospace', color: '#7e9bb2' }}>{item.clientFingerprint || '—'}</td><td><button style={dangerButton} disabled={Boolean(busy)} onClick={() => void revokeSession(item.id)}>Revoke</button></td></tr>)}</tbody></table></div>
      </section>

      <section style={panel}>
        <h2 style={{ marginTop: 0 }}>Tamper-evident security ledger</h2>
        {!data?.recentEvents.length && <p style={{ color: '#829eb5' }}>No security events have been recorded yet.</p>}
        {data?.recentEvents.slice(0, 60).map((item) => <div key={item.id} style={{ padding: '10px 0', borderBottom: '1px solid #183149', display: 'grid', gridTemplateColumns: '170px minmax(0,1fr) 90px', gap: 10, alignItems: 'start' }}>
          <div style={{ fontSize: 11, color: '#6f8ca4' }}>{new Date(item.createdAt).toLocaleString()}</div>
          <div><b style={{ fontSize: 13 }}>{item.action}</b><div style={{ fontSize: 11, color: '#8ca6b9' }}>{item.category}{item.actorPrincipalId ? ` · ${item.actorPrincipalId}` : ''}{item.detail ? ` · ${item.detail}` : ''}</div><div style={{ fontFamily: 'monospace', fontSize: 10, color: '#55748d', marginTop: 3 }}>{item.hash.slice(0, 24)}…</div></div>
          <div style={{ color: tone(item.outcome === 'success' ? item.severity : item.outcome), fontSize: 11, textTransform: 'uppercase' }}>{item.outcome}</div>
        </div>)}
      </section>
    </div>
  </main>;
}
