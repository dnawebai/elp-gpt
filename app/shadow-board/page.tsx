'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BrainCircuit, LoaderCircle, Scale, ShieldAlert, Sparkles, Swords } from 'lucide-react';

type Perspective = {
  id: string;
  title: string;
  mandate: string;
  analysis: string;
  provider: 'hermes' | 'together';
};

type BoardResult = {
  ok: boolean;
  generatedAt: string;
  question: string;
  synthesis: string;
  perspectives: Perspective[];
  failedRoles: Array<{ id: string; error: string }>;
};

export default function ShadowBoardPage() {
  const [sessionId, setSessionId] = useState('shadow-board');
  const [question, setQuestion] = useState('');
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BoardResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = window.sessionStorage.getItem('elp-session-id');
    const id = existing || crypto.randomUUID();
    if (!existing) window.sessionStorage.setItem('elp-session-id', id);
    setSessionId(id);
    void fetch('/api/identity', { method: 'POST', cache: 'no-store' });
  }, []);

  async function consult() {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/shadow-board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context, sessionId }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as BoardResult | { error?: string } | null;
      if (!response.ok || !data || !('synthesis' in data)) {
        throw new Error((data && 'error' in data && data.error) || 'Shadow Board failed.');
      }
      setResult(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Shadow Board failed.');
    } finally {
      setBusy(false);
    }
  }

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#eaf4ff',padding:'28px',fontFamily:'Inter,Arial,sans-serif'}}>
    <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:20,maxWidth:1180,margin:'0 auto 28px'}}>
      <Link href="/" style={{color:'#9dc9ff',textDecoration:'none',display:'flex',alignItems:'center',gap:8}}><ArrowLeft size={17}/> ELP</Link>
      <div style={{textAlign:'center'}}><div style={{fontSize:12,letterSpacing:2,color:'#6e9bc7'}}>ELP GPT</div><h1 style={{margin:'4px 0'}}>JARBIS Shadow Board</h1></div>
      <div style={{fontSize:12,color:'#77e0b5'}}>ADVISORY ONLY</div>
    </header>

    <section style={{maxWidth:1180,margin:'0 auto',display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(320px,.9fr)',gap:18}}>
      <article style={{border:'1px solid #1f3a55',background:'#0b1a2a',borderRadius:18,padding:20}}>
        <div style={{display:'flex',gap:10,alignItems:'center',color:'#8fc4ff'}}><BrainCircuit size={20}/><b>Decision for the Board</b></div>
        <p style={{color:'#9cb2c4',lineHeight:1.5}}>Ask a material question. Each specialist analyses it independently before JARBIS Chair synthesises a recommendation.</p>
        <textarea value={question} onChange={(e)=>setQuestion(e.target.value)} placeholder="Example: Should we launch this product now, delay it, or change the model?" style={{width:'100%',minHeight:130,boxSizing:'border-box',padding:14,borderRadius:12,border:'1px solid #2a4966',background:'#07131f',color:'#eaf4ff',resize:'vertical'}}/>
        <textarea value={context} onChange={(e)=>setContext(e.target.value)} placeholder="Optional decision context, constraints, numbers or facts not already in JARBIS memory" style={{width:'100%',minHeight:110,boxSizing:'border-box',marginTop:12,padding:14,borderRadius:12,border:'1px solid #2a4966',background:'#07131f',color:'#eaf4ff',resize:'vertical'}}/>
        <button onClick={()=>void consult()} disabled={busy || !question.trim()} style={{marginTop:14,width:'100%',padding:'12px 14px',borderRadius:10,border:'1px solid #3a70a1',background:'#0c2942',color:'#dceeff',cursor:'pointer'}}>
          {busy?<span style={{display:'inline-flex',gap:8,alignItems:'center'}}><LoaderCircle size={16}/> Consulting Board…</span>:<span style={{display:'inline-flex',gap:8,alignItems:'center'}}><Sparkles size={16}/> Consult Shadow Board</span>}
        </button>
      </article>

      <article style={{border:'1px solid #1f3a55',background:'#081624',borderRadius:18,padding:20}}>
        <div style={{display:'grid',gap:12}}>
          {[['Strategy','Competitive advantage, timing and optionality'],['Finance','Economics, downside and opportunity cost'],['Technology','Feasibility, architecture and hidden engineering cost'],['Legal & Risk','Regulatory, contractual and reputational exposure'],['Operations','Execution, dependencies and bottlenecks'],['Red Team','Strongest case against the proposal']].map(([title,detail],index)=><div key={title} style={{display:'flex',gap:10,alignItems:'flex-start'}}>{index===3?<Scale size={18}/>:index===5?<Swords size={18}/>:<ShieldAlert size={18}/>}<div><b>{title}</b><div style={{fontSize:13,color:'#91a9bc',marginTop:2}}>{detail}</div></div></div>)}
        </div>
      </article>
    </section>

    {error && <section style={{maxWidth:1180,margin:'18px auto',padding:14,border:'1px solid #7a3040',background:'#2a1118',borderRadius:12,color:'#ffd7dd'}}>{error}</section>}

    {result && <section style={{maxWidth:1180,margin:'22px auto',display:'grid',gap:18}}>
      <article style={{border:'1px solid #315b80',background:'#081624',borderRadius:18,padding:22}}>
        <div style={{fontSize:12,letterSpacing:1.5,color:'#6e9bc7'}}>CHAIR SYNTHESIS</div>
        <div style={{whiteSpace:'pre-wrap',lineHeight:1.65,marginTop:10,color:'#e1edf7'}}>{result.synthesis}</div>
      </article>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:16}}>
        {result.perspectives.map((item)=><article key={item.id} style={{border:'1px solid #1f3a55',background:'#0a1826',borderRadius:16,padding:18}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}><b>{item.title}</b><span style={{fontSize:11,color:'#6f91ae'}}>{item.provider.toUpperCase()}</span></div>
          <div style={{whiteSpace:'pre-wrap',lineHeight:1.6,color:'#c9dae8',marginTop:12}}>{item.analysis}</div>
        </article>)}
      </div>
      {result.failedRoles.length ? <article style={{border:'1px solid #6e3e46',background:'#261218',borderRadius:14,padding:16,color:'#ffcbd2'}}>Unavailable advisers: {result.failedRoles.map((item)=>item.id).join(', ')}</article>:null}
    </section>}
  </main>;
}
