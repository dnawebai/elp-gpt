'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bell,
  BrainCircuit,
  CalendarClock,
  ChevronRight,
  CircleUserRound,
  Command,
  Mic,
  MicOff,
  Orbit,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  WandSparkles,
  Zap,
} from 'lucide-react';

type Role = 'user' | 'assistant';
type Message = { role: Role; content: string };
type Suggestion = { title: string; detail: string; icon: 'calendar' | 'audit' | 'focus' };

const starterMessages: Message[] = [
  {
    role: 'assistant',
    content:
      "I'm LUCY. I can help you think, plan, research, remember preferences, monitor priorities and prepare actions. I’ll ask before executing sensitive or irreversible actions.",
  },
];

const suggestions: Suggestion[] = [
  {
    title: 'Daily command brief',
    detail: 'Summarize priorities, meetings, risks and follow-ups into one concise briefing.',
    icon: 'focus',
  },
  {
    title: 'Proactive audit',
    detail: 'Review connected projects and surface broken workflows, security risks and optimization opportunities.',
    icon: 'audit',
  },
  {
    title: 'Calendar intelligence',
    detail: 'Prepare before meetings and identify schedule conflicts, follow-ups and missing prep.',
    icon: 'calendar',
  },
];

function SuggestionIcon({ kind }: { kind: Suggestion['icon'] }) {
  if (kind === 'calendar') return <CalendarClock size={18} />;
  if (kind === 'audit') return <ShieldCheck size={18} />;
  return <Zap size={18} />;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [profileId] = useState(() => {
    if (typeof window === 'undefined') return 'anonymous';
    const existing = window.localStorage.getItem('lucy-profile-id');
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem('lucy-profile-id', created);
    return created;
  });
  const [sessionId] = useState(() => {
    if (typeof window === 'undefined') return 'web';
    const existing = window.sessionStorage.getItem('lucy-session-id');
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem('lucy-session-id', created);
    return created;
  });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  const status = useMemo(() => (busy ? 'Thinking' : listening ? 'Listening' : 'Ready'), [busy, listening]);

  async function send(content = input) {
    const text = content.trim();
    if (!text || busy) return;

    const nextMessages = [...messages, { role: 'user' as const, content: text }];
    setMessages(nextMessages);
    setInput('');
    setBusy(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, profileId, sessionId }),
      });

      if (!response.ok) throw new Error('Assistant request failed');
      const data = (await response.json()) as { message?: string };
      const answer = data.message || 'I received the request, but the model returned an empty response.';
      setMessages((current) => [...current, { role: 'assistant', content: answer }]);

      if (voiceEnabled && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(answer);
        utterance.rate = 1.02;
        window.speechSynthesis.speak(utterance);
      }
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content:
            'I cannot reach the configured reasoning provider yet. Check your server environment variables for Together AI or Hermes, then try again.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function toggleListening() {
    if (listening) {
      setListening(false);
      return;
    }

    setListening(true);
    try {
      const response = await fetch('/api/deepgram-token', { method: 'POST' });
      if (!response.ok) throw new Error('Voice unavailable');
      // The server-side token path is intentionally established now. The next voice milestone
      // attaches Deepgram Voice Agent streaming directly to this state machine.
      window.setTimeout(() => setListening(false), 1200);
    } catch {
      setListening(false);
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: 'Voice is not configured yet. Add DEEPGRAM_API_KEY to the deployment environment.',
        },
      ]);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar glass">
        <div className="brand-row">
          <div className="brand-mark"><Orbit size={23} /></div>
          <div><strong>LUCY</strong><span>ELP GPT</span></div>
        </div>

        <nav className="nav-stack" aria-label="Primary navigation">
          <button className="nav-item active"><Command size={18} /><span>Command Center</span></button>
          <button className="nav-item"><BrainCircuit size={18} /><span>Memory</span></button>
          <button className="nav-item"><Activity size={18} /><span>Signals</span></button>
          <button className="nav-item"><WandSparkles size={18} /><span>Skills</span></button>
          <button className="nav-item"><Bell size={18} /><span>Briefings</span></button>
        </nav>

        <div className="sidebar-spacer" />
        <div className="privacy-card">
          <ShieldCheck size={18} />
          <div><strong>Permission-first</strong><span>Actions remain reviewable.</span></div>
        </div>
        <button className="profile-row"><CircleUserRound size={20} /><span>Your profile</span><ChevronRight size={16} /></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">PERSONAL INTELLIGENCE SYSTEM</p>
            <h1>Good afternoon. <span>What are we solving?</span></h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Search"><Search size={19} /></button>
            <button className="icon-button" onClick={() => setVoiceEnabled((value) => !value)} aria-label="Toggle spoken responses">
              {voiceEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
            </button>
            <div className="status-pill"><i className={busy ? 'pulse' : ''} />{status}</div>
          </div>
        </header>

        <div className="content-grid">
          <section className="chat-panel glass">
            <div className="orb-wrap" aria-hidden="true">
              <div className={listening || busy ? 'lucy-orb active' : 'lucy-orb'}>
                <div className="orb-core"><Sparkles size={26} /></div>
              </div>
              <div className="orb-label">{listening ? 'LUCY IS LISTENING' : busy ? 'LUCY IS THINKING' : 'LUCY ONLINE'}</div>
            </div>

            <div className="messages" aria-live="polite">
              {messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className={`message ${message.role}`}>
                  <span>{message.role === 'assistant' ? 'LUCY' : 'YOU'}</span>
                  <p>{message.content}</p>
                </article>
              ))}
              {busy && <article className="message assistant"><span>LUCY</span><p className="thinking-dots">Analyzing<span>...</span></p></article>}
              <div ref={bottomRef} />
            </div>

            <div className="composer-wrap">
              <div className="composer">
                <button className={listening ? 'mic-button active' : 'mic-button'} onClick={toggleListening} aria-label="Voice input">
                  {listening ? <MicOff size={20} /> : <Mic size={20} />}
                </button>
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder="Ask LUCY anything, or give her a goal..."
                />
                <button className="send-button" onClick={() => void send()} disabled={!input.trim() || busy} aria-label="Send">
                  <Send size={18} />
                </button>
              </div>
              <p className="composer-hint">Enter to send · Shift + Enter for a new line · Sensitive actions require approval</p>
            </div>
          </section>

          <aside className="insight-rail">
            <section className="rail-card glass">
              <div className="rail-heading"><span><BrainCircuit size={17} /> Understanding you</span><b>LEARNING</b></div>
              <div className="learning-meter"><i style={{ width: '24%' }} /></div>
              <p>LUCY builds a durable preference model from conversations and approved connected context.</p>
            </section>

            <section className="rail-card glass">
              <div className="rail-heading"><span><Sparkles size={17} /> Suggested next</span></div>
              <div className="suggestion-stack">
                {suggestions.map((suggestion) => (
                  <button key={suggestion.title} onClick={() => void send(suggestion.title)} className="suggestion">
                    <i><SuggestionIcon kind={suggestion.icon} /></i>
                    <div><strong>{suggestion.title}</strong><span>{suggestion.detail}</span></div>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            </section>

            <section className="rail-card capability-card glass">
              <div className="rail-heading"><span><Zap size={17} /> Capability engine</span></div>
              <div className="capability-list">
                <span><i /> Together AI reasoning</span>
                <span><i /> Hermes agent runtime</span>
                <span><i /> Honcho long-term memory</span>
                <span><i /> Deepgram realtime voice</span>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
