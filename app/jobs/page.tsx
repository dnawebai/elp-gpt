'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock3, LoaderCircle, Pause, Play, RefreshCw, ShieldCheck, Trash2, Watch } from 'lucide-react';
import './jobs.css';

type Schedule =
  | { type:'once'; runAt:string }
  | { type:'interval'; everyMinutes:number; anchorAt?:string }
  | { type:'daily'; time:string; timezone:string }
  | { type:'weekly'; weekday:number; time:string; timezone:string };
type PendingAction={toolSlug:string;arguments:Record<string,unknown>;summary:string;risk:'write'|'high';connectedAccountId?:string};
type Job={id:string;title:string;instruction:string;mode:'scheduled'|'condition';condition?:string;schedule:Schedule;status:string;nextRunAt:string|null;lastRunAt?:string;lastRunStatus?:string;lastSummary?:string;runCount:number;failureCount:number;pendingAction?:PendingAction};
type Run={id:string;jobId:string;scheduledFor:string;completedAt:string;status:string;summary:string};
type Payload={configured:boolean;jobs:Job[];runs:Run[]};

function scheduleLabel(schedule:Schedule){
  if(schedule.type==='once') return `Once · ${new Date(schedule.runAt).toLocaleString()}`;
  if(schedule.type==='interval') return `Every ${schedule.everyMinutes/60}h`;
  if(schedule.type==='daily') return `Daily · ${schedule.time} · ${schedule.timezone}`;
  return `Weekly · day ${schedule.weekday} · ${schedule.time} · ${schedule.timezone}`;
}

export default function JobsPage(){
  const [data,setData]=useState<Payload|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [title,setTitle]=useState('');
  const [instruction,setInstruction]=useState('');
  const [mode,setMode]=useState<'scheduled'|'condition'>('scheduled');
  const [condition,setCondition]=useState('');
  const [scheduleType,setScheduleType]=useState<'once'|'interval'|'daily'|'weekly'>('daily');
  const [runAt,setRunAt]=useState('');
  const [intervalHours,setIntervalHours]=useState(1);
  const [time,setTime]=useState('08:00');
  const [weekday,setWeekday]=useState(1);
  const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Toronto';

  const load=useCallback(async()=>{
    setError(null);
    const response=await fetch('/api/jobs',{cache:'no-store'});
    const payload=await response.json().catch(()=>null) as Payload|{error?:string}|null;
    if(!response.ok||!payload||!('jobs' in payload)){setError(payload&&'error' in payload?payload.error||'Could not load jobs.':'Could not load jobs.');return;}
    setData(payload);
  },[]);

  useEffect(()=>{void fetch('/api/identity',{method:'POST',cache:'no-store'}).then(()=>load());},[load]);

  const recentByJob=useMemo(()=>{
    const map=new Map<string,Run[]>();
    for(const run of data?.runs||[]){const list=map.get(run.jobId)||[];list.push(run);map.set(run.jobId,list);}
    return map;
  },[data]);

  function buildSchedule():Schedule{
    if(scheduleType==='once') return {type:'once',runAt:new Date(runAt).toISOString()};
    if(scheduleType==='interval') return {type:'interval',everyMinutes:Math.max(1,intervalHours)*60,anchorAt:new Date().toISOString()};
    if(scheduleType==='daily') return {type:'daily',time,timezone};
    return {type:'weekly',weekday,time,timezone};
  }

  const create=useCallback(async()=>{
    if(!title.trim()||!instruction.trim()) return;
    setBusy('create');setError(null);setNotice(null);
    try{
      const schedule=buildSchedule();
      const response=await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create',title,instruction,mode,condition:mode==='condition'?condition:undefined,schedule})});
      const payload=await response.json().catch(()=>null) as {error?:string}|null;
      if(!response.ok) throw new Error(payload?.error||'Could not create job.');
      setTitle('');setInstruction('');setCondition('');setNotice('Autonomous job created.');await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'Could not create job.');}finally{setBusy(null);}
  },[condition,instruction,load,mode,runAt,scheduleType,time,title,weekday,intervalHours,timezone]);

  const patch=useCallback(async(job:Job,status:'active'|'paused'|'cancelled')=>{
    setBusy(`patch:${job.id}`);setError(null);
    try{const response=await fetch('/api/jobs',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:job.id,status})});const payload=await response.json().catch(()=>null) as {error?:string}|null;if(!response.ok) throw new Error(payload?.error||'Could not update job.');await load();}catch(caught){setError(caught instanceof Error?caught.message:'Could not update job.');}finally{setBusy(null);}
  },[load]);

  const runNow=useCallback(async(job:Job)=>{
    setBusy(`run:${job.id}`);setError(null);setNotice(null);
    try{const response=await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'run',jobId:job.id})});const payload=await response.json().catch(()=>null) as {error?:string;status?:string;summary?:string}|null;if(!response.ok) throw new Error(payload?.error||'Job run failed.');setNotice(payload?.summary||`Job ${payload?.status||'completed'}.`);await load();}catch(caught){setError(caught instanceof Error?caught.message:'Job run failed.');}finally{setBusy(null);}
  },[load]);

  const approve=useCallback(async(job:Job)=>{
    if(!job.pendingAction)return;
    setBusy(`approve:${job.id}`);setError(null);setNotice(null);
    try{
      const sessionId=`job-approval-${job.id}`.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,96);
      const planResponse=await fetch('/api/actions/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,toolSlug:job.pendingAction.toolSlug,arguments:job.pendingAction.arguments,summary:job.pendingAction.summary,connectedAccountId:job.pendingAction.connectedAccountId})});
      const plan=await planResponse.json().catch(()=>null) as {proposalToken?:string;action?:PendingAction;error?:string}|null;if(!planResponse.ok||!plan?.proposalToken||!plan.action)throw new Error(plan?.error||'Could not prepare approval.');
      const approveResponse=await fetch('/api/actions/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proposalToken:plan.proposalToken,sessionId})});
      const approval=await approveResponse.json().catch(()=>null) as {executionToken?:string;error?:string}|null;if(!approveResponse.ok||!approval?.executionToken)throw new Error(approval?.error||'Approval failed.');
      const executeResponse=await fetch('/api/actions/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:approval.executionToken,sessionId,toolSlug:plan.action.toolSlug,arguments:plan.action.arguments,connectedAccountId:plan.action.connectedAccountId})});
      const executed=await executeResponse.json().catch(()=>null) as {ok?:boolean;error?:string;result?:unknown}|null;if(!executeResponse.ok||!executed?.ok)throw new Error(executed?.error||'Approved action failed.');
      await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'executed',jobId:job.id,evidence:JSON.stringify(executed.result).slice(0,2800)})});
      setNotice('Approved action executed and job schedule resumed.');await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'Approval execution failed.');}finally{setBusy(null);}
  },[load]);

  return <main className="jobs-shell">
    <header className="jobs-header"><div><Link href="/" className="jobs-back"><ArrowLeft size={17}/> ELP</Link><p className="jobs-kicker">ELP AUTONOMY</p><h1>Autonomous Jobs</h1><p>Schedule recurring work and condition watches. Read-only work may run automatically; external writes stop for approval.</p></div><button className="jobs-refresh" onClick={()=>void load()}><RefreshCw size={16}/>Refresh</button></header>
    {notice&&<p className="jobs-notice">{notice}</p>}{error&&<p className="jobs-error">{error}</p>}
    <section className="job-create">
      <div><h2>Create job</h2><p>Use scheduled mode for recurring work, or condition mode to watch until something becomes true.</p></div>
      <div className="job-form-grid"><input placeholder="Job title" value={title} onChange={e=>setTitle(e.target.value)}/><select value={mode} onChange={e=>setMode(e.target.value as 'scheduled'|'condition')}><option value="scheduled">Scheduled</option><option value="condition">Condition watch</option></select><textarea placeholder="What should ELP do?" value={instruction} onChange={e=>setInstruction(e.target.value)}/>{mode==='condition'&&<textarea placeholder="Condition to watch for" value={condition} onChange={e=>setCondition(e.target.value)}/>}<select value={scheduleType} onChange={e=>setScheduleType(e.target.value as typeof scheduleType)}><option value="once">One time</option><option value="interval">Interval</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select>{scheduleType==='once'&&<input type="datetime-local" value={runAt} onChange={e=>setRunAt(e.target.value)}/>} {scheduleType==='interval'&&<input type="number" min="1" max="720" value={intervalHours} onChange={e=>setIntervalHours(Number(e.target.value))}/>} {(scheduleType==='daily'||scheduleType==='weekly')&&<input type="time" value={time} onChange={e=>setTime(e.target.value)}/>} {scheduleType==='weekly'&&<select value={weekday} onChange={e=>setWeekday(Number(e.target.value))}>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day,index)=><option key={day} value={index}>{day}</option>)}</select>}</div>
      <button className="job-primary" onClick={()=>void create()} disabled={busy==='create'||!title.trim()||!instruction.trim()||(mode==='condition'&&!condition.trim())||(scheduleType==='once'&&!runAt)}>{busy==='create'?<LoaderCircle size={16}/>:<Play size={16}/>}Create autonomous job</button>
    </section>
    <section className="jobs-grid">{(data?.jobs||[]).map(job=><article className="job-card" key={job.id}><div className="job-card-head"><span className={`job-status status-${job.status}`}>{job.mode==='condition'?<Watch size={15}/>:<Clock3 size={15}/>} {job.status.replaceAll('_',' ')}</span><h2>{job.title}</h2><p>{job.instruction}</p>{job.condition&&<div className="job-condition"><strong>WATCH FOR</strong>{job.condition}</div>}</div><div className="job-meta"><span>{scheduleLabel(job.schedule)}</span><span>Next: {job.nextRunAt?new Date(job.nextRunAt).toLocaleString():'—'}</span><span>Runs: {job.runCount}</span><span>Failures: {job.failureCount}</span></div>{job.lastSummary&&<div className="job-last"><strong>LAST RESULT · {job.lastRunStatus?.replaceAll('_',' ')}</strong><p>{job.lastSummary}</p></div>}{job.pendingAction&&<div className="job-approval"><ShieldCheck size={18}/><div><strong>Approval required</strong><p>{job.pendingAction.summary}</p></div><button onClick={()=>void approve(job)} disabled={busy===`approve:${job.id}`}>{busy===`approve:${job.id}`?<LoaderCircle size={15}/>:<CheckCircle2 size={15}/>}Approve & execute</button></div>}<div className="job-actions"><button onClick={()=>void runNow(job)} disabled={busy===`run:${job.id}`}><Play size={15}/>Run now</button>{job.status==='paused'?<button onClick={()=>void patch(job,'active')}><Play size={15}/>Resume</button>:job.status!=='cancelled'&&job.status!=='completed'?<button onClick={()=>void patch(job,'paused')}><Pause size={15}/>Pause</button>:null}<button className="danger" onClick={()=>void patch(job,'cancelled')} disabled={job.status==='cancelled'}><Trash2 size={15}/>Cancel</button></div>{(recentByJob.get(job.id)||[]).slice(0,3).map(run=><div className="job-run" key={run.id}><span>{run.status.replaceAll('_',' ')}</span><small>{new Date(run.completedAt).toLocaleString()}</small></div>)}</article>)}</section>
    {!data?.jobs.length&&<section className="jobs-empty"><Clock3 size={24}/><h2>No autonomous jobs yet</h2><p>Create the first recurring task or condition watch above.</p></section>}
  </main>;
}
