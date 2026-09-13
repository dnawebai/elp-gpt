'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Flag, LoaderCircle, RefreshCw, Target, Users } from 'lucide-react';

type Goal = { id:string; title:string; description?:string; level:string; parentId?:string; owner:string; status:string; priority:string; dueDate?:string; metric?:string; target?:number; current?:number; unit?:string; taskIds:string[]; ledgerIds:string[] };
type Delegation = { id:string; taskId:string; goalId?:string; delegatee:string; channel?:string; status:string; expectedOutcome:string; dueDate?:string; checkInEveryHours:number; lastCheckInAt?:string; progress:number; blockers:string[]; evidence:string[] };
type GoalHealth = { goal:Goal; health:'healthy'|'watch'|'at_risk'|'critical'; progress:number; openTasks:number; blockedTasks:number; delegatedOpen:number; delegatedStale:number; dueInDays:number|null; reasons:string[] };
type Snapshot = { configured:boolean; generatedAt:string; goals:Goal[]; delegations:Delegation[]; goalHealth:GoalHealth[]; delegationExceptions:Array<{delegation:Delegation;severity:'critical'|'high'|'normal';reason:string;recommendedAction:string}>; stats:{totalGoals:number;activeGoals:number;healthyGoals:number;watchGoals:number;atRiskGoals:number;criticalGoals:number;delegatedOpen:number;delegationExceptions:number;orphanTasks:number} };

export default function PortfolioControlPage(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [goalTitle,setGoalTitle]=useState('');
  const [goalDue,setGoalDue]=useState('');
  const [goalPriority,setGoalPriority]=useState('normal');

  useEffect(()=>{ void fetch('/api/identity',{method:'POST',cache:'no-store'}).then(()=>load()).catch(()=>load()); },[]);
  async function load(){ setError(null); const response=await fetch('/api/portfolio-control',{cache:'no-store'}); const data=await response.json().catch(()=>null) as Snapshot & {error?:string}|null; if(!response.ok){setError(data?.error||'Could not load portfolio control.');return;} setSnapshot(data); }
  async function post(body:Record<string,unknown>){ setBusy(true); setError(null); setMessage(null); try{ const response=await fetch('/api/portfolio-control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'}); const data=await response.json().catch(()=>null) as {error?:string}|null; if(!response.ok) throw new Error(data?.error||'Portfolio update failed.'); await load(); return data; }catch(caught){setError(caught instanceof Error?caught.message:'Portfolio update failed.');}finally{setBusy(false);} }
  async function createGoal(){ if(!goalTitle.trim()) return; await post({action:'create-goal',title:goalTitle,dueDate:goalDue||undefined,priority:goalPriority,level:'objective',owner:'user'}); setGoalTitle(''); setGoalDue(''); setMessage('Goal created. Link execution tasks to it to improve portfolio health accuracy.'); }

  const health=useMemo(()=>snapshot?.goalHealth||[],[snapshot]);
  const card={border:'1px solid #1d3b57',background:'#091827',borderRadius:16,padding:18} as const;
  const button={border:'1px solid #315572',background:'#0b1d2e',color:'#dceeff',borderRadius:999,padding:'9px 13px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:7} as const;
  const input={background:'#071421',border:'1px solid #294963',color:'#eaf4ff',borderRadius:10,padding:'10px 11px',width:'100%'} as const;
  const badge=(value:string)=>({display:'inline-flex',border:'1px solid #315572',borderRadius:999,padding:'5px 9px',fontSize:11,letterSpacing:.5,color:value==='critical'?'#ffadb9':value==='at_risk'||value==='high'?'#ffd47a':value==='watch'?'#9ec9ff':'#86e3b7'} as const);

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#eaf4ff',padding:26,fontFamily:'Inter,Arial,sans-serif'}}>
    <header style={{maxWidth:1280,margin:'0 auto 22px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
      <Link href="/" style={{display:'flex',alignItems:'center',gap:8,color:'#9dc9ff',textDecoration:'none'}}><ArrowLeft size={17}/> ELP</Link>
      <div style={{textAlign:'center'}}><div style={{fontSize:11,letterSpacing:2,color:'#6f9dc8'}}>ELP</div><h1 style={{margin:'4px 0'}}>Portfolio Control</h1><div style={{fontSize:12,color:'#78e1b5'}}>GOALS · DELEGATION · EXCEPTIONS · EXECUTION ALIGNMENT</div></div>
      <button disabled={busy} onClick={()=>void load()} style={button}>{busy?<LoaderCircle size={15}/>:<RefreshCw size={15}/>} Refresh</button>
    </header>

    {error&&<div style={{maxWidth:1280,margin:'0 auto 14px',padding:13,border:'1px solid #763348',background:'#2a1119',borderRadius:12,color:'#ffd9df'}}>{error}</div>}
    {message&&<div style={{maxWidth:1280,margin:'0 auto 14px',padding:13,border:'1px solid #28644f',background:'#0a261d',borderRadius:12,color:'#bdf4dc'}}>{message}</div>}

    <section style={{maxWidth:1280,margin:'0 auto 16px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}>
      {[
        ['ACTIVE GOALS',snapshot?.stats.activeGoals||0,<Target key="1" size={18}/>],['CRITICAL',snapshot?.stats.criticalGoals||0,<AlertTriangle key="2" size={18}/>],['AT RISK',snapshot?.stats.atRiskGoals||0,<AlertTriangle key="3" size={18}/>],['DELEGATED',snapshot?.stats.delegatedOpen||0,<Users key="4" size={18}/>],['EXCEPTIONS',snapshot?.stats.delegationExceptions||0,<Flag key="5" size={18}/>],['ORPHAN TASKS',snapshot?.stats.orphanTasks||0,<Flag key="6" size={18}/>],
      ].map(([label,value,icon])=><div key={String(label)} style={card}><div style={{display:'flex',justifyContent:'space-between',color:'#719cc4'}}><span style={{fontSize:10,letterSpacing:1.1}}>{label}</span>{icon}</div><div style={{fontSize:28,fontWeight:700,marginTop:8}}>{String(value)}</div></div>)}
    </section>

    <section style={{maxWidth:1280,margin:'0 auto',display:'grid',gridTemplateColumns:'minmax(0,1.3fr) minmax(320px,.7fr)',gap:16,alignItems:'start'}}>
      <div style={{display:'grid',gap:12}}>
        <div style={{fontSize:11,letterSpacing:1.3,color:'#6f9dc8'}}>GOAL HEALTH</div>
        {health.length===0?<div style={{...card,color:'#829eb6'}}>No goals yet. Create objectives here, then link Command Center tasks and delegations to them.</div>:health.map((item)=><article key={item.goal.id} style={card}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}><div><span style={badge(item.health)}>{item.health.toUpperCase().replace('_',' ')}</span><h3 style={{margin:'8px 0 2px'}}>{item.goal.title}</h3><div style={{fontSize:12,color:'#7899b5'}}>{item.goal.level.toUpperCase()} · {item.goal.owner} · {item.goal.priority}</div></div><div style={{fontSize:22,fontWeight:700}}>{item.progress}%</div></div>
          <p style={{lineHeight:1.5,color:'#c9dceb'}}>{item.goal.description||item.reasons.join(' ')}</p>
          <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:12,color:'#8da8bf'}}><span>{item.openTasks} open tasks</span><span>{item.blockedTasks} blocked</span><span>{item.delegatedOpen} delegated</span><span>{item.delegatedStale} stale</span>{item.dueInDays!==null&&<span>due {item.dueInDays}d</span>}</div>
          <div style={{display:'grid',gap:5,marginTop:10}}>{item.reasons.map((reason,index)=><div key={index} style={{fontSize:12,color:'#b4cadc'}}>• {reason}</div>)}</div>
        </article>)}

        <div style={{fontSize:11,letterSpacing:1.3,color:'#6f9dc8',marginTop:10}}>DELEGATION EXCEPTIONS</div>
        {(snapshot?.delegationExceptions||[]).length===0?<div style={{...card,color:'#829eb6'}}>No material delegation exceptions are currently detected.</div>:(snapshot?.delegationExceptions||[]).map((item)=><article key={item.delegation.id} style={card}>
          <div style={{display:'flex',justifyContent:'space-between',gap:10}}><div><span style={badge(item.severity)}>{item.severity.toUpperCase()}</span><h3 style={{margin:'8px 0 3px'}}>{item.delegation.delegatee}</h3></div><div style={{fontSize:12,color:'#8aa8c0'}}>{item.delegation.progress}%</div></div>
          <div style={{fontSize:13,color:'#c8dbe9'}}>{item.delegation.expectedOutcome}</div><p style={{fontSize:12,color:'#ffcc9d'}}>{item.reason}</p><div style={{borderLeft:'3px solid #6da8df',paddingLeft:10,fontSize:12,color:'#d6e8f8'}}>{item.recommendedAction}</div>
        </article>)}
      </div>

      <aside style={{display:'grid',gap:12,position:'sticky',top:20}}>
        <section style={card}><div style={{display:'flex',gap:8,alignItems:'center',color:'#8fc4ff'}}><Target size={17}/><b>Create objective</b></div><div style={{display:'grid',gap:9,marginTop:12}}><input value={goalTitle} onChange={(e)=>setGoalTitle(e.target.value)} placeholder="Objective" style={input}/><input type="date" value={goalDue} onChange={(e)=>setGoalDue(e.target.value)} style={input}/><select value={goalPriority} onChange={(e)=>setGoalPriority(e.target.value)} style={input}><option value="normal">Normal priority</option><option value="high">High priority</option><option value="critical">Critical priority</option><option value="low">Low priority</option></select><button disabled={busy||!goalTitle.trim()} onClick={()=>void createGoal()} style={button}><CheckCircle2 size={15}/> Create goal</button></div></section>
        <section style={card}><div style={{fontSize:11,letterSpacing:1.2,color:'#78e1b5'}}>CONTROL PRINCIPLE</div><p style={{fontSize:13,lineHeight:1.55,color:'#a9bfd2'}}>Delegation is not completion. ELP treats missing evidence, stale check-ins, blockers and overdue delegated work as exceptions until progress is verified.</p></section>
        <section style={card}><div style={{fontSize:11,letterSpacing:1.2,color:'#6f9dc8'}}>ALIGNMENT</div><p style={{fontSize:13,lineHeight:1.55,color:'#a9bfd2'}}>{snapshot?.stats.orphanTasks||0} open task{snapshot?.stats.orphanTasks===1?' is':'s are'} currently not linked to a goal. Link important execution work to objectives to improve portfolio-level prioritisation.</p></section>
      </aside>
    </section>
  </main>;
}
