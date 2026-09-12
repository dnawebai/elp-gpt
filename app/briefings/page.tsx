'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bell, CalendarClock, LoaderCircle, Radar, Sparkles } from 'lucide-react';

type BriefingKind = 'daily' | 'attention' | 'meeting-prep';
type Briefing = {
  ok: boolean;
  kind: BriefingKind;
  generatedAt: string;
  timezone: string;
  summary: string;
  status: 'completed' | 'needs_input' | 'blocked';
  question?: string;
  trace: Array<{ step: number; kind: string; summary: string; toolSlug?: string }>;
};

const cards: Array<{ kind: BriefingKind; title: string; detail: string }> = [
  { kind: 'daily', title: 'Executive Brief', detail: 'Schedule, priority messages, commitments, risks and opportunities.' },
  { kind: 'attention', title: 'Attention Radar', detail: 'What requires intervention now, ranked by urgency and consequence.' },
  { kind: 'meeting-prep', title: 'Meeting Prep', detail: 'Context, people, commitments, risks, questions and desired outcome.' },
];

export default function BriefingsPage() {
  const [sessionId, setSessionId] = useState('briefings');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [meeting, setMeeting] = useState('');
  const [busy, setBusy] = useState<BriefingKind | null>(null);
  const [result, setResult] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = window.sessionStorage.getItem('luke-session-id');
    const id = existing || crypto.randomUUID();
    if (!existing) window.sessionStorage.setItem('luke-session-id', id);
    setSessionId(id);
    try { setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto'); } catch {}
    void fetch('/api/identity', { method: 'POST', cache: 'no-store' });
  }, []);

  async function run(kind: BriefingKind) {
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch('/api/briefings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, sessionId, timezone, meeting: kind === 'meeting-prep' ? meeting : undefined }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as Briefing | { error?: string } | null;
      if (!response.ok || !data || !('summary' in data)) {
        throw new Error((data && 'error' in data && data.error) || 'Briefing generation failed.');
      }
      setResult(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Briefing generation failed.');
    } finally {
      setBusy(null);
    }
  }

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#eaf4ff',padding:'28px',fontFamily:'Inter,Arial,sans-serif'}}>
    <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:20,maxWidth:1180,margin:'0 auto 28px'}}>
      <Link href="/" style={{color:'#9dc9ff',textDecoration:'none',display:'flex',alignItems:'center',gap:8}}><ArrowLeft size={17}/> LUKE</Link>
      <div style={{textAlign:'center'}}><div style={{fontSize:12,letterSpacing:2,color:'#6e9bc7'}}>ELP GPT</div><h1 style={{margin:'4px 0'}}>JARBIS Proactive Intelligence</h1></div>
      <div style={{fontSize:12,color:'#77e0b5'}}>READ-ONLY MODE</div>
    </header>

    <section style={{maxWidth:1180,margin:'0 auto',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(250px,1fr))',gap:16}}>
      {cards.map((card) => <article key={card.kind} style={{border:'1px solid #1f3a55',background:'#0b1a2a',borderRadius:18,padding:20}}>
        <div style={{display:'flex',alignItems:'center',gap:10,color:'#8fc4ff'}}>{card.kind==='daily'?<Bell size={20}/>:card.kind==='attention'?<Radar size={20}/>:<CalendarClock size={20}/>}<b>{card.title}</b></div>
        <p style={{color:'#a9bed2',lineHeight:1.5,minHeight:66}}>{card.detail}</p>
        {card.kind==='meeting-prep' && <input value={meeting} onChange={(e)=>setMeeting(e.target.value)} placeholder="Optional: meeting title, company or person" style={{width:'100%',boxSizing:'border-box',marginBottom:12,padding:11,borderRadius:10,border:'1px solid #2a4966',background:'#07131f',color:'#eaf4ff'}}/>}
        <button onClick={()=>void run(card.kind)} disabled={Boolean(busy)} style={{width:'100%',padding:'11px 14px',borderRadius:10,border:'1px solid #3a70a1',background:'#0c2942',color:'#dceeff',cursor:'pointer'}}>
          {busy===card.kind?<span style={{display:'inline-flex',alignItems:'center',gap:8}}><LoaderCircle size={16}/> Running…</span>:<span style={{display:'inline-flex',alignItems:'center',gap:8}}><Sparkles size={16}/> Run</span>}
        </button>
      </article>)}
    </section>

    {error && <section style={{maxWidth:1180,margin:'18px auto',padding:14,border:'1px solid #7a3040',background:'#2a1118',borderRadius:12,color:'#ffd7dd'}}>{error}</section>}

    <section style={{maxWidth:1180,margin:'22px auto',border:'1px solid #1f3a55',background:'#081624',borderRadius:18,padding:22}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',marginBottom:14}}>
        <div><div style={{fontSize:12,letterSpacing:1.5,color:'#6e9bc7'}}>LATEST BRIEFING</div><h2 style={{margin:'4px 0'}}>{result ? result.kind.replace('-', ' ').toUpperCase() : 'STANDBY'}</h2></div>
        {result && <div style={{fontSize:12,color:'#87a5bf'}}>{new Date(result.generatedAt).toLocaleString()}</div>}
      </div>
      <div style={{whiteSpace:'pre-wrap',lineHeight:1.65,color:result?'#d9e9f6':'#8ca6bb'}}>{result?.summary || 'Run a briefing to synthesize your connected information into an executive view.'}</div>
      {result?.trace?.length ? <details style={{marginTop:18}}><summary style={{cursor:'pointer',color:'#8fc4ff'}}>Execution trace</summary><div style={{marginTop:12,display:'grid',gap:8}}>{result.trace.map((item,index)=><div key={`${index}-${item.step}`} style={{fontSize:13,color:'#9cb2c4'}}><b>{String(item.step).padStart(2,'0')}</b> · {item.kind.toUpperCase()}{item.toolSlug?` · ${item.toolSlug}`:''} — {item.summary}</div>)}</div></details>:null}
    </section>
  </main>;
}
