'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BrainCircuit, CheckCircle2, LoaderCircle, Mail, RefreshCw, Send, Target } from 'lucide-react';

type FollowUp = { target: string; channel: 'email'|'message'|'call'|'internal'; subject?: string; draft: string; reason: string };
type Insights = { summary: string; followUps: FollowUp[] };
type Meeting = { id:string; title:string; objective?:string; status:string; createdAt:string; finalInsights?:Insights };
type PendingPlan = {
  followUpIndex: number;
  action: { toolSlug:string; arguments:Record<string,unknown>; connectedAccountId?:string; summary:string };
  proposalToken: string;
  risk: 'write'|'high';
  policy: string;
};
type Outcome = { meetingId:string; title:string; objective:string; status:'pending'|'achieved'|'partial'|'missed'|'abandoned'; score:number; confidence:number; summary?:string; evidence:string[]; lessons:string[]; nextActions:string[]; updatedAt:string; nextReviewAt?:string };
type OutcomeSnapshot = { outcomes:Outcome[]; stats:{total:number;pending:number;achieved:number;partial:number;missed:number;averageScore:number} };

export default function FollowUpsPage() {
  const [meetings,setMeetings]=useState<Meeting[]>([]);
  const [outcomes,setOutcomes]=useState<OutcomeSnapshot|null>(null);
  const [selectedId,setSelectedId]=useState('');
  const [sessionId,setSessionId]=useState('follow-ups');
  const [pending,setPending]=useState<PendingPlan|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    const existing=window.sessionStorage.getItem('luke-session-id');
    const id=existing||crypto.randomUUID();
    if(!existing) window.sessionStorage.setItem('luke-session-id',id);
    setSessionId(id);
    void fetch('/api/identity',{method:'POST',cache:'no-store'}).then(()=>load()).catch(()=>load());
  },[]);

  async function load(){
    setError(null);
    try{
      const [meetingResponse,outcomeResponse]=await Promise.all([
        fetch('/api/meetings',{cache:'no-store'}),
        fetch('/api/meeting-outcomes',{cache:'no-store'}),
      ]);
      const meetingData=await meetingResponse.json().catch(()=>null) as {meetings?:Meeting[];error?:string}|null;
      const outcomeData=await outcomeResponse.json().catch(()=>null) as OutcomeSnapshot & {error?:string}|null;
      if(!meetingResponse.ok) throw new Error(meetingData?.error||'Could not load meetings.');
      if(!outcomeResponse.ok) throw new Error(outcomeData?.error||'Could not load outcomes.');
      const completed=(meetingData?.meetings||[]).filter((item)=>item.status==='completed'&&item.finalInsights);
      setMeetings(completed);
      setOutcomes(outcomeData);
      if(!selectedId&&completed[0]) setSelectedId(completed[0].id);
    }catch(caught){setError(caught instanceof Error?caught.message:'Could not load post-meeting work.');}
  }

  const selected=useMemo(()=>meetings.find((item)=>item.id===selectedId)||null,[meetings,selectedId]);
  const outcome=outcomes?.outcomes.find((item)=>item.meetingId===selectedId)||null;

  async function prepare(index:number){
    if(!selected) return;
    setBusy(`prepare-${index}`);setError(null);setMessage(null);setPending(null);
    try{
      const preparedResponse=await fetch('/api/meeting-follow-up',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prepare',meetingId:selected.id,index}),cache:'no-store'});
      const prepared=await preparedResponse.json().catch(()=>null) as {pendingAction?:{toolSlug:string;arguments:Record<string,unknown>;summary:string};error?:string}|null;
      if(!preparedResponse.ok||!prepared?.pendingAction) throw new Error(prepared?.error||'Could not prepare follow-up.');
      const planResponse=await fetch('/api/actions/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,toolSlug:prepared.pendingAction.toolSlug,arguments:prepared.pendingAction.arguments,summary:prepared.pendingAction.summary}),cache:'no-store'});
      const plan=await planResponse.json().catch(()=>null) as PendingPlan & {requiresApproval?:boolean;configured?:boolean;error?:string}|null;
      if(!planResponse.ok||!plan?.proposalToken) throw new Error(plan?.error||'Could not create approval proposal.');
      if(!plan.configured) throw new Error('Composio is not configured on this deployment.');
      if(!plan.requiresApproval) throw new Error('Expected an approval-required external write action.');
      setPending({...plan,followUpIndex:index});
      setMessage('Exact Gmail action prepared. Review the recipient, subject and draft, then approve the send.');
    }catch(caught){setError(caught instanceof Error?caught.message:'Follow-up preparation failed.');}
    finally{setBusy(null);}
  }

  async function approveAndSend(){
    if(!pending||!selected) return;
    setBusy('send');setError(null);setMessage(null);
    try{
      const approvalResponse=await fetch('/api/actions/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proposalToken:pending.proposalToken,sessionId}),cache:'no-store'});
      const approval=await approvalResponse.json().catch(()=>null) as {executionToken?:string;error?:string}|null;
      if(!approvalResponse.ok||!approval?.executionToken) throw new Error(approval?.error||'Approval failed.');
      const executionResponse=await fetch('/api/actions/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:approval.executionToken,sessionId,toolSlug:pending.action.toolSlug,arguments:pending.action.arguments,connectedAccountId:pending.action.connectedAccountId}),cache:'no-store'});
      const execution=await executionResponse.json().catch(()=>null) as {ok?:boolean;result?:unknown;error?:string}|null;
      if(!executionResponse.ok||execution?.ok===false) throw new Error(execution?.error||'Follow-up execution failed.');
      const evidence=JSON.stringify(execution?.result||{}).slice(0,1200);
      await fetch('/api/meeting-follow-up',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'record-executed',meetingId:selected.id,index:pending.followUpIndex,evidence}),cache:'no-store'});
      setPending(null);
      setMessage('Follow-up sent successfully and recorded as meeting outcome evidence.');
      await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'Approved send failed.');}
    finally{setBusy(null);}
  }

  async function evaluate(){
    if(!selected) return;
    setBusy('evaluate');setError(null);setMessage(null);
    try{
      const response=await fetch('/api/meeting-outcomes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'evaluate',meetingId:selected.id,sessionId}),cache:'no-store'});
      const data=await response.json().catch(()=>null) as {ok?:boolean;outcome?:Outcome;error?:string;summary?:string}|null;
      if(!response.ok||data?.ok===false) throw new Error(data?.error||data?.summary||'Outcome evaluation failed.');
      setMessage('Outcome evaluation completed using read-only connected evidence.');
      await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'Outcome evaluation failed.');}
    finally{setBusy(null);}
  }

  const card={border:'1px solid #1f3a55',background:'#0b1a2a',borderRadius:16,padding:18} as const;
  const chip={border:'1px solid #2b4b69',borderRadius:999,padding:'9px 13px',background:'#0a1725',color:'#cfe7fb',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:7} as const;
  return <main style={{minHeight:'100vh',background:'#06111f',color:'#eaf4ff',padding:26,fontFamily:'Inter,Arial,sans-serif'}}>
    <header style={{maxWidth:1280,margin:'0 auto 22px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,flexWrap:'wrap'}}>
      <Link href="/" style={{display:'flex',alignItems:'center',gap:8,color:'#9dc9ff',textDecoration:'none'}}><ArrowLeft size={17}/> LUKE</Link>
      <div style={{textAlign:'center'}}><div style={{fontSize:11,letterSpacing:2,color:'#6e9bc7'}}>JARBIS</div><h1 style={{margin:'4px 0'}}>Follow-Up Executor + Outcome Learning</h1><div style={{fontSize:12,color:'#77e0b5'}}>APPROVAL-GATED EXECUTION · VERIFIED OUTCOMES · LEARNING LOOP</div></div>
      <button onClick={()=>void load()} style={chip}><RefreshCw size={15}/> Refresh</button>
    </header>

    {error&&<div style={{maxWidth:1280,margin:'0 auto 14px',padding:13,border:'1px solid #7a3040',background:'#2a1118',borderRadius:12,color:'#ffd7dd'}}>{error}</div>}
    {message&&<div style={{maxWidth:1280,margin:'0 auto 14px',padding:13,border:'1px solid #28634f',background:'#0a261d',borderRadius:12,color:'#baf4dc'}}>{message}</div>}

    <section style={{maxWidth:1280,margin:'0 auto',display:'grid',gridTemplateColumns:'minmax(260px,.7fr) minmax(0,1.5fr)',gap:16}}>
      <aside style={{...card,alignSelf:'start'}}>
        <div style={{fontSize:11,letterSpacing:1.3,color:'#6e9bc7',marginBottom:10}}>COMPLETED MEETINGS</div>
        <div style={{display:'grid',gap:8,maxHeight:650,overflow:'auto'}}>{meetings.length===0?<div style={{color:'#7894aa'}}>No completed meetings with follow-up records yet.</div>:meetings.map((meeting)=><button key={meeting.id} onClick={()=>{setSelectedId(meeting.id);setPending(null);}} style={{textAlign:'left',border:selectedId===meeting.id?'1px solid #4d8bc5':'1px solid #203d58',background:selectedId===meeting.id?'#10263a':'#081726',color:'#eaf4ff',borderRadius:11,padding:12,cursor:'pointer'}}><b>{meeting.title}</b><div style={{fontSize:11,color:'#7595af',marginTop:5}}>{new Date(meeting.createdAt).toLocaleString()}</div></button>)}</div>
      </aside>

      <div style={{display:'grid',gap:14,alignContent:'start'}}>
        {!selected&&<div style={{...card,minHeight:220,display:'grid',placeItems:'center',color:'#7894aa'}}>Select a completed meeting.</div>}
        {selected&&<>
          <section style={card}><div style={{fontSize:11,letterSpacing:1.3,color:'#6e9bc7'}}>MEETING</div><h2 style={{margin:'6px 0'}}>{selected.title}</h2>{selected.objective&&<div style={{color:'#c6d9ea'}}>Objective: {selected.objective}</div>}<p style={{lineHeight:1.55,color:'#a9bfd2'}}>{selected.finalInsights?.summary}</p></section>

          <section style={card}><div style={{display:'flex',alignItems:'center',gap:8,color:'#8fc4ff'}}><Mail size={17}/><b>Proposed follow-ups</b></div><div style={{display:'grid',gap:12,marginTop:12}}>{(selected.finalInsights?.followUps||[]).length===0?<div style={{color:'#7894aa'}}>No external follow-ups were proposed.</div>:(selected.finalInsights?.followUps||[]).map((item,index)=><div key={index} style={{border:'1px solid #28445f',borderRadius:12,padding:14,background:'#081726'}}><div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><b>{item.channel.toUpperCase()} → {item.target}</b>{item.subject&&<div style={{fontSize:12,color:'#8ea9bd',marginTop:4}}>Subject: {item.subject}</div>}</div>{item.channel==='email'?<button disabled={Boolean(busy)||pending?.followUpIndex===index} onClick={()=>void prepare(index)} style={chip}>{busy===`prepare-${index}`?<LoaderCircle size={15}/>:<Send size={15}/>} Prepare approval</button>:<span style={{fontSize:12,color:'#7894aa'}}>Use Command Center / connected tool</span>}</div><div style={{fontSize:13,lineHeight:1.5,marginTop:9,color:'#d9e9f6'}}>{item.draft}</div><div style={{fontSize:12,color:'#9bafbf',marginTop:7}}>Why: {item.reason}</div></div>)}</div></section>

          {pending&&<section style={{...card,borderColor:'#6b5b2d',background:'#211b0d'}}><div style={{fontSize:11,letterSpacing:1.3,color:'#ffcb6b'}}>EXACT ACTION WAITING FOR YOUR APPROVAL</div><div style={{marginTop:10}}><b>{pending.action.summary}</b></div><div style={{fontSize:12,color:'#d1c49a',marginTop:7}}>Tool: {pending.action.toolSlug} · Risk: {pending.risk.toUpperCase()}</div><pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',fontSize:12,color:'#eee4c7',marginTop:10}}>{JSON.stringify(pending.action.arguments,null,2)}</pre><button disabled={busy==='send'} onClick={()=>void approveAndSend()} style={{...chip,borderColor:'#6b8f55'}}>{busy==='send'?<LoaderCircle size={15}/>:<CheckCircle2 size={15}/>} Approve & send</button></section>}

          <section style={card}><div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}><div style={{display:'flex',alignItems:'center',gap:8,color:'#77e0b5'}}><BrainCircuit size={17}/><b>Outcome learning</b></div><button disabled={busy==='evaluate'} onClick={()=>void evaluate()} style={chip}>{busy==='evaluate'?<LoaderCircle size={15}/>:<Target size={15}/>} Evaluate now</button></div>{outcome?<><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginTop:14}}><div><div style={{fontSize:11,color:'#6e9bc7'}}>STATUS</div><div style={{fontSize:20,fontWeight:700,marginTop:4}}>{outcome.status.toUpperCase()}</div></div><div><div style={{fontSize:11,color:'#6e9bc7'}}>OUTCOME SCORE</div><div style={{fontSize:20,fontWeight:700,marginTop:4}}>{Math.round(outcome.score)}%</div></div><div><div style={{fontSize:11,color:'#6e9bc7'}}>CONFIDENCE</div><div style={{fontSize:20,fontWeight:700,marginTop:4}}>{Math.round(outcome.confidence*100)}%</div></div></div>{outcome.summary&&<p style={{lineHeight:1.55,color:'#d8e8f5'}}>{outcome.summary}</p>}{outcome.evidence.length>0&&<div style={{marginTop:10}}><div style={{fontSize:11,color:'#6e9bc7'}}>EVIDENCE</div>{outcome.evidence.map((item,i)=><div key={i} style={{fontSize:13,marginTop:6}}>• {item}</div>)}</div>}{outcome.lessons.length>0&&<div style={{marginTop:12}}><div style={{fontSize:11,color:'#6e9bc7'}}>LEARNED PATTERNS</div>{outcome.lessons.map((item,i)=><div key={i} style={{fontSize:13,marginTop:6}}>• {item}</div>)}</div>}{outcome.nextActions.length>0&&<div style={{marginTop:12}}><div style={{fontSize:11,color:'#6e9bc7'}}>NEXT ACTIONS</div>{outcome.nextActions.map((item,i)=><div key={i} style={{fontSize:13,marginTop:6}}>• {item}</div>)}</div>}</>:<div style={{color:'#7894aa',marginTop:12}}>Outcome record will be created automatically for this completed meeting.</div>}</section>
        </>}
      </div>
    </section>
  </main>;
}
