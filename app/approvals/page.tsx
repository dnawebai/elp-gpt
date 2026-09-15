'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock3, LoaderCircle, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';

type Continuation = {
  id: string;
  nonce: string;
  toolSlug: string;
  summary: string;
  risk: 'read' | 'write' | 'high';
  status: 'pending' | 'executed' | 'rejected' | 'failed' | 'expired';
  source: 'agent';
  sourceRunId?: string;
  createdAt: string;
  expiresAt: string;
  updatedAt?: string;
  error?: string;
};

type ApprovalData = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  resumablePending: number;
  stats: { total:number; pending:number; approved:number; executed:number; rejected:number; failed:number; highRisk:number };
  continuations: Continuation[];
};

const panel = { border:'1px solid #1d3d59', background:'#091827', borderRadius:16, padding:18 } as const;
const button = { border:'1px solid #315874', background:'#0d2133', color:'#e8f5ff', borderRadius:999, padding:'9px 14px', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:7 } as const;

function when(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle:'medium', timeStyle:'short' }).format(new Date(value));
}

function riskColor(risk: Continuation['risk']) {
  return risk === 'high' ? '#ff9eab' : risk === 'write' ? '#ffd076' : '#79e2b4';
}

export default function ApprovalCenterPage() {
  const [data, setData] = useState<ApprovalData | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setBusy('load');
    setError('');
    try {
      await fetch('/api/identity', { method:'POST', cache:'no-store' }).catch(() => undefined);
      const response = await fetch('/api/approvals', { cache:'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Approval Center failed to load.');
      setData(json);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval Center failed to load.');
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const pending = useMemo(() => (data?.continuations || []).filter((item) => item.status === 'pending'), [data]);
  const history = useMemo(() => (data?.continuations || []).filter((item) => item.status !== 'pending').slice(0, 30), [data]);

  async function decide(item: Continuation, action: 'approve' | 'reject') {
    setBusy(`${action}-${item.id}`);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/approvals/continue', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({ continuationId:item.id, action }),
        cache:'no-store',
      });
      const json = await response.json().catch(() => ({ error:'Approval action returned an invalid response.' }));
      if (!response.ok) throw new Error(json.error || `Could not ${action} action.`);
      setMessage(action === 'approve'
        ? `${item.summary} — approved and executed with verified connector evidence.`
        : `${item.summary} — rejected. No external action was executed.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${action} action.`);
    } finally {
      setBusy('');
    }
  }

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#edf7ff',padding:22,fontFamily:'Inter,Arial,sans-serif'}}>
    <div style={{maxWidth:1180,margin:'0 auto'}}>
      <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:14,flexWrap:'wrap',marginBottom:18}}>
        <Link href="/" style={{color:'#9ecbff',textDecoration:'none',display:'flex',gap:7,alignItems:'center'}}><ArrowLeft size={17}/> ELP</Link>
        <div style={{textAlign:'center'}}><div style={{fontSize:11,letterSpacing:2,color:'#75a9d6'}}>ELP GOVERNED EXECUTION</div><h1 style={{margin:'4px 0',fontSize:34}}>Approval Center</h1><div style={{fontSize:12,color:'#77dfb4'}}>REVIEW · PASSKEY · EXECUTE · AUDIT</div></div>
        <button onClick={()=>void load()} disabled={busy==='load'} style={button}>{busy==='load'?<LoaderCircle size={15}/>:<RefreshCw size={15}/>} Refresh</button>
      </header>

      {error && <div style={{padding:12,border:'1px solid #773142',background:'#2b1119',borderRadius:10,color:'#ffd8df',marginBottom:12}}>{error}</div>}
      {message && <div style={{padding:12,border:'1px solid #2e6a53',background:'#0a281e',borderRadius:10,color:'#b8f5d9',marginBottom:12}}>{message}</div>}

      <section style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10,marginBottom:16}}>
        <div style={panel}><div style={{fontSize:12,color:'#8da9c0'}}>RESUMABLE</div><strong style={{fontSize:28}}>{data?.resumablePending || 0}</strong></div>
        <div style={panel}><div style={{fontSize:12,color:'#8da9c0'}}>EXECUTED</div><strong style={{fontSize:28}}>{data?.stats.executed || 0}</strong></div>
        <div style={panel}><div style={{fontSize:12,color:'#8da9c0'}}>HIGH RISK</div><strong style={{fontSize:28}}>{data?.stats.highRisk || 0}</strong></div>
        <div style={panel}><div style={{fontSize:12,color:'#8da9c0'}}>FAILED</div><strong style={{fontSize:28}}>{data?.stats.failed || 0}</strong></div>
      </section>

      <section style={{...panel,marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:12}}><ShieldAlert size={19}/><div><div style={{fontWeight:700}}>Pending agent approvals</div><div style={{fontSize:12,color:'#91a9bc'}}>Exact action envelopes are encrypted server-side. This screen intentionally does not expose raw arguments or approval tokens.</div></div></div>
        {!pending.length && <div style={{padding:'22px 4px',color:'#90a7ba'}}>No resumable agent approvals are waiting.</div>}
        <div style={{display:'grid',gap:10}}>{pending.map((item) => <article key={item.id} style={{border:'1px solid #224964',borderRadius:12,padding:14,background:'#071522'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:11,letterSpacing:1.2,color:riskColor(item.risk)}}>{item.risk.toUpperCase()} RISK · AGENT ACTION</div>
              <h2 style={{fontSize:18,margin:'6px 0'}}>{item.summary}</h2>
              <div style={{fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace',fontSize:12,color:'#9ecbff',overflowWrap:'anywhere'}}>{item.toolSlug}</div>
              <div style={{fontSize:12,color:'#8299ad',marginTop:8}}>Created {when(item.createdAt)} · Resumable until {when(item.expiresAt)}{item.sourceRunId ? ` · Run ${item.sourceRunId}` : ''}</div>
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <button onClick={()=>void decide(item,'reject')} disabled={Boolean(busy)} style={{...button,borderColor:'#693341',color:'#ffd6dc'}}><XCircle size={15}/> Reject</button>
              <button onClick={()=>void decide(item,'approve')} disabled={Boolean(busy)} style={{...button,borderColor:item.risk==='high'?'#8a4853':'#2e6a53',background:item.risk==='high'?'#2a151c':'#0a281e'}}>{busy===`approve-${item.id}`?<LoaderCircle size={15}/>:<CheckCircle2 size={15}/>} Approve & execute</button>
            </div>
          </div>
          {item.risk === 'high' && <div style={{fontSize:12,color:'#ffd0d6',marginTop:10}}>High-risk continuation: fresh passkey/step-up authorization is required before execution.</div>}
        </article>)}</div>
      </section>

      <section style={panel}>
        <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:12}}><Clock3 size={18}/><strong>Continuation history</strong></div>
        {!history.length && <div style={{color:'#90a7ba'}}>No completed continuation history yet.</div>}
        <div style={{display:'grid',gap:8}}>{history.map((item) => <div key={item.id} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',gap:12,borderBottom:'1px solid #16334a',padding:'9px 0'}}>
          <div><div>{item.summary}</div><div style={{fontSize:11,color:'#8299ad'}}>{item.toolSlug} · {item.risk} · {item.updatedAt ? when(item.updatedAt) : when(item.createdAt)}</div>{item.error&&<div style={{fontSize:12,color:'#ffadb8',marginTop:3}}>{item.error}</div>}</div>
          <div style={{fontSize:11,letterSpacing:1,color:item.status==='executed'?'#79e2b4':item.status==='failed'?'#ff9eab':'#a8b9c7'}}>{item.status.toUpperCase()}</div>
        </div>)}</div>
      </section>
    </div>
  </main>;
}
