'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ExternalLink, Link2, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Unplug, XCircle } from 'lucide-react';
import Link from 'next/link';
import './connections.css';

type Risk = 'read' | 'write' | 'high';
type Policy = {
  slug: string;
  label: string;
  description: string;
  risk: Risk;
  read: boolean;
  write: boolean;
  approval: 'none' | 'required';
};
type Account = {
  id: string;
  toolkit: string;
  label: string;
  alias: string | null;
  userId: string | null;
  status: string;
  disabled: boolean;
  authScheme: string | null;
  accountType: string;
  createdAt: string | null;
  updatedAt: string | null;
  source: 'profile' | 'owner-binding';
  risk: Risk;
  read: boolean;
  write: boolean;
  approval: 'none' | 'required';
};
type Payload = {
  configured: boolean;
  providerReady: boolean;
  providerError: string | null;
  accounts: Account[];
  policies: Policy[];
  profileId: string;
};

function statusClass(account: Account) {
  if (account.disabled) return 'disabled';
  return account.status.toLowerCase() === 'active' ? 'active' : 'pending';
}

function riskLabel(risk: Risk) {
  if (risk === 'high') return 'HIGH IMPACT';
  if (risk === 'write') return 'WRITE CAPABLE';
  return 'READ ONLY';
}

export default function ConnectionsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch('/api/connections', { cache: 'no-store' });
    const payload = await response.json().catch(() => null) as Payload | { error?: string } | null;
    if (!response.ok || !payload || !('accounts' in payload)) {
      setError(payload && 'error' in payload ? payload.error || 'Could not load connections.' : 'Could not load connections.');
      return;
    }
    setData(payload);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    if (connected) setNotice(`${connected} authentication returned to ELP. Verifying account status…`);
    void fetch('/api/identity', { method: 'POST', cache: 'no-store' }).then(() => load());
  }, [load]);

  const accountsByToolkit = useMemo(() => {
    const map = new Map<string, Account[]>();
    for (const account of data?.accounts || []) {
      const list = map.get(account.toolkit) || [];
      list.push(account);
      map.set(account.toolkit, list);
    }
    return map;
  }, [data]);

  const connect = useCallback(async (toolkit: string) => {
    setBusy(`connect:${toolkit}`);
    setError(null);
    try {
      const response = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolkit }),
      });
      const payload = await response.json().catch(() => null) as { redirectUrl?: string; error?: string } | null;
      if (!response.ok || !payload?.redirectUrl) throw new Error(payload?.error || 'Could not start authentication.');
      window.location.assign(payload.redirectUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start authentication.');
      setBusy(null);
    }
  }, []);

  const toggle = useCallback(async (account: Account) => {
    const enabled = account.disabled;
    setBusy(`toggle:${account.id}`);
    setError(null);
    try {
      const response = await fetch('/api/connections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: account.id, enabled }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || 'Could not update connection.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update connection.');
    } finally {
      setBusy(null);
    }
  }, [load]);

  return <main className="connections-shell">
    <header className="connections-header">
      <div>
        <Link href="/" className="connections-back"><ArrowLeft size={17} /> ELP</Link>
        <p className="connections-kicker">ELP CONTROL PLANE</p>
        <h1>Connected Accounts</h1>
        <p>Authorize the services ELP may use on your behalf. Read access can support your requests; every external write remains subject to ELP&apos;s approval policy.</p>
      </div>
      <button className="connections-refresh" onClick={() => void load()} aria-label="Refresh connections"><RefreshCw size={17} /> Refresh</button>
    </header>

    <section className="connection-principles">
      <div><ShieldCheck size={20} /><span><strong>Least privilege</strong>Only connected services and allowed toolkits are eligible for execution.</span></div>
      <div><LockKeyhole size={20} /><span><strong>Approval boundary</strong>Messages, event changes and other writes still require explicit approval.</span></div>
      <div><CheckCircle2 size={20} /><span><strong>Verified execution</strong>ELP records completion only after a connected tool returns a result.</span></div>
    </section>

    {notice && <p className="connections-notice">{notice}</p>}
    {error && <p className="connections-error">{error}</p>}
    {data && !data.providerReady && <p className="connections-error">{data.providerError || 'Connected account provider is unavailable.'}</p>}

    <section className="connections-grid">
      {(data?.policies || []).map((policy) => {
        const accounts = accountsByToolkit.get(policy.slug) || [];
        const active = accounts.filter((item) => item.status.toLowerCase() === 'active' && !item.disabled);
        return <article className="connection-card" key={policy.slug}>
          <div className="connection-card-head">
            <div className="connection-icon"><Link2 size={20} /></div>
            <div><h2>{policy.label}</h2><p>{policy.description}</p></div>
            <span className={`connection-risk risk-${policy.risk}`}>{riskLabel(policy.risk)}</span>
          </div>

          <div className="connection-scope-row">
            <span className={policy.read ? 'on' : ''}>READ {policy.read ? '✓' : '—'}</span>
            <span className={policy.write ? 'on' : ''}>WRITE {policy.write ? '✓' : '—'}</span>
            <span>APPROVAL {policy.approval === 'required' ? 'REQUIRED' : 'NONE'}</span>
          </div>

          {accounts.length ? <div className="account-list">{accounts.map((account) => <div className="account-row" key={account.id}>
            <div className={`account-status ${statusClass(account)}`}>{account.disabled ? <XCircle size={15} /> : account.status.toLowerCase() === 'active' ? <CheckCircle2 size={15} /> : <LoaderCircle size={15} />}</div>
            <div className="account-copy">
              <strong>{account.alias || account.label}</strong>
              <span>{account.status}{account.disabled ? ' · DISABLED' : ''} · {account.source === 'profile' ? 'THIS PROFILE' : 'OWNER FALLBACK'} · {account.accountType}</span>
              {account.authScheme && <small>{account.authScheme}</small>}
            </div>
            <button className="account-toggle" onClick={() => void toggle(account)} disabled={!data?.providerReady || busy === `toggle:${account.id}`}>
              {busy === `toggle:${account.id}` ? <LoaderCircle size={15} /> : account.disabled ? <ExternalLink size={15} /> : <Unplug size={15} />}
              {account.disabled ? 'Enable' : 'Disable'}
            </button>
          </div>)}</div> : <p className="connection-empty">No account connected to this ELP profile.</p>}

          <div className="connection-card-actions">
            <button className="connect-button" onClick={() => void connect(policy.slug)} disabled={!data?.providerReady || busy === `connect:${policy.slug}`}>
              {busy === `connect:${policy.slug}` ? <LoaderCircle size={16} /> : <Link2 size={16} />}
              {active.length ? 'Connect another' : 'Connect'}
            </button>
            <span>{active.length} active</span>
          </div>
        </article>;
      })}
    </section>

    <section className="connections-footer-card">
      <h2>Execution precedence</h2>
      <p>ELP uses an explicitly selected account first, then an active connection owned by this profile, then the existing private-owner binding for autonomous jobs. This preserves your current setup while moving toward per-user account isolation.</p>
    </section>
  </main>;
}
