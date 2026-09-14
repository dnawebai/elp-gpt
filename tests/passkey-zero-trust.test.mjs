import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('universal API proxy fails closed for delegated sessions and preserves signed external ingress', () => {
  const proxy = read('proxy.ts');
  const policy = read('lib/api-authority-policy.ts');
  assert.match(proxy, /verifyProfileToken/);
  assert.match(proxy, /verifyPrincipalSessionToken/);
  assert.match(proxy, /validatePrincipalSession/);
  assert.match(proxy, /requiredApiCapability/);
  assert.match(proxy, /Principal does not have/);
  assert.match(proxy, /matcher:\s*\['\/api\/:path\*'\]/);
  for (const route of ['/api/identity', '/api/healthz', '/api/device-agent', '/api/companion/enroll', '/api/voice/think']) assert.ok(policy.includes(`'${route}'`));
  assert.ok(policy.includes("'/api/cron/'"));
  assert.ok(policy.includes("'/api/webhooks/'"));
});

test('passkey ceremonies require user verification and bind challenges to ELP identity', () => {
  const service = read('lib/passkey-service.ts');
  const security = read('lib/security.ts');
  assert.match(service, /userVerification:\s*'required'/);
  assert.match(service, /requireUserVerification:\s*true/g);
  assert.match(service, /expectedOrigin:\s*origin/);
  assert.match(service, /expectedRPID:\s*rpID/);
  assert.match(service, /updatePasskeyUsage/);
  assert.match(security, /kind:\s*'passkey-challenge'/);
  assert.match(security, /PrincipalStepUpMethod = 'access-grant' \| 'passkey'/);
});

test('registered passkeys cannot be bypassed by access-grant step-up', () => {
  const approve = read('app/api/actions/approve/route.ts');
  const sessions = read('app/api/authority-session/route.ts');
  const authority = read('app/api/authority-control/route.ts');
  assert.match(approve, /passkeys\.length && stepUp\.method !== 'passkey'/);
  assert.match(approve, /stepUpMethod:\s*'passkey'/);
  assert.match(sessions, /registered passkey/);
  assert.match(authority, /stepUp\.method !== 'passkey'/);
});

test('client bridge automatically retries protected actions after a passkey assertion', () => {
  const bridge = read('app/PasskeyStepUpBridge.tsx');
  const client = read('lib/passkey-client.ts');
  const layout = read('app/layout.tsx');
  assert.match(bridge, /response\.status !== 428/);
  assert.match(bridge, /performPasskeyStepUp/);
  assert.match(bridge, /stepUpToken/);
  assert.match(client, /startRegistration/);
  assert.match(client, /startAuthentication/);
  assert.match(layout, /<PasskeyStepUpBridge \/>/);
});
