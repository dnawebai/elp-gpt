'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BrainCircuit, CheckCircle2, Gauge, GitBranch, LoaderCircle, RefreshCw, Scale, ShieldAlert, Sparkles, Users } from 'lucide-react';

type Scorecard={strategicFit:number;expectedValue:number;downsideRisk:number;reversibility:number;executionComplexity:number;evidenceStrength:number;relationshipImpact:number;decisionScore:number};
type Option={id:string;label:string;description:string;expectedOutcome:string;bestCase:string;baseCase:string;worstCase:string;upside:string[];downside:string[];failureModes:string[];secondOrderEffects:string[];dependencies:string[];relationshipEffects:string[];irreversibleMoves:string[];evidenceGaps:string[];reversalTriggers:string[];scorecard:Scorecard};
type Perspective={id:string;title:string;analysis:string;provider:string};
type Simulation={id:string;decision:string;objective?:string;context?:string;generatedAt:string;options:Option[];recommendation:{selectedOptionId:string;selectedOptionLabel:string;recommendation:string;why:string[];materialDissent:string[];assumptionsToVerify:string[];preMortem:string[];reversalTriggers:string[];nextBestAction:string;confidence:number};shadowBoard:{synthesis:string;perspectives:Perspective[];failedRoles:Array<{id:string;error:string}>};promotedLedgerId?:string};

export default function StrategicSimulationPage(){
  const [decision,setDecision]=useState('');
  const [objective,setObjective]=useState('');
  const [context,setContext]=useState('');
  const [optionsText,setOptionsText]=useState('');
  const [simulation,setSimulation]=useState<Simulation|null>(null);
  const [history,setHistory]=useState<Simulation[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);

  useEffect(()=>{void fetch('/api/identity',{method:'POST',cache:'no-store'}).then(()=>loadHistory()).catch(()=>loadHistory());},[]);

  async function loadHistory(){
    const response=await fetch('/api/strategic-simulation',{cache:'no-store'});
    const data=await response.json().catch(()=>null) as {data?:Simulation[]}|null;
    if(response.ok&&Array.isArray(data?.data)) setHistory(data!.data!);
  }

  async function run(){
    if(!decision.trim()){setError('Enter the decision you want ELP to simulate.');return;}
    setBusy(true);setError(null);setMessage(null);
    try{
      const sessionId=window.sessionStorage.getItem('elp-session-id')||crypto.randomUUID();
      window.sessionStorage.setItem('elp-session-id',sessionId);
      const options=optionsText.split('\n').map((line)=>line.trim()).filter(Boolean).map((description,index)=>({label:`Option ${index+1}`,description}));
      const response=await fetch('/api/strategic-simulation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,objective,context,options:options.length>=2?options:undefined,sessionId}),cache:'no-store'});
      const data=await response.json().catch(()=>null) as {simulation?:Simulation;error?:string}|null;
      if(!response.ok||!data?.simulation) throw new Error(data?.error||'Strategic simulation failed.');
      setSimulation(data.simulation);setMessage(`Simulation complete. ELP recommends ${data.simulation.recommendation.selectedOptionLabel} at ${Math.round(data.simulation.recommendation.confidence*100)}% confidence.`);void loadHistory();
    }catch(caught){setError(caught instanceof Error?caught.message:'Strategic simulation failed.');}
    finally{setBusy(false);}
  }

  async function promote(){
    if(!simulation)return;
    setBusy(true);setError(null);setMessage(null);
    try{
      const response=await fetch('/api/strategic-simulation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'promote',simulationId:simulation.id}),cache:'no-store'});
      const data=await response.json().catch(()=>null) as {ledgerId?:string;error?:string}|null;
      if(!response.ok||!data?.ledgerId)throw new Error(data?.error||'Could not promote decision.');
      setSimulation({...simulation,promotedLedgerId:data.ledgerId});setMessage('Recommended decision promoted to the Executive Ledger.');void loadHistory();
    }catch(caught){setError(caught instanceof Error?caught.message:'Could not promote decision.');}
    finally{setBusy(false);}
  }

  const selected=useMemo(()=>simulation?.options.find((item)=>item.id===simulation.recommendation.selectedOptionId)||null,[simulation]);
  const card={border:'1px solid #1d3b57',background:'#091827',borderRadius:16,padding:18} as const;
  const input={width:'100%',boxSizing:'border-box' as const,border:'1px solid #315572',background:'#071522',color:'#eaf4ff',borderRadius:12,padding:12,outline:'none'};
  const button={border:'1px solid #315572',background:'#0b1d2e',color:'#dceeff',borderRadius:999,padding:'9px 13px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:7} as const;

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#eaf4ff',padding:26,fontFamily:'Inter,Arial,sans-serif'}}>
    <header style={{maxWidth:1380,margin:'0 auto 22px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
      <Link href="/" style={{display:'flex',alignItems:'center',gap:8,color:'#9dc9ff',textDecoration:'none'}}><ArrowLeft size={17}/> ELP</Link>
      <div style={{textAlign:'center'}}><div style={{fontSize:11,letterSpacing:2,color:'#6f9dc8'}}>ELP</div><h1 style={{margin:'4px 0'}}>Strategic Simulation Engine</h1><div style={{fontSize:12,color:'#78e1b5'}}>PRE-MORTEM · COUNTERFACTUALS · SHADOW BOARD · REVERSAL TRIGGERS</div></div>
      <button onClick={()=>void loadHistory()} style={button}><RefreshCw size={15}/> History</button>
    </header>

    {error&&<div style={{maxWidth:1380,margin:'0 auto 14px',padding:13,border:'1px solid #763348',background:'#2a1119',borderRadius:12,color:'#ffd9df'}}>{error}</div>}
    {message&&<div style={{maxWidth:1380,margin:'0 auto 14px',padding:13,border:'1px solid #28644f',background:'#0a261d',borderRadius:12,color:'#bdf4dc'}}>{message}</div>}

    <section style={{maxWidth:1380,margin:'0 auto 18px',display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(300px,.36fr)',gap:16,alignItems:'start'}}>
      <div style={card}>
        <div style={{display:'flex',alignItems:'center',gap:8,color:'#8fc4ff',marginBottom:14}}><BrainCircuit size={18}/><b>Decision to simulate</b></div>
        <div style={{display:'grid',gap:10}}>
          <textarea value={decision} onChange={(e)=>setDecision(e.target.value)} placeholder="What decision are you considering?" rows={3} style={input}/>
          <textarea value={objective} onChange={(e)=>setObjective(e.target.value)} placeholder="What outcome are you trying to maximise?" rows={2} style={input}/>
          <textarea value={context} onChange={(e)=>setContext(e.target.value)} placeholder="Optional context, constraints, numbers, people, timing, or assumptions." rows={4} style={input}/>
          <textarea value={optionsText} onChange={(e)=>setOptionsText(e.target.value)} placeholder={'Optional: one course of action per line. Leave blank and ELP will generate distinct alternatives.'} rows={4} style={input}/>
          <div><button disabled={busy} onClick={()=>void run()} style={button}>{busy?<LoaderCircle size={16}/>:<Sparkles size={16}/>} Run simulation</button></div>
        </div>
      </div>
      <aside style={{display:'grid',gap:12}}>
        <section style={card}><div style={{display:'flex',gap:8,alignItems:'center',color:'#8fc4ff'}}><Scale size={17}/><b>Decision discipline</b></div><p style={{fontSize:13,lineHeight:1.6,color:'#a9bfd2'}}>Scores are decision aids, not truth. ELP also preserves dissent, missing evidence, irreversible moves, and the conditions that should cause you to reverse course.</p></section>
        <section style={card}><div style={{fontSize:11,letterSpacing:1.2,color:'#78e1b5'}}>ADVISORY ONLY</div><p style={{fontSize:13,lineHeight:1.55,color:'#a9bfd2'}}>Simulation never executes external actions. Promoting a recommendation writes only an internal Executive Ledger decision.</p></section>
      </aside>
    </section>

    {simulation&&<section style={{maxWidth:1380,margin:'0 auto',display:'grid',gap:16}}>
      <div style={{...card,borderColor:'#2d765d'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}><div><div style={{fontSize:11,letterSpacing:1.2,color:'#78e1b5'}}>CHAIR RECOMMENDATION</div><h2 style={{margin:'7px 0'}}>{simulation.recommendation.selectedOptionLabel}</h2></div><div style={{display:'flex',gap:8,alignItems:'center'}}><span style={{fontSize:12,color:'#9ec9ff'}}>{Math.round(simulation.recommendation.confidence*100)}% confidence</span><button disabled={busy||Boolean(simulation.promotedLedgerId)} onClick={()=>void promote()} style={button}>{simulation.promotedLedgerId?<CheckCircle2 size={15}/>:<GitBranch size={15}/>} {simulation.promotedLedgerId?'In Executive Ledger':'Promote decision'}</button></div></div>
        <p style={{lineHeight:1.6,color:'#d6e7f4'}}>{simulation.recommendation.recommendation}</p>
        {simulation.recommendation.why.length>0&&<div style={{display:'grid',gap:5,fontSize:13,color:'#bcd4e7'}}>{simulation.recommendation.why.map((item,index)=><div key={index}>• {item}</div>)}</div>}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14}}>{simulation.options.map((option)=><article key={option.id} style={{...card,borderColor:option.id===selected?.id?'#3c8a69':'#1d3b57'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:10}}><h3 style={{marginTop:0}}>{option.label}</h3><span style={{fontSize:22,fontWeight:700,color:option.id===selected?.id?'#78e1b5':'#9ec9ff'}}>{option.scorecard.decisionScore}</span></div>
        <p style={{color:'#bfd2e1',lineHeight:1.5}}>{option.description}</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8,fontSize:11,color:'#8fb0ca'}}>{Object.entries(option.scorecard).filter(([key])=>key!=='decisionScore').map(([key,value])=><div key={key} style={{border:'1px solid #19354d',borderRadius:10,padding:8}}><div>{key.replace(/[A-Z]/g,(m)=>` ${m}`).toUpperCase()}</div><b style={{fontSize:16,color:'#dceeff'}}>{value}</b></div>)}</div>
        <details style={{marginTop:12}}><summary style={{cursor:'pointer',color:'#9ec9ff'}}>Scenarios & pre-mortem</summary><div style={{display:'grid',gap:8,marginTop:10,fontSize:13,lineHeight:1.5}}><div><b>Best case:</b> {option.bestCase}</div><div><b>Base case:</b> {option.baseCase}</div><div><b>Worst case:</b> {option.worstCase}</div>{option.failureModes.length>0&&<div><b>Failure modes:</b> {option.failureModes.join(' · ')}</div>}{option.secondOrderEffects.length>0&&<div><b>Second-order effects:</b> {option.secondOrderEffects.join(' · ')}</div>}{option.dependencies.length>0&&<div><b>Dependencies:</b> {option.dependencies.join(' · ')}</div>}{option.irreversibleMoves.length>0&&<div><b>Irreversible moves:</b> {option.irreversibleMoves.join(' · ')}</div>}{option.reversalTriggers.length>0&&<div><b>Reversal triggers:</b> {option.reversalTriggers.join(' · ')}</div>}</div></details>
      </article>)}</div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(310px,1fr))',gap:14}}>
        <section style={card}><div style={{display:'flex',alignItems:'center',gap:8,color:'#ffbe8b'}}><ShieldAlert size={17}/><b>Pre-mortem</b></div><div style={{display:'grid',gap:7,marginTop:10,fontSize:13,color:'#cbddea'}}>{simulation.recommendation.preMortem.map((item,index)=><div key={index}>• {item}</div>)}</div></section>
        <section style={card}><div style={{display:'flex',alignItems:'center',gap:8,color:'#9ec9ff'}}><Gauge size={17}/><b>Reversal triggers</b></div><div style={{display:'grid',gap:7,marginTop:10,fontSize:13,color:'#cbddea'}}>{simulation.recommendation.reversalTriggers.map((item,index)=><div key={index}>• {item}</div>)}</div></section>
        <section style={card}><div style={{display:'flex',alignItems:'center',gap:8,color:'#d1b5ff'}}><Users size={17}/><b>Material dissent</b></div><div style={{display:'grid',gap:7,marginTop:10,fontSize:13,color:'#cbddea'}}>{simulation.recommendation.materialDissent.map((item,index)=><div key={index}>• {item}</div>)}</div></section>
      </div>

      <section style={card}><div style={{display:'flex',alignItems:'center',gap:8,color:'#8fc4ff'}}><Users size={18}/><b>Shadow Board</b></div><div style={{whiteSpace:'pre-wrap',lineHeight:1.55,color:'#bcd1e2',marginTop:12}}>{simulation.shadowBoard.synthesis}</div><details style={{marginTop:12}}><summary style={{cursor:'pointer',color:'#9ec9ff'}}>Independent board submissions</summary><div style={{display:'grid',gap:10,marginTop:10}}>{simulation.shadowBoard.perspectives.map((item)=><div key={item.id} style={{borderTop:'1px solid #173049',paddingTop:10}}><b>{item.title}</b><div style={{whiteSpace:'pre-wrap',fontSize:13,lineHeight:1.5,color:'#abc2d5',marginTop:6}}>{item.analysis}</div></div>)}</div></details></section>

      <section style={card}><div style={{fontSize:11,letterSpacing:1.2,color:'#78e1b5'}}>NEXT BEST ACTION</div><p style={{lineHeight:1.55,color:'#d5e6f2'}}>{simulation.recommendation.nextBestAction||'No next action was produced.'}</p></section>
    </section>}

    {history.length>0&&<section style={{maxWidth:1380,margin:'18px auto 0'}}><div style={{fontSize:11,letterSpacing:1.2,color:'#6f9dc8',marginBottom:8}}>RECENT SIMULATIONS</div><div style={{display:'grid',gap:8}}>{history.slice(0,8).map((item)=><button key={item.id} onClick={()=>setSimulation(item)} style={{...button,borderRadius:12,justifyContent:'space-between',width:'100%',textAlign:'left'}}><span>{item.decision}</span><span style={{color:'#78e1b5'}}>{item.recommendation.selectedOptionLabel}</span></button>)}</div></section>}
  </main>;
}
