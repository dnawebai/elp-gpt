'use client';

import { useEffect, useState } from 'react';

type PriorityItem = {
  id: string;
  source: string;
  sourceId: string;
  title: string;
  horizon: 'now' | 'today' | 'week';
  score: number;
  priority: 'critical' | 'high' | 'normal' | 'low';
  owner?: string;
  dueDate?: string;
  blocked: boolean;
  approvalRequired: boolean;
  reasons: string[];
  recommendedAction: string;
};

type Plan = {
  generatedAt: string;
  timezone: string;
  capacityStatus: string;
  headline: string;
  focus: PriorityItem[];
  now: PriorityItem[];
  today: PriorityItem[];
  week: PriorityItem[];
  defer: PriorityItem[];
  stopDoing: PriorityItem[];
  blockers: PriorityItem[];
  stats: { totalCandidates: number; critical: number; blocked: number; decisions: number; relationshipItems: number; overload: boolean };
};

const card: React.CSSProperties = { border: '1px solid #263248', borderRadius: 16, padding: 18, background: '#101827' };

function Item({ item }: { item: PriorityItem }) {
  return <div style={{ borderTop: '1px solid #253248', paddingTop: 12 }}>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <strong>{item.title}</strong>
      <span style={{ color: '#7dd3fc', fontSize: 12 }}>{item.source.toUpperCase()}</span>
      <span style={{ color: '#facc15', fontSize: 12 }}>SCORE {item.score}</span>
      {item.blocked ? <span style={{ color: '#fca5a5', fontSize: 12 }}>BLOCKED</span> : null}
      {item.approvalRequired ? <span style={{ color: '#fde68a', fontSize: 12 }}>APPROVAL</span> : null}
    </div>
    <div style={{ color: '#9fb0c7', marginTop: 5 }}>{item.recommendedAction}</div>
    <div style={{ color: '#72849a', fontSize: 12, marginTop: 5 }}>{item.reasons.join(' · ')}{item.owner ? ` · owner: ${item.owner}` : ''}{item.dueDate ? ` · due: ${item.dueDate}` : ''}</div>
  </div>;
}

export default function DailyOperatingPlanPage() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    const response = await fetch('/api/daily-operating-plan', { cache: 'no-store' });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'Operating plan failed.');
    setPlan(json.plan || null);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function refresh() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/daily-operating-plan', { method: 'POST' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Operating plan refresh failed.');
      setPlan(json.plan);
    } catch (e) { setError(e instanceof Error ? e.message : 'Operating plan refresh failed.'); }
    finally { setBusy(false); }
  }

  return <main style={{ minHeight: '100vh', background: '#07101d', color: '#e5edf7', padding: '28px 18px', fontFamily: 'Inter, ui-sans-serif, system-ui' }}>
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: '#7dd3fc', fontSize: 13, letterSpacing: '.14em', textTransform: 'uppercase' }}>ELP Dynamic Priority Engine</div>
          <h1 style={{ margin: '8px 0', fontSize: 34 }}>Daily Operating Plan</h1>
          <p style={{ color: '#9fb0c7', maxWidth: 800, lineHeight: 1.6 }}>Continuously ranks execution across goals, commitments, capacity, decisions, delegation, relationships and anticipatory risk. Ranking is advisory; consequential actions remain approval-gated.</p>
        </div>
        <button onClick={refresh} disabled={busy} style={{ padding: '12px 18px', borderRadius: 12, border: 0, cursor: 'pointer', background: '#e5edf7', color: '#07101d', fontWeight: 700 }}>{busy ? 'Re-ranking…' : 'Re-rank now'}</button>
      </div>

      {error ? <div style={{ ...card, marginTop: 20, borderColor: '#7f1d1d', color: '#fecaca' }}>{error}</div> : null}

      {plan ? <>
        <section style={{ ...card, marginTop: 20 }}><div style={{ color: '#8fa4bf', fontSize: 12 }}>CURRENT OPERATING HEADLINE</div><div style={{ fontSize: 25, fontWeight: 700, marginTop: 8 }}>{plan.headline}</div><div style={{ color: '#8294aa', marginTop: 7 }}>{new Date(plan.generatedAt).toLocaleString()} · {plan.timezone}</div></section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginTop: 16 }}>
          {[['Capacity', plan.capacityStatus.toUpperCase()], ['Candidates', plan.stats.totalCandidates], ['Critical', plan.stats.critical], ['Blocked', plan.stats.blocked], ['Decisions', plan.stats.decisions], ['Relationships', plan.stats.relationshipItems]].map(([label, value]) => <div key={String(label)} style={card}><div style={{ color: '#8fa4bf', fontSize: 12, textTransform: 'uppercase' }}>{label}</div><div style={{ fontSize: 25, fontWeight: 700, marginTop: 7 }}>{value}</div></div>)}
        </section>

        <section style={{ ...card, marginTop: 16 }}><h2 style={{ marginTop: 0 }}>Focus</h2><div style={{ display: 'grid', gap: 12 }}>{plan.focus.map((item) => <Item key={item.id} item={item}/>)}</div></section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(310px,1fr))', gap: 16, marginTop: 16 }}>
          {([['Now', plan.now], ['Today', plan.today], ['This week', plan.week]] as Array<[string, PriorityItem[]]>).map(([label, items]) => <div key={label} style={card}><h2 style={{ marginTop: 0 }}>{label}</h2>{items.length ? <div style={{ display: 'grid', gap: 10 }}>{items.map((item) => <Item key={item.id} item={item}/>)}</div> : <p style={{ color: '#8294aa' }}>No ranked items.</p>}</div>)}
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16, marginTop: 16 }}>
          <div style={card}><h2 style={{ marginTop: 0 }}>Blockers & approvals</h2>{plan.blockers.length ? plan.blockers.map((item) => <Item key={item.id} item={item}/>) : <p style={{ color: '#8294aa' }}>No material blockers.</p>}</div>
          <div style={card}><h2 style={{ marginTop: 0 }}>Defer candidates</h2>{plan.defer.length ? plan.defer.map((item) => <Item key={item.id} item={item}/>) : <p style={{ color: '#8294aa' }}>No deferral recommended.</p>}</div>
          <div style={card}><h2 style={{ marginTop: 0 }}>Stop / pause candidates</h2>{plan.stopDoing.length ? plan.stopDoing.map((item) => <Item key={item.id} item={item}/>) : <p style={{ color: '#8294aa' }}>No stop recommendation.</p>}</div>
        </section>
      </> : <div style={{ ...card, marginTop: 20 }}>No operating plan exists yet. Run the priority engine to generate the first plan.</div>}
    </div>
  </main>;
}
