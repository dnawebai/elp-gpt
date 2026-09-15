import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { capabilitiesForRole, hasCapability, requiredApprovalCapability } from '../lib/authority-policy.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('authority roles are least-privilege ceilings', () => {
  assert.equal(hasCapability('owner', 'manage_authority'), true);
  assert.equal(hasCapability('executive', 'approve_high_risk'), true);
  assert.equal(hasCapability('assistant', 'approve_write'), true);
  assert.equal(hasCapability('assistant', 'approve_high_risk'), false);
  assert.deepEqual(capabilitiesForRole('viewer'), ['read_context']);
  assert.equal(hasCapability('operator', 'send_messages'), false);
});

test('approval risk maps to explicit principal capabilities', () => {
  assert.equal(requiredApprovalCapability('read'), null);
  assert.equal(requiredApprovalCapability('write'), 'approve_write');
  assert.equal(requiredApprovalCapability('high'), 'approve_high_risk');
});

test('approved action tokens are bound to the approving principal', async () => {
  const [security, approval, approveRoute, executeRoute, governor] = await Promise.all([
    source('lib/security.ts'),
    source('lib/action-approval.ts'),
    source('app/api/actions/approve/route.ts'),
    source('app/api/actions/execute/route.ts'),
    source('lib/action-governor.ts'),
  ]);
  assert.match(security, /principalId\?: string/);
  assert.match(approval, /principalId: context\.principal\.id/);
  assert.match(approval, /requiredApprovalCapability/);
  assert.match(governor, /token\.principalId && token\.principalId !== context\.principal\.id/);
  assert.match(approveRoute, /approveGovernedAction/);
  assert.match(executeRoute, /executeGovernedAction/);
});

test('companion enrollment is signed, one-time and revocable', async () => {
  const [security, authority, enroll] = await Promise.all([
    source('lib/security.ts'),
    source('lib/principal-authority.ts'),
    source('app/api/companion/enroll/route.ts'),
  ]);
  assert.match(security, /kind: 'companion-enrollment'/);
  assert.match(security, /kind: 'companion'/);
  assert.match(authority, /enrollment\.consumedAt/);
  assert.match(authority, /tokenVersion/);
  assert.match(authority, /status: 'revoked'/);
  assert.match(enroll, /consumeCompanionEnrollment/);
});

test('device commands are target scoped and companions have allowlists', async () => {
  const [control, agent] = await Promise.all([
    source('lib/device-control.ts'),
    source('app/api/device-agent/route.ts'),
  ]);
  assert.match(control, /targetDeviceId/);
  assert.match(control, /allowedTypes/);
  assert.match(agent, /verifyCompanionAccess/);
  assert.match(agent, /companion\.device\.allowedCommands/);
});

test('companion agent persists its exchanged token with restricted permissions', async () => {
  const agent = await source('scripts/elp-device-agent.mjs');
  assert.match(agent, /ELP_COMPANION_ENROLLMENT_TOKEN/);
  assert.match(agent, /\/api\/companion\/enroll/);
  assert.match(agent, /mode: 0o600/);
  assert.match(agent, /chmod\(tokenFile, 0o600\)/);
});

test('authority control exposes principal and companion lifecycle without delegated owner creation', async () => {
  const [api, core, page] = await Promise.all([
    source('app/api/authority-control/route.ts'),
    source('lib/principal-authority.ts'),
    source('app/authority-control/page.tsx'),
  ]);
  assert.match(api, /manage_authority/);
  assert.match(core, /bootstrap owner role cannot be delegated/);
  assert.match(core, /companion\.revoke/);
  assert.match(page, /Principal Authority/);
  assert.match(page, /One-time enrollment/);
});
