'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowLeft, Bell, Check, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import './notifications.css';

type NotificationRecord = {
  id: string;
  kind: 'approval' | 'failure' | 'risk' | 'opportunity' | 'deadline' | 'relationship' | 'task' | 'completion' | 'system';
  severity: 'critical' | 'high' | 'normal' | 'low';
  status: 'unread' | 'read' | 'dismissed';
  title: string;
  summary: string;
  source: string;
  action?: string;
  createdAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
};

type NotificationCenter = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  notifications: NotificationRecord[];
  stats: { total: number; unread: number; critical: number; high: number; approvals: number; failures: number };
};

type Health = {
  ok: boolean;
  generatedAt: string;
  securityMode: string;
  services: Record<string, boolean>;
  queues: Record<string, number>;
  approvals: Record<string, number>;
  radar: Record<string, number>;
  relationships: Record<string, number>;
  notifications: Record<string, number>;
};

export default function NotificationsPage() {
  const [center, setCenter] = useState<NotificationCenter | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [notificationResponse, healthResponse] = await Promise.all([
      fetch('/api/notifications', { cache: 'no-store' }),
      fetch('/api/operations-health', { cache: 'no-store' }),
    ]);
    const notificationData = await notificationResponse.json().catch(() => null) as NotificationCenter | { error?: string } | null;
    const healthData = await healthResponse.json().catch(() => null) as Health | { error?: string } | null;
    if (!notificationResponse.ok || !notificationData || !('notifications' in notificationData)) {
      setError(notificationData && 'error' in notificationData ? notificationData.error || 'Could not load notifications.' : 'Could not load notifications.');
      return;
    }
    setCenter(notificationData);
    if (healthResponse.ok && healthData && 'services' in healthData) setHealth(healthData);
  }, []);

  useEffect(() => {
    void fetch('/api/identity', { method: 'POST', cache: 'no-store' }).then(() => load());
  }, [load]);

  const refresh = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/notifications', { method: 'POST' });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Could not refresh notifications.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not refresh notifications.');
    } finally {
      setBusy(false);
    }
  }, [busy, load]);

  const update = useCallback(async (id: string, status: 'read' | 'dismissed') => {
    setBusy(true);
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Could not update notification.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update notification.');
    } finally {
      setBusy(false);
    }
  }, [load]);

  const visible = center?.notifications.filter((item) => item.status !== 'dismissed') || [];
  return <main className="nt-shell">
    <header className="nt-header">
      <Link href="/command-center" className="nt-back"><ArrowLeft size={17} /> COMMAND CENTER</Link>
      <div><span>JARBIS</span><h1>Notifications & Health</h1></div>
      <button onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} /> Refresh</button>
    </header>

    {error && <section className="nt-error">{error}</section>}

    <section className="nt-stats">
      <div><span>UNREAD</span><strong>{center?.stats.unread ?? 0}</strong></div>
      <div><span>CRITICAL</span><strong>{center?.stats.critical ?? 0}</strong></div>
      <div><span>HIGH</span><strong>{center?.stats.high ?? 0}</strong></div>
      <div><span>APPROVALS</span><strong>{center?.stats.approvals ?? 0}</strong></div>
      <div><span>FAILURES</span><strong>{center?.stats.failures ?? 0}</strong></div>
    </section>

    <section className="nt-grid">
      <article className="nt-feed">
        <header><Bell size={18} /><div><span>PRIORITY FEED</span><strong>What needs attention</strong></div></header>
        {!visible.length && <div className="nt-empty">No active notifications.</div>}
        {visible.map((item) => <div className={`nt-card nt-${item.severity} ${item.status === 'read' ? 'nt-read' : ''}`} key={item.id}>
          <div className="nt-card-top"><span>{item.severity.toUpperCase()} · {item.kind.toUpperCase()}</span><small>{new Date(item.lastSeenAt).toLocaleString()}</small></div>
          <h2>{item.title}</h2>
          <p>{item.summary}</p>
          {item.action && <em>{item.action}</em>}
          <div className="nt-card-actions">
            {item.status === 'unread' && <button onClick={() => void update(item.id, 'read')} disabled={busy}><Check size={14} /> Mark read</button>}
            <button onClick={() => void update(item.id, 'dismissed')} disabled={busy}><Trash2 size={14} /> Dismiss</button>
            {item.occurrenceCount > 1 && <small>Seen {item.occurrenceCount} times</small>}
          </div>
        </div>)}
      </article>

      <aside className="nt-health">
        <header><Activity size={18} /><div><span>OPERATIONS HEALTH</span><strong>Runtime posture</strong></div></header>
        <div className="nt-service-list">
          {health && Object.entries(health.services).map(([name, ok]) => <div key={name}><span>{name.toUpperCase()}</span><b className={ok ? 'ok' : 'down'}>{ok ? 'READY' : 'MISSING'}</b></div>)}
        </div>
        <div className="nt-health-block"><span>SECURITY</span><strong>{health?.securityMode || 'unknown'}</strong></div>
        <div className="nt-health-block"><span>COMMAND CENTER</span><strong>{health ? `${health.queues.decisions || 0} decisions · ${health.queues.working || 0} working` : '—'}</strong></div>
        <div className="nt-health-block"><span>RADAR</span><strong>{health ? `${health.radar.critical || 0} critical · ${health.radar.high || 0} high` : '—'}</strong></div>
        <div className="nt-health-block"><span>RELATIONSHIPS</span><strong>{health ? `${health.relationships.cooling || 0} cooling · ${health.relationships.stalled || 0} stalled` : '—'}</strong></div>
      </aside>
    </section>

    <footer className="nt-footer">Approvals · Failures · Risks · Opportunities · Deadlines · Relationships · Tasks</footer>
  </main>;
}
