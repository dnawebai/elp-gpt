import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = async (file) => readFile(path.join(root, file), 'utf8');

test('owner session becomes mandatory after passkey enrollment', async () => {
  const [proxy, authority, passkeys] = await Promise.all([
    source('proxy.ts'), source('lib/zero-trust-authority.ts'), source('app/api/passkeys/route.ts'),
  ]);
  assert.match(proxy, /ownerSessionRequired:true/);
  assert.match(proxy, /listActivePasskeys/);
  assert.match(authority, /passkeys\.length > 0/);
  assert.match(passkeys, /owner\.session_created_by_passkey/);
  assert.match(passkeys, /createPrincipalSessionToken/);
});

test('standing authority is explicit, exact, kill-switchable and fail-closed', async () => {
  const text = await source('lib/standing-authority.ts');
  assert.match(text, /killSwitch/);
  assert.match(text, /allowedToolSlugs\.includes\(slug\)/);
  assert.match(text, /maxActionsPerDay/);
  assert.match(text, /allowHighRisk/);
  assert.match(text, /!domains\.length/);
  assert.match(text, /amount === null/);
  assert.match(text, /!currency \|\| currency !== p\.currency/);
  assert.match(text, /A currency is required when a maximum amount is configured/);
  assert.match(text, /No active standing authority policy matches this exact action/);
});

test('security automation rules default fail closed', async () => {
  const text = await source('lib/security-automation.ts');
  assert.match(text, /enabled:input\.enabled===true/);
  assert.match(text, /revoke_subject_sessions/);
  assert.match(text, /revoke_all_sessions_and_devices/);
  assert.match(text, /previous\.some/);
});

test('desktop companion keeps local file and process controls bounded', async () => {
  const text = await source('companion/desktop/agent.cjs');
  assert.match(text, /ELP_DEVICE_FILE_ROOTS/);
  assert.match(text, /Path is outside configured ELP file roots/);
  assert.match(text, /ELP_DEVICE_PROCESS_ALLOWLIST/);
  assert.match(text, /Executable is not in the explicit ELP process allowlist/);
  assert.match(text, /screen_describe/);
});

test('mobile companion uses secure enrollment, biometrics and push registration', async () => {
  const text = await source('companion/mobile/app/index.js');
  assert.match(text, /SecureStore/);
  assert.match(text, /LocalAuthentication/);
  assert.match(text, /getExpoPushTokenAsync/);
  assert.match(text, /\/api\/companion\/enroll/);
  assert.match(text, /\/api\/mobile-companion/);
});

test('mobile voice uses companion auth, bounded audio and server-side Deepgram', async () => {
  const [app, route, deepgram, policy] = await Promise.all([
    source('companion/mobile/app/index.js'),
    source('app/api/mobile-voice/route.ts'),
    source('lib/deepgram.ts'),
    source('lib/api-authority-policy.ts'),
  ]);
  assert.match(app, /useAudioRecorder/);
  assert.match(app, /authenticated\('Start ELP voice session'\)/);
  assert.match(app, /\/api\/mobile-voice/);
  assert.match(app, /deviceContext/);
  assert.match(route, /verifyCompanionAccess/);
  assert.match(route, /MAX_AUDIO_BYTES/);
  assert.match(route, /transcribeDeepgramAudio/);
  assert.match(route, /synthesizeDeepgramSpeech/);
  assert.match(deepgram, /\/v1\/listen/);
  assert.match(deepgram, /\/v2\/speak/);
  assert.match(deepgram, /flux-colin-en/);
  assert.match(policy, /'\/api\/mobile-voice'/);
  assert.doesNotMatch(app, /DEEPGRAM_API_KEY/);
});

test('external audit export verifies the chain and signs batches', async () => {
  const text = await source('lib/security-audit-export.ts');
  assert.match(text, /verifySecurityAuditChain/);
  assert.match(text, /createHmac\('sha256'/);
  assert.match(text, /Idempotency-Key/);
  assert.match(text, /protocol!=='https:'/);
});

test('computer operator excludes high-risk UI categories', async () => {
  const text = await source('lib/computer-operator.ts');
  assert.match(text, /Never perform purchases, financial transfers, credential entry/);
  assert.match(text, /Choose exactly ONE next UI step/);
  assert.match(text, /screen_describe/);
});
