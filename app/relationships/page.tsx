'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BrainCircuit,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Flame,
  Handshake,
  LoaderCircle,
  MessageCircleQuestion,
  RefreshCw,
  Search,
  Snowflake,
  Sparkles,
  Target,
  UserPlus,
  Users,
} from 'lucide-react';

type Momentum = 'warming' | 'steady' | 'cooling' | 'stalled' | 'unknown';
type Value = 'critical' | 'high' | 'normal' | 'low';
type Status = 'active' | 'watch' | 'inactive';
type Relationship = {
  id: string;
  messageId: string;
  key: string;
  name: string;
  organization?: string;
  role?: string;
  email?: string;
  status: Status;
  strategicValue: Value;
  momentum: Momentum;
  lastInteractionAt?: string;
  nextInteractionAt?: string;
  interactionCount: number;
  topics: string[];
  openLoops: string[];
  promisesByUs: string[];
  promisesByThem: string[];
  leverage: string[];
  objections: string[];
  evidence: string[];
  nextBestAction?: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  note?: string;
};
type Snapshot = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  relationships: Relationship[];
  stats: { total: number; active: number; critical: number; high: number; warming: number; cooling: number; stalled: number; openLoops: number };
  lastScan?: { runKey: string; generatedAt: string; summary: string; newCount: number; updatedCount: number };
};
type ScanResult = { ok: boolean; status: string; summary: string; newRelationships: number; updatedRelationships: number; question?: string };
type NegotiationResult = { ok: boolean; generatedAt: string; target: string; relationshipId?: string; provider: string; brief: string };

type Filter = 'active' | 'all' | 'warming' | 'cooling' | 'stalled' | 'high-value';

const momentumLabel: Record<Momentum, string> = {
  warming: 'WARMING', steady: 'STEADY', cooling: 'COOLING', stalled: 'STALLED', unknown: 'UNKNOWN',
};

export default function RelationshipsPage() {
  const [sessionId, setSessionId] = useState('relationships');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addOrganization, setAddOrganization] = useState('');
  const [addRole, setAddRole] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [negTarget, setNegTarget] = useState('');
  const [negObjective, setNegObjective] = useState('');
  const [negContext, setNegContext] = useState('');
  const [negBusy, setNegBusy] = useState(false);
  const [negResult, setNegResult] = useState<NegotiationResult | null>(null);

  useEffect(() => {
    const existing = window.sessionStorage.getItem('luke-session-id');
    const id = existing || crypto.randomUUID();
    if (!existing) window.sessionStorage.setItem('luke-session-id', id);
    setSessionId(id);
    try { setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto'); } catch {}
    void fetch('/api/identity', { method: 'POST', cache: 'no-store' }).then(() => load()).catch(() => load());
  }, []);

  async function load() {
    try {
      const response = await fetch('/api/relationships', { cache: 'no-store' });
      const data = await response.json().catch(() => null) as Snapshot | { error?: string } | null;
      if (!response.ok || !data || !('relationships' in data)) throw new Error((data && 'error' in data && data.error) || 'Could not load relationship intelligence.');
      setSnapshot(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load relationship intelligence.');
    }
  }

  async function scan() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'scan', sessionId, timezone }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as ScanResult | { error?: string } | null;
      if (!response.ok || !data || !('summary' in data)) throw new Error((data && 'error' in data && data.error) || 'Relationship scan failed.');
      setMessage(`${data.summary} · ${data.newRelationships} new / ${data.updatedRelationships} updated`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Relationship scan failed.');
    } finally { setBusy(false); }
  }

  async function addRelationship() {
    if (!addName.trim()) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/relationships', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'upsert', name: addName, organization: addOrganization, role: addRole, email: addEmail, strategicValue: 'normal', momentum: 'unknown' }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Could not add relationship.');
      setAddName(''); setAddOrganization(''); setAddRole(''); setAddEmail(''); setShowAdd(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add relationship.');
    } finally { setBusy(false); }
  }

  async function patch(messageId: string, body: Record<string, unknown>) {
    setUpdating(messageId); setError(null);
    try {
      const response = await fetch('/api/relationships', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId, ...body }), cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Relationship update failed.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Relationship update failed.');
    } finally { setUpdating(null); }
  }

  async function createFollowUp(record: Relationship) {
    const objective = record.nextBestAction || `Follow up with ${record.name}${record.organization ? ` at ${record.organization}` : ''}${record.openLoops[0] ? ` regarding ${record.openLoops[0]}` : ''}.`;
    await patch(record.messageId, { action: 'follow-up-task', title: objective, priority: record.strategicValue === 'critical' ? 'critical' : record.strategicValue === 'high' ? 'high' : 'normal' });
    setMessage(`Follow-up added to Command Center for ${record.name}.`);
  }

  async function negotiate(target?: string) {
    const selected = (target || negTarget).trim();
    if (!selected) return;
    setNegTarget(selected); setNegBusy(true); setError(null); setNegResult(null);
    try {
      const response = await fetch('/api/negotiation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: selected, objective: negObjective, context: negContext, sessionId }), cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as NegotiationResult | { error?: string } | null;
      if (!response.ok || !data || !('brief' in data)) throw new Error((data && 'error' in data && data.error) || 'Negotiation brief failed.');
      setNegResult(data);
      window.setTimeout(() => document.getElementById('negotiation-brief')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Negotiation brief failed.');
    } finally { setNegBusy(false); }
  }

  const visible = useMemo(() => {
    const records = snapshot?.relationships || [];
    const q = query.trim().toLowerCase();
    return records.filter((record) => {
      const matchesQuery = !q || [record.name, record.organization || '', record.role || '', record.email || '', ...record.topics].join(' ').toLowerCase().includes(q);
      if (!matchesQuery) return false;
      if (filter === 'all') return true;
      if (filter === 'active') return record.status !== 'inactive';
      if (filter === 'high-value') return record.strategicValue === 'critical' || record.strategicValue === 'high';
      return record.momentum === filter;
    });
  }, [snapshot, filter, query]);

  const stats = snapshot?.stats || { total:0, active:0, critical:0, high:0, warming:0, cooling:0, stalled:0, openLoops:0 };
  const card = { border:'1px solid #1f3a55', background:'#0b1a2a', borderRadius:16, padding:18 } as const;
  const chip = { border:'1px solid #2b4b69', borderRadius:999, padding:'7px 11px', background:'#0a1725', color:'#cfe7fb', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6 } as const;
  const input = { width:'100%', boxSizing:'border-box' as const, border:'1px solid #28445f', borderRadius:10, background:'#07131f', color:'#eaf4ff', padding:'10px 12px', outline:'none' };
  const labelStyle = { fontSize:11, letterSpacing:1.2, color:'#6e9bc7', marginBottom:6, display:'block' } as const;

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#eaf4ff',padding:'26px',fontFamily:'Inter,Arial,sans-serif'}}>
    <header style={{maxWidth:1280,margin:'0 auto 24px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:18,flexWrap:'wrap'}}>
      <Link href="/" style={{display:'flex',alignItems:'center',gap:8,color:'#9dc9ff',textDecoration:'none'}}><ArrowLeft size={17}/> LUKE</Link>
      <div style={{textAlign:'center'}}><div style={{fontSize:11,letterSpacing:2,color:'#6e9bc7'}}>JARBIS</div><h1 style={{margin:'4px 0'}}>Relationship Intelligence</h1><div style={{fontSize:12,color:'#77e0b5'}}>DOSSIERS · MOMENTUM · NEGOTIATION WHISPERER</div></div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button onClick={()=>setShowAdd((value)=>!value)} style={chip}><UserPlus size={15}/> Add</button>
        <button onClick={()=>void scan()} disabled={busy} style={{...chip,padding:'10px 14px'}}>{busy?<><LoaderCircle size={16}/> Scanning…</>:<><Users size={16}/> Refresh intelligence</>}</button>
      </div>
    </header>

    <section style={{maxWidth:1280,margin:'0 auto',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:12}}>
      {[
        ['Active',stats.active,<Users key="i" size={18}/>],['Critical',stats.critical,<Target key="i" size={18}/>],['High Value',stats.high,<BriefcaseBusiness key="i" size={18}/>],['Warming',stats.warming,<Flame key="i" size={18}/>],['Cooling',stats.cooling,<Snowflake key="i" size={18}/>],['Stalled',stats.stalled,<Clock3 key="i" size={18}/>],['Open Loops',stats.openLoops,<MessageCircleQuestion key="i" size={18}/>],
      ].map(([label,value,icon])=><div key={String(label)} style={card}><div style={{display:'flex',justifyContent:'space-between',color:'#8fc4ff'}}><span>{label as string}</span>{icon}</div><div style={{fontSize:30,fontWeight:700,marginTop:10}}>{value as number}</div></div>)}
    </section>

    {showAdd && <section style={{maxWidth:1280,margin:'14px auto 0',...card}}>
      <div style={{fontSize:11,letterSpacing:1.4,color:'#6e9bc7',marginBottom:12}}>ADD / PIN RELATIONSHIP</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10}}>
        <input value={addName} onChange={(e)=>setAddName(e.target.value)} placeholder="Name" style={input}/>
        <input value={addOrganization} onChange={(e)=>setAddOrganization(e.target.value)} placeholder="Organisation" style={input}/>
        <input value={addRole} onChange={(e)=>setAddRole(e.target.value)} placeholder="Role" style={input}/>
        <input value={addEmail} onChange={(e)=>setAddEmail(e.target.value)} placeholder="Email" style={input}/>
      </div>
      <button onClick={()=>void addRelationship()} disabled={busy||!addName.trim()} style={{...chip,marginTop:10}}><CheckCircle2 size={14}/> Save dossier</button>
    </section>}

    {snapshot?.lastScan && <section style={{maxWidth:1280,margin:'14px auto 0',...card}}><div style={{fontSize:11,letterSpacing:1.4,color:'#6e9bc7'}}>LAST RELATIONSHIP SCAN</div><div style={{marginTop:7,color:'#d9e9f6',lineHeight:1.55}}>{snapshot.lastScan.summary || 'Scan completed.'}</div><div style={{fontSize:12,color:'#7894aa',marginTop:8}}>{new Date(snapshot.lastScan.generatedAt).toLocaleString()} · {snapshot.lastScan.newCount} new · {snapshot.lastScan.updatedCount} updated</div></section>}
    {message && <section style={{maxWidth:1280,margin:'14px auto 0',padding:13,border:'1px solid #28634f',background:'#0a261d',borderRadius:12,color:'#baf4dc'}}>{message}</section>}
    {error && <section style={{maxWidth:1280,margin:'14px auto 0',padding:13,border:'1px solid #7a3040',background:'#2a1118',borderRadius:12,color:'#ffd7dd'}}>{error}</section>}

    <section style={{maxWidth:1280,margin:'18px auto 0',...card}}>
      <div style={{display:'flex',alignItems:'center',gap:8,color:'#8fc4ff'}}><BrainCircuit size={18}/><b>Negotiation Whisperer</b></div>
      <div style={{display:'grid',gridTemplateColumns:'minmax(180px,.8fr) minmax(220px,1fr)',gap:12,marginTop:14}}>
        <div><label style={labelStyle}>COUNTERPART</label><input value={negTarget} onChange={(e)=>setNegTarget(e.target.value)} list="relationship-targets" placeholder="Person or organisation" style={input}/><datalist id="relationship-targets">{(snapshot?.relationships||[]).map((record)=><option key={record.id} value={record.name}>{record.organization||record.role||''}</option>)}</datalist></div>
        <div><label style={labelStyle}>YOUR OBJECTIVE</label><input value={negObjective} onChange={(e)=>setNegObjective(e.target.value)} placeholder="What outcome do you want?" style={input}/></div>
      </div>
      <div style={{marginTop:10}}><label style={labelStyle}>OPTIONAL CONTEXT / NON-NEGOTIABLES</label><textarea value={negContext} onChange={(e)=>setNegContext(e.target.value)} placeholder="Constraints, numbers, alternatives, boundaries, deal structure…" rows={3} style={{...input,resize:'vertical'}}/></div>
      <button onClick={()=>void negotiate()} disabled={negBusy||!negTarget.trim()} style={{...chip,marginTop:10,padding:'10px 14px'}}>{negBusy?<><LoaderCircle size={15}/> Preparing…</>:<><Sparkles size={15}/> Prepare negotiation brief</>}</button>
    </section>

    {negResult && <section id="negotiation-brief" style={{maxWidth:1280,margin:'14px auto 0',...card,border:'1px solid #365f85'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><div style={{fontSize:11,letterSpacing:1.4,color:'#6e9bc7'}}>NEGOTIATION BRIEF</div><h2 style={{margin:'5px 0'}}>{negResult.target}</h2></div><div style={{fontSize:12,color:'#7894aa'}}>{new Date(negResult.generatedAt).toLocaleString()} · {negResult.provider}</div></div>
      <div style={{whiteSpace:'pre-wrap',lineHeight:1.65,color:'#d8e7f2',marginTop:10}}>{negResult.brief}</div>
    </section>}

    <section style={{maxWidth:1280,margin:'18px auto',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
      <div style={{position:'relative',minWidth:230,flex:'1 1 300px'}}><Search size={15} style={{position:'absolute',left:11,top:12,color:'#6f91ad'}}/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search people, companies, topics…" style={{...input,paddingLeft:34}}/></div>
      {(['active','all','high-value','warming','cooling','stalled'] as Filter[]).map((item)=><button key={item} onClick={()=>setFilter(item)} style={{...chip,background:filter===item?'#123655':'#0a1725'}}>{item.toUpperCase()}</button>)}
      <button onClick={()=>void load()} style={chip}><RefreshCw size={14}/></button>
    </section>

    <section style={{maxWidth:1280,margin:'0 auto',display:'grid',gap:14}}>
      {!visible.length && <div style={{...card,color:'#8ca6bb'}}>No relationship dossiers match this view.</div>}
      {visible.map((record)=><article key={record.id} style={card}>
        <div style={{display:'flex',justifyContent:'space-between',gap:18,alignItems:'flex-start',flexWrap:'wrap'}}>
          <div><div style={{display:'flex',gap:8,flexWrap:'wrap',fontSize:11}}><span style={{color:'#86c8ff'}}>{record.strategicValue.toUpperCase()} VALUE</span><span style={{color:record.momentum==='warming'?'#8df0c4':record.momentum==='cooling'||record.momentum==='stalled'?'#ff9ca8':'#e5c984'}}>{momentumLabel[record.momentum]}</span><span style={{color:'#7894aa'}}>{Math.round(record.confidence*100)}% confidence</span><span style={{color:'#7894aa'}}>{record.status.toUpperCase()}</span></div><h2 style={{margin:'7px 0 4px'}}>{record.name}</h2><div style={{color:'#9fb4c5'}}>{[record.role,record.organization].filter(Boolean).join(' · ') || record.email || 'Relationship dossier'}</div></div>
          <div style={{fontSize:12,color:'#7894aa',textAlign:'right'}}>{record.lastInteractionAt?<><div>Last interaction</div><div style={{color:'#b9cbda'}}>{new Date(record.lastInteractionAt).toLocaleString()}</div></>:<div>No verified interaction date</div>}</div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:12,marginTop:15}}>
          <InfoBlock title="Topics" items={record.topics}/>
          <InfoBlock title="Open loops" items={record.openLoops}/>
          <InfoBlock title="Our promises" items={record.promisesByUs}/>
          <InfoBlock title="Their promises" items={record.promisesByThem}/>
          <InfoBlock title="Legitimate leverage" items={record.leverage}/>
          <InfoBlock title="Objections / friction" items={record.objections}/>
        </div>

        {record.nextBestAction && <div style={{marginTop:14,padding:12,borderRadius:10,background:'#07131f',color:'#d9e9f6'}}><b style={{color:'#8fc4ff'}}>Next best action:</b> {record.nextBestAction}</div>}
        {record.evidence.length>0 && <details style={{marginTop:12}}><summary style={{color:'#8fc4ff',cursor:'pointer'}}>Evidence</summary><div style={{marginTop:9,display:'grid',gap:7,color:'#9fb4c5'}}>{record.evidence.map((item,index)=><div key={index}>• {item}</div>)}</div></details>}

        <div style={{marginTop:14,display:'flex',gap:8,flexWrap:'wrap'}}>
          <button disabled={updating===record.id} onClick={()=>void negotiate(record.name)} style={chip}><Handshake size={14}/> Negotiation brief</button>
          <button disabled={updating===record.id} onClick={()=>void createFollowUp(record)} style={chip}><CheckCircle2 size={14}/> Add follow-up</button>
          {record.status!=='watch'&&<button disabled={updating===record.id} onClick={()=>void patch(record.messageId,{status:'watch'})} style={chip}>Watch</button>}
          {record.status!=='active'&&<button disabled={updating===record.id} onClick={()=>void patch(record.messageId,{status:'active'})} style={chip}>Active</button>}
          {record.status!=='inactive'&&<button disabled={updating===record.id} onClick={()=>void patch(record.messageId,{status:'inactive'})} style={chip}>Archive</button>}
          <select value={record.strategicValue} onChange={(e)=>void patch(record.messageId,{strategicValue:e.target.value})} style={{...chip,appearance:'auto'}}><option value="critical">Critical value</option><option value="high">High value</option><option value="normal">Normal value</option><option value="low">Low value</option></select>
          <select value={record.momentum} onChange={(e)=>void patch(record.messageId,{momentum:e.target.value})} style={{...chip,appearance:'auto'}}><option value="warming">Warming</option><option value="steady">Steady</option><option value="cooling">Cooling</option><option value="stalled">Stalled</option><option value="unknown">Unknown</option></select>
        </div>
      </article>)}
    </section>
  </main>;
}

function InfoBlock({ title, items }: { title: string; items: string[] }) {
  return <div style={{border:'1px solid #173149',borderRadius:11,padding:12,background:'#081624'}}><div style={{fontSize:11,letterSpacing:1.1,color:'#6e9bc7',marginBottom:7}}>{title.toUpperCase()}</div>{items.length?<div style={{display:'grid',gap:6,color:'#b9cddd',lineHeight:1.45}}>{items.map((item,index)=><div key={index}>• {item}</div>)}</div>:<div style={{color:'#5f778c',fontSize:13}}>No verified data.</div>}</div>;
}
