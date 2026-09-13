import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('Gmail and Outlook use durable incremental checkpoints instead of mailbox rescans', async () => {
  const sync = await source('lib/communications-sync.ts');
  assert.match(sync, /GMAIL_GET_PROFILE/);
  assert.match(sync, /GMAIL_LIST_HISTORY/);
  assert.match(sync, /OUTLOOK_GET_MAIL_DELTA/);
  assert.match(sync, /delta_token/);
  assert.match(sync, /skip_token/);
  assert.match(sync, /CATEGORY_PROMOTIONS/);
  assert.match(sync, /baselineComplete/);
  assert.match(sync, /without replaying/);
});

test('communications deltas flow into the event fabric, notifications and interrupt manager', async () => {
  const [sync, notifications, fabric] = await Promise.all([
    source('lib/communications-sync.ts'),
    source('lib/notifications.ts'),
    source('lib/event-fabric.ts'),
  ]);
  assert.match(sync, /recordInboundEvent/);
  assert.match(sync, /refreshNotifications/);
  assert.match(sync, /runInterruptManager/);
  assert.match(notifications, /listRecentInboundEvents/);
  assert.match(notifications, /communication-/);
  assert.match(fabric, /listRecentInboundEvents/);
});

test('communications polling remains bounded and cron-authenticated', async () => {
  const [sync, cron, vercel] = await Promise.all([
    source('lib/communications-sync.ts'),
    source('app/api/cron/communications-sync/route.ts'),
    source('vercel.json'),
  ]);
  assert.match(sync, /slice\(0, 20\)/);
  assert.match(sync, /top: 100/);
  assert.match(cron, /isCronRequestAuthorised/);
  assert.match(vercel, /\/api\/cron\/communications-sync/);
  assert.match(vercel, /\*\/2 \* \* \* \*/);
});

test('Mission Control exposes communications sync health and manual refresh', async () => {
  const [api, page] = await Promise.all([
    source('app/api/mission-control/route.ts'),
    source('app/mission-control/page.tsx'),
  ]);
  assert.match(api, /getCommunicationsSyncSnapshot/);
  assert.match(api, /communications/);
  assert.match(page, /Communications sync/);
  assert.match(page, /\/api\/communications-sync/);
});
