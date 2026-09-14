'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Fingerprint, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { registerElpPasskey } from '@/lib/passkey-client';

type Passkey = {
  id: string;
  label: string;
  transports: string[];
  credentialDeviceType?: string;
  credentialBackedUp?: boolean;
  createdAt: string;
  lastUsedAt?: string;
};

type Payload = { principal: { id: string; displayName: string }; passkeys: Passkey[]; supported: boolean };
const panel: React.CSSProperties = { background: '#091725', border: '1px solid #1d3c56', borderRadius: 14, padding: 16 };
const button: React.CSSProperties = { background: '#10273a', border: '1px solid #315676', borderRadius: 9, color: '#e9f5ff', padding: '9px 12px', cursor: 'pointer', display: 'inline-flex', gap: 7, alignItems: 'center' };
const input: React.CSSProperties = { background: '#06111f', border: '1px solid #294863', borderRadius: 8, color: '#e9f5ff', padding: '10px 11px', width: '100%' };

export default function PasskeysPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [label, setLabel] = useState('Mac passkey');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setBusy('load'); setError('');
    try {
      await fetch('/api/identity', { method: 'POST', cache: 'no-store' });
      const response = await fetch('/api/passkeys', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load passkeys.');
      setData(payload);
    } catch (value) { setError(value instanceof Error ? value.message : 'Could not load passkeys.'); }
    finally { setBusy(''); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function register() {
    setBusy('register'); setError(''); setMessage('');
    try {
      await registerElpPasskey(label.trim() || 'Passkey');
      setMessage('Passkey registered. High-risk ELP approvals can now require device biometric/passkey verification.');
      await load();
    } catch (value) { setError(value instanceof Error ? value.message : 'Passkey registration failed.'); }
    finally { setBusy(''); }
  }

  async function revoke(credentialId: string) {
    setBusy(`revoke-${credentialId}`); setError(''); setMessage('');
    try {
      const response = await fetch('/api/passkeys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', credentialId }), cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not revoke passkey.');
      setMessage('Passkey revoked.'); await load();
    } catch (value) { setError(value instanceof Error ? value.message : 'Could not revoke passkey.'); }
    finally { setBusy(''); }
  }

  return <main style={{ minHeight: '100vh', background: '#06111f', color: '#edf7ff', padding: 22, fontFamily: 'Inter,Arial,sans-serif' }}>
    <div style={{ maxWidth: 1060, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <Link href="/authority-sessions" style={{ color: '#9ecbff', textDecoration: 'none', display: 'flex', gap: 7, alignItems: 'center' }}><ArrowLeft size={17}/> Principal Sessions</Link>
          <div style={{ fontSize: 11, letterSpacing: 2, color: '#75a9d6', marginTop: 14 }}>ELP PASSKEY SECURITY</div>
          <h1 style={{ margin: '5px 0', fontSize: 34 }}>Passkeys & biometric step-up</h1>
          <p style={{ margin: 0, color: '#91aabd', maxWidth: 760 }}>Bind high-risk approvals to a passkey on your trusted device. ELP verifies the WebAuthn challenge, origin, relying party, user verification and authenticator counter before minting a short-lived step-up authorization.</p>
        </div>
        <button style={button} onClick={() => void load()}><RefreshCw size={15}/> Refresh</button>
      </header>

      {error && <div style={{ padding: 12, border: '1px solid #78384a', background: '#2a1119', borderRadius: 10, color: '#ffd7df', marginBottom: 12 }}>{error}</div>}
      {message && <div style={{ padding: 12, border: '1px solid #2e6b53', background: '#0a281e', borderRadius: 10, color: '#baf5da', marginBottom: 12 }}>{message}</div>}

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, marginBottom: 14 }}>
        <div style={panel}><ShieldCheck size={20}/><div style={{ fontSize: 12, color: '#8ba7bd', marginTop: 8 }}>CURRENT PRINCIPAL</div><div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{data?.principal.displayName || '—'}</div></div>
        <div style={panel}><Fingerprint size={20}/><div style={{ fontSize: 12, color: '#8ba7bd', marginTop: 8 }}>ACTIVE PASSKEYS</div><div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>{data?.passkeys.length ?? 0}</div></div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(280px,.8fr)', gap: 14, alignItems: 'start' }}>
        <div style={panel}>
          <h2 style={{ marginTop: 0 }}>Registered passkeys</h2>
          {!data?.passkeys.length && <p style={{ color: '#829eb5' }}>No passkey is registered yet. Until the first passkey is added, the owner keeps the existing recovery path.</p>}
          {data?.passkeys.map((item) => <div key={item.id} style={{ padding: '13px 0', borderBottom: '1px solid #183149', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div><b>{item.label}</b><div style={{ fontSize: 11, color: '#829eb5', marginTop: 4 }}>{item.credentialDeviceType || 'passkey'}{item.credentialBackedUp ? ' · backed up' : ''}{item.transports?.length ? ` · ${item.transports.join(', ')}` : ''}</div><div style={{ fontSize: 11, color: '#6f8ca4' }}>Added {new Date(item.createdAt).toLocaleString()}{item.lastUsedAt ? ` · last used ${new Date(item.lastUsedAt).toLocaleString()}` : ''}</div></div>
            <button style={button} disabled={busy === `revoke-${item.id}`} onClick={() => void revoke(item.id)}><Trash2 size={14}/> Revoke</button>
          </div>)}
        </div>

        <aside style={panel}>
          <KeyRound size={22}/><h2>Add a passkey</h2>
          <p style={{ fontSize: 12, color: '#91aabd' }}>Use Touch ID, Face ID, Windows Hello, a security key, or another WebAuthn authenticator supported by your browser.</p>
          <input style={input} value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} placeholder="Device label"/>
          <button style={{ ...button, marginTop: 9 }} disabled={busy === 'register'} onClick={() => void register()}><Fingerprint size={15}/> Register passkey</button>
          <p style={{ fontSize: 11, lineHeight: 1.5, color: '#6f8ca4', marginBottom: 0 }}>After a passkey is enrolled, high-risk action approval and protected authority changes require a fresh passkey assertion. The assertion expires after five minutes and is bound to the active principal/session.</p>
        </aside>
      </section>
    </div>
  </main>;
}
