'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, Bot, BriefcaseBusiness, RefreshCw, ShieldCheck, Target, Users } from 'lucide-react';

type Attachment = {
  company: string;
  product_repo?: string | null;
  repositories?: string[];
  shared_support?: string[];
  positions: number;
  agent_identities: number;
  attached: boolean;
  annual_revenue_target_usd?: number | null;
};

type Schedule = { id:string; every_minutes:number; company:string; position:string; objective:string };
type Job = { id:string; company:string; objective:string; position:string; active_agent:string; status:string; created_at:string; updated_at:string };
type Performance = { agent_id:string; position:string; runs_count:number; composite_score:number; lifecycle_status:string; updated_at:string };
type ProjectStatus = {
  project: Attachment;
  operating: { scheduled_cycles:number; queue_depth:number; job_status:Record<string,number>; replacement_candidates:number };
  schedules: Schedule[];
  recent_jobs: Job[];
  agent_performance: Performance[];
};

const panel: React.CSSProperties = { background:'#091827', border:'1px solid #1d3d59', borderRadius:16, padding:16 };
const button: React.CSSProperties = { border:'1px solid #315874', background:'#0d2133', color:'#e8f5ff', borderRadius:10, padding:'9px 13px', cursor:'pointer' };
const input: React.CSSProperties = { background:'#071421', border:'1px solid #294963', color:'#eaf4ff', borderRadius:9, padding:'11px 12px', width:'100%' };
const names: Record<string,string> = { elp_gpt:'ELP GPT', iquash:'iQuash', mezcalsearch:'MezcalSearch', dnaweb:'DNA WEB', elp_owner:'ELP Owner', elp_ventures:'ELP Ventures', grus:'Grus Drinks', opus:'Opus Drinks', shared:'Shared Executive Team' };

function cadence(minutes:number){ if(minutes < 120) return `${minutes} min`; if(minutes % 1440 === 0) return `${minutes/1440} day`; if(minutes % 60 === 0) return `${minutes/60} h`; return `${minutes} min`; }
function tone(status:string){ return ['completed','champion','performing'].includes(status) ? '#79e2b4' : ['failed','replacement_candidate'].includes(status) ? '#ff9eab' : ['blocked','probation'].includes(status) ? '#ffd076' : '#8dc6ff'; }

export default function CompanyOSPage(){
  const [attachments,setAttachments]=useState<Record<string,Attachment>>({});
  const [selected,setSelected]=useState('elp_gpt');
  const [status,setStatus]=useState<ProjectStatus|null>(null);
  const [objective,setObjective]=useState('');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');

  const loadAttachments=useCallback(async()=>{
    const r=await fetch('/api/company?resource=attachments',{cache:'no-store'});
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||'Could not load project attachments.');
    setAttachments(j);
    if(!j[selected] && j.elp_gpt) setSelected('elp_gpt');
  },[selected]);

  const loadStatus=useCallback(async(company:string)=>{
    setBusy('status'); setError('');
    try{
      const r=await fetch(`/api/company?resource=status&company=${encodeURIComponent(company)}`,{cache:'no-store'});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||'Could not load project status.');
      setStatus(j);
    }catch(e){ setError(e instanceof Error?e.message:'Could not load project status.'); }
    finally{ setBusy(''); }
  },[]);

  const load=useCallback(async()=>{
    setBusy('all'); setError('');
    try{ await loadAttachments(); await loadStatus(selected); }
    catch(e){ setError(e instanceof Error?e.message:'Company OS failed to load.'); setBusy(''); }
  },[loadAttachments,loadStatus,selected]);

  useEffect(()=>{ void fetch('/api/identity',{method:'POST',cache:'no-store'}).finally(()=>void load()); },[load]);
  useEffect(()=>{ if(attachments[selected]) void loadStatus(selected); },[selected,attachments,loadStatus]);

  const projects=useMemo(()=>Object.values(attachments).filter(x=>x.company!=='shared'),[attachments]);
  const activeJobs=status?.recent_jobs.filter(j=>['queued','running','review','blocked'].includes(j.status))||[];
  const strong=status?.agent_performance.filter(a=>['champion','performing'].includes(a.lifecycle_status)).length||0;

  async function createGoal(){
    if(objective.trim().length<3) return;
    setBusy('goal'); setError(''); setMessage('');
    try{
      const r=await fetch('/api/company',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({company:selected,objective:objective.trim(),action:'goal'})});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||'Could not create project goal.');
      setMessage(`Goal queued for ${names[selected]||selected}. Lead: ${j.lead_agent||'assigned automatically'}.`);
      setObjective(''); await loadStatus(selected);
    }catch(e){ setError(e instanceof Error?e.message:'Could not create project goal.'); }
    finally{ setBusy(''); }
  }

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#edf7ff',padding:22,fontFamily:'Inter,Arial,sans-serif'}}><div style={{maxWidth:1500,margin:'0 auto'}}>
    <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:14,flexWrap:'wrap',marginBottom:18}}>
      <div><Link href="/mission-control" style={{color:'#9ecbff',textDecoration:'none',display:'inline-flex',gap:7,alignItems:'center'}}><ArrowLeft size={17}/> Mission Control</Link><div style={{fontSize:11,letterSpacing:2,color:'#75a9d6',marginTop:12}}>ELP AGENT COMPANY</div><h1 style={{margin:'4px 0',fontSize:34}}>Project Workforce</h1><p style={{margin:0,color:'#91aabd'}}>Permanent project pods, autonomous operating cycles, jobs and HR performance.</p></div>
      <button style={button} onClick={()=>void load()} disabled={!!busy}><RefreshCw size={15} style={{verticalAlign:'middle',marginRight:6}}/>Refresh</button>
    </header>

    {error&&<div style={{padding:12,border:'1px solid #773142',background:'#2b1119',borderRadius:10,color:'#ffd8df',marginBottom:12}}>{error}</div>}
    {message&&<div style={{padding:12,border:'1px solid #2e6a53',background:'#0a281e',borderRadius:10,color:'#b8f5d9',marginBottom:12}}>{message}</div>}

    <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10,marginBottom:16}}>
      {projects.map(project=><button key={project.company} onClick={()=>setSelected(project.company)} style={{...panel,textAlign:'left',color:'inherit',cursor:'pointer',borderColor:selected===project.company?'#6fb8ef':'#1d3d59'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><b>{names[project.company]||project.company}</b><span style={{fontSize:11,color:project.attached?'#79e2b4':'#ff9eab'}}>{project.attached?'ATTACHED':'DETACHED'}</span></div>
        <div style={{fontSize:12,color:'#91aabd',marginTop:9}}>{project.positions} positions · {project.agent_identities} identities</div>
        <div style={{fontSize:11,color:'#6f8ca4',marginTop:5,overflow:'hidden',textOverflow:'ellipsis'}}>{project.product_repo}</div>
      </button>)}
    </section>

    {status&&<>
      <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10,marginBottom:14}}>
        {[
          ['Agent identities',status.project.agent_identities,<Users key="u" size={18}/>],
          ['Scheduled cycles',status.operating.scheduled_cycles,<Activity key="a" size={18}/>],
          ['Active jobs',activeJobs.length,<Bot key="b" size={18}/>],
          ['Strong agents',strong,<ShieldCheck key="s" size={18}/>],
          ['Replacement candidates',status.operating.replacement_candidates,<Target key="t" size={18}/>],
          ['Queue depth',status.operating.queue_depth,<BriefcaseBusiness key="q" size={18}/>],
        ].map(([label,value,icon])=><div key={String(label)} style={panel}><div style={{color:'#75a9d6'}}>{icon}</div><div style={{fontSize:26,fontWeight:700,marginTop:8}}>{String(value)}</div><div style={{fontSize:12,color:'#91aabd'}}>{String(label)}</div></div>)}
      </section>

      <section style={{...panel,marginBottom:14}}><h2 style={{marginTop:0}}>Send work to {names[selected]||selected}</h2><div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:10}}><input style={input} value={objective} onChange={e=>setObjective(e.target.value)} placeholder="Objective for this project pod" onKeyDown={e=>{if(e.key==='Enter')void createGoal();}}/><button style={button} disabled={busy==='goal'||objective.trim().length<3} onClick={()=>void createGoal()}>{busy==='goal'?'Queuing…':'Queue objective'}</button></div><div style={{fontSize:11,color:'#6f8ca4',marginTop:8}}>The control plane routes this to the best specialist pair. Agent A executes; Agent B independently challenges and can take over.</div></section>

      <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(360px,1fr))',gap:14}}>
        <div style={panel}><h2 style={{marginTop:0}}>Autonomous operating cycles</h2>{status.schedules.length===0?<p style={{color:'#91aabd'}}>No schedules registered.</p>:status.schedules.map(s=><div key={s.id} style={{padding:'11px 0',borderTop:'1px solid #173249'}}><div style={{display:'flex',justifyContent:'space-between',gap:10}}><b>{s.position}</b><span style={{fontSize:11,color:'#8dc6ff'}}>every {cadence(s.every_minutes)}</span></div><div style={{fontSize:12,color:'#91aabd',marginTop:4}}>{s.objective}</div></div>)}</div>
        <div style={panel}><h2 style={{marginTop:0}}>Recent jobs</h2>{status.recent_jobs.length===0?<p style={{color:'#91aabd'}}>No jobs recorded yet.</p>:status.recent_jobs.slice(0,15).map(j=><div key={j.id} style={{padding:'11px 0',borderTop:'1px solid #173249'}}><div style={{display:'flex',justifyContent:'space-between',gap:10}}><b>{j.position}</b><span style={{fontSize:11,color:tone(j.status)}}>{j.status.toUpperCase()}</span></div><div style={{fontSize:12,color:'#91aabd',marginTop:4}}>{j.objective}</div><div style={{fontSize:11,color:'#6f8ca4',marginTop:4}}>{j.active_agent}</div></div>)}</div>
        <div style={panel}><h2 style={{marginTop:0}}>HR performance</h2>{status.agent_performance.length===0?<p style={{color:'#91aabd'}}>Performance history begins after verified runs.</p>:status.agent_performance.slice(0,20).map(a=><div key={a.agent_id} style={{padding:'11px 0',borderTop:'1px solid #173249'}}><div style={{display:'flex',justifyContent:'space-between',gap:10}}><b>{a.position}</b><span style={{fontSize:11,color:tone(a.lifecycle_status)}}>{a.lifecycle_status.replaceAll('_',' ').toUpperCase()}</span></div><div style={{fontSize:12,color:'#91aabd',marginTop:4}}>{a.agent_id} · score {Number(a.composite_score||0).toFixed(1)} · {a.runs_count} runs</div></div>)}</div>
        <div style={panel}><h2 style={{marginTop:0}}>Project attachment</h2><div style={{fontSize:13,lineHeight:1.75,color:'#c9d8e5'}}><div><b>Repository:</b> {status.project.product_repo||'—'}</div><div><b>Positions:</b> {status.project.positions}</div><div><b>Identities:</b> {status.project.agent_identities}</div><div><b>Shared executives:</b> {status.project.shared_support?.length||0}</div><div><b>Target:</b> {status.project.annual_revenue_target_usd?`$${status.project.annual_revenue_target_usd.toLocaleString()}/year`:'Portfolio governance'}</div></div><div style={{fontSize:11,color:'#6f8ca4',marginTop:10}}>Configured attachment is not the same as a live worker process. Live activity appears here only after the Coolify/Kamal runtime is online and executing jobs.</div></div>
      </section>
    </>}
  </div></main>;
}
