'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import './command-center.css';

type TaskQueue = 'now' | 'decisions' | 'working' | 'delegated' | 'done';
type TaskRecord = {
  id: string;
  objective: string;
  title: string;
  queue: TaskQueue;
  owner: 'user' | 'ai' | 'connector' | 'browser' | 'human' | 'professional';
  priority: 'critical' | 'high' | 'normal' | 'low';
  approval: 'none' | 'required' | 'professional';
  status: 'active' | 'blocked' | 'completed' | 'cancelled';
  source: string;
  createdAt: string;
  summary?: string;
  toolSlug?: string;
  risk?: string;
};

type TaskBoard = {
  configured: boolean;
  available: boolean;
  generatedAt: string;
  total: number;
  queues: Record<TaskQueue, TaskRecord[]>;
};

const QUEUES: Array<{ key: TaskQueue; label: string; description: string }> = [
  { key: 'now', label: 'NOW', description: 'Your immediate attention' },
  { key: 'decisions', label: 'DECISIONS', description: 'Approval or input required' },
  { key: 'working', label: 'ELP WORKING', description: 'LUKE/JARBIS executing' },
  { key: 'delegated', label: 'DELEGATED', description: 'Human or third party' },
  { key: 'done', label: 'DONE', description: 'Verified completion' },
];

export default function CommandCenterPage() {
  const [board, setBoard] = useState<TaskBoard | null>(null);
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch('/api/tasks', { cache: 'no-store' });
    const data = await response.json().catch(() => null) as TaskBoard | { error?: string } | null;
    if (!response.ok || !data || !('queues' in data)) {
      setError(data && 'error' in data ? data.error || 'Could not load tasks.' : 'Could not load tasks.');
      return;
    }
    setBoard(data);
  }, []);

  useEffect(() => {
    void fetch('/api/identity', { method: 'POST', cache: 'no-store' }).then(() => load());
  }, [load]);

  const create = useCallback(async () => {
    const text = objective.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective: text, queue: 'now', owner: 'user', source: 'command-center' }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Could not create task.');
      setObjective('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create task.');
    } finally {
      setBusy(false);
    }
  }, [busy, load, objective]);

  const markDone = useCallback(async (task: TaskRecord) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, queue: 'done', status: 'completed', approval: 'none' }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'Could not update task.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update task.');
    } finally {
      setBusy(false);
    }
  }, [load]);

  return <main className="cc-shell">
    <header className="cc-header">
      <Link href="/operator" className="cc-back"><ArrowLeft size={17} /> OPERATOR</Link>
      <div><span>ELP GPT</span><h1>Command Center</h1></div>
      <button className="cc-refresh" onClick={() => void load()} disabled={busy}><RefreshCw size={15} /> Refresh</button>
    </header>

    <section className="cc-intake">
      <div><span>QUICK CAPTURE</span><strong>Add something that needs attention</strong></div>
      <div className="cc-intake-row">
        <input value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Example: Decide whether to move Tuesday's investor call." />
        <button onClick={() => void create()} disabled={!objective.trim() || busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />} Add</button>
      </div>
    </section>

    {error && <section className="cc-error">{error}</section>}

    <section className="cc-summary">
      <div><span>TOTAL</span><strong>{board?.total ?? 0}</strong></div>
      {QUEUES.map((queue) => <div key={queue.key}><span>{queue.label}</span><strong>{board?.queues[queue.key]?.length ?? 0}</strong></div>)}
    </section>

    <section className="cc-board">
      {QUEUES.map((queue) => <article className="cc-column" key={queue.key}>
        <header><div><span>{queue.label}</span><small>{queue.description}</small></div><b>{board?.queues[queue.key]?.length ?? 0}</b></header>
        <div className="cc-cards">
          {!board?.queues[queue.key]?.length && <div className="cc-empty">No tasks.</div>}
          {board?.queues[queue.key]?.map((task) => <div className={`cc-card priority-${task.priority}`} key={task.id}>
            <div className="cc-card-top"><span>{task.priority.toUpperCase()}</span><small>{task.owner.toUpperCase()}</small></div>
            <h2>{task.title}</h2>
            {task.summary && <p>{task.summary}</p>}
            <div className="cc-tags">
              {task.approval !== 'none' && <em>{task.approval === 'required' ? 'APPROVAL' : 'PROFESSIONAL'}</em>}
              {task.toolSlug && <code>{task.toolSlug}</code>}
              {task.status === 'blocked' && <em>BLOCKED</em>}
            </div>
            {queue.key !== 'done' && <button className="cc-done" onClick={() => void markDone(task)} disabled={busy}><CheckCircle2 size={14} /> Mark done</button>}
          </div>)}
        </div>
      </article>)}
    </section>

    <footer className="cc-footer">NOW · DECISIONS · ELP WORKING · DELEGATED · DONE</footer>
  </main>;
}
