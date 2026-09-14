import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=(file)=>readFile(path.join(root,file),'utf8');

test('delegated principal sessions are registry-bound and revocable',async()=>{
  const [security,sessions,resolver]=await Promise.all([source('lib/security.ts'),source('lib/principal-sessions.ts'),source('lib/zero-trust-authority.ts')]);
  assert.match(security,/sessionId:/);assert.match(security,/tokenVersion:/);assert.match(security,/assurance:/);assert.match(security,/principal-step-up/);
  assert.match(sessions,/revokePrincipalSession/);assert.match(sessions,/tokenVersion: randomUUID\(\)/);assert.match(sessions,/consumePrincipalAccessNonce/);assert.match(sessions,/elpPrincipalAccessConsumed/);
  assert.match(resolver,/validatePrincipalSession/);assert.match(resolver,/principal\.status !== 'active'/);
});

test('principal access is one-time and delegated high risk requires step-up',async()=>{
  const [sessionRoute,approve]=await Promise.all([source('app/api/authority-session/route.ts'),source('app/api/actions/approve/route.ts')]);
  assert.match(sessionRoute,/exchange-access/);assert.match(sessionRoute,/consumePrincipalAccessNonce/);assert.match(sessionRoute,/httpOnly: true/);assert.match(sessionRoute,/secure: true/);
  assert.match(approve,/stepUpToken/);assert.match(approve,/high-risk-approval/);assert.match(approve,/status: 428/);
});

test('action pipeline binds planning approval and execution to live zero-trust authority',async()=>{
  const files=await Promise.all(['app/api/actions/plan/route.ts','app/api/actions/approve/route.ts','app/api/actions/execute/route.ts'].map(source));
  for(const file of files) assert.match(file,/resolveZeroTrustAuthority/);
  assert.match(files[0],/principalId: context\.principal\.id/);
  assert.match(files[2],/token\.principalId !== context\.principal\.id/);
});

test('operational APIs enforce principal capabilities',async()=>{
  const expectations=[
    ['app/api/device-control/route.ts','control_devices'],
    ['app/api/connections/route.ts','manage_integrations'],
    ['app/api/phone-control/route.ts','make_calls'],
    ['app/api/execution-calendar-actions/route.ts','manage_calendar'],
    ['app/api/protected-blocks/route.ts','manage_calendar'],
    ['app/api/tasks/route.ts','manage_tasks'],
  ];
  for(const [file,capability] of expectations){const text=await source(file);assert.match(text,/requireZeroTrustAuthority/);assert.ok(text.includes(`'${capability}'`),`${file} must enforce ${capability}`);}
});

test('authority mutations revoke delegated sessions and can issue one-time access',async()=>{
  const route=await source('app/api/authority-control/route.ts');
  assert.match(route,/revokeAllPrincipalSessions/);assert.match(route,/createPrincipalAccess/);assert.match(route,/create-access/);assert.match(route,/authority-management/);assert.match(route,/status: 428/);
});

test('desktop companion is packaged with a constrained renderer and safe local execution',async()=>{
  const [pkg,main,agent,preload,html,workflow]=await Promise.all([
    source('companion/desktop/package.json'),source('companion/desktop/main.cjs'),source('companion/desktop/agent.cjs'),source('companion/desktop/preload.cjs'),source('companion/desktop/renderer.html'),source('.github/workflows/desktop-companion.yml')
  ]);
  assert.match(pkg,/electron-builder/);assert.match(pkg,/"dmg"/);assert.match(pkg,/"nsis"/);
  assert.match(main,/contextIsolation:true/);assert.match(main,/nodeIntegration:false/);assert.match(main,/sandbox:true/);
  assert.match(agent,/execFileAsync/);assert.doesNotMatch(agent,/shell\s*:\s*true/);assert.match(agent,/\^https:/);assert.match(agent,/0o600/);
  assert.match(preload,/contextBridge/);assert.match(html,/Content-Security-Policy/);assert.match(workflow,/macos-latest/);assert.match(workflow,/windows-latest/);
});
