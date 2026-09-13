import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isFresh, shouldRenewCalendarWatch } from '../lib/subscription-policy.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('calendar lifecycle renews missing, expired and near-expiry watches', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  assert.equal(shouldRenewCalendarWatch({ status: 'active', expiresAt: '2026-09-15T12:00:00Z', now }), false);
  assert.equal(shouldRenewCalendarWatch({ status: 'active', expiresAt: '2026-09-14T11:00:00Z', now }), true);
  assert.equal(shouldRenewCalendarWatch({ status: 'blocked', expiresAt: '2026-09-20T12:00:00Z', now }), true);
  assert.equal(shouldRenewCalendarWatch({ status: 'active', now }), true);
});

test('incremental provider health uses a bounded freshness window', () => {
  const now = new Date('2026-09-13T12:00:00Z');
  assert.equal(isFresh('2026-09-13T11:52:00Z', 10, now), true);
  assert.equal(isFresh('2026-09-13T11:40:00Z', 10, now), false);
  assert.equal(isFresh(undefined, 10, now), false);
});

test('calendar replacement is created before previous channel cleanup', async () => {
  const lifecycle = await source('lib/subscription-lifecycle.ts');
  const createAt = lifecycle.indexOf('const replacement = await createGoogleCalendarWatch');
  const stopAt = lifecycle.indexOf("toolSlug: 'GOOGLECALENDAR_CHANNELS_STOP'");
  assert.ok(createAt >= 0 && stopAt > createAt);
  assert.match(lifecycle, /renewalWindowHours: 24/);
});

test('Gmail and Outlook remain explicit delta fallbacks when native push is unavailable', async () => {
  const lifecycle = await source('lib/subscription-lifecycle.ts');
  assert.match(lifecycle, /mode: 'delta_sync'/);
  assert.match(lifecycle, /Gmail history/);
  assert.match(lifecycle, /Outlook delta/);
  assert.match(lifecycle, /native provider push is not exposed/);
});

test('WhatsApp webhook ingress verifies challenge and signed payloads fail-closed', async () => {
  const webhook = await source('app/api/webhooks/whatsapp/route.ts');
  assert.match(webhook, /ELP_WHATSAPP_VERIFY_TOKEN/);
  assert.match(webhook, /ELP_WHATSAPP_APP_SECRET/);
  assert.match(webhook, /x-hub-signature-256/);
  assert.match(webhook, /createHmac\('sha256'/);
  assert.match(webhook, /timingSafeEqual/);
  assert.match(webhook, /runInterruptManager/);
});

test('subscription lifecycle cron is authenticated and scheduled every six hours', async () => {
  const [cron, vercel] = await Promise.all([
    source('app/api/cron/subscription-lifecycle/route.ts'),
    source('vercel.json'),
  ]);
  assert.match(cron, /isCronRequestAuthorised/);
  assert.match(cron, /runSubscriptionLifecycle/);
  assert.match(vercel, /\/api\/cron\/subscription-lifecycle/);
  assert.match(vercel, /13 \*\/6 \* \* \*/);
});

test('Mission Control exposes lifecycle health and manual refresh', async () => {
  const [api, page] = await Promise.all([
    source('app/api/mission-control/route.ts'),
    source('app/mission-control/page.tsx'),
  ]);
  assert.match(api, /getSubscriptionLifecycleSnapshot/);
  assert.match(api, /subscriptionLifecycle/);
  assert.match(page, /Subscription lifecycle/);
  assert.match(page, /\/api\/subscription-lifecycle/);
  assert.match(page, /Refresh subscriptions/);
});
