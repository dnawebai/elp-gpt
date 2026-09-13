'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Brain, CheckCircle2, Gauge, LoaderCircle, RefreshCw, ShieldCheck, Target, TriangleAlert, WandSparkles } from 'lucide-react';

type Snapshot = {
  generatedAt: string;
  policy: {
    constitution: null | { principles:string[]; hardConstraints:string[]; preferences:string[]; approvalPolicyNotes:string[]; updatedAt:string };
    intent: null | { objective:string; purpose:string; endState:string; priorities:string[]; constraints:string[]; nonGoals:string[]; timeHorizon?:string; updatedAt:string };
    evidence: Array<{ id:string; claim:string; evidence:string; source?:string; sourceType:string; status:string; confidence:number }>;
  };
  calibration: { sampleSize:number; resolvedDecisions:number; averageForecastAccuracy:number; averageOutcomeScore:number; assumptionHitRate:number; dimensions:Record<string,number>; recurringLessons:string[]; generatedAt:string };
  attention:Array<{id:string;source:string;severity:'critical'|'high'|'normal';title:string;reason:string;recommendedAction:string}>;
  assumptions:{ contradicted:Array<{id:string;text:string;confidence:number;evidence:string[];decision:string;outcomeId:string}>; open:Array<{id:string;text:string;confidence:number;evidence:string[];decision:string;outcomeId:string}> };
  uncertainty:{ totalOpenSignals:number;openAssumptions:number;unverifiedEvidence:number;lowConfidenceForecasts:number;level:string };
  recoveryPlays:Array<{id:string;title:string;trigger:string;response:string;sourceIds:string[]}>;
  skillProposals:Array<{id:string;title:string;reason:string;capability:string;risk:string}>;
  stats:{strategicSimulations:number;trackedDecisions:number;resolvedDecisions:number;activeLedgerItems:number;criticalAttention:number;highAttention:number;approvalRequired:number};
};

const splitLines=(value:string)=>value.split('\n').map((v)=>v.trim()).filter(Boolean);

export default function CognitiveControlPage(){
  const [data,setData]=useState<Snapshot|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [principles,setPrinciples]=useState('');
  const [constraints,setConstraints]=useState('');
  const [preferences,setPreferences]=useState('');
  const [approvalNotes,setApprovalNotes]=useState('');
  const [objective,setObjective]=useState('');
  const [purpose,setPurpose]=useState('');
  const [endState,setEndState]=useState('');
  const [priorities,setPriorities]=useState('');
  const [intentConstraints,setIntentConstraints]=useState('');
  const [nonGoals,setNonGoals]=useState('');
  const [timeHorizon,setTimeHorizon]=useState('');

  useEffect(()=>{ void fetch('/api/identity',{method:'POST',cache:'no-store'}).then(()=>load()).catch(()=>load()); },[]);

  async function load(){
    setError(null);
    const response=await fetch('/api/cognitive-control',{cache:'no-store'});
    const json=await response.json().catch(()=>null) as Snapshot & {error?:string}|null;
    if(!response.ok){setError(json?.error||'Could not load Cognitive Control.');return;}
    setData(json);
    if(json?.policy.constitution){
      setPrinciples(json.policy.constitution.principles.join('\n'));
      setConstraints(json.policy.constitution.hardConstraints.join('\n'));
      setPreferences(json.policy.constitution.preferences.join('\n'));
      setApprovalNotes(json.policy.constitution.approvalPolicyNotes.join('\n'));
    }
    if(json?.policy.intent){
      setObjective(json.policy.intent.objective);setPurpose(json.policy.intent.purpose);setEndState(json.policy.intent.endState);
      setPriorities(json.policy.intent.priorities.join('\n'));setIntentConstraints(json.policy.intent.constraints.join('\n'));setNonGoals(json.policy.intent.nonGoals.join('\n'));setTimeHorizon(json.policy.intent.timeHorizon||'');
    }
  }

  async function act(body:Record<string,unknown>,success:string){
    setBusy(true);setError(null);setMessage(null);
    try{
      const response=await fetch('/api/cognitive-control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
      const json=await response.json().catch(()=>null) as {error?:string}|null;
      if(!response.ok) throw new Error(json?.error||'Action failed.');
      setMessage(success);await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'Action failed.');}
    finally{setBusy(false);}
  }

  const card={border:'1px solid #203d58',background:'#091827',borderRadius:16,padding:18} as const;
  const input={width:'100%',boxSizing:'border-box' as const,background:'#07121f',border:'1px solid #294863',borderRadius:10,color:'#eaf4ff',padding:11,fontSize:13};
  const button={border:'1px solid #315572',background:'#0b1d2e',color:'#dceeff',borderRadius:999,padding:'9px 13px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:7} as const;
  const badge=(severity:string)=>({display:'inline-flex',border:'1px solid #315572',borderRadius:999,padding:'4px 8px',fontSize:10,letterSpacing:.6,color:severity==='critical'?'#ffadb9':severity==='high'?'#ffd47a':'#9ec9ff'} as const);

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#eaf4ff',padding:24,fontFamily:'Inter,Arial,sans-serif'}}>
    <header style={{maxWidth:1380,margin:'0 auto 20px',display:'flex',justifyContent:'space-between',gap:14,alignItems:'center',flexWrap:'wrap'}}>
      <Link href="/" style={{display:'flex',alignItems:'center',gap:7,color:'#9dc9ff',textDecoration:'none'}}><ArrowLeft size={17}/> ELP</Link>
      <div style={{textAlign:'center'}}><div style={{fontSize:10,letterSpacing:2,color:'#6f9dc8'}}>COGNITIVE OPERATING SYSTEM</div><h1 style={{margin:'4px 0'}}>Cognitive Control</h1><div style={{fontSize:12,color:'#78e1b5'}}>POLICY · INTENT · EVIDENCE · ASSUMPTIONS · LEARNING · RECOVERY</div></div>
      <button onClick={()=>void load()} style={button}><RefreshCw size={15}/> Refresh</button>
    </header>

    {error&&<div style={{maxWidth:1380,margin:'0 auto 12px',padding:12,borderRadius:12,border:'1px solid #743246',background:'#2a1119',color:'#ffdbe1'}}>{error}</div>}
    {message&&<div style={{maxWidth:1380,margin:'0 auto 12px',padding:12,borderRadius:12,border:'1px solid #2d654f',background:'#0a251d',color:'#c2f4dd'}}>{message}</div>}

    <section style={{maxWidth:1380,margin:'0 auto 16px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}>
      {[
        ['TRACKED DECISIONS',data?.stats.trackedDecisions||0,<Brain key="a" size={18}/>],['RESOLVED',data?.stats.resolvedDecisions||0,<CheckCircle2 key="b" size={18}/>],['FORECAST ACCURACY',`${data?.calibration.averageForecastAccuracy||0}%`,<Gauge key="c" size={18}/>],['CRITICAL ATTENTION',data?.stats.criticalAttention||0,<TriangleAlert key="d" size={18}/>],['OPEN UNCERTAINTY',data?.uncertainty.totalOpenSignals||0,<Target key="e" size={18}/>],['APPROVALS',data?.stats.approvalRequired||0,<ShieldCheck key="f" size={18}/>],
      ].map(([label,value,icon])=><div key={String(label)} style={card}><div style={{display:'flex',justifyContent:'space-between',color:'#719cc4'}}><span style={{fontSize:10,letterSpacing:1}}>{label}</span>{icon}</div><div style={{fontSize:27,fontWeight:700,marginTop:8}}>{String(value)}</div></div>)}
    </section>

    <section style={{maxWidth:1380,margin:'0 auto',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))',gap:14,alignItems:'start'}}>
      <div style={{display:'grid',gap:14}}>
        <section style={card}><div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12}}><ShieldCheck size={17}/><b>Personal Constitution</b></div><p style={{fontSize:12,color:'#88a6bf'}}>Explicit principles only. ELP must not infer additional values or weaken hard constraints.</p>
          <textarea value={principles} onChange={e=>setPrinciples(e.target.value)} placeholder="One principle per line" rows={4} style={input}/><div style={{height:8}}/><textarea value={constraints} onChange={e=>setConstraints(e.target.value)} placeholder="Hard constraints — one per line" rows={3} style={input}/><div style={{height:8}}/><textarea value={preferences} onChange={e=>setPreferences(e.target.value)} placeholder="Preferences — one per line" rows={3} style={input}/><div style={{height:8}}/><textarea value={approvalNotes} onChange={e=>setApprovalNotes(e.target.value)} placeholder="Approval policy notes — one per line" rows={3} style={input}/><div style={{marginTop:10}}><button disabled={busy} style={button} onClick={()=>void act({action:'save-constitution',principles:splitLines(principles),hardConstraints:splitLines(constraints),preferences:splitLines(preferences),approvalPolicyNotes:splitLines(approvalNotes)},'Personal Constitution saved.')}>{busy?<LoaderCircle size={15}/>:<ShieldCheck size={15}/>} Save constitution</button></div>
        </section>

        <section style={card}><div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12}}><Target size={17}/><b>Commander’s Intent</b></div><input value={objective} onChange={e=>setObjective(e.target.value)} placeholder="Objective" style={input}/><div style={{height:8}}/><textarea value={purpose} onChange={e=>setPurpose(e.target.value)} placeholder="Purpose — why this matters" rows={3} style={input}/><div style={{height:8}}/><textarea value={endState} onChange={e=>setEndState(e.target.value)} placeholder="Desired end state" rows={3} style={input}/><div style={{height:8}}/><textarea value={priorities} onChange={e=>setPriorities(e.target.value)} placeholder="Priorities — one per line" rows={3} style={input}/><div style={{height:8}}/><textarea value={intentConstraints} onChange={e=>setIntentConstraints(e.target.value)} placeholder="Constraints — one per line" rows={3} style={input}/><div style={{height:8}}/><textarea value={nonGoals} onChange={e=>setNonGoals(e.target.value)} placeholder="Non-goals — one per line" rows={3} style={input}/><div style={{height:8}}/><input value={timeHorizon} onChange={e=>setTimeHorizon(e.target.value)} placeholder="Time horizon" style={input}/><div style={{marginTop:10}}><button disabled={busy} style={button} onClick={()=>void act({action:'save-intent',objective,purpose,endState,priorities:splitLines(priorities),constraints:splitLines(intentConstraints),nonGoals:splitLines(nonGoals),timeHorizon},'Commander’s Intent saved.')}><Target size={15}/> Save intent</button></div></section>
      </div>

      <div style={{display:'grid',gap:14}}>
        <section style={card}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><b>Attention Controller</b><span style={{fontSize:11,color:'#7da3c4'}}>only material exceptions</span></div><div style={{display:'grid',gap:10,marginTop:12}}>{(data?.attention||[]).slice(0,12).map(item=><div key={item.id} style={{borderTop:'1px solid #17324a',paddingTop:10}}><div style={{display:'flex',gap:8,alignItems:'center'}}><span style={badge(item.severity)}>{item.severity.toUpperCase()}</span><b style={{fontSize:13}}>{item.title}</b></div><div style={{fontSize:12,color:'#a9bfd2',lineHeight:1.5,marginTop:5}}>{item.reason}</div><div style={{fontSize:12,color:'#9bd6bc',lineHeight:1.45,marginTop:5}}>Next: {item.recommendedAction}</div></div>)}{!data?.attention?.length&&<div style={{color:'#809db6',fontSize:13}}>No material exceptions currently require attention.</div>}</div></section>

        <section style={card}><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><b>Decision Learning</b><button disabled={busy} style={button} onClick={()=>void act({action:'evaluate-due',sessionId:crypto.randomUUID()},'Decision outcomes reviewed and calibration refreshed.')}><WandSparkles size={14}/> Review due outcomes</button></div><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginTop:12}}><div><div style={{fontSize:10,color:'#708fa9'}}>ACCURACY</div><b>{data?.calibration.averageForecastAccuracy||0}%</b></div><div><div style={{fontSize:10,color:'#708fa9'}}>OUTCOME</div><b>{data?.calibration.averageOutcomeScore||0}%</b></div><div><div style={{fontSize:10,color:'#708fa9'}}>ASSUMPTION HIT RATE</div><b>{data?.calibration.assumptionHitRate||0}%</b></div></div>{data?.calibration.recurringLessons?.length?<div style={{marginTop:12,fontSize:12,color:'#b5cada',lineHeight:1.5}}>{data.calibration.recurringLessons.slice(0,6).map((lesson,i)=><div key={i}>• {lesson}</div>)}</div>:null}</section>

        <section style={card}><b>Assumption Register</b><div style={{fontSize:11,color:'#ffb3bf',margin:'10px 0 6px'}}>CONTRADICTED</div>{(data?.assumptions.contradicted||[]).slice(0,8).map(item=><div key={item.id} style={{fontSize:12,lineHeight:1.45,padding:'6px 0',borderTop:'1px solid #17324a'}}><b>{item.text}</b><div style={{color:'#829fb6'}}>{item.decision}</div></div>)}<div style={{fontSize:11,color:'#9fcaff',margin:'12px 0 6px'}}>OPEN / UNKNOWN</div>{(data?.assumptions.open||[]).slice(0,8).map(item=><div key={item.id} style={{fontSize:12,lineHeight:1.45,padding:'6px 0',borderTop:'1px solid #17324a'}}>{item.text}</div>)}</section>
      </div>

      <div style={{display:'grid',gap:14}}>
        <section style={card}><b>Uncertainty Budget</b><div style={{fontSize:32,fontWeight:700,margin:'10px 0'}}>{(data?.uncertainty.level||'low').toUpperCase()}</div><div style={{fontSize:12,lineHeight:1.7,color:'#a9bfd2'}}>Open assumptions: {data?.uncertainty.openAssumptions||0}<br/>Unverified evidence: {data?.uncertainty.unverifiedEvidence||0}<br/>Low-confidence forecasts: {data?.uncertainty.lowConfidenceForecasts||0}</div></section>

        <section style={card}><b>Failure Recovery</b><div style={{display:'grid',gap:10,marginTop:10}}>{(data?.recoveryPlays||[]).slice(0,8).map(play=><div key={play.id} style={{borderTop:'1px solid #17324a',paddingTop:9}}><b style={{fontSize:13}}>{play.title}</b><div style={{fontSize:12,color:'#a9bfd2',lineHeight:1.45,marginTop:4}}>{play.trigger}</div><div style={{fontSize:12,color:'#9bd6bc',lineHeight:1.45,marginTop:5}}>Recovery: {play.response}</div></div>)}{!data?.recoveryPlays?.length&&<div style={{fontSize:12,color:'#809db6'}}>No active recovery play is required.</div>}</div></section>

        <section style={card}><div style={{display:'flex',gap:8,alignItems:'center'}}><WandSparkles size={17}/><b>Skill Factory Proposals</b></div><p style={{fontSize:12,color:'#829fb6'}}>Proposals only. ELP does not install new capabilities or widen permissions automatically.</p>{(data?.skillProposals||[]).map(skill=><div key={skill.id} style={{borderTop:'1px solid #17324a',padding:'9px 0'}}><div style={{display:'flex',justifyContent:'space-between',gap:8}}><b style={{fontSize:13}}>{skill.title}</b><span style={badge(skill.risk==='high'?'critical':skill.risk==='write'?'high':'normal')}>{skill.risk.toUpperCase()}</span></div><div style={{fontSize:12,color:'#a9bfd2',lineHeight:1.45,marginTop:4}}>{skill.reason}</div><div style={{fontSize:12,color:'#9fcaff',lineHeight:1.45,marginTop:4}}>{skill.capability}</div></div>)}</section>
      </div>
    </section>
  </main>;
}
