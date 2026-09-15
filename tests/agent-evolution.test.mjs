import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const evolution = fs.readFileSync(new URL('../lib/agent-evolution.ts', import.meta.url), 'utf8');
const swarm = fs.readFileSync(new URL('../lib/agent-swarm.ts', import.meta.url), 'utf8');
const agi = fs.readFileSync(new URL('../lib/agi-core.ts', import.meta.url), 'utf8');
const route = fs.readFileSync(new URL('../app/api/agents/evolution/route.ts', import.meta.url), 'utf8');

test('agent evolution separates measured outcomes from unknown accuracy and business impact', () => {
  assert.match(evolution, /verifiedAccuracy\?: number/);
  assert.match(evolution, /businessImpact\?: number/);
  assert.match(evolution, /At least one measurable outcome signal is required/);
  assert.match(evolution, /accuracy:unmeasured/);
  assert.match(evolution, /impact:unmeasured/);
});

test('promotion requires independent evidence rather than response style alone', () => {
  assert.match(evolution, /recent\.length >= 15/);
  assert.match(evolution, /accuracySamples >= 5/);
  assert.match(evolution, /businessSamples >= 3/);
  assert.match(evolution, /verificationFailures === 0/);
  assert.match(evolution, /tier = 'champion'/);
});

test('weak agents enter probation or retirement without deleting core coordinators', () => {
  assert.match(evolution, /tier = 'probation'/);
  assert.match(evolution, /tier = 'retired'/);
  assert.match(evolution, /PROTECTED_CORE/);
  assert.match(evolution, /Core coordinating roles cannot be automatically retired/);
  assert.match(evolution, /selectionBias = tier === 'champion'/);
});

test('retired specialists are excluded while mandatory core agents remain selected', () => {
  assert.match(swarm, /entry\.measuredBias > -50/);
  assert.match(swarm, /const core = scored\.filter/);
  assert.match(swarm, /chief-strategist/);
  assert.match(swarm, /market-intelligence/);
  assert.match(swarm, /operations-chief/);
  assert.match(swarm, /agentSelectionBias/);
});

test('AGI core records observations and uses historical evolution bias', () => {
  assert.match(agi, /getAgentEvolutionSnapshot/);
  assert.match(agi, /evolutionSelectionBias/);
  assert.match(agi, /recordSwarmEvolution/);
  assert.match(agi, /recordedObservations/);
});

test('verified outcome evidence is owner-only and restricted to known ELP agents', () => {
  assert.match(route, /verifyProfileToken/);
  assert.match(route, /ELP_SWARM_AGENTS\.find/);
  assert.match(route, /Unknown ELP specialist agent/);
  assert.match(route, /recordVerifiedAgentOutcome/);
  assert.match(route, /evidence is required/);
});
