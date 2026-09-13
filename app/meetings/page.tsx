'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  CircleStop,
  FileText,
  LoaderCircle,
  Mic,
  MonitorUp,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

type Participant = { name: string; organization?: string; role?: string; email?: string };
type Commitment = { text: string; owner?: string; side: 'us'|'them'|'joint'|'unknown'; dueDate?: string; priority: 'high'|'medium'|'normal' };
type ActionItem = { text: string; owner?: string; dueDate?: string; priority: 'high'|'medium'|'normal' };
type FollowUp = { target: string; channel: 'email'|'message'|'call'|'internal'; subject?: string; draft: string; reason: string };
type Insights = {
  summary: string;
  decisions: string[];
  commitments: Commitment[];
  actionItems: ActionItem[];
  objections: string[];
  questions: string[];
  topics: string[];
  followUps: FollowUp[];
  confidence: number;
};
type Meeting = {
  id: string;
  messageId: string;
  title: string;
  objective?: string;
  participants: Participant[];
  status: 'draft'|'live'|'processing'|'completed'|'cancelled';
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
  prep?: string;
  liveInsights?: Insights;
  finalInsights?: Insights;
  transcriptCharacters: number;
  ledgerIds: string[];
  taskIds: string[];
};
type TranscriptSegment = { id: string; text: string; speaker?: string; capturedAt: string; sequence: number };
type Detail = { meeting: Meeting; transcript: TranscriptSegment[] };

type DeepgramResult = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
};

function parseParticipants(raw: string): Participant[] {
  return raw.split('\n').flatMap((line) => {
    const clean = line.trim();
    if (!clean) return [];
    const [nameRaw, organizationRaw, emailRaw] = clean.split('|').map((item) => item.trim());
    if (!nameRaw) return [];
    return [{
      name: nameRaw,
      ...(organizationRaw ? { organization: organizationRaw } : {}),
      ...(emailRaw ? { email: emailRaw } : {}),
    }];
  }).slice(0, 20);
}

function float32ToInt16(input: Float32Array) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [participantsRaw, setParticipantsRaw] = useState('');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [sessionId, setSessionId] = useState('meeting-copilot');
  const [consent, setConsent] = useState(false);
  const [captureSystemAudio, setCaptureSystemAudio] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [liveInsights, setLiveInsights] = useState<Insights | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const sequenceRef = useRef(0);
  const fullTranscriptRef = useRef('');
  const analysedCharsRef = useRef(0);
  const analysisTimerRef = useRef<number | null>(null);
  const keepAliveRef = useRef<number | null>(null);

  useEffect(() => {
    const existing = window.sessionStorage.getItem('luke-session-id');
    const id = existing || crypto.randomUUID();
    if (!existing) window.sessionStorage.setItem('luke-session-id', id);
    setSessionId(id);
    try { setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto'); } catch {}
    void fetch('/api/identity', { method: 'POST', cache: 'no-store' }).then(() => loadMeetings()).catch(() => loadMeetings());
    return () => stopCapture(false);
  }, []);

  async function loadMeetings() {
    try {
      const response = await fetch('/api/meetings', { cache: 'no-store' });
      const data = await response.json().catch(() => null) as { meetings?: Meeting[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Could not load meetings.');
      setMeetings(data?.meetings || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load meetings.');
    }
  }

  async function loadDetail(id: string) {
    setSelectedId(id);
    setError(null);
    try {
      const response = await fetch(`/api/meetings?meetingId=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => null) as Detail | { error?: string } | null;
      if (!response.ok || !data || !('meeting' in data)) throw new Error((data && 'error' in data && data.error) || 'Could not load meeting.');
      setDetail(data);
      const joined = data.transcript.map((item) => item.text).join(' ').trim();
      fullTranscriptRef.current = joined;
      setLiveTranscript(joined);
      setLiveInsights(data.meeting.finalInsights || data.meeting.liveInsights || null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load meeting.');
    }
  }

  async function create() {
    if (!title.trim()) return;
    setBusy('create'); setError(null); setMessage(null);
    try {
      const response = await fetch('/api/meetings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', title, objective, participants: parseParticipants(participantsRaw) }),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; meetingId?: string; error?: string } | null;
      if (!response.ok || !data?.meetingId) throw new Error(data?.error || 'Could not create meeting.');
      setTitle(''); setObjective(''); setParticipantsRaw('');
      await loadMeetings();
      await loadDetail(data.meetingId);
      setMessage('Meeting room created. Prepare context, then start passive capture when all participants have consented.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create meeting.'); }
    finally { setBusy(null); }
  }

  async function meetingAction(action: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!selectedId) throw new Error('Select a meeting first.');
    const response = await fetch('/api/meetings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, meetingId: selectedId, sessionId, timezone, ...extra }), cache: 'no-store',
    });
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !data) throw new Error(typeof data?.error === 'string' ? data.error : `${action} failed.`);
    return data;
  }

  async function prepare() {
    setBusy('prepare'); setError(null); setMessage(null);
    try {
      const result = await meetingAction('prepare');
      setMessage(typeof result.summary === 'string' ? result.summary : 'Meeting preparation completed.');
      await loadDetail(selectedId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Meeting preparation failed.'); }
    finally { setBusy(null); }
  }

  async function persistSegment(text: string) {
    const clean = text.trim();
    if (!clean || !selectedId) return;
    sequenceRef.current += 1;
    await meetingAction('transcript', {
      text: clean,
      sequence: sequenceRef.current,
      capturedAt: new Date().toISOString(),
    }).catch((caught) => console.error('Meeting segment save failed', caught));
  }

  async function analyseNow() {
    const transcript = fullTranscriptRef.current.trim();
    if (!selectedId || transcript.length < 200 || transcript.length - analysedCharsRef.current < 300) return;
    analysedCharsRef.current = transcript.length;
    try {
      const result = await meetingAction('analyse-live', { transcript: transcript.slice(-24000) });
      const insights = result.insights as Insights | undefined;
      if (insights) setLiveInsights(insights);
    } catch (caught) {
      console.error('Live meeting analysis failed', caught);
    }
  }

  async function startCapture() {
    if (!selectedId || !consent || capturing) return;
    setBusy('start'); setError(null); setMessage(null);
    try {
      await meetingAction('start');
      const tokenResponse = await fetch('/api/deepgram-token', { method: 'POST', cache: 'no-store' });
      if (!tokenResponse.ok) throw new Error(await tokenResponse.text());
      const token = await tokenResponse.text();
      const query = new URLSearchParams({
        model: 'nova-3',
        smart_format: 'true',
        punctuate: 'true',
        interim_results: 'true',
        endpointing: '400',
        vad_events: 'true',
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
      });
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${query.toString()}`, ['token', token]);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Deepgram live transcription timed out.')), 12000);
        ws.onopen = () => { window.clearTimeout(timeout); resolve(); };
        ws.onerror = () => { window.clearTimeout(timeout); reject(new Error('Deepgram live transcription connection failed.')); };
      });

      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      streamsRef.current.push(mic);
      let system: MediaStream | null = null;
      if (captureSystemAudio) {
        try {
          system = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
          streamsRef.current.push(system);
          for (const track of system.getVideoTracks()) track.enabled = false;
        } catch {
          setMessage('Tab/system audio was not shared. Continuing with microphone capture only.');
        }
      }

      const context = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = context;
      const processor = context.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      context.createMediaStreamSource(mic).connect(processor);
      if (system?.getAudioTracks().length) context.createMediaStreamSource(system).connect(processor);
      const silent = context.createGain();
      silent.gain.value = 0;
      processor.connect(silent);
      silent.connect(context.destination);
      processor.onaudioprocess = (event) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const pcm = float32ToInt16(event.inputBuffer.getChannelData(0));
        ws.send(pcm.buffer);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as DeepgramResult;
          if (data.type !== 'Results') return;
          const text = data.channel?.alternatives?.[0]?.transcript?.trim() || '';
          if (!text) return;
          if (data.is_final) {
            setInterim('');
            fullTranscriptRef.current = `${fullTranscriptRef.current} ${text}`.trim();
            setLiveTranscript(fullTranscriptRef.current);
            void persistSegment(text);
          } else {
            setInterim(text);
          }
        } catch {}
      };
      ws.onclose = () => setMessage('Live transcription connection closed.');
      keepAliveRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }, 8000);
      analysisTimerRef.current = window.setInterval(() => { void analyseNow(); }, 30000);
      setCapturing(true);
      setMessage('Meeting Copilot is listening passively. External follow-ups will not be sent automatically.');
      await loadDetail(selectedId);
    } catch (caught) {
      stopCapture(false);
      setError(caught instanceof Error ? caught.message : 'Could not start meeting capture.');
    } finally { setBusy(null); }
  }

  function stopCapture(sendClose = true) {
    if (analysisTimerRef.current) window.clearInterval(analysisTimerRef.current);
    if (keepAliveRef.current) window.clearInterval(keepAliveRef.current);
    analysisTimerRef.current = null;
    keepAliveRef.current = null;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (sendClose) {
        try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch {}
      }
      window.setTimeout(() => { try { ws.close(); } catch {} }, 150);
    }
    wsRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    for (const stream of streamsRef.current) for (const track of stream.getTracks()) track.stop();
    streamsRef.current = [];
    setCapturing(false);
    setInterim('');
  }

  async function finish() {
    if (!selectedId) return;
    setBusy('finalize'); setError(null); setMessage(null);
    stopCapture(true);
    try {
      const result = await meetingAction('finalize', { transcript: fullTranscriptRef.current });
      const insights = result.insights as Insights | undefined;
      if (insights) setLiveInsights(insights);
      setMessage('Post-meeting processing completed. Internal decisions, commitments and tasks were captured; external follow-ups are waiting for your approval in Command Center.');
      await loadMeetings();
      await loadDetail(selectedId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Meeting finalisation failed.'); }
    finally { setBusy(null); }
  }

  const selected = detail?.meeting || meetings.find((item) => item.id === selectedId) || null;
  const insights = selected?.finalInsights || liveInsights || selected?.liveInsights || null;
  const canStart = Boolean(selected && (selected.status === 'draft' || selected.status === 'live') && consent && !capturing);
  const statusColor = selected?.status === 'completed' ? '#77e0b5' : selected?.status === 'live' ? '#ffcb6b' : '#8fc4ff';
  const card = { border:'1px solid #1f3a55', background:'#0b1a2a', borderRadius:16, padding:18 } as const;
  const chip = { border:'1px solid #2b4b69', borderRadius:999, padding:'9px 13px', background:'#0a1725', color:'#cfe7fb', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:7 } as const;
  const input = { width:'100%', boxSizing:'border-box' as const, border:'1px solid #28445f', borderRadius:10, background:'#07131f', color:'#eaf4ff', padding:'10px 12px', outline:'none' };
  const label = { fontSize:11, letterSpacing:1.2, color:'#6e9bc7', marginBottom:6, display:'block' } as const;

  return <main style={{minHeight:'100vh',background:'#06111f',color:'#eaf4ff',padding:'26px',fontFamily:'Inter,Arial,sans-serif'}}>
    <header style={{maxWidth:1320,margin:'0 auto 22px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
      <Link href="/" style={{display:'flex',alignItems:'center',gap:8,color:'#9dc9ff',textDecoration:'none'}}><ArrowLeft size={17}/> LUKE</Link>
      <div style={{textAlign:'center'}}><div style={{fontSize:11,letterSpacing:2,color:'#6e9bc7'}}>JARBIS</div><h1 style={{margin:'4px 0'}}>Live Meeting Copilot</h1><div style={{fontSize:12,color:'#77e0b5'}}>PASSIVE CAPTURE · LIVE SIGNALS · POST-MEETING AUTOPILOT</div></div>
      <button onClick={()=>void loadMeetings()} style={chip}><RefreshCw size={15}/> Refresh</button>
    </header>

    {error && <div style={{maxWidth:1320,margin:'0 auto 14px',padding:13,border:'1px solid #7a3040',background:'#2a1118',borderRadius:12,color:'#ffd7dd'}}>{error}</div>}
    {message && <div style={{maxWidth:1320,margin:'0 auto 14px',padding:13,border:'1px solid #28634f',background:'#0a261d',borderRadius:12,color:'#baf4dc'}}>{message}</div>}

    <section style={{maxWidth:1320,margin:'0 auto',display:'grid',gridTemplateColumns:'minmax(300px,.75fr) minmax(0,1.65fr)',gap:16}}>
      <aside style={{display:'grid',gap:14,alignContent:'start'}}>
        <div style={card}>
          <div style={{display:'flex',alignItems:'center',gap:8,color:'#8fc4ff',marginBottom:13}}><Sparkles size={17}/><b>New meeting</b></div>
          <label style={label}>TITLE</label><input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="Meeting title" style={input}/>
          <label style={{...label,marginTop:11}}>OBJECTIVE</label><textarea value={objective} onChange={(e)=>setObjective(e.target.value)} placeholder="Desired outcome" style={{...input,minHeight:75,resize:'vertical'}}/>
          <label style={{...label,marginTop:11}}>PARTICIPANTS</label><textarea value={participantsRaw} onChange={(e)=>setParticipantsRaw(e.target.value)} placeholder={'One per line: Name | Organisation | email'} style={{...input,minHeight:95,resize:'vertical'}}/>
          <button disabled={!title.trim()||busy==='create'} onClick={()=>void create()} style={{...chip,marginTop:12}}>{busy==='create'?<LoaderCircle size={15}/>:<CheckCircle2 size={15}/>} Create room</button>
        </div>

        <div style={card}>
          <div style={{fontSize:11,letterSpacing:1.3,color:'#6e9bc7',marginBottom:10}}>RECENT MEETINGS</div>
          <div style={{display:'grid',gap:8,maxHeight:430,overflow:'auto'}}>
            {meetings.length===0 && <div style={{color:'#7894aa',fontSize:13}}>No meetings recorded yet.</div>}
            {meetings.map((meeting)=><button key={meeting.id} onClick={()=>void loadDetail(meeting.id)} style={{textAlign:'left',border:selectedId===meeting.id?'1px solid #4d8bc5':'1px solid #203d58',background:selectedId===meeting.id?'#10263a':'#081726',color:'#eaf4ff',borderRadius:11,padding:12,cursor:'pointer'}}>
              <div style={{fontWeight:700}}>{meeting.title}</div><div style={{fontSize:11,color:'#7595af',marginTop:5}}>{meeting.status.toUpperCase()} · {new Date(meeting.createdAt).toLocaleString()}</div>
            </button>)}
          </div>
        </div>
      </aside>

      <div style={{display:'grid',gap:14,alignContent:'start'}}>
        {!selected && <div style={{...card,minHeight:240,display:'grid',placeItems:'center',textAlign:'center',color:'#7894aa'}}><div><Users size={34} style={{margin:'0 auto 10px'}}/>Create or select a meeting to start.</div></div>}
        {selected && <>
          <div style={card}>
            <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',flexWrap:'wrap'}}>
              <div><div style={{fontSize:11,letterSpacing:1.3,color:'#6e9bc7'}}>MEETING</div><h2 style={{margin:'5px 0 7px'}}>{selected.title}</h2><div style={{color:statusColor,fontSize:12,fontWeight:700}}>{selected.status.toUpperCase()}</div></div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <button onClick={()=>void prepare()} disabled={busy==='prepare'||selected.status==='completed'} style={chip}>{busy==='prepare'?<LoaderCircle size={15}/>:<BrainCircuit size={15}/>} Prepare</button>
                {!capturing?<button onClick={()=>void startCapture()} disabled={!canStart||busy==='start'} style={chip}>{busy==='start'?<LoaderCircle size={15}/>:<Play size={15}/>} Start capture</button>:<button onClick={()=>stopCapture(true)} style={{...chip,borderColor:'#805b2b'}}><CircleStop size={15}/> Stop capture</button>}
                <button onClick={()=>void finish()} disabled={busy==='finalize'||selected.status==='completed'||!liveTranscript.trim()} style={{...chip,borderColor:'#28634f'}}>{busy==='finalize'?<LoaderCircle size={15}/>:<CheckCircle2 size={15}/>} Finalise</button>
              </div>
            </div>
            {selected.objective && <div style={{marginTop:12,color:'#c6d9ea'}}>Objective: {selected.objective}</div>}
            {selected.participants.length>0 && <div style={{marginTop:10,fontSize:13,color:'#92aac0'}}>Participants: {selected.participants.map((p)=>`${p.name}${p.organization?` · ${p.organization}`:''}`).join(', ')}</div>}
            <div style={{marginTop:15,padding:13,border:'1px solid #31465a',borderRadius:11,background:'#081521'}}>
              <label style={{display:'flex',gap:9,alignItems:'flex-start',fontSize:13,lineHeight:1.5,cursor:'pointer'}}><input type="checkbox" checked={consent} onChange={(e)=>setConsent(e.target.checked)} style={{marginTop:3}}/><span><ShieldCheck size={15} style={{verticalAlign:'text-bottom',marginRight:6}}/>I have permission from the participants to record/transcribe this meeting where required by applicable law and policy.</span></label>
              <label style={{display:'flex',gap:9,alignItems:'center',fontSize:13,marginTop:10,cursor:'pointer'}}><input type="checkbox" checked={captureSystemAudio} onChange={(e)=>setCaptureSystemAudio(e.target.checked)} disabled={capturing}/><MonitorUp size={15}/> Also request browser tab/system audio capture. The browser will ask what to share.</label>
            </div>
          </div>

          {selected.prep && <div style={card}><div style={{display:'flex',gap:8,alignItems:'center',color:'#8fc4ff'}}><FileText size={17}/><b>Pre-meeting intelligence</b></div><pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',lineHeight:1.55,color:'#d9e9f6',margin:'12px 0 0'}}>{selected.prep}</pre></div>}

          <div style={card}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}><div style={{display:'flex',alignItems:'center',gap:8,color:capturing?'#ffcb6b':'#8fc4ff'}}><Mic size={17}/><b>{capturing?'LIVE TRANSCRIPT':'Transcript'}</b></div><div style={{fontSize:11,color:'#7894aa'}}>{liveTranscript.length.toLocaleString()} chars</div></div>
            <div style={{marginTop:12,minHeight:150,maxHeight:340,overflow:'auto',border:'1px solid #1c354d',background:'#07131f',borderRadius:10,padding:14,lineHeight:1.55,color:'#d8e8f5'}}>{liveTranscript || <span style={{color:'#607e99'}}>Transcript will appear here as Deepgram finalises speech.</span>}{interim && <span style={{color:'#7894aa'}}> {interim}</span>}</div>
          </div>

          {insights && <div style={card}>
            <div style={{display:'flex',alignItems:'center',gap:8,color:'#77e0b5'}}><BrainCircuit size={17}/><b>{selected.status==='completed'?'Post-meeting record':'Live meeting signals'}</b></div>
            <p style={{lineHeight:1.55,color:'#d8e8f5'}}>{insights.summary || 'No material meeting signals yet.'}</p>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:12}}>
              {[['Decisions',insights.decisions],['Commitments',insights.commitments.map((x)=>`${x.text}${x.owner?` — ${x.owner}`:''}`)],['Actions',insights.actionItems.map((x)=>`${x.text}${x.owner?` — ${x.owner}`:''}`)],['Objections',insights.objections],['Open questions',insights.questions]].map(([heading,items])=><div key={heading as string} style={{border:'1px solid #1f3a55',borderRadius:11,padding:12,background:'#081726'}}><div style={{fontSize:11,letterSpacing:1.1,color:'#6e9bc7',marginBottom:8}}>{heading as string}</div>{(items as string[]).length?(items as string[]).map((item,i)=><div key={i} style={{fontSize:13,lineHeight:1.45,marginBottom:6}}>• {item}</div>):<div style={{fontSize:12,color:'#607e99'}}>None captured.</div>}</div>)}
            </div>
            {insights.followUps.length>0 && <div style={{marginTop:12,border:'1px solid #5c4c28',borderRadius:11,padding:12,background:'#211b0d'}}><div style={{fontSize:11,letterSpacing:1.1,color:'#ffcb6b'}}>FOLLOW-UPS — APPROVAL REQUIRED BEFORE EXTERNAL SEND</div>{insights.followUps.map((item,i)=><div key={i} style={{marginTop:10}}><b>{item.channel.toUpperCase()} → {item.target}</b>{item.subject&&<div style={{fontSize:12,color:'#cbb985',marginTop:3}}>Subject: {item.subject}</div>}<div style={{fontSize:13,lineHeight:1.5,marginTop:5,color:'#e7dfc7'}}>{item.draft}</div></div>)}</div>}
          </div>}
        </>}
      </div>
    </section>
  </main>;
}
