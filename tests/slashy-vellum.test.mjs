import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('Slashy is grounded in ELP memory, communications and fulfilment', () => {
  const source = read('lib/slashy-agent.ts');
  assert.match(source, /getMemorySnapshot/);
  assert.match(source, /getCommunicationsSyncSnapshot/);
  assert.match(source, /getCommitmentFulfilmentSnapshot/);
  assert.match(source, /getExecutiveLedger/);
  assert.match(source, /getTaskBoard/);
  assert.match(source, /droppedBallSignals/);
  assert.match(source, /memoryAnchors/);
});

test('Slashy external writes remain approval governed', () => {
  const source = read('lib/slashy-agent.ts');
  assert.match(source, /classifyActionRisk/);
  assert.match(source, /proposedWriteTools/);
  assert.match(source, /action approval or standing-authority controls/);
  assert.doesNotMatch(source, /executeComposioTool\s*\(/);
});

test('Vellum workflow runtime is bounded and traceable', () => {
  const source = read('lib/vellum-agent.ts');
  assert.match(source, /MAX_NODES = 32/);
  assert.match(source, /MAX_ITERATIONS = 12/);
  assert.match(source, /MAX_SCENARIOS = 12/);
  assert.match(source, /trace: VellumTraceStep\[\]/);
  assert.match(source, /totalLatencyMs/);
  assert.match(source, /replayOf/);
  assert.match(source, /deploymentGate/);
});

test('Vellum blocks write and high-risk tool nodes', () => {
  const source = read('lib/vellum-agent.ts');
  assert.match(source, /classifyActionRisk\(node\.toolSlug\)/);
  assert.match(source, /if \(risk !== 'read'\)/);
  assert.match(source, /approvalRequired: true/);
  assert.match(source, /External write\/high-risk tool nodes must use ELP action planning and approval/);
});

test('Vellum supports quantitative deterministic metrics and regression gates', () => {
  const source = read('lib/vellum-agent.ts');
  for (const metric of ['contains', 'notContains', 'exact', 'jsonValid', 'nonEmpty']) assert.match(source, new RegExp(metric));
  assert.match(source, /evaluationThreshold/);
  assert.match(source, /deploymentGate: score >= threshold/);
});

test('Slashy and Vellum APIs require authenticated profile identity', () => {
  const slashy = read('app/api/agents/slashy/route.ts');
  const vellum = read('app/api/agents/vellum/route.ts');
  for (const source of [slashy, vellum]) {
    assert.match(source, /PROFILE_COOKIE/);
    assert.match(source, /verifyProfileToken/);
    assert.match(source, /Identity not established/);
    assert.match(source, /private, no-store/);
  }
});

test('global skill registry includes creative, Slashy and Vellum skill packs', () => {
  const source = read('lib/skill-registry.ts');
  assert.match(source, /HERMES_CREATIVE_SKILLS/);
  assert.match(source, /AGENT_PLATFORM_SKILLS/);
  assert.match(source, /\.\.\.AGENT_PLATFORM_SKILLS/);
  const api = read('app/api/skills/route.ts');
  assert.match(api, /ALL_ELP_SKILLS/);
  assert.match(api, /matchAllSkills/);
});
