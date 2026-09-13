'use client';

import { useEffect, useState } from 'react';

type CapacityProfile = {
  weeklyHours: number;
  reservePercent: number;
  adminPercent: number;
  maxConcurrentObjectives: number;
  defaultTaskHours: number;
  timezone: string;
};

type CapacityPlan = {
  generatedAt: string;
  status: string;
  grossCapacityHours: number;
  reserveHours: number;
  adminHours: number;
  calendarBusyHours: number;
  executionCapacityHours: number;
  estimatedDemandHours: number;
  capacityGapHours: number;
  loadRatio: number;
  calendar: { available: boolean; eventCount: number; busyHours: number; horizonDays: number; note?: string };
  recommendations: Array<{ id: string; action: string; title: string; reason: string; estimatedHoursRecovered?: number; confidence: number; requiresApproval: boolean }>;
  demand: Array<{ id: string; source: string; title: string; owner?: string; priority: string; estimatedHours: number; reason: string; dueDate?: string }>;
  stats: Record<string, number>;
};

type Payload = { ok: boolean; profile: CapacityProfile; plan: CapacityPlan | null };

const card: React.CSSProperties = { border: '1px solid #263248', borderRadius: 16, padding: 18, background: '#101827' };
const input: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#0b1220', color: '#e5edf7' };

export default function ResourceCapacityPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<CapacityProfile | null>(null);

  async function load() {
    setError('');
    const response = await fetch('/api/resource-capacity', { cache: 'no-store' });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'Capacity data failed.');
    setData(json);
    setProfile(json.profile);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function run() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/resource-capacity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run', horizonDays: 7, createRecoveryTasks: true }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Planner failed.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Planner failed.'); }
    finally { setBusy(false); }
  }

  async function saveProfile() {
    if (!profile) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/resource-capacity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-profile', ...profile }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Profile save failed.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Profile save failed.'); }
    finally { setBusy(false); }
  }

  const plan = data?.plan;
  return <main style={{ minHeight: '100vh', background: '#07101d', color: '#e5edf7', padding: '28px 18px', fontFamily: 'Inter, ui-sans-serif, system-ui' }}>
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: '#7dd3fc', fontSize: 13, letterSpacing: '.14em', textTransform: 'uppercase' }}>ELP Resource Allocation</div>
          <h1 style={{ margin: '8px 0', fontSize: 34 }}>Capacity Planner</h1>
          <p style={{ color: '#9fb0c7', maxWidth: 760, lineHeight: 1.6 }}>Balances commitments, goals, active work, delegation overhead and calendar load. Recommendations are advisory; consequential changes remain approval-gated.</p>
        </div>
        <button onClick={run} disabled={busy} style={{ padding: '12px 18px', borderRadius: 12, border: 0, cursor: 'pointer', background: '#e5edf7', color: '#07101d', fontWeight: 700 }}>{busy ? 'Working…' : 'Recalculate now'}</button>
      </div>

      {error ? <div style={{ ...card, marginTop: 20, borderColor: '#7f1d1d', color: '#fecaca' }}>{error}</div> : null}

      {plan ? <>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginTop: 22 }}>
          {[
            ['Status', plan.status.toUpperCase()], ['Execution capacity', `${plan.executionCapacityHours}h`], ['Estimated demand', `${plan.estimatedDemandHours}h`], ['Capacity gap', `${plan.capacityGapHours}h`], ['Load', `${Math.round(plan.loadRatio * 100)}%`], ['Calendar busy', `${plan.calendarBusyHours}h`]
          ].map(([label, value]) => <div key={label} style={card}><div style={{ color: '#8fa4bf', fontSize: 12, textTransform: 'uppercase' }}>{label}</div><div style={{ fontSize: 26, fontWeight: 700, marginTop: 7 }}>{value}</div></div>)}
        </section>

        <section style={{ ...card, marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Allocation recommendations</h2>
          {!plan.recommendations.length ? <p style={{ color: '#9fb0c7' }}>No material reallocation is recommended.</p> : <div style={{ display: 'grid', gap: 10 }}>
            {plan.recommendations.map((item) => <div key={item.id} style={{ borderTop: '1px solid #253248', paddingTop: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><strong>{item.action.toUpperCase()}</strong><span>{item.title}</span>{item.requiresApproval ? <span style={{ color: '#facc15', fontSize: 12 }}>APPROVAL REQUIRED</span> : null}</div>
              <div style={{ color: '#9fb0c7', marginTop: 5 }}>{item.reason}</div>
              <div style={{ color: '#72849a', fontSize: 12, marginTop: 5 }}>{Math.round(item.confidence * 100)}% confidence{item.estimatedHoursRecovered ? ` · ~${item.estimatedHoursRecovered}h capacity` : ''}</div>
            </div>)}
          </div>}
        </section>

        <section style={{ ...card, marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Demand model</h2>
          <div style={{ display: 'grid', gap: 9 }}>{plan.demand.slice(0, 30).map((item) => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 80px', gap: 12, borderTop: '1px solid #253248', paddingTop: 10 }}><span style={{ color: '#7dd3fc', fontSize: 12 }}>{item.source.toUpperCase()}</span><div><strong>{item.title}</strong><div style={{ color: '#8294aa', fontSize: 13 }}>{item.reason}{item.owner ? ` · owner: ${item.owner}` : ''}</div></div><strong style={{ textAlign: 'right' }}>{item.estimatedHours}h</strong></div>)}</div>
        </section>
      </> : <div style={{ ...card, marginTop: 20 }}>No capacity plan has been calculated yet. Run the planner to create the first seven-day allocation model.</div>}

      {profile ? <section style={{ ...card, marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Capacity policy</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
          {[
            ['Weekly hours', 'weeklyHours'], ['Reserve %', 'reservePercent'], ['Admin %', 'adminPercent'], ['Max objectives', 'maxConcurrentObjectives'], ['Default task hours', 'defaultTaskHours']
          ].map(([label, key]) => <label key={key} style={{ color: '#9fb0c7', fontSize: 13 }}>{label}<input type="number" style={{ ...input, marginTop: 5 }} value={String(profile[key as keyof CapacityProfile])} onChange={(e) => setProfile({ ...profile, [key]: Number(e.target.value) })}/></label>)}
          <label style={{ color: '#9fb0c7', fontSize: 13 }}>Timezone<input style={{ ...input, marginTop: 5 }} value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}/></label>
        </div>
        <button onClick={saveProfile} disabled={busy} style={{ marginTop: 14, padding: '10px 15px', borderRadius: 10, border: '1px solid #334155', background: '#172033', color: '#e5edf7', cursor: 'pointer' }}>Save capacity policy</button>
      </section> : null}
    </div>
  </main>;
}
