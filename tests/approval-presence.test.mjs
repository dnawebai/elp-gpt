import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const presence = read('app/ApprovalPresence.tsx');
const layout = read('app/layout.tsx');
const continuations = read('lib/approval-continuations.ts');
const notifications = read('lib/approval-presence-notifications.ts');
const bridge = read('app/PasskeyStepUpBridge.tsx');

test('approval presence is global rather than page-specific', () => {
  assert.match(layout, /import ApprovalPresence from '.\/ApprovalPresence'/);
  assert.match(layout, /<ApprovalPresence \/>/);
  assert.match(presence, /fetch\('\/api\/approvals'/);
  assert.match(presence, /document\.visibilityState === 'visible'/);
  assert.match(presence, /window\.addEventListener\('focus'/);
});

test('global presence resumes durable approvals by id without exposing action secrets', () => {
  assert.match(presence, /fetch\('\/api\/approvals\/continue'/);
  assert.match(presence, /JSON\.stringify\(\{ continuationId: item\.id, action \}\)/);
  assert.doesNotMatch(presence, /proposalToken/);
  assert.doesNotMatch(presence, /executionToken/);
  assert.doesNotMatch(presence, /item\.arguments/);
  assert.match(presence, /Approve & execute/);
  assert.match(presence, /Reject/);
});

test('high-risk continuation approval remains on the passkey step-up path', () => {
  assert.match(bridge, /parsed\.pathname === '\/api\/approvals\/continue'/);
  assert.match(bridge, /high-risk-approval/);
});

test('persisted agent continuations create one immediate ledger-compatible approval notification', () => {
  assert.match(continuations, /publishApprovalPresenceNotification/);
  assert.match(continuations, /nonce: envelope\.nonce/);
  assert.match(notifications, /kind: 'approval'/);
  assert.match(notifications, /source: 'approval'/);
  assert.match(notifications, /sourceId: input\.nonce/);
  assert.match(notifications, /approval\|\$\{nonce\}\|approval/);
  assert.match(notifications, /resolveMissing: false/);
  assert.match(notifications, /Open Approval Center/);
});

test('terminal continuation states resolve their approval notification', () => {
  assert.match(continuations, /resolveApprovalPresenceNotification\(profileId, found\.record\.nonce\)/);
  assert.match(notifications, /item\.source === 'approval'/);
  assert.match(notifications, /item\.sourceId === nonce/);
  assert.match(notifications, /updateNotification\(profileId, item\.id, 'resolved'\)/);
});
