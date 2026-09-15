import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router = fs.readFileSync(new URL('../lib/core-agent-router.ts', import.meta.url), 'utf8');
const memory = fs.readFileSync(new URL('../lib/agent-run-memory.ts', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../app/api/chat/route.ts', import.meta.url), 'utf8');
const vellum = fs.readFileSync(new URL('../lib/vellum-agent.ts', import.meta.url), 'utf8');

test('normal chat has an explicit specialist routing boundary', () => {
  assert.match(chat, /routeCoreAgent/);
  assert.match(chat, /if \(specialist\.handled\)/);
  assert.match(chat, /runElp\(/);
  assert.match(router, /if \(!mode\) return \{ handled: false \}/);
});

test('Slashy and Vellum require explicit or strong intent signals', () => {
  assert.match(router, /use\|ask\|run/);
  assert.match(router, /dropped balls/);
  assert.match(router, /evaluate/);
  assert.doesNotMatch(router, /return 'slashy';\s*$/m);
});

test('Vellum continues to block write and high-risk tool nodes', () => {
  assert.match(vellum, /classifyActionRisk/);
  assert.match(vellum, /risk !== 'read'/);
  assert.match(vellum, /approvalRequired: true/);
  assert.match(vellum, /must use ELP action planning and approval/);
});

test('specialist runs persist durable run and trace metadata', () => {
  assert.match(router, /persistAgentRun/);
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
