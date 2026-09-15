'use client';

import { FormEvent, useMemo, useState } from 'react';

type Result = {
  objective: string;
  synthesis: string;
  agents: Array<{ id: string; name: string; mission: string }>;
  evidence: Array<{ source: string; query: string; status: string; error?: string }>;
  proposedActions: Array<{ purpose: string; status: string; reason: string; toolCandidates: Array<{ slug: string; name: string; toolkit?: string }> }>;
  skills: Array<{ id: string; name: string; description: string; risk: string }>;
};

export default function HermesCreativePage() {
  const [objective, setObjective] = useState('Create five differentiated performance ads from our brand, competitor evidence and offer, ready for AI rendering and controlled testing.');
  const [brand, setBrand] = useState('');
  const [website, setWebsite] = useState('');
  const [audience, setAudience] = useState('');
  const [offer, setOffer] = useState('');
  const [channels, setChannels] = useState('Instagram, Meta');
  const [competitors, setCompetitors] = useState('');
  const [assetCount, setAssetCount] = useState(5);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const actionSummary = useMemo(() => result?.proposedActions.map((action) => `${action.purpose}: ${action.status}`).join(' · ') || '', [result]);

  async function run(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      await fetch('/api/identity', { method: 'POST' }).catch(() => null);
      const response = await fetch('/api/hermes-creative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective, brand, website, audience, offer, channels, competitors, assetCount }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Creative execution failed.');
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creative execution failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-5 py-10">
        <div className="mb-8 max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">ELP · Senior Hermes</div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Creative Execution Agent</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">Video-derived operating system: brand brain → competitor intelligence → strategy → copy → art direction → rendering route → QA → experiment plan. External writes remain governed by ELP approval controls.</p>
        </div>

        <form onSubmit={run} className="grid gap-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5 lg:grid-cols-2">
          <label className="lg:col-span-2 text-sm text-slate-300">Objective<textarea className="mt-2 min-h-28 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 outline-none" value={objective} onChange={(e) => setObjective(e.target.value)} /></label>
          <Field label="Brand" value={brand} onChange={setBrand} placeholder="Brand or product" />
          <Field label="Website" value={website} onChange={setWebsite} placeholder="https://..." />
          <Field label="Audience" value={audience} onChange={setAudience} placeholder="Who should convert?" />
          <Field label="Offer" value={offer} onChange={setOffer} placeholder="Offer, proof, price or CTA" />
          <Field label="Channels" value={channels} onChange={setChannels} placeholder="Instagram, Meta, TikTok..." />
          <Field label="Competitors" value={competitors} onChange={setCompetitors} placeholder="Known competitors, optional" />
          <label className="text-sm text-slate-300">Creative variants<input type="number" min={1} max={12} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 outline-none" value={assetCount} onChange={(e) => setAssetCount(Number(e.target.value))} /></label>
          <div className="flex items-end"><button disabled={loading} className="w-full rounded-2xl bg-cyan-300 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">{loading ? 'Senior Hermes is executing…' : 'Execute mission'}</button></div>
        </form>

        {error ? <div className="mt-5 rounded-2xl border border-rose-900 bg-rose-950/50 p-4 text-rose-200">{error}</div> : null}

        {result ? (
          <div className="mt-8 grid gap-5 lg:grid-cols-[1.5fr_.8fr]">
            <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">Chief Executor synthesis</div>
              <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-7 text-slate-200">{result.synthesis}</pre>
            </section>
            <aside className="space-y-5">
              <Panel title="Execution status"><p className="text-sm leading-6 text-slate-300">{actionSummary}</p>{result.proposedActions.map((action) => <div key={action.purpose} className="mt-3 rounded-2xl border border-slate-800 p-3"><div className="font-medium capitalize">{action.purpose} · {action.status}</div><div className="mt-1 text-xs leading-5 text-slate-400">{action.reason}</div>{action.toolCandidates.length ? <div className="mt-2 text-xs text-cyan-300">{action.toolCandidates.map((tool) => tool.slug).join(' · ')}</div> : null}</div>)}</Panel>
              <Panel title="Verified evidence">{result.evidence.map((item, index) => <div key={`${item.source}-${index}`} className="mb-3 text-xs leading-5"><span className={item.status === 'verified-tool-output' ? 'text-emerald-300' : 'text-amber-300'}>{item.status}</span><div className="text-slate-300">{item.query}</div>{item.error ? <div className="text-slate-500">{item.error}</div> : null}</div>)}</Panel>
              <Panel title="Agent swarm"><div className="grid gap-2">{result.agents.map((agent) => <div key={agent.id} className="rounded-xl border border-slate-800 px-3 py-2 text-xs"><div className="font-medium text-slate-200">{agent.name}</div><div className="mt-1 text-slate-500">{agent.mission}</div></div>)}</div></Panel>
              <Panel title="Video-derived skills"><div className="grid gap-2">{result.skills.map((skill) => <div key={skill.id} className="text-xs"><span className="text-cyan-300">{skill.name}</span><span className="text-slate-500"> · {skill.risk}</span></div>)}</div></Panel>
            </aside>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="text-sm text-slate-300">{label}<input className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 outline-none" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></label>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5"><div className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</div>{children}</section>;
}
