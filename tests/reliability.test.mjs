import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  actionDigest,
  classifyActionRisk,
  normalizeToolSlug,
  sanitizeActionArguments,
} from '../lib/actions.ts';
import { isCronAuthorised } from '../lib/cron-auth.ts';
import { operatorTaskTransition } from '../lib/task-router.ts';
import { mintSignedToken, verifySignedToken } from '../lib/token-codec.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('signed tokens verify intact claims', () => {
  const secret = 'unit-test-secret';
  const claims = { kind: 'action', exp: 2_000_000_000, nonce: 'abc' };
  const token = mintSignedToken(secret, claims);
  assert.deepEqual(verifySignedToken(secret, token, 1_900_000_000), claims);
});

test('signed tokens reject payload tampering and wrong secrets', () => {
  const secret = 'unit-test-secret';
  const token = mintSignedToken(secret, { kind: 'profile', exp: 2_000_000_000, profileId: 'owner' });
  const [payload, signature] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  decoded.profileId = 'attacker';
  const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');
  assert.equal(verifySignedToken(secret, `${tamperedPayload}.${signature}`, 1_900_000_000), null);
  assert.equal(verifySignedToken('wrong-secret', token, 1_900_000_000), null);
});

test('signed tokens reject expired claims', () => {
  const token = mintSignedToken('secret', { kind: 'profile', exp: 100, profileId: 'owner' });
  assert.equal(verifySignedToken('secret', token, 100), null);
  assert.equal(verifySignedToken('secret', token, 101), null);
});

test('action digest is stable across object key ordering', () => {
  const first = actionDigest({
    toolSlug: 'GMAIL_SEND_EMAIL',
    arguments: { subject: 'Hello', recipient_email: 'a@example.com', nested: { b: 2, a: 1 } },
  });
  const second = actionDigest({
    toolSlug: 'GMAIL_SEND_EMAIL',
    arguments: { nested: { a: 1, b: 2 }, recipient_email: 'a@example.com', subject: 'Hello' },
  });
  assert.equal(first, second);
});

test('action digest changes if approved arguments or account change', () => {
  const base = { toolSlug: 'GMAIL_SEND_EMAIL', arguments: { recipient_email: 'a@example.com', body: 'one' } };
  const digest = actionDigest(base);
  assert.notEqual(digest, actionDigest({ ...base, arguments: { recipient_email: 'a@example.com', body: 'two' } }));
  assert.notEqual(digest, actionDigest({ ...base, connectedAccountId: 'account-two' }));
});

test('action risk classification keeps consequential actions behind approval', () => {
  assert.equal(classifyActionRisk('GMAIL_FETCH_EMAILS'), 'read');
  assert.equal(classifyActionRisk('GMAIL_SEND_EMAIL'), 'write');
  assert.equal(classifyActionRisk('GITHUB_MERGE_PULL_REQUEST'), 'high');
  assert.equal(classifyActionRisk('UNKNOWN_EXTERNAL_TOOL'), 'write');
});

test('tool slugs and action argument limits reject unsafe shapes', () => {
  assert.equal(normalizeToolSlug(' gmail_send_email '), 'GMAIL_SEND_EMAIL');
  assert.equal(normalizeToolSlug('../danger'), null);
  assert.deepEqual(sanitizeActionArguments(null), {});
  assert.equal(sanitizeActionArguments({ payload: 'x'.repeat(65_000) }), null);
});

test('cron authorization is fail-closed and exact', () => {
  assert.equal(isCronAuthorised(null, 'secret'), false);
  assert.equal(isCronAuthorised('Bearer secret', undefined), false);
  assert.equal(isCronAuthorised('Bearer secret', 'secret'), true);
  assert.equal(isCronAuthorised('bearer secret', 'secret'), false);
  assert.equal(isCronAuthorised('Bearer secret-extra', 'secret'), false);
  assert.equal(isCronAuthorised('Bearer wrong', 'secret'), false);
});

test('operator task transitions route approvals and verified completion correctly', () => {
  assert.deepEqual(
    operatorTaskTransition({ status: 'completed', summary: 'Verified complete.' }),
    { queue: 'done', owner: 'ai', approval: 'none', status: 'completed' },
  );
  assert.deepEqual(
    operatorTaskTransition({
      status: 'approval_required',
      summary: 'Send email.',
      pendingAction: { toolSlug: 'GMAIL_SEND_EMAIL', risk: 'write' },
    }),
    {
      queue: 'decisions',
      owner: 'user',
      approval: 'required',
      status: 'blocked',
      toolSlug: 'GMAIL_SEND_EMAIL',
      risk: 'write',
    },
  );
  assert.equal(operatorTaskTransition({ status: 'needs_input', summary: 'Need a date.' }).queue, 'decisions');
  assert.equal(operatorTaskTransition({ status: 'blocked', summary: 'Provider unavailable.' }).status, 'blocked');
});

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (/\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|yml|yaml)$/.test(entry.name)) files.push(full);
  }
  return files;
}

test('canonical ELP branding has no literal legacy assistant name in source paths or content', async () => {
  const legacy = String.fromCharCode(76, 85, 75, 69);
  const files = await walk(root);
  const offenders = [];
  for (const file of files) {
    const relative = path.relative(root, file);
    if (relative.toUpperCase().includes(legacy)) offenders.push(`${relative} (path)`);
    const content = await readFile(file, 'utf8');
    if (content.toUpperCase().includes(legacy)) offenders.push(relative);
  }
  assert.deepEqual(offenders, []);
});

test('all autonomous cron routes use the centralized authorization guard', async () => {
  const routes = [
    'app/api/cron/daily-briefing/route.ts',
    'app/api/cron/meeting-outcomes/route.ts',
    'app/api/cron/notifications/route.ts',
    'app/api/cron/opportunity-radar/route.ts',
    'app/api/cron/relationship-intelligence/route.ts',
  ];
  for (const route of routes) {
    const content = await readFile(path.join(root, route), 'utf8');
    assert.match(content, /isCronRequestAuthorised/);
    assert.doesNotMatch(content, /process\.env\.CRON_SECRET/);
  }
});

test('public health route does not serialize secret values', async () => {
  const content = await readFile(path.join(root, 'app/api/healthz/route.ts'), 'utf8');
  assert.doesNotMatch(content, /apiKey\s*:/i);
  assert.doesNotMatch(content, /secret\s*:/i);
  assert.match(content, /checks/);
  assert.match(content, /release/);
});
