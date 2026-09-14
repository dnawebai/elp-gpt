import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  classifyCommunicationsState,
  classifyConnection,
  classifyProviderHealth,
  likelyAuthFailure,
  likelyMisboundAccount,
  sanitizeDiagnostic,
} from '../lib/integration-health-policy.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

const account = (patch = {}) => ({
  id: 'account-1', toolkit: 'gmail', label: 'Gmail', alias: null, userId: 'user-1', status: 'ACTIVE', disabled: false,
  authScheme: 'OAUTH2', accountType: 'PRIVATE', createdAt: null, updatedAt: null, source: 'profile', risk: 'write', read: true, write: true, approval: 'required',
  ...patch,
});

test('connection failures become explicit reconnect repairs while disabled accounts stay user-controlled', () => {
  const failed = classifyConnection(account({ status: 'EXPIRED' }));
  assert.equal(failed.status, 'broken');
  assert.equal(failed.repairKind, 'reconnect');

  const disabled = classifyConnection(account({ disabled: true }));
  assert.equal(disabled.status, 'disabled');
  assert.equal(disabled.repairKind, 'enable');
  assert.match(disabled.detail, /not re-enable it automatically/i);
});

test('provider diagnostics distinguish auth failures, misbound accounts and provider boundaries', () => {
  assert.equal(likelyAuthFailure('401 invalid_grant token expired'), true);
  assert.equal(likelyMisboundAccount('Invalid WABA ID for business account'), true);

  const misbound = classifyProviderHealth({ provider: 'whatsapp', accountLabel: 'WhatsApp', status: 'degraded', note: 'Invalid WABA ID for business account' });
  assert.equal(misbound.repairKind, 'reconnect');
  assert.equal(misbound.status, 'broken');

  const blocked = classifyProviderHealth({ provider: 'slack', accountLabel: 'Slack', status: 'blocked', note: 'Events API subscription creation unavailable.' });
  assert.equal(blocked.status, 'provider_limited');
  assert.equal(blocked.repairKind, 'provider_boundary');
});

test('mailbox sync automatically retries stale checkpoints but reconnects auth failures', () => {
  const now = new Date('2026-09-13T20:00:00Z');
  const stale = classifyCommunicationsState({ provider: 'gmail', accountLabel: 'Gmail', baselineComplete: true, lastSuccessAt: '2026-09-13T19:40:00Z', now });
  assert.equal(stale.repairKind, 'resync');
  const auth = classifyCommunicationsState({ provider: 'outlook', accountLabel: 'Outlook', baselineComplete: true, lastError: '401 Unauthorized: token expired', now });
  assert.equal(auth.repairKind, 'reconnect');
  assert.equal(auth.status, 'broken');
});

test('diagnostics redact common bearer and query token forms', () => {
  const result = sanitizeDiagnostic('Bearer abcdefghijklmnopqrstuvwxyz https://x.test?a=1&token=supersecretvalue');
  assert.doesNotMatch(result, /abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(result, /supersecretvalue/);
  assert.match(result, /\[redacted\]/);
});

test('self-healing cron is fail-closed and scheduled hourly', async () => {
  const [cron, vercel] = await Promise.all([
    source('app/api/cron/integration-health/route.ts'),
    source('vercel.json'),
  ]);
  assert.match(cron, /isCronRequestAuthorised/);
  assert.match(cron, /runIntegrationHealth/);
  assert.match(vercel, /\/api\/cron\/integration-health/);
  assert.match(vercel, /19 \* \* \* \*/);
});

test('repair API preserves explicit provider auth boundary', async () => {
  const [api, engine, page] = await Promise.all([
    source('app/api/integration-health/route.ts'),
    source('lib/integration-health.ts'),
    source('app/integration-health/page.tsx'),
  ]);
  assert.match(api, /action === 'repair'/);
  assert.match(engine, /createConnectionLink/);
  assert.match(engine, /setConnectedAccountEnabled/);
  assert.match(engine, /provider_boundary/);
  assert.match(page, /Integration Self-Healing Center/);
  assert.match(page, /Run full health scan/);
});
