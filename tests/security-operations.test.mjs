import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('security ledger is hash chained and detects forks or disconnected history', () => {
  const audit = read('lib/security-audit.ts');
  assert.match(audit, /createHash\('sha256'\)/);
  assert.match(audit, /prevHash/);
  assert.match(audit, /GENESIS_HASH/);
  assert.match(audit, /heads\.length !== 1/);
  assert.match(audit, /roots\.length !== 1/);
  assert.match(audit, /Cycle detected in the security audit chain/);
  assert.match(audit, /unreachable event or forked branch/);
});

test('security monitor detects authentication bursts session sprawl and critical action failures without automatic lockdown', () => {
  const operations = read('lib/security-operations.ts');
  assert.match(operations, /passkeyFailures15 >= 5/);
  assert.match(operations, /passkeyFailures15 >= 10/);
  assert.match(operations, /denied15 >= 8/);
  assert.match(operations, /denied15 >= 16/);
  assert.match(operations, /principalSessions\.length >= 8/);
  assert.match(operations, /principalSessions\.length >= 12/);
  assert.match(operations, /criticalActionFailures >= 3/);
  const assessment = operations.slice(operations.indexOf('export async function assessSecurityOperations'), operations.indexOf('export async function revokeOneSecuritySession'));
  assert.doesNotMatch(assessment, /revokePrincipalSession\(/);
  assert.doesNotMatch(assessment, /revokeCompanionDevice\(/);
});

test('security response mutations require authority management and fresh step-up', () => {
  const route = read('app/api/security-operations/route.ts');
  const bridge = read('app/PasskeyStepUpBridge.tsx');
  const policy = read('lib/api-authority-policy.ts');
  assert.match(route, /hasCapability\(context\.principal\.role, 'manage_authority'/);
  assert.match(route, /verifyPrincipalStepUpToken/);
  assert.match(route, /stepUpRequired:\s*true/);
  assert.match(route, /'revoke-session'/);
  assert.match(route, /'revoke-principal-sessions'/);
  assert.match(route, /'lockdown'/);
  assert.match(route, /'resolve-incident'/);
  assert.match(bridge, /\/api\/security-operations/);
  assert.match(policy, /pathname\.startsWith\('\/api\/security-operations'\).*'manage_authority'/);
});

test('expected passkey step-up prompts are informational rather than anomaly denials', () => {
  const authority = read('app/api/authority-control/route.ts');
  const passkeys = read('app/api/passkeys/route.ts');
  assert.match(authority, /authority\.step_up_required/);
  assert.match(authority, /outcome:\s*'info', severity:\s*'normal'/);
  assert.match(passkeys, /passkey\.step_up_required/);
  assert.match(passkeys, /stepUpMethod:\s*activePasskeys\.length \? 'passkey' : 'access-grant'/);
  assert.doesNotMatch(authority, /authority\.change_denied/);
  assert.doesNotMatch(passkeys, /passkey\.revoke_denied/);
});

test('security incident notifications are scoped and do not resolve unrelated notifications', () => {
  const operations = read('lib/security-operations.ts');
  const store = read('lib/notification-store.ts');
  assert.match(operations, /upsertNotificationCandidates\(profileId, candidates, \{ resolveMissing: false \}\)/);
  assert.match(store, /options\?\.resolveMissing/);
  assert.match(store, /candidate\.source === 'security-operations'/);
});

test('security monitor is cron authenticated and scheduled hourly', () => {
  const cron = read('app/api/cron/security-monitor/route.ts');
  const vercel = read('vercel.json');
  assert.match(cron, /isCronRequestAuthorised/);
  assert.doesNotMatch(cron, /process\.env\.CRON_SECRET/);
  assert.match(cron, /persistIncidents:\s*true/);
  assert.match(cron, /notify:\s*true/);
  assert.match(vercel, /"\/api\/cron\/security-monitor",\s*"schedule":\s*"27 \* \* \* \*"/);
});

test('passkey session authority and high-risk action lifecycle feed security audit', () => {
  for (const path of [
    'app/api/passkeys/route.ts',
    'app/api/authority-session/route.ts',
    'app/api/authority-control/route.ts',
    'app/api/actions/approve/route.ts',
    'app/api/actions/execute/route.ts',
  ]) {
    assert.match(read(path), /recordSecurityEventSafe/, `${path} should write security events`);
  }
  const execute = read('app/api/actions/execute/route.ts');
  assert.match(execute, /action\.high_risk_executed/);
  assert.match(execute, /action\.high_risk_failed/);
});

test('security operations console exposes posture integrity incidents sessions and guarded lockdown', () => {
  const page = read('app/security/page.tsx');
  assert.match(page, /Audit ledger & incident response/);
  assert.match(page, /AUDIT INTEGRITY/);
  assert.match(page, /OPEN INCIDENTS/);
  assert.match(page, /ACTIVE SESSIONS/);
  assert.match(page, /Revoke all sessions/);
  assert.match(page, /Full lockdown/);
  assert.match(page, /window\.confirm/);
});
