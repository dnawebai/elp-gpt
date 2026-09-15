import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const voice = read('lib/useElpVoice.ts');
const bridge = read('app/PasskeyStepUpBridge.tsx');
const escalation = read('lib/approval-escalation.ts');
const presence = read('lib/approval-presence-notifications.ts');
const cron = read('app/api/cron/notifications/route.ts');
const vercel = read('vercel.json');
const delivery = read('lib/notification-delivery.ts');
const deliveryRoute = read('app/api/notification-delivery/route.ts');

test('voice exposes durable approval list, approve, and reject functions', () => {
  assert.match(voice, /name: 'list_pending_approvals'/);
  assert.match(voice, /name: 'approve_pending_approval'/);
  assert.match(voice, /name: 'reject_pending_approval'/);
  assert.match(voice, /fetch\('\/api\/approvals'/);
  assert.match(voice, /fetch\('\/api\/approvals\/continue'/);
});

test('voice approval requires recent explicit user speech and re-fetches the durable queue', () => {
  assert.match(voice, /lastUserUtteranceRef/);
  assert.match(voice, /Date\.now\(\) - spoken\.at <= 25_000/);
  assert.match(voice, /explicitApprovalLanguage\(spoken\.content\)/);
  assert.match(voice, /Explicit spoken/);
  assert.match(voice, /const listed = await listPendingApprovals\(\)/);
  assert.match(voice, /continuationId: selected\.continuationId, action/);
  assert.doesNotMatch(voice, /proposalToken/);
  assert.doesNotMatch(voice, /executionToken/);
});

test('high-risk durable voice approvals remain on the global passkey step-up path', () => {
  assert.match(bridge, /parsed\.pathname === '\/api\/approvals\/continue'/);
  assert.match(bridge, /high-risk-approval/);
});

test('approval creation triggers immediate priority delivery', () => {
  assert.match(presence, /deliverPriorityNotifications/);
  assert.match(presence, /Immediate approval delivery failed/);
});

test('pending approvals escalate before expiry and notification cron runs every fifteen minutes', () => {
  assert.match(escalation, /WARNING_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(escalation, /CRITICAL_MS = 30 \* 60 \* 1000/);
  assert.match(escalation, /Approval expires soon/);
  assert.match(escalation, /Approval nearing expiry/);
  assert.match(cron, /refreshApprovalEscalations/);
  assert.match(vercel, /"\/api\/cron\/notifications", "schedule": "\*\/15 \* \* \* \*"/);
});

test('Web Push secrets are sealed and legacy plaintext is migrated away', () => {
  assert.match(delivery, /sealServerEnvelope/);
  assert.match(delivery, /unsealServerEnvelope/);
  assert.match(delivery, /subscriptionSealed: sealServerEnvelope\(input, PUSH_SUBSCRIPTION_PURPOSE\)/);
  assert.match(delivery, /subscriptionJson: ''/);
  assert.match(delivery, /recordVersion: 2/);
  assert.match(delivery, /const legacy = parseJson<PushSubscriptionSecret>\(item\.metadata\.subscriptionJson\)/);
  assert.match(delivery, /subscriptionSealed: sealServerEnvelope\(legacy, PUSH_SUBSCRIPTION_PURPOSE\)/);
});

test('notification delivery control plane requires owner authority', () => {
  assert.match(deliveryRoute, /resolveZeroTrustAuthority/);
  assert.match(deliveryRoute, /context\.principal\.role !== 'owner'/);
  assert.match(deliveryRoute, /Authenticated owner authority is required/);
});

test('approval Web Push opens the Approval Center directly', () => {
  assert.match(delivery, /notification\.kind === 'approval' \? '\/approvals' : '\/notifications'/);
});
