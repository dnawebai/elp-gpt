import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const secure = read('lib/secure-envelope.ts');
const store = read('lib/approval-continuations.ts');
const runtime = read('lib/approval-continuation-runtime.ts');
const approval = read('lib/action-approval.ts');
const orchestrator = read('lib/agent-action-orchestrator.ts');
const router = read('lib/core-agent-router.ts');
const seriousRoute = read('app/api/agents/serious/route.ts');
const continueRoute = read('app/api/approvals/continue/route.ts');
const approvalsRoute = read('app/api/approvals/route.ts');
const page = read('app/approvals/page.tsx');
const bridge = read('app/PasskeyStepUpBridge.tsx');

test('approval continuations encrypt exact action envelopes at rest', () => {
  assert.match(secure, /aes-256-gcm/);
  assert.match(secure, /getAuthTag/);
  assert.match(secure, /setAuthTag/);
  assert.match(secure, /MAX_PLAINTEXT_BYTES = 32_000/);
  assert.match(store, /sealServerEnvelope\(envelope, PURPOSE\)/);
  assert.match(store, /unsealServerEnvelope<ApprovalContinuationEnvelope>/);
  assert.match(store, /\[ELP_APPROVAL_CONTINUATION\]/);
  const metadataStart = store.indexOf('metadata: {');
  const metadataEnd = store.indexOf('continuationStatus:', metadataStart);
  const metadata = store.slice(metadataStart, metadataEnd);
  assert.doesNotMatch(metadata, /arguments:/);
  assert.doesNotMatch(metadata, /proposalToken/);
});

test('continuations are bounded to seven days and only pending records can resume', () => {
  assert.match(store, /7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(store, /found\.record\.status !== 'pending'/);
  assert.match(store, /status === 'pending' && Date\.parse\(expiresAt\) <= Date\.now\(\)/);
});

test('agent approvals persist a continuation tied to the originating run', () => {
  assert.match(orchestrator, /persistApprovalContinuation/);
  assert.match(orchestrator, /verifyActionToken\(proposalToken\)/);
  assert.match(orchestrator, /sourceRunId\?: string/);
  assert.match(orchestrator, /sourceRunId: args\.sourceRunId/);
  assert.match(router, /sourceRunId: runId/);
  assert.match(seriousRoute, /sourceRunId: runId/);
  assert.ok(router.indexOf('const runId = randomUUID();', router.indexOf("if (mode === 'serious')")) < router.indexOf('orchestrateAgentActions', router.indexOf("if (mode === 'serious')")));
});

test('resumed approvals revalidate the original digest before shared approval and execution', () => {
  assert.match(runtime, /actionDigest/);
  assert.match(runtime, /digest !== envelope\.digest \|\| digest !== record\.digest/);
  assert.match(runtime, /createActionToken/);
  assert.match(runtime, /approveGovernedAction/);
  assert.match(runtime, /executeGovernedAction/);
  assert.match(runtime, /recordActionRejected/);
  assert.match(approval, /requiredApprovalCapability/);
  assert.match(approval, /high-risk-approval/);
});

test('continuation endpoint remains zero-trust and high-risk passkey retry aware', () => {
  assert.match(continueRoute, /resolveZeroTrustAuthority/);
  assert.match(continueRoute, /runApprovalContinuation/);
  assert.match(bridge, /\/api\/approvals\/continue/);
  assert.match(bridge, /high-risk-approval/);
});

test('Approval Center exposes redacted resumable records, not raw action secrets', () => {
  assert.match(approvalsRoute, /listApprovalContinuations/);
  assert.match(approvalsRoute, /resumablePending/);
  assert.match(page, /Approval Center/);
  assert.match(page, /Approve & execute/);
  assert.match(page, /Reject/);
  assert.match(page, /\/api\/approvals\/continue/);
  assert.doesNotMatch(page, /item\.arguments/);
  assert.doesNotMatch(page, /proposalToken/);
});
