'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  GitBranch,
  Goal,
  LoaderCircle,
  Plus,
  RefreshCw,
  Scale,
  Target,
  XCircle,
} from 'lucide-react';

type Kind = 'decision' | 'commitment' | 'assumption' | 'objective';
type Status = 'active' | 'completed' | 'blocked' | 'superseded' | 'dismissed';
type Priority = 'high' | 'medium' | 'normal';
type Item = {
  id: string;
  messageId: string;
  kinds: Kind[];
  primaryKind: Kind;
  title: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  status: Status;
  owner?: string;
  dueDate?: string;
  dueLabel?: string;
  priority: Priority;
  stale: boolean;
  overdue: boolean;
  ageDays: number;
  dependencyText?: string;
  note?: string;
};
type Edge = { id: string; from: string; to: string; type: string; score: number };
type Ledger = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  items: Item[];
  edges: Edge[];
  stats: {
    total: number;
    active: number;
    openCommitments: number;
    overdue: number;
    blocked: number;
    activeObjectives: number;
    staleAssumptions: number;
    recentDecisions: number;
  };
};

const KIND_LABEL: Record<Kind, string> = {
  decision: 'Decision',
  commitment: 'Commitment',
  assumption: 'Assumption',
  objective: 'Objective',
};

function KindIcon({ kind, size = 16 }: { kind: Kind; size?: number }) {
  if (kind === 'decision') return <Scale size={size} />;
  if (kind === 'commitment') return <CheckCircle2 size={size} />;
  if (kind === 'objective') return <Target size={size} />;
  return <CircleDot size={size} />;
}

function statusTone(status: Status) {
  if (status === 'completed') return '#77e0b5';
  if (status === 'blocked') return '#ff9f80';
  if (status === 'superseded') return '#c4a7ff';
  if (status === 'dismissed') return '#7f94a7';
  return '#8fc4ff';
}

export default function ExecutiveLedgerPage() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('commitment');
  const [content, setContent] = useState('');
  const [owner, setOwner] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | Kind | 'attention'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetch('/api/identity', { method: 'POST', cache: 'no-store' });
      const response = await fetch('/api/executive/ledger', { cache: 'no-store' });
      const data = await response.json().catch(() => null) as Ledger | { error?: string } | null;
      if (!response.ok || !data || !('items' in data)) {
        throw new Error((data && 'error' in data && data.error) || 'Executive ledger could not be loaded.');
      }
      setLedger(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Executive ledger could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibleItems = useMemo(() => {
    const items = ledger?.items || [];
    if (filter === 'all') return items;
    if (filter === 'attention') return items.filter((item) => item.overdue || item.stale || item.status === 'blocked' || item.priority === 'high');
    return items.filter((item) => item.primaryKind === filter);
  }, [filter, ledger]);

  async function createItem() {
    if (!content.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch('/api/executive/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, content, owner: owner || undefined, dueDate: dueDate || undefined, priority }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Could not create ledger item.');
      setContent('');
      setOwner('');
      setDueDate('');
      setPriority('normal');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create ledger item.');
    } finally {
      setCreating(false);
    }
  }

  async function patchItem(messageId: string, patch: Record<string, unknown>) {
    setBusyId(messageId);
    setError(null);
    try {
      const response = await fetch('/api/executive/ledger', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, ...patch }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Could not update ledger item.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update ledger item.');
    } finally {
      setBusyId(null);
    }
  }

  const graphItems = useMemo(() => (ledger?.items || []).filter((item) => item.status === 'active' || item.status === 'blocked').slice(0, 12), [ledger]);
  const graphIndex = useMemo(() => new Map(graphItems.map((item, index) => [item.id, index])), [graphItems]);
  const graphEdges = useMemo(() => (ledger?.edges || []).filter((edge) => graphIndex.has(edge.from) && graphIndex.has(edge.to)).slice(0, 24), [ledger, graphIndex]);
  const nodePositions = useMemo(() => graphItems.map((_, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, graphItems.length) - Math.PI / 2;
    return { x: 320 + Math.cos(angle) * 225, y: 210 + Math.sin(angle) * 145 };
  }), [graphItems]);

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#eaf4ff',padding:'26px',fontFamily:'Inter,Arial,sans-serif'}}>
    <header style={{maxWidth:1280,margin:'0 auto 24px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:18}}>
      <Link href="/" style={{color:'#9dc9ff',textDecoration:'none',display:'flex',gap:8,alignItems:'center'}}><ArrowLeft size={17}/> LUKE</Link>
      <div style={{textAlign:'center'}}><div style={{fontSize:11,letterSpacing:2.4,color:'#6e9bc7'}}>JARBIS EXECUTIVE CONTROL</div><h1 style={{margin:'4px 0'}}>Commitment Graph + Decision Ledger</h1></div>
      <button onClick={()=>void load()} disabled={loading} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderRadius:10,border:'1px solid #294866',background:'#0a1b2b',color:'#cfe8ff',cursor:'pointer'}}><RefreshCw size={15}/> Refresh</button>
    </header>

    {error && <section style={{maxWidth:1280,margin:'0 auto 18px',padding:13,border:'1px solid #7a3040',background:'#2a1118',borderRadius:12,color:'#ffd7dd'}}>{error}</section>}

    <section style={{maxWidth:1280,margin:'0 auto',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:12}}>
      {[
        ['Open commitments', ledger?.stats.openCommitments ?? 0],
        ['Overdue', ledger?.stats.overdue ?? 0],
        ['Blocked', ledger?.stats.blocked ?? 0],
        ['Objectives', ledger?.stats.activeObjectives ?? 0],
        ['Stale assumptions', ledger?.stats.staleAssumptions ?? 0],
        ['30d decisions', ledger?.stats.recentDecisions ?? 0],
      ].map(([label,value]) => <article key={String(label)} style={{padding:16,borderRadius:15,border:'1px solid #1d3952',background:'#0a1827'}}><div style={{fontSize:11,color:'#7c9ab4',textTransform:'uppercase',letterSpacing:1}}>{label}</div><div style={{fontSize:28,fontWeight:700,marginTop:5}}>{value}</div></article>)}
    </section>

    <section style={{maxWidth:1280,margin:'18px auto 0',display:'grid',gridTemplateColumns:'minmax(0,1.35fr) minmax(320px,.65fr)',gap:16}}>
      <article style={{border:'1px solid #1e3a54',background:'#081624',borderRadius:18,padding:18,overflow:'hidden'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',marginBottom:8}}><div><div style={{fontSize:11,letterSpacing:1.7,color:'#6e9bc7'}}>RELATIONSHIP MAP</div><h2 style={{margin:'4px 0'}}>Commitment Graph</h2></div><GitBranch size={22} color="#8fc4ff"/></div>
        <p style={{color:'#8fa8bd',fontSize:13,marginTop:0}}>Edges are inferred from shared decision context, implementation language and explicit dependency phrases.</p>
        <div style={{overflowX:'auto'}}>
          <svg width="640" height="420" viewBox="0 0 640 420" role="img" aria-label="Commitment graph" style={{display:'block',margin:'0 auto'}}>
            {graphEdges.map((edge) => {
              const a = nodePositions[graphIndex.get(edge.from) ?? 0];
              const b = nodePositions[graphIndex.get(edge.to) ?? 0];
              return <g key={edge.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#31526d" strokeWidth={Math.max(1,edge.score*3)} opacity="0.8"/><text x={(a.x+b.x)/2} y={(a.y+b.y)/2-4} textAnchor="middle" fill="#7090aa" fontSize="9">{edge.type.replace('_',' ')}</text></g>;
            })}
            {graphItems.map((item,index) => {
              const p=nodePositions[index];
              const ring=item.overdue?'#ff8f70':item.status==='blocked'?'#ffb168':item.stale?'#d6b2ff':'#6db7ef';
              return <g key={item.id}><circle cx={p.x} cy={p.y} r="27" fill="#0c2337" stroke={ring} strokeWidth="2"/><text x={p.x} y={p.y+4} textAnchor="middle" fill="#eaf4ff" fontSize="10" fontWeight="700">{item.primaryKind.slice(0,3).toUpperCase()}</text><text x={p.x} y={p.y+43} textAnchor="middle" fill="#9fb5c8" fontSize="9">{item.title.slice(0,26)}{item.title.length>26?'…':''}</text></g>;
            })}
            {!graphItems.length && <text x="320" y="210" textAnchor="middle" fill="#7893aa" fontSize="13">No active executive artifacts yet.</text>}
          </svg>
        </div>
      </article>

      <article style={{border:'1px solid #1e3a54',background:'#0a1827',borderRadius:18,padding:18}}>
        <div style={{display:'flex',alignItems:'center',gap:9,color:'#8fc4ff'}}><Plus size={18}/><b>Add executive artifact</b></div>
        <div style={{display:'grid',gap:10,marginTop:15}}>
          <select value={kind} onChange={(e)=>setKind(e.target.value as Kind)} style={inputStyle}>{Object.entries(KIND_LABEL).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
          <textarea value={content} onChange={(e)=>setContent(e.target.value)} placeholder="Decision, commitment, objective or working assumption…" rows={5} style={{...inputStyle,resize:'vertical'}}/>
          <input value={owner} onChange={(e)=>setOwner(e.target.value)} placeholder="Owner (optional)" style={inputStyle}/>
          <input type="date" value={dueDate} onChange={(e)=>setDueDate(e.target.value)} style={inputStyle}/>
          <select value={priority} onChange={(e)=>setPriority(e.target.value as Priority)} style={inputStyle}><option value="normal">Normal priority</option><option value="medium">Medium priority</option><option value="high">High priority</option></select>
          <button onClick={()=>void createItem()} disabled={creating || !content.trim()} style={{padding:11,borderRadius:10,border:'1px solid #3b74a6',background:'#0d2c47',color:'#e9f5ff',cursor:'pointer'}}>{creating?<span style={{display:'inline-flex',gap:8,alignItems:'center'}}><LoaderCircle size={15}/> Saving…</span>:'Add to ledger'}</button>
        </div>
      </article>
    </section>

    <section style={{maxWidth:1280,margin:'18px auto 0',border:'1px solid #1e3a54',background:'#081624',borderRadius:18,padding:18}}>
      <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:12,alignItems:'center'}}>
        <div><div style={{fontSize:11,letterSpacing:1.7,color:'#6e9bc7'}}>CONTROL LEDGER</div><h2 style={{margin:'4px 0'}}>Tracked executive state</h2></div>
        <div style={{display:'flex',flexWrap:'wrap',gap:7}}>{(['all','attention','commitment','decision','objective','assumption'] as const).map((key)=><button key={key} onClick={()=>setFilter(key)} style={{padding:'7px 10px',borderRadius:999,border:`1px solid ${filter===key?'#4a83b5':'#29445c'}`,background:filter===key?'#113352':'#091824',color:filter===key?'#eaf5ff':'#8fa8bd',cursor:'pointer'}}>{key.replace('-',' ')}</button>)}</div>
      </div>

      {loading ? <div style={{padding:'34px 0',display:'flex',gap:9,alignItems:'center',justifyContent:'center',color:'#8fa8bd'}}><LoaderCircle size={18}/> Loading executive state…</div> : <div style={{display:'grid',gap:11,marginTop:16}}>
        {visibleItems.map((item)=><article key={item.id} style={{border:'1px solid #1c344a',borderRadius:14,padding:15,background:'#0a1927'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start'}}>
            <div style={{minWidth:0}}>
              <div style={{display:'flex',gap:8,alignItems:'center',fontSize:12,color:'#86afd0'}}><KindIcon kind={item.primaryKind}/>{KIND_LABEL[item.primaryKind].toUpperCase()} <span style={{color:statusTone(item.status)}}>• {item.status.toUpperCase()}</span>{item.priority==='high'&&<span style={{color:'#ffad91'}}>• HIGH</span>}</div>
              <h3 style={{margin:'7px 0 6px',fontSize:16}}>{item.title}</h3>
              <div style={{color:'#a9bfd1',fontSize:13,lineHeight:1.5,whiteSpace:'pre-wrap'}}>{item.content}</div>
            </div>
            <div style={{display:'flex',gap:6,flexShrink:0}}>
              {item.status!=='completed' && <button title="Mark completed" onClick={()=>void patchItem(item.messageId,{status:'completed'})} disabled={busyId===item.messageId} style={iconButton}><CheckCircle2 size={16}/></button>}
              {item.status!=='blocked' && <button title="Mark blocked" onClick={()=>void patchItem(item.messageId,{status:'blocked'})} disabled={busyId===item.messageId} style={iconButton}><AlertTriangle size={16}/></button>}
              {item.status!=='dismissed' && <button title="Dismiss" onClick={()=>void patchItem(item.messageId,{status:'dismissed'})} disabled={busyId===item.messageId} style={iconButton}><XCircle size={16}/></button>}
            </div>
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:12,fontSize:12,color:'#7f9bb3'}}>
            <span>Created {new Date(item.createdAt).toLocaleDateString()}</span>
            {item.owner&&<span>• Owner: {item.owner}</span>}
            {item.dueDate&&<span style={{color:item.overdue?'#ff9f80':'#91b6d2'}}>• Due: {item.dueDate}{item.overdue?' OVERDUE':''}</span>}
            {item.stale&&<span style={{color:'#d6b2ff'}}>• STALE</span>}
            {item.dependencyText&&<span>• Depends on: {item.dependencyText}</span>}
          </div>
        </article>)}
        {!visibleItems.length && <div style={{padding:'28px 0',textAlign:'center',color:'#7d97ad'}}>No ledger items match this view.</div>}
      </div>}
    </section>
  </main>;
}

const inputStyle: React.CSSProperties = {width:'100%',boxSizing:'border-box',padding:'10px 11px',borderRadius:10,border:'1px solid #294862',background:'#07131f',color:'#eaf4ff'};
const iconButton: React.CSSProperties = {width:34,height:34,borderRadius:9,border:'1px solid #2a4862',background:'#0b2235',color:'#a9cce8',display:'grid',placeItems:'center',cursor:'pointer'};
