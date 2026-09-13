'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CalendarClock, GitBranch, LoaderCircle, RefreshCw, ScanSearch, Sparkles, Users } from 'lucide-react';

type Risk = { id:string; fingerprint:string; type:string; severity:'critical'|'high'|'medium'; title:string; summary:string; evidence:string[]; recommendedAction:string; horizonHours:number; confidence:number; relatedIds:string[] };
type Snapshot = { configured:boolean; available:boolean; generatedAt:string; timezone:string; risks:Risk[]; forwardScanSummary:string; stats:{total:number;critical:number;high:number;medium:number;deadlines:number;decisions:number;dependencies:number;relationships:number;schedule:number}; createdTasks?:number };

export default function AnticipatoryPage(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);

  useEffect(()=>{ void fetch('/api/identity',{method:'POST',cache:'no-store'}).then(()=>load()).catch(()=>load()); },[]);

  async function load(){
    setError(null);
    const response=await fetch('/api/anticipatory',{cache:'no-store'});
    const data=await response.json().catch(()=>null) as Snapshot & {error?:string}|null;
    if(!response.ok){setError(data?.error||'Could not load anticipatory forecast.');return;}
    setSnapshot(data);
  }

  async function scan(){
    setBusy(true);setError(null);setMessage(null);
    try{
      let timezone:string|undefined;
      try{timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||undefined;}catch{}
      const sessionId=window.sessionStorage.getItem('elp-session-id')||crypto.randomUUID();
      window.sessionStorage.setItem('elp-session-id',sessionId);
      const response=await fetch('/api/anticipatory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,timezone}),cache:'no-store'});
      const data=await response.json().catch(()=>null) as Snapshot & {createdTasks?:number;error?:string}|null;
      if(!response.ok) throw new Error(data?.error||'Forecast scan failed.');
      setSnapshot(data);
      setMessage(`Forecast refreshed. ${data?.stats.critical||0} critical, ${data?.stats.high||0} high, ${data?.stats.medium||0} medium. ${data?.createdTasks||0} preventive internal task${data?.createdTasks===1?'':'s'} prepared.`);
    }catch(caught){setError(caught instanceof Error?caught.message:'Forecast scan failed.');}
    finally{setBusy(false);}
  }

  const top=useMemo(()=>snapshot?.risks||[],[snapshot]);
  const card={border:'1px solid #1d3b57',background:'#091827',borderRadius:16,padding:18} as const;
  const button={border:'1px solid #315572',background:'#0b1d2e',color:'#dceeff',borderRadius:999,padding:'9px 13px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:7} as const;
  const badge=(severity:Risk['severity'])=>({display:'inline-flex',border:'1px solid #315572',borderRadius:999,padding:'5px 9px',fontSize:11,letterSpacing:.6,color:severity==='critical'?'#ffadb9':severity==='high'?'#ffd47a':'#9ec9ff'} as const);
  const iconFor=(type:string)=>type==='deadline_failure'?<CalendarClock size={17}/>:type==='dependency_block'?<GitBranch size={17}/>:type==='relationship_followup'?<Users size={17}/>:<AlertTriangle size={17}/>;

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#eaf4ff',padding:26,fontFamily:'Inter,Arial,sans-serif'}}>
    <header style={{maxWidth:1280,margin:'0 auto 22px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
      <Link href="/" style={{display:'flex',alignItems:'center',gap:8,color:'#9dc9ff',textDecoration:'none'}}><ArrowLeft size={17}/> ELP</Link>
      <div style={{textAlign:'center'}}><div style={{fontSize:11,letterSpacing:2,color:'#6f9dc8'}}>ELP</div><h1 style={{margin:'4px 0'}}>Anticipatory Chief of Staff</h1><div style={{fontSize:12,color:'#78e1b5'}}>SEVEN-DAY EARLY WARNING · EVIDENCE-FIRST · PREVENTIVE PREPARATION</div></div>
      <div style={{display:'flex',gap:8}}><button onClick={()=>void load()} style={button}><RefreshCw size={15}/> Refresh</button><button disabled={busy} onClick={()=>void scan()} style={button}>{busy?<LoaderCircle size={15}/>:<ScanSearch size={15}/>} Scan next 7 days</button></div>
    </header>

    {error&&<div style={{maxWidth:1280,margin:'0 auto 14px',padding:13,border:'1px solid #763348',background:'#2a1119',borderRadius:12,color:'#ffd9df'}}>{error}</div>}
    {message&&<div style={{maxWidth:1280,margin:'0 auto 14px',padding:13,border:'1px solid #28644f',background:'#0a261d',borderRadius:12,color:'#bdf4dc'}}>{message}</div>}

    <section style={{maxWidth:1280,margin:'0 auto 16px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10}}>
      {[
        ['CRITICAL',snapshot?.stats.critical||0,<AlertTriangle key="1" size={18}/>],['HIGH',snapshot?.stats.high||0,<AlertTriangle key="2" size={18}/>],['DEADLINES',snapshot?.stats.deadlines||0,<CalendarClock key="3" size={18}/>],['DECISIONS',snapshot?.stats.decisions||0,<Sparkles key="4" size={18}/>],['DEPENDENCIES',snapshot?.stats.dependencies||0,<GitBranch key="5" size={18}/>],['RELATIONSHIPS',snapshot?.stats.relationships||0,<Users key="6" size={18}/>],
      ].map(([label,value,icon])=><div key={String(label)} style={card}><div style={{display:'flex',justifyContent:'space-between',color:'#719cc4'}}><span style={{fontSize:10,letterSpacing:1.1}}>{label}</span>{icon}</div><div style={{fontSize:28,fontWeight:700,marginTop:8}}>{String(value)}</div></div>)}
    </section>

    <section style={{maxWidth:1280,margin:'0 auto',display:'grid',gridTemplateColumns:'minmax(0,1.3fr) minmax(300px,.7fr)',gap:16,alignItems:'start'}}>
      <div style={{display:'grid',gap:12}}>
        <div style={{fontSize:11,letterSpacing:1.3,color:'#6f9dc8'}}>FORECAST RISKS</div>
        {top.length===0?<div style={{...card,color:'#829eb6'}}>No material near-term risks are currently forecast. Run a seven-day scan to refresh connected calendar and email evidence.</div>:top.map((item)=><article key={item.id} style={card}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}><div style={{display:'flex',gap:10,alignItems:'center'}}>{iconFor(item.type)}<div><span style={badge(item.severity)}>{item.severity.toUpperCase()}</span><h3 style={{margin:'8px 0 2px'}}>{item.title}</h3></div></div><div style={{fontSize:11,color:'#7594ad'}}>Horizon {item.horizonHours}h · {Math.round(item.confidence*100)}% confidence</div></div>
          <p style={{lineHeight:1.55,color:'#c9dceb'}}>{item.summary}</p>
          <div style={{borderLeft:'3px solid #6da8df',paddingLeft:10,color:'#cfe5fa',fontSize:13}}>Preventive action: {item.recommendedAction}</div>
          {item.evidence.length>0&&<details style={{marginTop:10,color:'#88a9c4'}}><summary>Evidence</summary><div style={{display:'grid',gap:6,marginTop:8}}>{item.evidence.slice(0,4).map((evidence,index)=><div key={index} style={{fontSize:12,lineHeight:1.45}}>{evidence}</div>)}</div></details>}
        </article>)}
      </div>

      <aside style={{display:'grid',gap:12,position:'sticky',top:20}}>
        <section style={card}><div style={{display:'flex',gap:8,alignItems:'center',color:'#8fc4ff'}}><Sparkles size={17}/><b>How ELP forecasts</b></div><p style={{fontSize:13,lineHeight:1.6,color:'#a9bfd2'}}>Structured obligations, blocking decisions, dependencies, relationship momentum and strategic signals are combined with a strictly read-only seven-day calendar/email scan. Forecasts are early warnings, not facts.</p></section>
        <section style={card}><div style={{fontSize:11,letterSpacing:1.2,color:'#6f9dc8'}}>CONNECTED LOOKAHEAD</div><p style={{fontSize:13,lineHeight:1.55,color:'#b9cede',whiteSpace:'pre-wrap'}}>{snapshot?.forwardScanSummary||'Run a scan to generate the seven-day connected lookahead.'}</p></section>
        <section style={card}><div style={{fontSize:11,letterSpacing:1.2,color:'#78e1b5'}}>AUTONOMY BOUNDARY</div><p style={{fontSize:13,lineHeight:1.55,color:'#a9bfd2'}}>ELP may prepare internal preventive work automatically. Sending messages, changing calendars, publishing, deploying, buying, deleting, cancelling or other external mutations still require explicit approval.</p></section>
      </aside>
    </section>
  </main>;
}
