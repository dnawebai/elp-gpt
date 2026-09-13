'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock3, LoaderCircle, Play, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';

type PendingAction = { toolSlug:string; arguments:Record<string,unknown>; summary:string; risk:'write'|'high' };
type RecordItem = {
  id:string;
  targetType:'commitment'|'task';
  targetId:string;
  title:string;
  status:'completed'|'approval_required'|'needs_input'|'blocked';
  summary:string;
  createdAt:string;
  updatedAt?:string;
  nextReviewAt?:string;
  pendingAction?:PendingAction;
  evidence?:string;
  question?:string;
};
type Snapshot = { configured:boolean; available:boolean; generatedAt:string; records:RecordItem[]; stats:{total:number;completed:number;approvalRequired:number;needsInput:number;blocked:number} };
type PendingPlan = {
  recordId:string;
  action:{toolSlug:string;arguments:Record<string,unknown>;connectedAccountId?:string;summary:string};
  proposalToken:string;
  risk:'write'|'high';
  policy:string;
};

export default function CommitmentFulfilmentPage(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [sessionId,setSessionId]=useState('commitment-fulfilment');
  const [pending,setPending]=useState<PendingPlan|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    const existing=window.sessionStorage.getItem('elp-session-id')||window.sessionStorage.getItem('luke-session-id');
    const id=existing||crypto.randomUUID();
    if(!existing) window.sessionStorage.setItem('elp-session-id',id);
    setSessionId(id);
    void fetch('/api/identity',{method:'POST',cache:'no-store'}).then(()=>load()).catch(()=>load());
  },[]);

  async function load(){
    setError(null);
    const response=await fetch('/api/commitment-fulfilment',{cache:'no-store'});
    const data=await response.json().catch(()=>null) as Snapshot & {error?:string}|null;
    if(!response.ok){setError(data?.error||'Could not load autonomous fulfilment.');return;}
    setSnapshot(data);
  }

  async function runNow(){
    setBusy('run');setError(null);setMessage(null);setPending(null);
    try{
      const response=await fetch('/api/commitment-fulfilment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'run',sessionId,limit:4}),cache:'no-store'});
      const data=await response.json().catch(()=>null) as {reviewed?:number;completed?:number;approvalRequired?:number;needsInput?:number;blocked?:number;error?:string}|null;
      if(!response.ok) throw new Error(data?.error||'Autonomous fulfilment run failed.');
      setMessage(`Reviewed ${data?.reviewed||0} obligations · ${data?.completed||0} completed · ${data?.approvalRequired||0} awaiting approval · ${data?.needsInput||0} need input · ${data?.blocked||0} blocked.`);
      await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'Autonomous fulfilment run failed.');}
    finally{setBusy(null);}
  }

  async function prepare(record:RecordItem){
    setBusy(`prepare-${record.id}`);setError(null);setMessage(null);setPending(null);
    try{
      const pendingResponse=await fetch('/api/commitment-fulfilment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pending',recordId:record.id}),cache:'no-store'});
      const pendingData=await pendingResponse.json().catch(()=>null) as {pendingAction?:PendingAction;error?:string}|null;
      if(!pendingResponse.ok||!pendingData?.pendingAction) throw new Error(pendingData?.error||'No pending action is available.');
      const planResponse=await fetch('/api/actions/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,toolSlug:pendingData.pendingAction.toolSlug,arguments:pendingData.pendingAction.arguments,summary:pendingData.pendingAction.summary}),cache:'no-store'});
      const plan=await planResponse.json().catch(()=>null) as Omit<PendingPlan,'recordId'> & {configured?:boolean;requiresApproval?:boolean;error?:string}|null;
      if(!planResponse.ok||!plan?.proposalToken) throw new Error(plan?.error||'Could not create approval proposal.');
      if(!plan.configured) throw new Error('Connected-app execution is not configured on this deployment.');
      if(!plan.requiresApproval) throw new Error('Expected an approval-required external action.');
      setPending({...plan,recordId:record.id});
      setMessage('Exact external action prepared. Review it before approving execution.');
    }catch(caught){setError(caught instanceof Error?caught.message:'Approval preparation failed.');}
    finally{setBusy(null);}
  }

  async function approveAndExecute(){
    if(!pending)return;
    setBusy('execute');setError(null);setMessage(null);
    try{
      const approvalResponse=await fetch('/api/actions/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proposalToken:pending.proposalToken,sessionId}),cache:'no-store'});
      const approval=await approvalResponse.json().catch(()=>null) as {executionToken?:string;error?:string}|null;
      if(!approvalResponse.ok||!approval?.executionToken) throw new Error(approval?.error||'Approval failed.');
      const executionResponse=await fetch('/api/actions/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:approval.executionToken,sessionId,toolSlug:pending.action.toolSlug,arguments:pending.action.arguments,connectedAccountId:pending.action.connectedAccountId}),cache:'no-store'});
      const execution=await executionResponse.json().catch(()=>null) as {ok?:boolean;result?:unknown;error?:string}|null;
      if(!executionResponse.ok||execution?.ok===false) throw new Error(execution?.error||'Execution failed.');
      let evidence='Approved action executed successfully.';
      try{evidence=JSON.stringify(execution?.result||{}).slice(0,2400);}catch{}
      await fetch('/api/commitment-fulfilment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'executed',recordId:pending.recordId,evidence}),cache:'no-store'});
      setPending(null);setMessage('Approved action executed and recorded. The underlying commitment remains open until its outcome is verified.');
      await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'Approved execution failed.');}
    finally{setBusy(null);}
  }

  const live=useMemo(()=>snapshot?.records.filter((record)=>record.status!=='completed')||[],[snapshot]);
  const recentDone=useMemo(()=>snapshot?.records.filter((record)=>record.status==='completed').slice(0,12)||[],[snapshot]);
  const card={border:'1px solid #1d3b57',background:'#0a1827',borderRadius:16,padding:18} as const;
  const button={border:'1px solid #315572',background:'#0b1d2e',color:'#dceeff',borderRadius:999,padding:'9px 13px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:7} as const;
  const badge=(status:RecordItem['status'])=>({display:'inline-flex',border:'1px solid #315572',borderRadius:999,padding:'5px 9px',fontSize:11,letterSpacing:.6,color:status==='approval_required'?'#ffd47a':status==='completed'?'#8ce5bb':status==='needs_input'?'#9ec9ff':'#ffb3be'} as const);

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#eaf4ff',padding:26,fontFamily:'Inter,Arial,sans-serif'}}>
    <header style={{maxWidth:1280,margin:'0 auto 22px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
      <Link href="/" style={{display:'flex',alignItems:'center',gap:8,color:'#9dc9ff',textDecoration:'none'}}><ArrowLeft size={17}/> ELP</Link>
      <div style={{textAlign:'center'}}><div style={{fontSize:11,letterSpacing:2,color:'#6f9dc8'}}>JARBIS</div><h1 style={{margin:'4px 0'}}>Autonomous Commitment Fulfilment</h1><div style={{fontSize:12,color:'#78e1b5'}}>READ-ONLY AUTONOMY · INTERNAL PREPARATION · APPROVAL-GATED WRITES</div></div>
      <div style={{display:'flex',gap:8}}><button onClick={()=>void load()} style={button}><RefreshCw size={15}/> Refresh</button><button disabled={busy==='run'} onClick={()=>void runNow()} style={button}>{busy==='run'?<LoaderCircle size={15}/>:<Play size={15}/>} Run now</button></div>
    </header>

    {error&&<div style={{maxWidth:1280,margin:'0 auto 14px',padding:13,border:'1px solid #763348',background:'#2a1119',borderRadius:12,color:'#ffd9df'}}>{error}</div>}
    {message&&<div style={{maxWidth:1280,margin:'0 auto 14px',padding:13,border:'1px solid #28644f',background:'#0a261d',borderRadius:12,color:'#bdf4dc'}}>{message}</div>}

    <section style={{maxWidth:1280,margin:'0 auto',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:16}}>
      {[
        ['AWAITING APPROVAL',snapshot?.stats.approvalRequired||0,<ShieldAlert key="a" size={18}/>],
        ['NEEDS INPUT',snapshot?.stats.needsInput||0,<Clock3 key="b" size={18}/>],
        ['BLOCKED',snapshot?.stats.blocked||0,<ShieldAlert key="c" size={18}/>],
        ['COMPLETED REVIEWS',snapshot?.stats.completed||0,<CheckCircle2 key="d" size={18}/>],
      ].map(([label,value,icon])=><div key={String(label)} style={card}><div style={{display:'flex',justifyContent:'space-between',color:'#719cc4'}}><span style={{fontSize:10,letterSpacing:1.1}}>{label}</span>{icon}</div><div style={{fontSize:28,fontWeight:700,marginTop:8}}>{String(value)}</div></div>)}
    </section>

    <section style={{maxWidth:1280,margin:'0 auto',display:'grid',gridTemplateColumns:'minmax(0,1.4fr) minmax(300px,.7fr)',gap:16,alignItems:'start'}}>
      <div style={{display:'grid',gap:12}}>
        <div style={{fontSize:11,letterSpacing:1.3,color:'#6f9dc8'}}>LIVE AUTONOMOUS QUEUE</div>
        {live.length===0?<div style={{...card,color:'#829eb6'}}>No open fulfilment exceptions. The next scheduled cycle will continue reviewing material commitments automatically.</div>:live.map((record)=><article key={record.id} style={card}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}><div><span style={badge(record.status)}>{record.status.replaceAll('_',' ').toUpperCase()}</span><h3 style={{margin:'9px 0 4px'}}>{record.title}</h3><div style={{fontSize:11,color:'#7594ad'}}>{record.targetType.toUpperCase()} · {new Date(record.updatedAt||record.createdAt).toLocaleString()}</div></div>{record.status==='approval_required'&&<button disabled={Boolean(busy)} onClick={()=>void prepare(record)} style={button}>{busy===`prepare-${record.id}`?<LoaderCircle size={15}/>:<ShieldAlert size={15}/>} Review action</button>}</div>
          <p style={{lineHeight:1.55,color:'#c9dceb'}}>{record.summary}</p>{record.question&&<div style={{borderLeft:'3px solid #6da8df',paddingLeft:10,color:'#cfe5fa'}}>Input needed: {record.question}</div>}
          {record.pendingAction&&<div style={{marginTop:10,fontSize:12,color:'#e6c779'}}>Prepared: {record.pendingAction.summary} · {record.pendingAction.toolSlug}</div>}
        </article>)}

        <div style={{fontSize:11,letterSpacing:1.3,color:'#6f9dc8',marginTop:8}}>RECENT VERIFIED/PREPARED WORK</div>
        {recentDone.map((record)=><article key={record.id} style={{...card,padding:14}}><div style={{display:'flex',alignItems:'center',gap:8,color:'#8ce5bb'}}><CheckCircle2 size={15}/><b>{record.title}</b></div><div style={{fontSize:13,color:'#9fb6c8',marginTop:7,lineHeight:1.45}}>{record.summary}</div></article>)}
      </div>

      <aside style={{display:'grid',gap:12,position:'sticky',top:20}}>
        <section style={card}><div style={{display:'flex',gap:8,alignItems:'center',color:'#8fc4ff'}}><Sparkles size={17}/><b>Autonomy policy</b></div><p style={{fontSize:13,lineHeight:1.6,color:'#a9bfd2'}}>ELP may research, inspect connected systems, reconcile evidence, prepare drafts, and update internal work state. It cannot send, publish, book, deploy, purchase, delete, cancel, or change an external system without your explicit approval.</p></section>
        {pending&&<section style={{...card,borderColor:'#6b5b2d',background:'#211b0d'}}><div style={{fontSize:11,letterSpacing:1.2,color:'#ffcc72'}}>EXACT ACTION WAITING FOR APPROVAL</div><h3>{pending.action.summary}</h3><div style={{fontSize:12,color:'#d2c49a'}}>Tool: {pending.action.toolSlug} · Risk: {pending.risk.toUpperCase()}</div><pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',fontFamily:'ui-monospace,monospace',fontSize:11,color:'#eee4c7',maxHeight:320,overflow:'auto'}}>{JSON.stringify(pending.action.arguments,null,2)}</pre><button disabled={busy==='execute'} onClick={()=>void approveAndExecute()} style={{...button,borderColor:'#6a8e55'}}>{busy==='execute'?<LoaderCircle size={15}/>:<CheckCircle2 size={15}/>} Approve & execute</button></section>}
      </aside>
    </section>
  </main>;
}
