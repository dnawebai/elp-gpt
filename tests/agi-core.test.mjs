import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const agi = fs.readFileSync(new URL('../lib/agi-core.ts', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../lib/core-agent-router.ts', import.meta.url), 'utf8');
const briefing = fs.readFileSync(new URL('../app/api/cron/daily-briefing/route.ts', import.meta.url), 'utf8');

test('AGI Core adds repository, world-model and memory lenses around Serious Mode', () => {
  assert.match(agi, /repository-intelligence/);
  assert.match(agi, /world-model/);
  assert.match(agi, /memory-steward/);
  assert.match(agi, /getExecutiveLedger/);
  assert.match(agi, /runUnifiedAgentSwarm/);
});

test('AGI Core independently verifies the swarm synthesis before returning it', () => {
  assert.match(agi, /ELP Independent Verifier/);
  assert.match(agi, /fake completion claims/);
  assert.match(agi, /synthesis: verified\.text/);
});

test('AGI and GitHub-repository objectives route to enhanced Serious Mode', () => {
  assert.match(router, /first agi/);
  assert.match(router, /github\|git/);
  assert.match(router, /runAgiCore/);
  assert.match(router, /cognitiveLenses/);
});

test('daily briefing claims completed work only from the durable autonomous-job ledger', () => {
  assert.match(briefing, /listAutonomousJobRuns/);
  assert.match(briefing, /VERIFIED WORK COMPLETED OVERNIGHT/);
  assert.match(briefing, /NEEDS YOUR AUTHORITY OR INPUT/);
  assert.match(briefing, /Execution claims above come only from the autonomous-job ledger/);
  assert.doesNotMatch(briefing, /JARBIS/);
});
