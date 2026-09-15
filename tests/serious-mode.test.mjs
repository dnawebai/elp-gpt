import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const swarm = fs.readFileSync(new URL('../lib/agent-swarm.ts', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../lib/core-agent-router.ts', import.meta.url), 'utf8');
const memory = fs.readFileSync(new URL('../lib/agent-run-memory.ts', import.meta.url), 'utf8');
const route = fs.readFileSync(new URL('../app/api/agents/serious/route.ts', import.meta.url), 'utf8');

test('Serious Mode exposes the full 12-domain specialist roster', () => {
  for (const domain of [
    'strategy', 'research', 'marketing', 'sales', 'content', 'product',
    'engineering', 'automation', 'finance', 'legal', 'security', 'operations',
  ]) assert.match(swarm, new RegExp(`domain: '${domain}'`));
});

test('Serious Mode is bounded and always includes core coordinating disciplines', () => {
  assert.match(swarm, /const MAX_AGENTS = 8/);
  assert.match(swarm, /const MIN_AGENTS = 3/);
  assert.match(swarm, /chief-strategist/);
  assert.match(swarm, /market-intelligence/);
  assert.match(swarm, /operations-chief/);
  assert.match(swarm, /Promise\.all\(agents\.map/);
});

test('individual specialist failures are isolated rather than collapsing the swarm', () => {
  assert.match(swarm, /status: 'failed'/);
  assert.match(swarm, /if \(!completed\.length\)/);
  assert.match(swarm, /All Serious Mode specialists failed/);
});

test('Serious Mode may propose skills but cannot silently install them', () => {
  assert.match(swarm, /proposed skills are specifications only/);
  assert.match(swarm, /must never be treated as installed/);
  assert.match(swarm, /skillCandidates/);
  assert.doesNotMatch(swarm, /installSkill\s*\(/);
  assert.doesNotMatch(swarm, /createSkill\s*\(/);
});

test('consequential actions remain behind ELP approval controls', () => {
  assert.match(swarm, /approval and standing-authority controls/);
  assert.match(swarm, /External writes and consequential actions remain behind ELP approval controls/);
  assert.doesNotMatch(swarm, /executeComposioTool/);
});

test('normal ELP chat supports explicit Serious Mode without hijacking ordinary chat', () => {
  assert.match(router, /mode: 'slashy' \| 'vellum' \| 'serious'/);
  assert.match(router, /\/serious/);
  assert.match(router, /if \(mode === 'serious'\)/);
  assert.match(router, /if \(!mode\) return \{ handled: false \}/);
});

test('Serious Mode runs are authenticated and durably persisted', () => {
  assert.match(route, /verifyProfileToken/);
  assert.match(route, /runUnifiedAgentSwarm/);
  assert.match(route, /persistAgentRun/);
  assert.match(memory, /'slashy' \| 'vellum' \| 'serious'/);
  assert.match(memory, /traceJson/);
});
