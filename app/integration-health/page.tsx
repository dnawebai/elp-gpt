'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowLeft, CheckCircle2, ExternalLink, HeartPulse, LoaderCircle, RefreshCw, ShieldAlert, Wrench } from 'lucide-react';

type Issue = {
  id:string; toolkit:string; provider?:string; accountId?:string; accountLabel:string;
  status:'healthy'|'watch'|'degraded'|'broken'|'disconnected'|'disabled'|'provider_limited';
  severity:'info'|'warning'|'high'|'critical'; issue:string; detail:string;
  repairKind:'none'|'enable'|'resync'|'renew'|'reconnect'|'connect'|'configure'|'provider_boundary';
  repairLabel?:string; lastSuccessAt?:string; source:string;
};
type Snapshot = {
  id:string; generatedAt:string; score:number; issues:Issue[];
  stats:{total:number;healthy:number;watch:number;degraded:number;broken:number;disabled:number;disconnected:number;providerLimited:number;automaticRepairs:number;reconnectRequired:number};
};

const panel={border:'1px solid #1e3a54',background:'#081725',borderRadius:16,padding:16} as const;
const button={border:'1px solid #315874',background:'#0c2234',color:'#edf7ff',borderRadius:999,padding:'9px 13px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:7} as const;

function tone(status:Issue['status']) {
  if (status==='healthy') return '#77dfb4';
  if (status==='broken') return '#ff9eab';
  if (status==='degraded'||status==='disabled') return '#ffd076';
  if (status==='watch') return '#d9c77a';
  if (status==='provider_limited') return '#9fb7c9';
  return '#86c7ff';
}

export default function IntegrationHealthPage(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  const load=useCallback(async()=>{
    setError('');
    const response=await fetch('/api/integration-health',{cache:'no-store'});
    const payload=await response.json().catch(()=>null) as {snapshot?:Snapshot;error?:string}|null;
    if(!response.ok||!payload?.snapshot) throw new Error(payload?.error||'Could not load integration health.');
    setSnapshot(payload.snapshot);
  },[]);

  useEffect(()=>{void fetch('/api/identity',{method:'POST',cache:'no-store'}).then(()=>load()).catch(e=>setError(e instanceof Error?e.message:'Could not establish identity.'));},[load]);

  async function scan(){
    setBusy('scan'); setError(''); setNotice('');
    try{
      const response=await fetch('/api/integration-health',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'scan'})});
      const payload=await response.json().catch(()=>null) as {snapshot?:Snapshot;error?:string}|null;
      if(!response.ok||!payload?.snapshot) throw new Error(payload?.error||'Health scan failed.');
      setSnapshot(payload.snapshot); setNotice('Provider health, subscriptions and incremental sync were re-checked.');
    }catch(e){setError(e instanceof Error?e.message:'Health scan failed.');}
    finally{setBusy('');}
  }

  async function repair(issue:Issue){
    setBusy(issue.id); setError(''); setNotice('');
    try{
      const response=await fetch('/api/integration-health',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'repair',issueId:issue.id})});
      const payload=await response.json().catch(()=>null) as {result?:{kind:string;message:string;redirectUrl?:string;snapshot?:Snapshot};error?:string}|null;
      if(!response.ok||!payload?.result) throw new Error(payload?.error||'Repair failed.');
      if(payload.result.redirectUrl){window.location.assign(payload.result.redirectUrl);return;}
      if(payload.result.snapshot)setSnapshot(payload.result.snapshot); else await load();
      setNotice(payload.result.message);
    }catch(e){setError(e instanceof Error?e.message:'Repair failed.');}
    finally{setBusy('');}
  }

  const material=(snapshot?.issues||[]).filter(i=>i.status!=='healthy');
  const healthy=(snapshot?.issues||[]).filter(i=>i.status==='healthy');
  return <main style={{minHeight:'100vh',background:'#06111f',color:'#edf7ff',padding:22,fontFamily:'Inter,Arial,sans-serif'}}><div style={{maxWidth:1280,margin:'0 auto'}}>
    <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,flexWrap:'wrap',marginBottom:18}}>
      <div><Link href="/mission-control" style={{color:'#9ecbff',textDecoration:'none',display:'inline-flex',gap:7,alignItems:'center'}}><ArrowLeft size={17}/> Mission Control</Link><div style={{fontSize:11,letterSpacing:1.8,color:'#77a9d2',marginTop:12}}>ELP CONTROL PLANE</div><h1 style={{margin:'5px 0',fontSize:36}}>Integration Self-Healing Center</h1><p style={{color:'#96aec2',maxWidth:760,lineHeight:1.55}}>Diagnoses broken connections, expired authorization, stale incremental sync, provider subscription failures and account-binding problems. Safe internal recovery can run automatically; reauthorization and intentionally disabled accounts still require your action.</p></div>
      <button style={button} onClick={()=>void scan()} disabled={busy==='scan'}>{busy==='scan'?<LoaderCircle size={16}/>:<RefreshCw size={16}/>} Run full health scan</button>
    </header>
    {error&&<div style={{padding:12,border:'1px solid #773142',background:'#2b1119',borderRadius:10,color:'#ffd8df',marginBottom:12}}>{error}</div>}
    {notice&&<div style={{padding:12,border:'1px solid #2e6a53',background:'#0a281e',borderRadius:10,color:'#b8f5d9',marginBottom:12}}>{notice}</div>}

    <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10,marginBottom:14}}>
      <div style={panel}><HeartPulse size={18}/><div style={{fontSize:11,color:'#789dbb',marginTop:7}}>HEALTH SCORE</div><div style={{fontSize:30,fontWeight:800}}>{snapshot?.score??'—'}</div></div>
      <div style={panel}><ShieldAlert size={18}/><div style={{fontSize:11,color:'#789dbb',marginTop:7}}>BROKEN</div><div style={{fontSize:30,fontWeight:800,color:'#ff9eab'}}>{snapshot?.stats.broken??0}</div></div>
      <div style={panel}><Activity size={18}/><div style={{fontSize:11,color:'#789dbb',marginTop:7}}>DEGRADED</div><div style={{fontSize:30,fontWeight:800,color:'#ffd076'}}>{snapshot?.stats.degraded??0}</div></div>
      <div style={panel}><Wrench size={18}/><div style={{fontSize:11,color:'#789dbb',marginTop:7}}>AUTO-REPAIRABLE</div><div style={{fontSize:30,fontWeight:800}}>{snapshot?.stats.automaticRepairs??0}</div></div>
      <div style={panel}><ExternalLink size={18}/><div style={{fontSize:11,color:'#789dbb',marginTop:7}}>RECONNECT</div><div style={{fontSize:30,fontWeight:800}}>{snapshot?.stats.reconnectRequired??0}</div></div>
    </section>

    <section style={panel}><div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center',flexWrap:'wrap'}}><div><h2 style={{margin:'0 0 5px'}}>Needs attention</h2><div style={{color:'#8ea8bd',fontSize:13}}>Repairs that require provider auth will open the provider connection flow. ELP never re-enables intentionally disabled accounts unless you click the repair.</div></div><Link href="/connections" style={{...button,textDecoration:'none'}}><ExternalLink size={15}/> Connected Accounts</Link></div>
      <div style={{display:'grid',gap:10,marginTop:14}}>{material.map(issue=><div key={issue.id} style={{border:'1px solid #203d55',borderRadius:12,padding:13,background:'#071420'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}><div><div style={{fontSize:11,color:tone(issue.status),letterSpacing:1}}>{issue.status.toUpperCase()} · {issue.source.toUpperCase()}</div><h3 style={{margin:'5px 0 4px'}}>{issue.accountLabel}</h3><b style={{fontSize:13}}>{issue.issue}</b><p style={{color:'#91a9bc',fontSize:12,lineHeight:1.45,margin:'6px 0 0',maxWidth:800}}>{issue.detail}</p>{issue.lastSuccessAt&&<div style={{fontSize:11,color:'#708da5',marginTop:6}}>Last success {new Date(issue.lastSuccessAt).toLocaleString()}</div>}</div>
          {issue.repairKind!=='none'&&<button style={{...button,borderColor:issue.repairKind==='reconnect'||issue.repairKind==='connect'?'#6a5d2e':'#315874'}} onClick={()=>void repair(issue)} disabled={busy===issue.id}>{busy===issue.id?<LoaderCircle size={15}/>:<Wrench size={15}/>} {issue.repairLabel||'Review'}</button>}
        </div>
      </div>)}{!material.length&&<div style={{padding:20,textAlign:'center',color:'#8fb7a4'}}><CheckCircle2 size={24}/><div style={{marginTop:7}}>No integration issues detected.</div></div>}</div>
    </section>

    <section style={{...panel,marginTop:14}}><h2 style={{marginTop:0}}>Healthy paths</h2><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:8}}>{healthy.map(issue=><div key={issue.id} style={{padding:10,border:'1px solid #173b34',borderRadius:10,background:'#071b19'}}><div style={{display:'flex',gap:7,alignItems:'center',color:'#77dfb4'}}><CheckCircle2 size={15}/><b>{issue.accountLabel}</b></div><div style={{fontSize:11,color:'#86a99d',marginTop:4}}>{issue.issue} · {issue.source}</div></div>)}</div></section>

    <footer style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',marginTop:14,color:'#6f8ba1',fontSize:12}}><span>Last scan {snapshot?new Date(snapshot.generatedAt).toLocaleString():'—'}</span><span>ELP repairs only within provider-authorized capabilities; provider login and missing secrets remain explicit boundaries.</span></footer>
  </div></main>;
}
