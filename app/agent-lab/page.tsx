'use client';

import { useMemo, useState } from 'react';

const sampleWorkflow = {
  id: 'executive-research',
  name: 'Executive Research Workflow',
  version: '1.0.0',
  entryNodeId: 'analyse',
  maxIterations: 8,
  evaluationThreshold: 0.8,
  nodes: [
    { id: 'analyse', type: 'agent', name: 'Senior Analyst', prompt: 'Analyse this request and return a concise executive answer: {{request}}', outputKey: 'analysis' },
    { id: 'quality', type: 'condition', name: 'Quality Gate', condition: { key: 'analysis', operator: 'nonEmpty' } },
    { id: 'final', type: 'output', name: 'Final Output', inputKey: 'analysis', outputKey: 'answer' },
  ],
  edges: [
    { from: 'analyse', to: 'quality' },
    { from: 'quality', to: 'final', when: 'true' },
  ],
};

export default function AgentLabPage() {
  const [slashyObjective, setSlashyObjective] = useState('Find dropped balls, important follow-ups and communications that need my attention.');
  const [slashy, setSlashy] = useState<any>(null);
  const [slashyBusy, setSlashyBusy] = useState(false);
  const [workflowText, setWorkflowText] = useState(JSON.stringify(sampleWorkflow, null, 2));
  const [inputsText, setInputsText] = useState(JSON.stringify({ request: 'Summarize what needs executive attention.' }, null, 2));
  const [vellum, setVellum] = useState<any>(null);
  const [vellumBusy, setVellumBusy] = useState(false);
  const workflowValid = useMemo(() => { try { JSON.parse(workflowText); JSON.parse(inputsText); return true; } catch { return false; } }, [workflowText, inputsText]);

  async function runSlashy() {
    setSlashyBusy(true); setSlashy(null);
    try {
      const response = await fetch('/api/agents/slashy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objective: slashyObjective, refreshCommunications: true }) });
      setSlashy(await response.json());
    } finally { setSlashyBusy(false); }
  }

  async function runVellum(action: 'run' | 'evaluate' = 'run') {
    setVellumBusy(true); setVellum(null);
    try {
      const workflow = JSON.parse(workflowText);
      const inputs = JSON.parse(inputsText);
      const body = action === 'evaluate'
        ? { action, workflow, scenarios: [{ id: 'default', name: 'Default scenario', inputs, metrics: [{ type: 'nonEmpty', key: 'answer' }] }] }
        : { action, workflow, inputs };
      const response = await fetch('/api/agents/vellum', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setVellum(await response.json());
    } finally { setVellumBusy(false); }
  }

  return <main style={{ minHeight: '100vh', background: '#07111f', color: '#eaf2ff', padding: '32px', fontFamily: 'Inter, system-ui, sans-serif' }}>
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <p style={{ opacity: .65, letterSpacing: 1.5, textTransform: 'uppercase', fontSize: 12 }}>ELP Agent Engineering</p>
      <h1 style={{ fontSize: 40, margin: '8px 0' }}>Slashy + Vellum Agent Lab</h1>
      <p style={{ opacity: .72, maxWidth: 850 }}>Slashy operates communications, memory anchors and dropped-ball detection. Vellum runs bounded graph workflows, traces and evaluation gates. External mutations remain governed by ELP approvals.</p>

      <section style={{ marginTop: 30, padding: 24, border: '1px solid #22344d', borderRadius: 18, background: '#0b1728' }}>
        <h2>Slashy Communications Operator</h2>
        <textarea value={slashyObjective} onChange={(e) => setSlashyObjective(e.target.value)} rows={4} style={{ width: '100%', marginTop: 10, padding: 14, borderRadius: 12, background: '#07111f', color: 'inherit', border: '1px solid #29415f' }} />
        <button onClick={runSlashy} disabled={slashyBusy || !slashyObjective.trim()} style={{ marginTop: 12, padding: '11px 18px', borderRadius: 10, cursor: 'pointer' }}>{slashyBusy ? 'Running…' : 'Run Slashy'}</button>
        {slashy && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#07111f', padding: 18, borderRadius: 12, marginTop: 16, maxHeight: 520, overflow: 'auto' }}>{slashy.synthesis || slashy.error || JSON.stringify(slashy, null, 2)}</pre>}
      </section>

      <section style={{ marginTop: 24, padding: 24, border: '1px solid #22344d', borderRadius: 18, background: '#0b1728' }}>
        <h2>Vellum Workflow & Evaluation Runtime</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 14, marginTop: 12 }}>
          <textarea value={workflowText} onChange={(e) => setWorkflowText(e.target.value)} rows={22} style={{ width: '100%', padding: 14, borderRadius: 12, background: '#07111f', color: 'inherit', border: '1px solid #29415f', fontFamily: 'monospace' }} />
          <textarea value={inputsText} onChange={(e) => setInputsText(e.target.value)} rows={22} style={{ width: '100%', padding: 14, borderRadius: 12, background: '#07111f', color: 'inherit', border: '1px solid #29415f', fontFamily: 'monospace' }} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button onClick={() => runVellum('run')} disabled={vellumBusy || !workflowValid} style={{ padding: '11px 18px', borderRadius: 10, cursor: 'pointer' }}>{vellumBusy ? 'Running…' : 'Run Workflow'}</button>
          <button onClick={() => runVellum('evaluate')} disabled={vellumBusy || !workflowValid} style={{ padding: '11px 18px', borderRadius: 10, cursor: 'pointer' }}>Evaluate</button>
        </div>
        {vellum && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#07111f', padding: 18, borderRadius: 12, marginTop: 16, maxHeight: 600, overflow: 'auto' }}>{JSON.stringify(vellum, null, 2)}</pre>}
      </section>
    </div>
  </main>;
}
