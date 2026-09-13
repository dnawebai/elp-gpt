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
import { nextRunAfter, validateJobSchedule } from '../lib/job-schedule.ts';
import {
  DEFAULT_NOTIFICATION_DELIVERY_PREFERENCES,
  deliveryKey,
  isQuietHours,
  notificationChannelDelayMinutes,
  shouldDeliverNotification,
} from '../lib/notification-delivery-policy.ts';
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

test('autonomous job schedules validate minimum cadence and compute interval runs', () => {
  assert.match(validateJobSchedule({ type: 'interval', everyMinutes: 30 }) || '', /60 minutes/);
  assert.equal(validateJobSchedule({ type: 'interval', everyMinutes: 60 }), null);
  const next = nextRunAfter(
    { type: 'interval', everyMinutes: 60, anchorAt: '2026-09-13T12:00:00.000Z' },
    new Date('2026-09-13T13:12:00.000Z'),
  );
  assert.equal(next, '2026-09-13T14:00:00.000Z');
});

test('daily autonomous job schedules honor the configured timezone', () => {
  const next = nextRunAfter(
    { type: 'daily', time: '08:00', timezone: 'America/Toronto' },
    new Date('2026-09-13T10:00:00.000Z'),
  );
  assert.equal(next, '2026-09-13T12:00:00.000Z');
  const tomorrow = nextRunAfter(
    { type: 'daily', time: '08:00', timezone: 'America/Toronto' },
    new Date('2026-09-13T13:00:00.000Z'),
  );
  assert.equal(tomorrow, '2026-09-14T12:00:00.000Z');
});

test('one-time autonomous jobs never reschedule after their run time', () => {
  const schedule = { type: 'once', runAt: '2026-09-13T16:00:00.000Z' };
  assert.equal(nextRunAfter(schedule, new Date('2026-09-13T15:00:00.000Z')), '2026-09-13T16:00:00.000Z');
  assert.equal(nextRunAfter(schedule, new Date('2026-09-13T16:00:00.000Z')), null);
});

test('notification escalation delays preserve channel boundaries', () => {
  assert.equal(notificationChannelDelayMinutes({ channel: 'push', severity: 'high', kind: 'risk' }), 0);
  assert.equal(notificationChannelDelayMinutes({ channel: 'email', severity: 'high', kind: 'approval' }), 0);
  assert.equal(notificationChannelDelayMinutes({ channel: 'sms', severity: 'critical', kind: 'risk' }), 0);
  assert.equal(notificationChannelDelayMinutes({ channel: 'voice', severity: 'critical', kind: 'failure' }), 10);
  assert.equal(notificationChannelDelayMinutes({ channel: 'voice', severity: 'high', kind: 'approval' }), 60);
  assert.equal(notificationChannelDelayMinutes({ channel: 'sms', severity: 'normal', kind: 'task' }), Number.POSITIVE_INFINITY);
});

test('quiet hours suppress non-critical delivery but never critical alerts', () => {
  const preferences = {
    ...DEFAULT_NOTIFICATION_DELIVERY_PREFERENCES,
    pushEnabled: true,
    emailEnabled: true,
    email: 'owner@example.com',
    timezone: 'UTC',
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
  };
  const now = new Date('2026-09-13T23:30:00.000Z');
  assert.equal(isQuietHours(preferences, now), true);
  assert.equal(shouldDeliverNotification({ channel: 'email', severity: 'high', kind: 'approval', lastSeenAt: '2026-09-13T22:00:00.000Z', preferences, now }), false);
  assert.equal(shouldDeliverNotification({ channel: 'email', severity: 'critical', kind: 'approval', lastSeenAt: '2026-09-13T22:00:00.000Z', preferences, now }), true);
});

test('notification delivery keys change with occurrence or alert update', () => {
  const base = { id: 'note-1', occurrenceCount: 1, updatedAt: '2026-09-13T12:00:00.000Z' };
  assert.equal(deliveryKey(base, 'push'), deliveryKey(base, 'push'));
  assert.notEqual(deliveryKey(base, 'push'), deliveryKey({ ...base, occurrenceCount: 2 }, 'push'));
  assert.notEqual(deliveryKey(base, 'push'), deliveryKey({ ...base, updatedAt: '2026-09-13T13:00:00.000Z' }, 'push'));
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
    'app/api/cron/autonomous-jobs/route.ts',
    'app/api/cron/commitment-fulfilment/route.ts',
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

test('notification cron invokes delivery after refreshing candidates', async () => {
  const content = await readFile(path.join(root, 'app/api/cron/notifications/route.ts'), 'utf8');
  assert.match(content, /deliverPriorityNotifications/);
  assert.match(content, /refreshNotifications/);
});

test('Vercel invokes the autonomous jobs runner hourly', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  const cron = config.crons.find((entry) => entry.path === '/api/cron/autonomous-jobs');
  assert.deepEqual(cron, { path: '/api/cron/autonomous-jobs', schedule: '11 * * * *' });
});

test('public health route does not serialize secret values', async () => {
  const content = await readFile(path.join(root, 'app/api/healthz/route.ts'), 'utf8');
  assert.doesNotMatch(content, /apiKey\s*:/i);
  assert.doesNotMatch(content, /secret\s*:/i);
  assert.match(content, /checks/);
  assert.match(content, /release/);
});
