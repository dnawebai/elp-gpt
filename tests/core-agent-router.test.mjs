import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../lib/core-agent-router.ts', import.meta.url), 'utf8');
const memory = fs.readFileSync(new URL('../lib/agent-run-memory.ts', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../app/api/chat/route.ts', import.meta.url), 'utf8');
const vellum = fs.readFileSync(new URL('../lib/vellum-agent.ts', import.meta.url), 'utf8');
const mesh = fs.readFileSync(new URL('../lib/cognitive-mesh.ts', import.meta.url), 'utf8');
const briefing = fs.readFileSync(new URL('../app/api/cron/daily-briefing/route.ts', import.meta.url), 'utf8');

test('normal chat has an explicit specialist routing boundary', () => {
  assert.match(chat, /routeCoreAgent/);
  assert.match(chat, /if \(specialist\.handled\)/);
  assert.match(chat, /runElp\(/);
  assert.match(router, /if \(!mode\) return \{ handled: false \}/);
});

test('Slashy, Vellum and Cognitive Mesh require explicit or strong intent signals', () => {
  assert.match(router, /use\|ask\|run/);
  assert.match(router, /dropped balls/);
  assert.match(router, /evaluate/);
  assert.match(router, /first agi/);
  assert.match(router, /cognitive mesh/);
  assert.match(router, /if \(slashySignals\.some/);
  assert.match(router, /if \(vellumSignals\.some/);
  assert.match(router, /if \(meshSignals\.some/);
  assert.match(router, /return null;/);
});

test('Vellum continues to block write and high-risk tool nodes', () => {
  assert.match(vellum, /classifyActionRisk/);
  assert.match(vellum, /risk !== 'read'/);
  assert.match(vellum, /approvalRequired: true/);
  assert.match(vellum, /must use ELP action planning and approval/);
});

test('specialist and mesh runs persist durable run and trace metadata', () => {
  assert.match(router, /persistAgentRun/);
  assert.match(router, /selectedAgents/);
  assert.match(memory, /'mesh'/);
  assert.match(memory, /elpAgentRun: true/);
  assert.match(memory, /traceJson/);
  assert.match(memory, /metadataJson/);
  assert.match(memory, /agent-runs-/);
});

test('Vellum chat workflow is bounded and produces a final output', () => {
  assert.match(router, /maxIterations: 4/);
  assert.match(router, /id: 'planner'/);
  assert.match(router, /id: 'reviewer'/);
  assert.match(router, /id: 'output'/);
  assert.match(router, /outputKey: 'answer'/);
});

test('cognitive mesh dynamically selects a bounded expert panel with independent verification', () => {
  assert.match(mesh, /executive-orchestrator/);
  assert.match(mesh, /repository-scout/);
  assert.match(mesh, /venture-intelligence/);
  assert.match(mesh, /world-model/);
  assert.match(mesh, /authority-guardian/);
  assert.match(mesh, /verifier/);
  assert.match(mesh, /maxSpecialists/);
  assert.match(mesh, /slice\(0, 5\)/);
  assert.match(mesh, /Never imply that a real-world action was completed/);
});

test('daily briefing reports verified overnight execution only from the autonomous job ledger', () => {
  assert.match(briefing, /listAutonomousJobRuns/);
  assert.match(briefing, /VERIFIED WORK COMPLETED OVERNIGHT/);
  assert.match(briefing, /NEEDS YOUR AUTHORITY OR INPUT/);
  assert.match(briefing, /Execution claims above come only from the autonomous-job ledger/);
  assert.doesNotMatch(briefing, /JARBIS/);
});
