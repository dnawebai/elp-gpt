'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowLeft, Bell, Check, RefreshCw, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import './notifications.css';

type NotificationRecord = {
  id: string;
  kind: 'approval' | 'failure' | 'risk' | 'opportunity' | 'deadline' | 'relationship' | 'task' | 'completion' | 'system';
  severity: 'critical' | 'high' | 'normal' | 'low';
  status: 'unread' | 'read' | 'dismissed' | 'resolved';
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

type DeliveryPreferences = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  voiceEnabled: boolean;
  email?: string;
  phone?: string;
  whatsapp?: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone: string;
};

type DeliverySnapshot = {
  preferences: DeliveryPreferences;
  push: { configured: boolean; publicKey: string | null; subscriptions: number };
  providers: { email: boolean; sms: boolean; whatsapp: boolean; voice: boolean };
  recentAttempts: Array<{ id: string; channel: string; status: string; createdAt: string; detail?: string }>;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export default function NotificationsPage() {
  const [center, setCenter] = useState<NotificationCenter | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [delivery, setDelivery] = useState<DeliverySnapshot | null>(null);
  const [prefs, setPrefs] = useState<DeliveryPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [notificationResponse, healthResponse, deliveryResponse] = await Promise.all([
      fetch('/api/notifications', { cache: 'no-store' }),
      fetch('/api/operations-health', { cache: 'no-store' }),
      fetch('/api/notification-delivery', { cache: 'no-store' }),
    ]);
    const notificationData = await notificationResponse.json().catch(() => null) as NotificationCenter | { error?: string } | null;
    const healthData = await healthResponse.json().catch(() => null) as Health | { error?: string } | null;
    const deliveryData = await deliveryResponse.json().catch(() => null) as DeliverySnapshot | { error?: string } | null;
    if (!notificationResponse.ok || !notificationData || !('notifications' in notificationData)) {
      setError(notificationData && 'error' in notificationData ? notificationData.error || 'Could not load notifications.' : 'Could not load notifications.');
      return;
    }
    setCenter(notificationData);
    if (healthResponse.ok && healthData && 'services' in healthData) setHealth(healthData);
    if (deliveryResponse.ok && deliveryData && 'preferences' in deliveryData) {
      setDelivery(deliveryData);
      setPrefs(deliveryData.preferences);
    }
  }, []);

  useEffect(() => {
    void fetch('/api/identity', { method: 'POST', cache: 'no-store' }).then(() => load());
  }, [load]);

  const refresh = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
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
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Could not update notification.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update notification.');
    } finally { setBusy(false); }
  }, [load]);

  const savePreferences = useCallback(async () => {
    if (!prefs) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/notification-delivery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preferences', preferences: prefs }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Could not save delivery preferences.');
      setMessage('Delivery preferences saved.');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save delivery preferences.'); }
    finally { setBusy(false); }
  }, [load, prefs]);

  const enablePush = useCallback(async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      if (!delivery?.push.configured || !delivery.push.publicKey) throw new Error('Web Push VAPID keys are not configured on this deployment.');
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser does not support Web Push.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted.');
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(delivery.push.publicKey) });
      }
      const response = await fetch('/api/notification-delivery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'subscribe_push', subscription: subscription.toJSON() }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Could not register push subscription.');
      setPrefs((current) => current ? { ...current, pushEnabled: true } : current);
      setMessage('Web Push enabled on this device.');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not enable Web Push.'); }
    finally { setBusy(false); }
  }, [delivery, load]);

  const deliverNow = useCallback(async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/notification-delivery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deliver_now' }),
      });
      const data = await response.json().catch(() => null) as { error?: string; attempted?: number; sent?: number; failed?: number } | null;
      if (!response.ok) throw new Error(data?.error || 'Could not run delivery.');
      setMessage(`Delivery run: ${data?.sent || 0} sent, ${data?.failed || 0} failed, ${data?.attempted || 0} attempted.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not run delivery.'); }
    finally { setBusy(false); }
  }, [load]);

  const visible = center?.notifications.filter((item) => item.status === 'unread' || item.status === 'read') || [];
  return <main className="nt-shell">
    <header className="nt-header">
      <Link href="/command-center" className="nt-back"><ArrowLeft size={17} /> COMMAND CENTER</Link>
      <div><span>ELP</span><h1>Notifications & Delivery</h1></div>
      <button onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} /> Refresh</button>
    </header>

    {error && <section className="nt-error">{error}</section>}
    {message && <section className="nt-message">{message}</section>}

    <section className="nt-stats">
      <div><span>UNREAD</span><strong>{center?.stats.unread ?? 0}</strong></div>
      <div><span>CRITICAL</span><strong>{center?.stats.critical ?? 0}</strong></div>
      <div><span>HIGH</span><strong>{center?.stats.high ?? 0}</strong></div>
      <div><span>APPROVALS</span><strong>{center?.stats.approvals ?? 0}</strong></div>
      <div><span>FAILURES</span><strong>{center?.stats.failures ?? 0}</strong></div>
    </section>

    <section className="nt-delivery">
      <header><Send size={18} /><div><span>DELIVERY & ESCALATION</span><strong>How ELP reaches you</strong></div></header>
      {prefs && <div className="nt-delivery-body">
        <div className="nt-channel-grid">
          {(['push','email','sms','whatsapp','voice'] as const).map((channel) => {
            const key = `${channel}Enabled` as keyof DeliveryPreferences;
            const ready = channel === 'push' ? delivery?.push.configured : delivery?.providers[channel];
            return <label className="nt-toggle" key={channel}><input type="checkbox" checked={Boolean(prefs[key])} onChange={(event) => setPrefs({ ...prefs, [key]: event.target.checked })} /><span>{channel.toUpperCase()}</span><b className={ready ? 'ok' : 'down'}>{ready ? 'READY' : 'SETUP'}</b></label>;
          })}
        </div>
        <div className="nt-fields">
          <label>Email<input value={prefs.email || ''} onChange={(e) => setPrefs({ ...prefs, email: e.target.value })} placeholder="you@example.com" /></label>
          <label>Phone<input value={prefs.phone || ''} onChange={(e) => setPrefs({ ...prefs, phone: e.target.value })} placeholder="+1..." /></label>
          <label>WhatsApp<input value={prefs.whatsapp || ''} onChange={(e) => setPrefs({ ...prefs, whatsapp: e.target.value })} placeholder="+1..." /></label>
          <label>Timezone<input value={prefs.timezone} onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })} /></label>
          <label>Quiet from<input type="time" value={prefs.quietHoursStart || ''} onChange={(e) => setPrefs({ ...prefs, quietHoursStart: e.target.value })} /></label>
          <label>Quiet until<input type="time" value={prefs.quietHoursEnd || ''} onChange={(e) => setPrefs({ ...prefs, quietHoursEnd: e.target.value })} /></label>
        </div>
        <div className="nt-delivery-actions">
          <button onClick={() => void savePreferences()} disabled={busy}>Save delivery</button>
          <button onClick={() => void enablePush()} disabled={busy || !delivery?.push.configured}>Enable push on this device</button>
          <button onClick={() => void deliverNow()} disabled={busy}><Send size={14} /> Deliver priority alerts now</button>
          <small>{delivery?.push.subscriptions || 0} push device(s) · Critical alerts ignore quiet hours.</small>
        </div>
      </div>}
    </section>

    <section className="nt-grid">
      <article className="nt-feed">
        <header><Bell size={18} /><div><span>PRIORITY FEED</span><strong>What needs attention</strong></div></header>
        {!visible.length && <div className="nt-empty">No active notifications.</div>}
        {visible.map((item) => <div className={`nt-card nt-${item.severity} ${item.status === 'read' ? 'nt-read' : ''}`} key={item.id}>
          <div className="nt-card-top"><span>{item.severity.toUpperCase()} · {item.kind.toUpperCase()}</span><small>{new Date(item.lastSeenAt).toLocaleString()}</small></div>
          <h2>{item.title}</h2><p>{item.summary}</p>{item.action && <em>{item.action}</em>}
          <div className="nt-card-actions">
            {item.status === 'unread' && <button onClick={() => void update(item.id, 'read')} disabled={busy}><Check size={14} /> Mark read</button>}
            <button onClick={() => void update(item.id, 'dismissed')} disabled={busy}><Trash2 size={14} /> Dismiss</button>
            {item.occurrenceCount > 1 && <small>Seen {item.occurrenceCount} times</small>}
          </div>
        </div>)}
      </article>

      <aside className="nt-health">
        <header><Activity size={18} /><div><span>OPERATIONS HEALTH</span><strong>Runtime posture</strong></div></header>
        <div className="nt-service-list">{health && Object.entries(health.services).map(([name, ok]) => <div key={name}><span>{name.toUpperCase()}</span><b className={ok ? 'ok' : 'down'}>{ok ? 'READY' : 'MISSING'}</b></div>)}</div>
        <div className="nt-health-block"><span>SECURITY</span><strong>{health?.securityMode || 'unknown'}</strong></div>
        <div className="nt-health-block"><span>COMMAND CENTER</span><strong>{health ? `${health.queues.decisions || 0} decisions · ${health.queues.working || 0} working` : '—'}</strong></div>
        <div className="nt-health-block"><span>RECENT DELIVERY</span><strong>{delivery?.recentAttempts[0] ? `${delivery.recentAttempts[0].channel.toUpperCase()} · ${delivery.recentAttempts[0].status.toUpperCase()}` : 'No attempts yet'}</strong></div>
      </aside>
    </section>

    <footer className="nt-footer">Push · Email · SMS · WhatsApp · Voice escalation · In-app feed</footer>
  </main>;
}
