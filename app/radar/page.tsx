'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, CheckCircle2, LoaderCircle, Radar, RefreshCw, Sparkles, Target, TrendingUp, Users } from 'lucide-react';

type SignalType = 'opportunity' | 'risk' | 'deadline' | 'relationship' | 'contradiction' | 'dependency';
type SignalStatus = 'open' | 'acknowledged' | 'dismissed' | 'promoted';
type Signal = {
  id: string;
  messageId: string;
  type: SignalType;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  summary: string;
  evidence: string[];
  confidence: number;
  recommendedAction: string;
  relatedLedgerIds: string[];
  detectedAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  status: SignalStatus;
  promotedLedgerId?: string;
};
type Snapshot = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  signals: Signal[];
  stats: { open: number; critical: number; high: number; opportunities: number; risks: number; deadlines: number; relationships: number };
  lastScan?: { runKey: string; generatedAt: string; summary: string; newCount: number; updatedCount: number };
};

type ScanResult = { ok: boolean; status: string; summary: string; newSignals: number; updatedSignals: number; question?: string };

const typeLabels: Record<SignalType, string> = {
  opportunity: 'Opportunity', risk: 'Risk', deadline: 'Deadline', relationship: 'Relationship', contradiction: 'Contradiction', dependency: 'Dependency',
};

export default function RadarPage() {
  const [sessionId, setSessionId] = useState('radar');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'all' | SignalType>('active');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = window.sessionStorage.getItem('luke-session-id');
    const id = existing || crypto.randomUUID();
    if (!existing) window.sessionStorage.setItem('luke-session-id', id);
    setSessionId(id);
    try { setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto'); } catch {}
    void fetch('/api/identity', { method: 'POST', cache: 'no-store' }).then(() => load()).catch(() => load());
  }, []);

  async function load() {
    try {
      const response = await fetch('/api/radar', { cache: 'no-store' });
      const data = await response.json().catch(() => null) as Snapshot | { error?: string } | null;
      if (!response.ok || !data || !('signals' in data)) throw new Error((data && 'error' in data && data.error) || 'Could not load radar.');
      setSnapshot(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load radar.');
    }
  }

  async function scan() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/radar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, timezone }), cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as ScanResult | { error?: string } | null;
      if (!response.ok || !data || !('summary' in data)) throw new Error((data && 'error' in data && data.error) || 'Radar scan failed.');
      setMessage(`${data.summary} · ${data.newSignals} new / ${data.updatedSignals} updated`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Radar scan failed.');
    } finally { setBusy(false); }
  }

  async function patch(messageId: string, body: Record<string, unknown>) {
    setUpdating(messageId); setError(null);
    try {
      const response = await fetch('/api/radar', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId, ...body }), cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Radar update failed.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Radar update failed.');
    } finally { setUpdating(null); }
  }

  const visible = useMemo(() => {
    const signals = snapshot?.signals || [];
    if (filter === 'all') return signals;
    if (filter === 'active') return signals.filter((signal) => signal.status === 'open' || signal.status === 'acknowledged');
    return signals.filter((signal) => signal.type === filter);
  }, [snapshot, filter]);

  const stats = snapshot?.stats || { open:0, critical:0, high:0, opportunities:0, risks:0, deadlines:0, relationships:0 };
  const card = { border:'1px solid #1f3a55', background:'#0b1a2a', borderRadius:16, padding:18 } as const;
  const chip = { border:'1px solid #2b4b69', borderRadius:999, padding:'7px 11px', background:'#0a1725', color:'#cfe7fb', cursor:'pointer' } as const;

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#eaf4ff',padding:'26px',fontFamily:'Inter,Arial,sans-serif'}}>
    <header style={{maxWidth:1240,margin:'0 auto 24px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:18,flexWrap:'wrap'}}>
      <Link href="/" style={{display:'flex',alignItems:'center',gap:8,color:'#9dc9ff',textDecoration:'none'}}><ArrowLeft size={17}/> LUKE</Link>
      <div style={{textAlign:'center'}}><div style={{fontSize:11,letterSpacing:2,color:'#6e9bc7'}}>JARBIS</div><h1 style={{margin:'4px 0'}}>Opportunity Radar</h1><div style={{fontSize:12,color:'#77e0b5'}}>AUTONOMOUS READ-ONLY MONITORING</div></div>
      <button onClick={()=>void scan()} disabled={busy} style={{...chip,padding:'10px 14px'}}>{busy?<span style={{display:'flex',gap:8,alignItems:'center'}}><LoaderCircle size={16}/> Scanning…</span>:<span style={{display:'flex',gap:8,alignItems:'center'}}><Radar size={16}/> Scan now</span>}</button>
    </header>

    <section style={{maxWidth:1240,margin:'0 auto',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12}}>
      {[
        ['Open',stats.open,<Radar key="i" size={18}/>],['Critical',stats.critical,<AlertTriangle key="i" size={18}/>],['High',stats.high,<Target key="i" size={18}/>],['Opportunities',stats.opportunities,<TrendingUp key="i" size={18}/>],['Risks',stats.risks,<AlertTriangle key="i" size={18}/>],['Deadlines',stats.deadlines,<CheckCircle2 key="i" size={18}/>],['Relationships',stats.relationships,<Users key="i" size={18}/>],
      ].map(([label,value,icon])=><div key={String(label)} style={card}><div style={{display:'flex',justifyContent:'space-between',color:'#8fc4ff'}}><span>{label as string}</span>{icon}</div><div style={{fontSize:30,fontWeight:700,marginTop:10}}>{value as number}</div></div>)}
    </section>

    {snapshot?.lastScan && <section style={{maxWidth:1240,margin:'14px auto 0',...card}}><div style={{fontSize:11,letterSpacing:1.4,color:'#6e9bc7'}}>LAST AUTONOMOUS SCAN</div><div style={{marginTop:7,color:'#d9e9f6',lineHeight:1.55}}>{snapshot.lastScan.summary || 'Scan completed.'}</div><div style={{fontSize:12,color:'#7894aa',marginTop:8}}>{new Date(snapshot.lastScan.generatedAt).toLocaleString()} · {snapshot.lastScan.newCount} new · {snapshot.lastScan.updatedCount} updated</div></section>}
    {message && <section style={{maxWidth:1240,margin:'14px auto 0',padding:13,border:'1px solid #28634f',background:'#0a261d',borderRadius:12,color:'#baf4dc'}}>{message}</section>}
    {error && <section style={{maxWidth:1240,margin:'14px auto 0',padding:13,border:'1px solid #7a3040',background:'#2a1118',borderRadius:12,color:'#ffd7dd'}}>{error}</section>}

    <section style={{maxWidth:1240,margin:'18px auto',display:'flex',gap:8,flexWrap:'wrap'}}>
      {(['active','all','opportunity','risk','deadline','relationship','contradiction','dependency'] as const).map((item)=><button key={item} onClick={()=>setFilter(item)} style={{...chip,background:filter===item?'#123655':'#0a1725'}}>{item.toUpperCase()}</button>)}
      <button onClick={()=>void load()} style={chip}><RefreshCw size={14}/></button>
    </section>

    <section style={{maxWidth:1240,margin:'0 auto',display:'grid',gap:14}}>
      {!visible.length && <div style={{...card,color:'#8ca6bb'}}>No signals match this view. JARBIS intentionally prefers silence over low-value noise.</div>}
      {visible.map((signal)=><article key={signal.id} style={card}>
        <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
          <div><div style={{display:'flex',gap:8,flexWrap:'wrap',fontSize:11}}><span style={{color:'#86c8ff'}}>{typeLabels[signal.type].toUpperCase()}</span><span style={{color:signal.severity==='critical'||signal.severity==='high'?'#ff9ca8':'#e5c984'}}>{signal.severity.toUpperCase()}</span><span style={{color:'#7894aa'}}>{Math.round(signal.confidence*100)}% confidence</span><span style={{color:'#7894aa'}}>seen {signal.occurrenceCount}×</span></div><h2 style={{margin:'7px 0 5px',fontSize:20}}>{signal.title}</h2></div>
          <span style={{fontSize:12,color:'#7894aa'}}>{signal.status.toUpperCase()}</span>
        </div>
        <p style={{color:'#bdd0e0',lineHeight:1.6}}>{signal.summary}</p>
        {signal.evidence.length>0 && <details><summary style={{color:'#8fc4ff',cursor:'pointer'}}>Evidence</summary><div style={{marginTop:9,display:'grid',gap:7,color:'#9fb4c5'}}>{signal.evidence.map((item,index)=><div key={index}>• {item}</div>)}</div></details>}
        <div style={{marginTop:14,padding:12,borderRadius:10,background:'#07131f',color:'#d9e9f6'}}><b style={{color:'#8fc4ff'}}>Recommended:</b> {signal.recommendedAction}</div>
        <div style={{marginTop:14,display:'flex',gap:8,flexWrap:'wrap'}}>
          {signal.status!=='acknowledged'&&signal.status!=='promoted'&&<button disabled={updating===signal.id} onClick={()=>void patch(signal.messageId,{status:'acknowledged'})} style={chip}>Acknowledge</button>}
          {signal.status!=='dismissed'&&signal.status!=='promoted'&&<button disabled={updating===signal.id} onClick={()=>void patch(signal.messageId,{status:'dismissed'})} style={chip}>Dismiss</button>}
          {signal.status!=='promoted'&&<button disabled={updating===signal.id} onClick={()=>void patch(signal.messageId,{promoteKind:'commitment'})} style={chip}><Sparkles size={13}/> Promote to commitment</button>}
          {signal.status!=='promoted'&&<button disabled={updating===signal.id} onClick={()=>void patch(signal.messageId,{promoteKind:'objective'})} style={chip}>Promote to objective</button>}
          {signal.promotedLedgerId&&<Link href="/executive-ledger" style={{...chip,textDecoration:'none'}}>Open ledger</Link>}
        </div>
      </article>)}
    </section>
  </main>;
}
