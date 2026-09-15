import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const governor = fs.readFileSync(new URL('../lib/action-governor.ts', import.meta.url), 'utf8');
const orchestrator = fs.readFileSync(new URL('../lib/agent-action-orchestrator.ts', import.meta.url), 'utf8');
const swarm = fs.readFileSync(new URL('../lib/agent-swarm.ts', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../lib/core-agent-router.ts', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../app/api/chat/route.ts', import.meta.url), 'utf8');
const planRoute = fs.readFileSync(new URL('../app/api/actions/plan/route.ts', import.meta.url), 'utf8');
const executeRoute = fs.readFileSync(new URL('../app/api/actions/execute/route.ts', import.meta.url), 'utf8');

test('manual and agent actions share the same governance runtime', () => {
  assert.match(planRoute, /planGovernedAction/);
  assert.match(executeRoute, /executeGovernedAction/);
  assert.match(orchestrator, /planGovernedAction/);
  assert.match(orchestrator, /executeGovernedAction/);
  assert.match(governor, /recordActionProposal/);
  assert.match(governor, /recordActionExecuting/);
  assert.match(governor, /recordActionExecuted/);
  assert.match(governor, /recordActionFailed/);
});

test('shared governance preserves capability, standing-authority and digest controls', () => {
  assert.match(governor, /hasCapability/);
  assert.match(governor, /requiredApprovalCapability/);
  assert.match(governor, /evaluateStandingAuthority/);
  assert.match(governor, /recordStandingAuthorityUse/);
  assert.match(governor, /actionDigest/);
  assert.match(governor, /Action changed after authorization/);
});

test('high-risk agent actions are forced to explicit approval', () => {
  assert.match(governor, /forceExplicitApprovalForHigh/);
  assert.match(governor, /risk === 'high' && options\.forceExplicitApprovalForHigh === true/);
  assert.match(orchestrator, /forceExplicitApprovalForHigh: true/);
  assert.match(orchestrator, /risk === 'high'/);
  assert.doesNotMatch(orchestrator, /risk === 'high' && standingAuthorityAuthorized &&.*executeGovernedAction/);
});

test('read actions and standing-authorized ordinary writes may execute through governed tokens', () => {
  assert.match(orchestrator, /shouldExecuteRead = risk === 'read'/);
  assert.match(orchestrator, /shouldExecuteStandingWrite = risk === 'write'/);
  assert.match(orchestrator, /executeGovernedAction/);
  assert.match(governor, /token\.risk !== 'read' && token\.stage !== 'approved'/);
});

test('tool resolution discovers exact tools, validates schemas and blocks invented sensitive inputs', () => {
  assert.match(orchestrator, /searchComposioTools/);
  assert.match(orchestrator, /inputSchema/);
  assert.match(orchestrator, /Resolver did not select one of the discovered tools/);
  assert.match(orchestrator, /Tool input schema is unavailable/);
  assert.match(orchestrator, /not grounded in supplied context/);
  assert.match(orchestrator, /const MAX_ACTIONS = 6/);
});

test('Serious Mode emits natural-language action intents rather than connector slugs', () => {
  assert.match(swarm, /export type ActionIntent/);
  assert.match(swarm, /natural-language Composio tool search query/);
  assert.match(swarm, /never invent an exact connector tool slug/);
  assert.match(swarm, /actionIntents: extractActionIntents/);
});

test('chat resolves zero-trust authority and passes it into specialist routing', () => {
  assert.match(chat, /resolveZeroTrustAuthority/);
  assert.match(chat, /authorityContext/);
  assert.match(router, /authorityContext\?: ZeroTrustAuthorityContext \| null/);
  assert.match(router, /orchestrateAgentActions/);
});

test('durable agent memory stores redacted governance summaries rather than execution tokens', () => {
  assert.match(router, /governedActions: summarizeGovernedAgentActions\(governedActions\)/);
  const summaryStart = orchestrator.indexOf('export function summarizeGovernedAgentActions');
  const summaryEnd = orchestrator.indexOf('export function governedActionExecutionSummary');
  const summaryFunction = orchestrator.slice(summaryStart, summaryEnd);
  assert.doesNotMatch(summaryFunction, /proposalToken/);
  assert.doesNotMatch(summaryFunction, /executionToken/);
  assert.doesNotMatch(summaryFunction, /executionResult/);
});
